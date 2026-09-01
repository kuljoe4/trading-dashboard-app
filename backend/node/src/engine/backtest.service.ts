import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SessionConfig } from '../models/SessionConfig';
import { SignalEngineService } from './signalEngine';
import { KlineStoreService, Candle } from './kline_store.service';
import { BinanceClientFactory } from '../lib/binanceClientFactory';
import { roundTo } from '../lib/math';

export interface BacktestTradeDto {
  id: string;
  symbol: string;
  strategy_label: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  exit_price: number;
  entry_ts: number;
  exit_ts: number;
  qty: number;
  pnl: number;
  pnl_pct: number;
  realized_fee: number;
  rr: number;
  exit_reason: string;
  is_knife?: boolean;
}

export interface EquityCurvePoint {
  timestamp: number;
  balance: number;
  equity: number;
  drawdown: number;
  drawdownPct: number;
}

export interface BacktestResultDto {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  pnlPct: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  expectancy: number;
  avgTradePnl: number;
  avgWin: number;
  avgLoss: number;
  startingBalance: number;
  endingBalance: number;
  totalFees: number;
  executionTimeMs: number;
  config: SessionConfig;
  equityCurve: EquityCurvePoint[];
  trades: BacktestTradeDto[];
}

export class RunBacktestDto {
  config?: SessionConfig;
  symbols?: string[];
  days?: number;
  startingBalance?: number;
  useGlobalScanner?: boolean;
}

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);

  constructor(
    private readonly signalEngine: SignalEngineService,
    private readonly klineStore: KlineStoreService,
    private readonly binanceClientFactory: BinanceClientFactory,
  ) {}

  public async runBacktest(dto: RunBacktestDto): Promise<BacktestResultDto> {
    const startMs = Date.now();
    const config = dto.config || new SessionConfig();
    const days = Math.min(Math.max(dto.days || 14, 1), 90);
    const startingBalance = Math.max(dto.startingBalance || 10000, 10);
    const scanInterval = config.scan_interval || '5m';

    // 1. Resolve Target Symbols
    let symbols = (dto.symbols && dto.symbols.length > 0)
      ? dto.symbols
      : (config.symbols && config.symbols.length > 0)
        ? config.symbols
        : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

    // Ensure all symbols end with USDT (USDT Quote Pair Filtering Standard)
    symbols = symbols.map(s => s.toUpperCase()).filter(s => s.endsWith('USDT'));
    if (symbols.length === 0) {
      symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    }

    this.logger.log(`Starting Backtest over ${days} days for ${symbols.length} symbols [${symbols.join(', ')}]...`);

    // 2. Fetch Historical Klines per Symbol
    const symbolCandlesMap = new Map<string, Candle[]>();
    const requiredWarmup = this.signalEngine.getRequiredWarmup(config);
    const intervalMs = this.parseIntervalToMs(scanInterval);
    const totalCandlesNeeded = Math.ceil((days * 24 * 60 * 60 * 1000) / intervalMs) + requiredWarmup;

    for (const symbol of symbols) {
      const candles = await this.fetchHistoricalCandles(symbol, scanInterval, totalCandlesNeeded);
      if (candles.length > requiredWarmup) {
        symbolCandlesMap.set(symbol, candles);
      }
    }

    if (symbolCandlesMap.size === 0) {
      throw new BadRequestException('Insufficient historical candle data retrieved for backtesting.');
    }

    // 3. Align Timestamps across symbols
    let minLength = Infinity;
    symbolCandlesMap.forEach((c) => {
      if (c.length < minLength) minLength = c.length;
    });

    // 4. Run Event-Driven Candle Simulation
    let balance = startingBalance;
    let peakBalance = balance;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    let totalFees = 0;

    const closedTrades: BacktestTradeDto[] = [];
    const activePositions = new Map<string, {
      id: string;
      symbol: string;
      direction: 'LONG' | 'SHORT';
      entry_price: number;
      entry_ts: number;
      qty: number;
      initial_sl: number;
      current_sl: number;
      tp_price: number | null;
      risk_usdt: number;
      peak_rr: number;
      is_knife?: boolean;
    }>();

    const lastExitTsMap = new Map<string, number>();
    const equityCurve: EquityCurvePoint[] = [];

    const sampleSymbol = Array.from(symbolCandlesMap.keys())[0];
    const fullCandles = symbolCandlesMap.get(sampleSymbol)!;

    // Taker fee rate (0.04% per side)
    const TAKER_FEE_RATE = 0.0004;

    for (let i = requiredWarmup; i < fullCandles.length; i++) {
      const currentTs = fullCandles[i].time;
      let unrealizedPnlTotal = 0;

      // Evaluate each symbol at index i
      for (const [symbol, candles] of symbolCandlesMap) {
        if (i >= candles.length) continue;
        const currentCandle = candles[i];
        const prevCandlesSlice = candles.slice(0, i + 1);

        // A. Evaluate Active Position on this symbol
        const pos = activePositions.get(symbol);
        if (pos) {
          let closed = false;
          let exitPrice = currentCandle.close;
          let exitReason = '';

          // 1. Check Stop Loss breach
          if (pos.direction === 'LONG') {
            if (currentCandle.low <= pos.current_sl) {
              closed = true;
              exitPrice = pos.current_sl;
              exitReason = pos.current_sl >= pos.entry_price ? 'STOP_LOSS_BREAKEVEN' : 'STOP_LOSS';
            }
          } else { // SHORT
            if (currentCandle.high >= pos.current_sl) {
              closed = true;
              exitPrice = pos.current_sl;
              exitReason = pos.current_sl <= pos.entry_price ? 'STOP_LOSS_BREAKEVEN' : 'STOP_LOSS';
            }
          }

          // 2. Check Fixed TP reach
          if (!closed && pos.tp_price !== null) {
            if (pos.direction === 'LONG' && currentCandle.high >= pos.tp_price) {
              closed = true;
              exitPrice = pos.tp_price;
              exitReason = 'TAKE_PROFIT';
            } else if (pos.direction === 'SHORT' && currentCandle.low <= pos.tp_price) {
              closed = true;
              exitPrice = pos.tp_price;
              exitReason = 'TAKE_PROFIT';
            }
          }

          // 3. Trailing Ratchet SL logic & Peak RR calculation
          if (!closed) {
            const currentPnl = pos.direction === 'LONG'
              ? (currentCandle.close - pos.entry_price) * pos.qty
              : (pos.entry_price - currentCandle.close) * pos.qty;

            const slDist = Math.abs(pos.entry_price - pos.initial_sl);
            const currentRr = slDist > 0 ? (currentPnl / pos.risk_usdt) : 0;
            if (currentRr > pos.peak_rr) pos.peak_rr = currentRr;

            // Dynamic Trailing Stop Loss
            const trailingEnabled = pos.is_knife
              ? config.knife_trailing_enabled !== false
              : config.trailing_stop_enabled === true;
            const trailingDistancePct = pos.is_knife
              ? (config.knife_trailing_distance_pct ?? 0.5)
              : (config.trailing_stop_distance_pct ?? 1.0);

            if (trailingEnabled && trailingDistancePct > 0) {
              if (pos.direction === 'LONG') {
                const trailSl = currentCandle.high * (1 - trailingDistancePct / 100);
                if (trailSl > pos.current_sl) {
                  pos.current_sl = trailSl;
                }
              } else { // SHORT
                const trailSl = currentCandle.low * (1 + trailingDistancePct / 100);
                if (trailSl < pos.current_sl) {
                  pos.current_sl = trailSl;
                }
              }
            }

            // Ratchet SL on Exponential RR sequence milestone
            if (config.tp_mode === 'exp_rr_seq' && config.live_rr_sequence && config.exit_rr_sequence) {
              const liveSeq = config.live_rr_sequence;
              const exitSeq = config.exit_rr_sequence;
              for (let k = 0; k < liveSeq.length; k++) {
                if (pos.peak_rr >= liveSeq[k]) {
                  const targetExitRr = exitSeq[k] !== undefined ? exitSeq[k] : 0;
                  const newSl = pos.direction === 'LONG'
                    ? pos.entry_price + (targetExitRr * (pos.risk_usdt / pos.qty))
                    : pos.entry_price - (targetExitRr * (pos.risk_usdt / pos.qty));

                  if (pos.direction === 'LONG' && newSl > pos.current_sl) {
                    pos.current_sl = newSl;
                  } else if (pos.direction === 'SHORT' && newSl < pos.current_sl) {
                    pos.current_sl = newSl;
                  }
                }
              }
            }
          }

          // 4. Check Exit Signals via SignalEngineService
          if (!closed && config.exit_signals && config.exit_signals.length > 0) {
            const exitCheck = this.evaluateSignalOnSlice(symbol, config, scanInterval, pos.direction, 'exit', prevCandlesSlice);
            if (exitCheck.allFired) {
              closed = true;
              exitPrice = currentCandle.close;
              exitReason = `EXIT_SIGNAL: ${exitCheck.firedSignals.join(', ')}`;
            }
          }

          if (closed) {
            const grossPnl = pos.direction === 'LONG'
              ? (exitPrice - pos.entry_price) * pos.qty
              : (pos.entry_price - exitPrice) * pos.qty;

            const entryFee = (pos.entry_price * pos.qty) * TAKER_FEE_RATE;
            const exitFee = (exitPrice * pos.qty) * TAKER_FEE_RATE;
            const realizedFee = entryFee + exitFee;
            totalFees += realizedFee;

            const netPnl = grossPnl - realizedFee;
            balance += netPnl;
            lastExitTsMap.set(symbol, currentTs);

            const pnlPct = (netPnl / (pos.entry_price * pos.qty)) * 100;
            const slDist = Math.abs(pos.entry_price - pos.initial_sl);
            const rr = slDist > 0 ? roundTo(netPnl / pos.risk_usdt, 2) : 0;

            closedTrades.push({
              id: pos.id,
              symbol,
              strategy_label: config.strategy_label || 'Momentum Strategy',
              direction: pos.direction,
              entry_price: pos.entry_price,
              exit_price: exitPrice,
              entry_ts: pos.entry_ts,
              exit_ts: currentTs,
              qty: pos.qty,
              pnl: roundTo(netPnl, 2),
              pnl_pct: roundTo(pnlPct, 2),
              realized_fee: roundTo(realizedFee, 4),
              rr,
              exit_reason: exitReason,
              is_knife: pos.is_knife || false,
            });

            activePositions.delete(symbol);
          } else {
            // Track unrealized PnL for open trade
            const unPnl = pos.direction === 'LONG'
              ? (currentCandle.close - pos.entry_price) * pos.qty
              : (pos.entry_price - currentCandle.close) * pos.qty;
            unrealizedPnlTotal += unPnl;
          }
        }

        // B. Evaluate Entry Signal if position slot available
        const useGlobalScanner = dto.useGlobalScanner !== false;
        let isScannerCandidate = true;

        if (useGlobalScanner && !activePositions.has(symbol)) {
          // Compute historical momentum over scan_lookback
          const lookback = Math.max(config.scan_lookback || 3, 1);
          if (prevCandlesSlice.length > lookback) {
            const firstClose = prevCandlesSlice[prevCandlesSlice.length - 1 - lookback].close;
            const lastClose = prevCandlesSlice[prevCandlesSlice.length - 1].close;
            const momPct = Math.abs(((lastClose - firstClose) / firstClose) * 100);
            isScannerCandidate = momPct >= (config.scan_pct_threshold || 2.0);
          }
        }

        // Check global SL guard limit (total_sl_guard_usdt)
        const cumLoss = startingBalance - balance;
        const totalSlGuardBreached = (config.total_sl_guard_usdt && config.total_sl_guard_usdt > 0)
          ? cumLoss >= config.total_sl_guard_usdt
          : false;

        if (isScannerCandidate && !totalSlGuardBreached && !activePositions.has(symbol) && activePositions.size < (config.max_open_trades || 5)) {
          // Check per-symbol anti-whipsaw cooldown and min_trade_interval_min
          const minTradeIntervalMs = Math.max(intervalMs, (config.min_trade_interval_min || 0) * 60 * 1000);
          const lastExit = lastExitTsMap.get(symbol) || 0;
          if (currentTs >= lastExit + minTradeIntervalMs) {
            const entrySide = config.entry_side || 'both';

            // Test LONG entry
            if (entrySide === 'both' || entrySide === 'long') {
              const longCheck = this.evaluateSignalOnSlice(symbol, config, scanInterval, 'LONG', 'entry', prevCandlesSlice);
              if (longCheck.allFired) {
                this.openSimulatedPosition('LONG', symbol, currentCandle, currentTs, balance, config, activePositions, longCheck.details);
                continue;
              }
            }

            // Test SHORT entry
            if (!activePositions.has(symbol) && (entrySide === 'both' || entrySide === 'short')) {
              const shortCheck = this.evaluateSignalOnSlice(symbol, config, scanInterval, 'SHORT', 'entry', prevCandlesSlice);
              if (shortCheck.allFired) {
                this.openSimulatedPosition('SHORT', symbol, currentCandle, currentTs, balance, config, activePositions, shortCheck.details);
              }
            }
          }
        }
      }

      // Equity tracking after timestamp processing
      const currentEquity = balance + unrealizedPnlTotal;
      if (currentEquity > peakBalance) peakBalance = currentEquity;
      const drawdown = Math.max(0, peakBalance - currentEquity);
      const drawdownPct = peakBalance > 0 ? (drawdown / peakBalance) * 100 : 0;

      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;

      // Sample equity curve every N steps to optimize bandwidth
      if (i % Math.max(1, Math.floor((fullCandles.length - requiredWarmup) / 100)) === 0 || i === fullCandles.length - 1) {
        equityCurve.push({
          timestamp: currentTs,
          balance: roundTo(balance, 2),
          equity: roundTo(currentEquity, 2),
          drawdown: roundTo(drawdown, 2),
          drawdownPct: roundTo(drawdownPct, 2),
        });
      }
    }

    // Force close any remaining open positions at the end of simulation
    for (const [symbol, pos] of activePositions) {
      const candles = symbolCandlesMap.get(symbol)!;
      const lastCandle = candles[candles.length - 1];
      const grossPnl = pos.direction === 'LONG'
        ? (lastCandle.close - pos.entry_price) * pos.qty
        : (pos.entry_price - lastCandle.close) * pos.qty;

      const entryFee = (pos.entry_price * pos.qty) * TAKER_FEE_RATE;
      const exitFee = (lastCandle.close * pos.qty) * TAKER_FEE_RATE;
      const realizedFee = entryFee + exitFee;
      totalFees += realizedFee;

      const netPnl = grossPnl - realizedFee;
      balance += netPnl;

      const pnlPct = (netPnl / (pos.entry_price * pos.qty)) * 100;
      const slDist = Math.abs(pos.entry_price - pos.initial_sl);
      const rr = slDist > 0 ? roundTo(netPnl / pos.risk_usdt, 2) : 0;

      closedTrades.push({
        id: pos.id,
        symbol,
        strategy_label: config.strategy_label || 'Momentum Strategy',
        direction: pos.direction,
        entry_price: pos.entry_price,
        exit_price: lastCandle.close,
        entry_ts: pos.entry_ts,
        exit_ts: lastCandle.time,
        qty: pos.qty,
        pnl: roundTo(netPnl, 2),
        pnl_pct: roundTo(pnlPct, 2),
        realized_fee: roundTo(realizedFee, 4),
        rr,
        exit_reason: 'BACKTEST_END_FORCE_CLOSE',
        is_knife: pos.is_knife || false,
      });
    }

    // 5. Compute Summary Metrics
    const totalTrades = closedTrades.length;
    const wins = closedTrades.filter(t => t.pnl > 0).length;
    const losses = closedTrades.filter(t => t.pnl <= 0).length;
    const winRate = totalTrades > 0 ? roundTo((wins / totalTrades) * 100, 2) : 0;
    const totalPnl = roundTo(balance - startingBalance, 2);
    const pnlPct = roundTo((totalPnl / startingBalance) * 100, 2);

    const grossWins = closedTrades.filter(t => t.pnl > 0).reduce((acc, t) => acc + t.pnl, 0);
    const grossLosses = Math.abs(closedTrades.filter(t => t.pnl <= 0).reduce((acc, t) => acc + t.pnl, 0));
    const profitFactor = grossLosses > 0 ? roundTo(grossWins / grossLosses, 2) : grossWins > 0 ? 99.99 : 0;

    const avgWin = wins > 0 ? roundTo(grossWins / wins, 2) : 0;
    const avgLoss = losses > 0 ? roundTo(grossLosses / losses, 2) : 0;
    const avgTradePnl = totalTrades > 0 ? roundTo(totalPnl / totalTrades, 2) : 0;

    // Expectancy per trade: (Win Rate * Avg Win) - (Loss Rate * Avg Loss)
    const winRateFrac = wins / (totalTrades || 1);
    const lossRateFrac = losses / (totalTrades || 1);
    const expectancy = roundTo((winRateFrac * avgWin) - (lossRateFrac * avgLoss), 2);

    // Sharpe ratio approximation (annualized return over std deviation of daily returns)
    const returns = closedTrades.map(t => t.pnl_pct);
    let sharpeRatio = 0;
    if (returns.length > 1) {
      const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / (returns.length - 1);
      const stdDev = Math.sqrt(variance);
      sharpeRatio = stdDev > 0 ? roundTo((meanReturn / stdDev) * Math.sqrt(252), 2) : 0;
    }

    const executionTimeMs = Date.now() - startMs;

    return {
      totalTrades,
      wins,
      losses,
      winRate,
      totalPnl,
      pnlPct,
      profitFactor,
      maxDrawdown: roundTo(maxDrawdown, 2),
      maxDrawdownPct: roundTo(maxDrawdownPct, 2),
      sharpeRatio,
      expectancy,
      avgTradePnl,
      avgWin,
      avgLoss,
      startingBalance,
      endingBalance: roundTo(balance, 2),
      totalFees: roundTo(totalFees, 2),
      executionTimeMs,
      config,
      equityCurve,
      trades: closedTrades,
    };
  }

  private evaluateSignalOnSlice(
    symbol: string,
    config: SessionConfig,
    interval: string,
    side: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit',
    candlesSlice: Candle[]
  ) {
    return this.signalEngine.checkEntry(symbol, config, interval, side, purpose, false, candlesSlice);
  }

  private openSimulatedPosition(
    direction: 'LONG' | 'SHORT',
    symbol: string,
    currentCandle: Candle,
    entryTs: number,
    balance: number,
    config: SessionConfig,
    activePositions: Map<string, any>,
    details?: any
  ) {
    const entryPrice = currentCandle.close;
    let slDistPct = config.sl_distance_pct || 2.0;

    // Apply SL floor/ceiling clamping (sl_min_pct & sl_max_pct)
    if (config.sl_min_pct !== undefined && config.sl_min_pct > 0) {
      slDistPct = Math.max(slDistPct, config.sl_min_pct);
    }
    if (config.sl_max_pct !== undefined && config.sl_max_pct > 0) {
      slDistPct = Math.min(slDistPct, config.sl_max_pct);
    }

    let initialSl = direction === 'LONG'
      ? entryPrice * (1 - slDistPct / 100)
      : entryPrice * (1 + slDistPct / 100);

    // Overwrite SL if technical signal provides explicit slPrice (e.g. Supertrend, Engulfing boundary)
    if (details) {
      for (const sigKey of Object.keys(details)) {
        if (details[sigKey]?.slPrice && typeof details[sigKey].slPrice === 'number') {
          initialSl = details[sigKey].slPrice;
          break;
        }
      }
    }

    const riskPct = config.risk_pct_per_trade || 1.0;
    const riskUsdt = Math.max(balance * (riskPct / 100), 10);
    const slDistAbs = Math.abs(entryPrice - initialSl);
    const qty = slDistAbs > 0 ? riskUsdt / slDistAbs : (riskUsdt / entryPrice);

    let tpPrice: number | null = null;
    if (config.tp_mode === 'fixed' && config.tp_ratio) {
      tpPrice = direction === 'LONG'
        ? entryPrice + (slDistAbs * config.tp_ratio)
        : entryPrice - (slDistAbs * config.tp_ratio);
    }

    const isKnife = details?.knife_catch?.fired || false;

    activePositions.set(symbol, {
      id: `bt_${symbol}_${entryTs}`,
      symbol,
      direction,
      entry_price: entryPrice,
      entry_ts: entryTs,
      qty,
      initial_sl: initialSl,
      current_sl: initialSl,
      tp_price: tpPrice,
      risk_usdt: riskUsdt,
      peak_rr: 0,
      is_knife: isKnife,
    });
  }

  private async fetchHistoricalCandles(symbol: string, interval: string, totalCount: number): Promise<Candle[]> {
    try {
      const limit = Math.min(totalCount, 1000);
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return [];

      const raw = (await response.json()) as any[][];
      if (!Array.isArray(raw)) return [];

      return raw.map(k => ({
        time: Number(k[0]),
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5])),
        closeTime: Number(k[6]),
      }));
    } catch (err) {
      this.logger.warn(`Failed to fetch historical klines for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private parseIntervalToMs(interval: string): number {
    if (!interval) return 5 * 60 * 1000;
    const unit = interval.slice(-1);
    const val = parseInt(interval.slice(0, -1), 10) || 5;
    switch (unit) {
      case 'm': return val * 60 * 1000;
      case 'h': return val * 60 * 60 * 1000;
      case 'd': return val * 24 * 60 * 60 * 1000;
      case 'w': return val * 7 * 24 * 60 * 60 * 1000;
      default: return val * 60 * 1000;
    }
  }
}
