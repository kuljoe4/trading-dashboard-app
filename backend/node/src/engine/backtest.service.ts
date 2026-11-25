import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionConfig, SingleSymbolConfig } from '../models/SessionConfig';
import { StrategyPreset as StrategyPresetEntity } from '../models/entities/StrategyPreset.entity';
import { ENGINE_CONSTANTS } from '../models/constants';
import { SignalEngineService } from './signalEngine';
import { KlineStoreService, Candle } from './kline_store.service';
import { BinanceClientFactory } from '../lib/binanceClientFactory';
import { roundTo } from '../lib/math';
import { IsOptional, IsObject, ValidateNested, IsArray, IsString, IsNumber, Min, Max, IsBoolean, ArrayMaxSize, MaxLength, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export interface BacktestTradeDto {
  id: string;
  symbol: string;
  strategy_label: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  exit_price: number;
  initial_sl?: number;
  tp_price?: number | null;
  entry_ts: number;
  exit_ts: number;
  holding_duration_ms?: number;
  qty: number;
  pnl: number;
  pnl_pct: number;
  realized_fee: number;
  rr: number;
  exit_reason: string;
  is_knife?: boolean;
  candles?: Candle[];
}

export interface EquityCurvePoint {
  timestamp: number;
  balance: number;
  equity: number;
  drawdown: number;
  drawdownPct: number;
}

export interface BacktestSymbolPerformanceDto {
  symbol: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  profitFactor: number;
  isRecommended: boolean;
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
  symbolPerformance: BacktestSymbolPerformanceDto[];
  trades: BacktestTradeDto[];
}

export class RunBacktestDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SessionConfig)
  config?: SessionConfig;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  presetId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20)
  variantIndex?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/, {
    message: 'scanInterval must be a valid Binance kline interval',
  })
  scanInterval?: string;

  // SEC-SENTINEL: Defense-in-depth array size, string length, and character-level gating
  // Prevents Denial of Service (DoS) via massive symbol arrays and script/header injection vectors
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50, { message: 'symbols array cannot exceed 50 items' })
  @MaxLength(20, { each: true, message: 'Symbol cannot exceed 20 characters' })
  @Matches(/^[a-zA-Z0-9_\-]{3,20}$/, { each: true, message: 'Symbols must contain only alphanumeric characters, underscores, or hyphens and be at least 3 characters long' })
  symbols?: string[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(730)
  days?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(100000000, { message: 'startingBalance cannot exceed 100,000,000' })
  startingBalance?: number;

  @IsOptional()
  @IsBoolean()
  useGlobalScanner?: boolean;
}

interface ExtraTimeframeState {
  interval: string;
  intervalMs: number;
  candles: Candle[];
  warmup: number;
  cursor: number;
  formingBar: Candle | null;
}

interface SimulatedPosition {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  entry_ts: number;
  entry_index?: number;
  qty: number;
  initial_sl: number;
  current_sl: number;
  tp_price: number | null;
  risk_usdt: number;
  peak_rr: number;
  is_knife?: boolean;
  trigger_candle_low?: number;
  trigger_candle_high?: number;
  trigger_candle_time?: number;
  trigger_candle_timeframe?: string;
}

interface HistoricalFetchResult {
  candles: Candle[];
  httpStatus?: number;
  errorMessage?: string;
}

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);
  private readonly candleCacheMap = new Map<string, { candles: Candle[]; fetchedAt: number }>();
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache TTL for instant backtest reruns
  private static readonly VALID_INTERVAL_RE = /^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/;

  constructor(
    private readonly signalEngine: SignalEngineService,
    private readonly klineStore: KlineStoreService,
    private readonly binanceClientFactory: BinanceClientFactory,
    @Optional()
    @InjectRepository(StrategyPresetEntity)
    private readonly presetRepository?: Repository<StrategyPresetEntity>,
  ) {}

  public async runBacktest(dto: RunBacktestDto): Promise<BacktestResultDto> {
    const startMs = Date.now();
    let config = dto.config ? Object.assign(new SessionConfig(), dto.config) : new SessionConfig();

    // 0. Resolve Strategy Preset or Strategy Variant if specified
    if (dto.presetId && this.presetRepository) {
      try {
        const preset = await this.presetRepository.findOne({
          where: [{ id: dto.presetId }, { name: dto.presetId }],
        });
        if (preset && preset.config) {
          // Preset provides base strategy; explicit dto.config overrides (e.g. from UI tweaks) apply on top
          config = dto.config
            ? Object.assign(new SessionConfig(), preset.config, dto.config)
            : Object.assign(new SessionConfig(), preset.config);
          this.logger.log(`Backtest resolving preset "${preset.name}" (${dto.presetId})`);
        }
      } catch (err) {
        this.logger.warn(`Could not resolve presetId "${dto.presetId}": ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (dto.variantIndex !== undefined && dto.variantIndex >= 0 && Array.isArray(config.strategy_variants) && config.strategy_variants[dto.variantIndex]) {
      const variant = config.strategy_variants[dto.variantIndex];
      config = Object.assign(new SessionConfig(), config, variant);
      this.logger.log(`Backtest resolving strategy variant #${dto.variantIndex} "${config.strategy_label}"`);
    }

    // Explicit scanInterval override from RunBacktestDto always takes precedence
    if (dto.scanInterval && BacktestService.VALID_INTERVAL_RE.test(dto.scanInterval)) {
      config.scan_interval = dto.scanInterval;
    }

    const days = Math.min(Math.max(dto.days || 14, 1), 730);
    const startingBalance = Math.max(dto.startingBalance || 10000, 10);
    const scanInterval = config.scan_interval || '5m';
    const intervalMs = this.parseIntervalToMs(scanInterval);

    // Resolve single-symbol solo monitors (including custom per-symbol config overrides)
    const singleSymbolMap = new Map<string, SingleSymbolConfig>();
    if (Array.isArray(config.single_symbol_configs)) {
      for (const ssc of config.single_symbol_configs) {
        if (ssc && ssc.enabled !== false && typeof ssc.symbol === 'string' && ssc.symbol.trim()) {
          singleSymbolMap.set(ssc.symbol.trim().toUpperCase(), ssc);
        }
      }
    }

    // 1. Resolve Target Symbols (explicit dto.symbols > config.symbols + enabled single_symbol_configs > default basket)
    let symbols: string[];
    if (dto.symbols && dto.symbols.length > 0) {
      symbols = dto.symbols;
    } else {
      const combined: string[] = [];
      if (Array.isArray(config.symbols)) combined.push(...config.symbols);
      for (const soloSym of singleSymbolMap.keys()) {
        combined.push(soloSym);
      }
      symbols = combined.length > 0
        ? Array.from(new Set(combined))
        : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
    }

    // Ensure all symbols end with USDT (USDT Quote Pair Filtering Standard)
    symbols = Array.from(new Set(symbols.map(s => s.trim().toUpperCase()).filter(s => s.endsWith('USDT'))));
    if (symbols.length === 0) {
      symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    }

    const restBase = config.trading_mode === 'testnet'
      ? ENGINE_CONSTANTS.BINANCE_TESTNET_REST_URL
      : (process.env.BINANCE_REST_BASE || ENGINE_CONSTANTS.BINANCE_REST_BASE);

    // Build per-symbol effective configs (honoring single_symbol_configs.custom_config)
    const symbolConfigMap = new Map<string, SessionConfig>();
    for (const symbol of symbols) {
      const ssc = singleSymbolMap.get(symbol);
      if (ssc?.use_custom_config && ssc.custom_config) {
        const merged = Object.assign(new SessionConfig(), config, ssc.custom_config);
        if (dto.scanInterval && BacktestService.VALID_INTERVAL_RE.test(dto.scanInterval)) {
          merged.scan_interval = dto.scanInterval;
        }
        symbolConfigMap.set(symbol, merged);
      } else {
        symbolConfigMap.set(symbol, config);
      }
    }

    this.logger.log(`Starting Backtest over ${days} days (${scanInterval}) for ${symbols.length} symbol(s) [${symbols.join(', ')}]...`);

    // 2. Fetch Historical Klines per Symbol (base interval + any multi-timeframe intervals)
    const symbolCandlesMap = new Map<string, Candle[]>();
    const symbolExtraTfMap = new Map<string, Map<string, ExtraTimeframeState>>();
    const symbolWarmupMap = new Map<string, number>();

    let lastFetchHttpStatus: number | undefined;
    let lastFetchError: string | undefined;
    const warmupFailures: string[] = [];

    for (const symbol of symbols) {
      const symCfg = symbolConfigMap.get(symbol) || config;
      const baseWarmup = this.getWarmupForInterval(symCfg, scanInterval, true);
      const totalCandlesNeeded = Math.ceil((days * 24 * 60 * 60 * 1000) / intervalMs) + baseWarmup + 2;

      const baseRes = await this.fetchHistoricalCandles(symbol, scanInterval, totalCandlesNeeded, restBase);
      if (baseRes.httpStatus) lastFetchHttpStatus = baseRes.httpStatus;
      if (baseRes.errorMessage) lastFetchError = baseRes.errorMessage;

      if (baseRes.candles.length > baseWarmup) {
        symbolCandlesMap.set(symbol, baseRes.candles);
        symbolWarmupMap.set(symbol, baseWarmup);

        // Fetch any additional timeframes referenced by signal_timeframes, sl_lookback_timeframe, htf_breakout, etc.
        const extraIntervals = this.collectRequiredIntervals(symCfg, scanInterval);
        extraIntervals.delete(scanInterval);

        if (extraIntervals.size > 0) {
          const tfStateMap = new Map<string, ExtraTimeframeState>();
          const spanMs = baseRes.candles.length >= 2
            ? Math.max(days * 24 * 60 * 60 * 1000, baseRes.candles[baseRes.candles.length - 1].time - baseRes.candles[0].time)
            : days * 24 * 60 * 60 * 1000;

          for (const tf of extraIntervals) {
            const tfMs = this.parseIntervalToMs(tf);
            const tfWarmup = this.getWarmupForInterval(symCfg, tf, false);
            const tfNeeded = Math.ceil(spanMs / tfMs) + tfWarmup + 5;
            const tfRes = await this.fetchHistoricalCandles(symbol, tf, tfNeeded, restBase);
            if (tfRes.candles.length > 0) {
              tfStateMap.set(tf, {
                interval: tf,
                intervalMs: tfMs,
                candles: tfRes.candles,
                warmup: tfWarmup,
                cursor: 0,
                formingBar: null,
              });
            }
          }
          if (tfStateMap.size > 0) {
            symbolExtraTfMap.set(symbol, tfStateMap);
          }
        }
      } else if (baseRes.candles.length > 0) {
        warmupFailures.push(`${symbol}: ${baseRes.candles.length}/${baseWarmup + 1} candles on ${scanInterval}`);
      }
    }

    if (symbolCandlesMap.size === 0) {
      if (lastFetchHttpStatus === 451) {
        throw new BadRequestException(
          'Binance returned HTTP 451 (Regional Geo-Restriction) while fetching historical candles. Configure a Proxy URL in Settings or switch to Testnet mode.'
        );
      }
      if (lastFetchHttpStatus === 429 || lastFetchHttpStatus === 418) {
        throw new BadRequestException(
          `Binance rate limit active (HTTP ${lastFetchHttpStatus}) while fetching historical candles. Please retry shortly.`
        );
      }
      if (warmupFailures.length > 0) {
        throw new BadRequestException(
          `Insufficient historical candle data for indicator warmup (${warmupFailures.slice(0, 3).join(', ')}). Try shorter indicator periods, a longer listing, or a lower timeframe.`
        );
      }
      throw new BadRequestException(
        lastFetchError
          ? `Insufficient historical candle data retrieved for backtesting (${lastFetchError}).`
          : 'Insufficient historical candle data retrieved for backtesting.'
      );
    }

    // 3. Determine starting warmup index and reference symbol timeline
    const sampleSymbol = Array.from(symbolCandlesMap.keys())[0];
    const fullCandles = symbolCandlesMap.get(sampleSymbol)!;
    const maxWarmup = Math.max(1, ...Array.from(symbolWarmupMap.values()));

    // 4. Run Event-Driven Candle Simulation
    let balance = startingBalance;
    let peakBalance = balance;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    let totalFees = 0;

    const closedTrades: BacktestTradeDto[] = [];
    const activePositions = new Map<string, SimulatedPosition>();
    const lastExitTsMap = new Map<string, number>();
    const equityCurve: EquityCurvePoint[] = [];

    // Switch state for backtesting (tracks active hit count)
    let activeSwitchHits = 0;
    const tradesContributingToSwitch = new Set<string>();

    // Taker fee rate (0.04% per side)
    const TAKER_FEE_RATE = 0.0004;

    // Respect explicit dto.useGlobalScanner; otherwise fall back to strategy's global_scanner_enabled setting
    const useGlobalScanner = dto.useGlobalScanner !== undefined
      ? Boolean(dto.useGlobalScanner)
      : (config.global_scanner_enabled !== false);

    try {
      for (let i = maxWarmup; i < fullCandles.length; i++) {
        const currentTs = fullCandles[i].time;
        let unrealizedPnlTotal = 0;

        // Evaluate each symbol at index i
        for (const [symbol, candles] of symbolCandlesMap) {
          if (i >= candles.length) continue;
          const symWarmup = symbolWarmupMap.get(symbol) || maxWarmup;
          if (i < symWarmup) continue;

          const symCfg = symbolConfigMap.get(symbol) || config;
          const currentCandle = candles[i];
          const extraTfStates = symbolExtraTfMap.get(symbol);

          // Advance zero-lookahead multi-timeframe pointers for this symbol once per bar
          let alignedTfMap: Map<string, Candle[]> | undefined;
          if (extraTfStates && extraTfStates.size > 0) {
            alignedTfMap = this.advanceAndBuildTimeAlignedMap(
              scanInterval,
              intervalMs,
              candles,
              i,
              symWarmup,
              currentCandle,
              extraTfStates,
            );
          }

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
              const candleExtremeReward = pos.direction === 'LONG'
                ? currentCandle.high - pos.entry_price
                : pos.entry_price - currentCandle.low;
              const slDist = Math.abs(pos.entry_price - pos.initial_sl);
              const extremeRr = slDist > 0 ? (candleExtremeReward / slDist) : 0;
              if (extremeRr > pos.peak_rr) pos.peak_rr = extremeRr;

              // Dynamic Trailing Stop Loss
              const trailingEnabled = pos.is_knife
                ? symCfg.knife_trailing_enabled !== false
                : (symCfg.trailing_stop_enabled === true || symCfg.sl_type === 'trailing');
              const trailingDistancePct = pos.is_knife
                ? (symCfg.knife_trailing_distance_pct ?? 0.5)
                : (symCfg.trailing_stop_distance_pct ?? 1.0);

              if (trailingEnabled) {
                const activationRr = symCfg.trailing_activation_rr || 0;
                let activationMet = true;
                const initialRisk = Math.abs(pos.entry_price - pos.initial_sl);

                if (activationRr > 0 && !pos.is_knife) {
                  if (initialRisk > 0) {
                    activationMet = pos.peak_rr >= activationRr;
                  }
                }

                if (activationMet) {
                  let trailSl = pos.current_sl;

                  const peakPrice = pos.direction === 'LONG'
                    ? (initialRisk > 0 ? Math.max(currentCandle.high, pos.entry_price + initialRisk * pos.peak_rr) : currentCandle.high)
                    : (initialRisk > 0 ? Math.min(currentCandle.low, pos.entry_price - initialRisk * pos.peak_rr) : currentCandle.low);

                  if (!pos.is_knife && symCfg.trailing_stop_type === 'rr' && initialRisk > 0) {
                    const rrDist = initialRisk * (symCfg.trailing_stop_rr || 1.0);
                    trailSl = pos.direction === 'LONG'
                      ? peakPrice - rrDist
                      : peakPrice + rrDist;
                  } else if (trailingDistancePct > 0) {
                    const dist = peakPrice * (trailingDistancePct / 100);
                    trailSl = pos.direction === 'LONG'
                      ? peakPrice - dist
                      : peakPrice + dist;
                  }

                  if (pos.direction === 'LONG') {
                    if (trailSl > pos.current_sl) {
                      pos.current_sl = trailSl;
                    }
                  } else { // SHORT
                    if (trailSl < pos.current_sl) {
                      pos.current_sl = trailSl;
                    }
                  }
                }
              }

              // Handle Switch Hit Tracking
              if (symCfg.tp_mode === 'exp_rr_seq_switch' && symCfg.peak_rr_switch_threshold) {
                if (pos.peak_rr >= symCfg.peak_rr_switch_threshold && !tradesContributingToSwitch.has(pos.id)) {
                  tradesContributingToSwitch.add(pos.id);
                  activeSwitchHits++;
                }
              }

              // Ratchet SL on Exponential RR sequence milestone
              if ((symCfg.tp_mode === 'exp_rr_seq' || symCfg.tp_mode === 'exp_rr_seq_switch') && symCfg.live_rr_sequence && symCfg.exit_rr_sequence) {
                let liveSeq = symCfg.live_rr_sequence;
                let exitSeq = symCfg.exit_rr_sequence;
                if (symCfg.tp_mode === 'exp_rr_seq_switch' && activeSwitchHits >= (symCfg.peak_rr_switch_count || 1)) {
                  liveSeq = symCfg.switched_live_rr_sequence || liveSeq;
                  exitSeq = symCfg.switched_exit_rr_sequence || exitSeq;
                }
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
            const hasExitSignals = Boolean((symCfg.exit_signals && symCfg.exit_signals.length > 0) || symCfg.trigger_candle_exit_enabled);
            if (!closed && hasExitSignals) {
              const exitCheck = this.evaluateSignalOnSlice(
                symbol,
                symCfg,
                scanInterval,
                pos.direction,
                'exit',
                candles,
                i,
                symWarmup,
                alignedTfMap,
                pos,
              );
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
              const rr = slDist > 0 && pos.risk_usdt > 0 ? roundTo(netPnl / pos.risk_usdt, 2) : 0;

              // Handle switch revert on trade closure
              if (symCfg.tp_mode === 'exp_rr_seq_switch' && tradesContributingToSwitch.has(pos.id)) {
                tradesContributingToSwitch.delete(pos.id);
                if (activeSwitchHits > 0) activeSwitchHits--;
              }

              const candleSlice = candles.slice(
                Math.max(0, (pos.entry_index ?? i) - 12),
                Math.min(candles.length, i + 6)
              );

              closedTrades.push({
                id: pos.id,
                symbol,
                strategy_label: symCfg.strategy_label || 'Momentum Strategy',
                direction: pos.direction,
                entry_price: pos.entry_price,
                exit_price: exitPrice,
                initial_sl: pos.initial_sl,
                tp_price: pos.tp_price,
                entry_ts: pos.entry_ts,
                exit_ts: currentTs,
                holding_duration_ms: currentTs - pos.entry_ts,
                qty: pos.qty,
                pnl: roundTo(netPnl, 2),
                pnl_pct: roundTo(pnlPct, 2),
                realized_fee: roundTo(realizedFee, 4),
                rr,
                exit_reason: exitReason,
                is_knife: pos.is_knife || false,
                candles: candleSlice,
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
          let isScannerCandidate = true;

          if (useGlobalScanner && !activePositions.has(symbol)) {
            // Compute historical momentum over scan_lookback
            // BOLT OPTIMIZATION: Zero-allocation direct array index lookup instead of slicing
            const lookback = Math.max(symCfg.scan_lookback || 3, 1);
            const scanThreshold = symCfg.scan_pct_threshold ?? 2.0;
            if (scanThreshold > 0 && i >= lookback) {
              const firstClose = candles[i - lookback].close;
              const lastClose = candles[i].close;
              const momPct = firstClose > 0 ? Math.abs(((lastClose - firstClose) / firstClose) * 100) : 0;
              isScannerCandidate = momPct >= scanThreshold;
            }
          }

          // Check global SL guard limit (total_sl_guard_usdt) & max_total_risk_pct against active open position risk
          let activeTotalSlRisk = 0;
          for (const openPos of activePositions.values()) {
            activeTotalSlRisk += openPos.risk_usdt || 0;
          }
          const totalSlGuardBreached = (symCfg.total_sl_guard_usdt && symCfg.total_sl_guard_usdt > 0)
            ? activeTotalSlRisk >= symCfg.total_sl_guard_usdt
            : false;

          const riskPct = symCfg.risk_pct_per_trade ?? 1.0;
          const prospectiveRiskUsdt = Math.max(0, balance * (riskPct / 100));
          const maxTotalRiskPct = symCfg.max_total_risk_pct ?? 5.0;
          const totalRiskCeilingBreached = maxTotalRiskPct > 0 && balance > 0
            ? ((activeTotalSlRisk + prospectiveRiskUsdt) / balance) * 100 > maxTotalRiskPct + 0.0001
            : false;

          if (
            isScannerCandidate &&
            !totalSlGuardBreached &&
            !totalRiskCeilingBreached &&
            !activePositions.has(symbol) &&
            activePositions.size < (symCfg.max_open_trades || 5)
          ) {
            // Check per-symbol anti-whipsaw cooldown and min_trade_interval_min
            const candleDelayBars = Math.max(0, Number(symCfg.anti_whipsaw_candle_delay ?? 1));
            const antiWhipsawMs = candleDelayBars * intervalMs;
            const minTradeIntervalMs = Math.max(antiWhipsawMs, (symCfg.min_trade_interval_min || 0) * 60 * 1000);
            const lastExit = lastExitTsMap.get(symbol) || 0;
            if (currentTs >= lastExit + minTradeIntervalMs) {
              const entrySide = (symCfg.entry_side || 'both').toLowerCase();

              // Test LONG entry
              if (entrySide === 'both' || entrySide === 'long') {
                const longCheck = this.evaluateSignalOnSlice(
                  symbol,
                  symCfg,
                  scanInterval,
                  'LONG',
                  'entry',
                  candles,
                  i,
                  symWarmup,
                  alignedTfMap,
                );
                if (longCheck.allFired) {
                  const opened = this.openSimulatedPosition(
                    'LONG',
                    symbol,
                    currentCandle,
                    currentTs,
                    balance,
                    symCfg,
                    activePositions,
                    activeSwitchHits,
                    longCheck.details,
                    candles,
                    i,
                    alignedTfMap,
                    scanInterval,
                  );
                  if (opened) continue;
                }
              }

              // Test SHORT entry
              if (!activePositions.has(symbol) && (entrySide === 'both' || entrySide === 'short')) {
                const shortCheck = this.evaluateSignalOnSlice(
                  symbol,
                  symCfg,
                  scanInterval,
                  'SHORT',
                  'entry',
                  candles,
                  i,
                  symWarmup,
                  alignedTfMap,
                );
                if (shortCheck.allFired) {
                  this.openSimulatedPosition(
                    'SHORT',
                    symbol,
                    currentCandle,
                    currentTs,
                    balance,
                    symCfg,
                    activePositions,
                    activeSwitchHits,
                    shortCheck.details,
                    candles,
                    i,
                    alignedTfMap,
                    scanInterval,
                  );
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
        if (i % Math.max(1, Math.floor((fullCandles.length - maxWarmup) / 100)) === 0 || i === fullCandles.length - 1) {
          equityCurve.push({
            timestamp: currentTs,
            balance: roundTo(balance, 2),
            equity: roundTo(currentEquity, 2),
            drawdown: roundTo(drawdown, 2),
            drawdownPct: roundTo(drawdownPct, 2),
          });
        }
      }
    } finally {
      // Purge backtest-namespaced indicator caches so live/paper sessions stay completely isolated
      if (typeof (this.signalEngine as any).clearBacktestCaches === 'function') {
        (this.signalEngine as any).clearBacktestCaches();
      }
    }

    // Force close any remaining open positions at the end of simulation
    for (const [symbol, pos] of activePositions) {
      const candles = symbolCandlesMap.get(symbol)!;
      const symCfg = symbolConfigMap.get(symbol) || config;
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
      const rr = slDist > 0 && pos.risk_usdt > 0 ? roundTo(netPnl / pos.risk_usdt, 2) : 0;

      const candleSlice = candles.slice(
        Math.max(0, (pos.entry_index ?? (candles.length - 1)) - 12),
        candles.length
      );

      closedTrades.push({
        id: pos.id,
        symbol,
        strategy_label: symCfg.strategy_label || 'Momentum Strategy',
        direction: pos.direction,
        entry_price: pos.entry_price,
        exit_price: lastCandle.close,
        initial_sl: pos.initial_sl,
        tp_price: pos.tp_price,
        entry_ts: pos.entry_ts,
        exit_ts: lastCandle.time,
        holding_duration_ms: lastCandle.time - pos.entry_ts,
        qty: pos.qty,
        pnl: roundTo(netPnl, 2),
        pnl_pct: roundTo(pnlPct, 2),
        realized_fee: roundTo(realizedFee, 4),
        rr,
        exit_reason: 'BACKTEST_END_FORCE_CLOSE',
        is_knife: pos.is_knife || false,
        candles: candleSlice,
      });
    }

    // 5. Compute Summary Metrics
    // BOLT OPTIMIZATION: Single-pass loop fusion over closed trades for counts, gross totals, and returns.
    // Eliminates multiple intermediate .filter(), .map(), and .reduce() array allocations.
    const totalTrades = closedTrades.length;
    let wins = 0;
    let losses = 0;
    let grossWins = 0;
    let grossLosses = 0;
    let sumReturnPct = 0;

    for (let k = 0; k < totalTrades; k++) {
      const t = closedTrades[k];
      if (t.pnl > 0) {
        wins++;
        grossWins += t.pnl;
      } else {
        losses++;
        grossLosses += Math.abs(t.pnl);
      }
      sumReturnPct += t.pnl_pct;
    }

    const winRate = totalTrades > 0 ? roundTo((wins / totalTrades) * 100, 2) : 0;
    const totalPnl = roundTo(balance - startingBalance, 2);
    const pnlPct = roundTo((totalPnl / startingBalance) * 100, 2);

    const profitFactor = grossLosses > 0 ? roundTo(grossWins / grossLosses, 2) : grossWins > 0 ? 99.99 : 0;
    const avgWin = wins > 0 ? roundTo(grossWins / wins, 2) : 0;
    const avgLoss = losses > 0 ? roundTo(grossLosses / losses, 2) : 0;
    const avgTradePnl = totalTrades > 0 ? roundTo(totalPnl / totalTrades, 2) : 0;

    // Expectancy per trade: (Win Rate * Avg Win) - (Loss Rate * Avg Loss)
    const winRateFrac = wins / (totalTrades || 1);
    const lossRateFrac = losses / (totalTrades || 1);
    const expectancy = roundTo((winRateFrac * avgWin) - (lossRateFrac * avgLoss), 2);

    // Sharpe ratio approximation (annualized return over std deviation of returns)
    let sharpeRatio = 0;
    if (totalTrades > 1) {
      const meanReturn = sumReturnPct / totalTrades;
      let varianceSum = 0;
      for (let k = 0; k < totalTrades; k++) {
        const diff = closedTrades[k].pnl_pct - meanReturn;
        varianceSum += diff * diff;
      }
      const variance = varianceSum / (totalTrades - 1);
      const stdDev = Math.sqrt(variance);
      sharpeRatio = stdDev > 0 ? roundTo((meanReturn / stdDev) * Math.sqrt(252), 2) : 0;
    }

    const executionTimeMs = Date.now() - startMs;

    // 6. Compute Per-Symbol Performance Breakdowns and Recommendations
    const symbolPerformanceMap = new Map<string, {
      trades: number;
      wins: number;
      losses: number;
      grossWins: number;
      grossLosses: number;
      totalPnl: number;
    }>();

    // Initialize all candidate symbols to handle 0-trade symbols
    for (const sym of symbolCandlesMap.keys()) {
      symbolPerformanceMap.set(sym, { trades: 0, wins: 0, losses: 0, grossWins: 0, grossLosses: 0, totalPnl: 0 });
    }

    for (let k = 0; k < closedTrades.length; k++) {
      const t = closedTrades[k];
      let sp = symbolPerformanceMap.get(t.symbol);
      if (!sp) {
        sp = { trades: 0, wins: 0, losses: 0, grossWins: 0, grossLosses: 0, totalPnl: 0 };
        symbolPerformanceMap.set(t.symbol, sp);
      }

      sp.trades++;
      sp.totalPnl += t.pnl;
      if (t.pnl > 0) {
        sp.wins++;
        sp.grossWins += t.pnl;
      } else {
        sp.losses++;
        sp.grossLosses += Math.abs(t.pnl);
      }
    }

    const symbolPerformance: BacktestSymbolPerformanceDto[] = [];
    for (const [sym, sp] of symbolPerformanceMap) {
      const symWinRate = sp.trades > 0 ? roundTo((sp.wins / sp.trades) * 100, 2) : 0;
      const symPF = sp.grossLosses > 0 ? roundTo(sp.grossWins / sp.grossLosses, 2) : sp.grossWins > 0 ? 99.99 : 0;
      const symPnl = roundTo(sp.totalPnl, 2);

      // Symbol recommendation heuristic: positive PnL, win rate >= 40%, and at least 1 winning trade
      const isRecommended = symPnl > 0 && symWinRate >= 40 && sp.wins >= 1;

      symbolPerformance.push({
        symbol: sym,
        totalTrades: sp.trades,
        wins: sp.wins,
        losses: sp.losses,
        winRate: symWinRate,
        totalPnl: symPnl,
        profitFactor: symPF,
        isRecommended,
      });
    }

    // Sort symbol performance by total PnL descending
    symbolPerformance.sort((a, b) => b.totalPnl - a.totalPnl);

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
      symbolPerformance,
      trades: closedTrades,
    };
  }

  private collectRequiredIntervals(config: SessionConfig, baseInterval: string): Set<string> {
    const intervals = new Set<string>([baseInterval]);
    const params: any = config.signal_params || {};
    const addIfValid = (tf?: string) => {
      if (tf && tf !== 'default' && BacktestService.VALID_INTERVAL_RE.test(tf)) {
        intervals.add(tf);
      }
    };

    const allSignals = [
      ...(config.enabled_signals || []),
      ...(config.exit_signals || []),
    ];

    for (const sig of allSignals) {
      const baseType = sig.replace(/_\d+$/, '');
      addIfValid(config.signal_timeframes?.[sig]);
      addIfValid(config.signal_timeframes?.[baseType]);

      if (baseType === 'htf_breakout' || baseType === 'prev_day_breakout') {
        addIfValid(params.htf_breakout_ref_timeframe || config.htf_breakout_ref_timeframe || '1d');
        addIfValid(params.htf_breakout_trigger_timeframe || config.htf_breakout_trigger_timeframe || '1h');
      }
    }

    if (config.sl_type === 'lookback_low/high') {
      addIfValid(config.sl_lookback_timeframe);
    }

    if (config.trigger_candle_exit_enabled) {
      addIfValid(config.trigger_candle_exit_timeframe);
    }

    return intervals;
  }

  private getWarmupForInterval(config: SessionConfig, targetInterval: string, isBaseInterval: boolean): number {
    let warmup = 0;
    if (typeof (this.signalEngine as any).getRequiredWarmupForInterval === 'function') {
      const entryW = this.signalEngine.getRequiredWarmupForInterval(config, targetInterval, 'entry');
      const exitW = this.signalEngine.getRequiredWarmupForInterval(config, targetInterval, 'exit');
      warmup = Math.max(entryW, exitW);
    } else if (isBaseInterval) {
      warmup = this.signalEngine.getRequiredWarmup(config);
    }

    if (config.sl_type === 'lookback_low/high') {
      const slTf = (!config.sl_lookback_timeframe || config.sl_lookback_timeframe === 'default')
        ? (config.scan_interval || '5m')
        : config.sl_lookback_timeframe;
      if (slTf === targetInterval) {
        warmup = Math.max(warmup, (config.sl_lookback_period ?? 5) + 2);
      }
    }

    if (isBaseInterval && warmup === 0) {
      warmup = Math.max(1, config.scan_lookback || 3);
    }

    return warmup;
  }

  /**
   * Advances monotonic cursors for auxiliary timeframes and synthesizes any active higher-timeframe
   * forming bar strictly from past/current base candles so zero future data is ever leaked.
   */
  private advanceAndBuildTimeAlignedMap(
    baseInterval: string,
    baseIntervalMs: number,
    baseCandles: Candle[],
    currentIndex: number,
    baseWarmup: number,
    currentCandle: Candle,
    extraTfStates: Map<string, ExtraTimeframeState>,
  ): Map<string, Candle[]> {
    const map = new Map<string, Candle[]>();
    const baseMaxWindow = Math.max(baseWarmup * 2, 200);
    const baseSliceStart = Math.max(0, currentIndex + 1 - baseMaxWindow);
    map.set(baseInterval, baseCandles.slice(baseSliceStart, currentIndex + 1));

    const currentTs = currentCandle.time;
    const currentCloseTs = currentTs + baseIntervalMs - 1;

    for (const [tf, state] of extraTfStates) {
      const tfCandles = state.candles;
      const tfMs = state.intervalMs;

      // Advance cursor over all strictly completed candles (closeTs <= currentCloseTs)
      while (state.cursor < tfCandles.length) {
        const c = tfCandles[state.cursor];
        const cClose = c.time + tfMs - 1;
        if (cClose <= currentCloseTs) {
          state.cursor++;
          if (state.formingBar && state.formingBar.time === c.time) {
            state.formingBar = null;
          }
        } else {
          break;
        }
      }

      const maxWindow = Math.max(state.warmup * 2, 200);
      const sliceStart = Math.max(0, state.cursor - maxWindow);
      const completedSlice = tfCandles.slice(sliceStart, state.cursor);

      // If this is a higher timeframe with an active forming bucket, synthesize it incrementally
      // from base candles to prevent lookahead into future base candles of the same HTF bar.
      if (tfMs > baseIntervalMs && state.cursor < tfCandles.length && tfCandles[state.cursor].time <= currentTs) {
        const bucketCandle = tfCandles[state.cursor];
        if (!state.formingBar || state.formingBar.time !== bucketCandle.time) {
          state.formingBar = {
            time: bucketCandle.time,
            open: currentCandle.open,
            high: currentCandle.high,
            low: currentCandle.low,
            close: currentCandle.close,
            volume: currentCandle.volume,
          };
        } else {
          state.formingBar.high = Math.max(state.formingBar.high, currentCandle.high);
          state.formingBar.low = Math.min(state.formingBar.low, currentCandle.low);
          state.formingBar.close = currentCandle.close;
          state.formingBar.volume += currentCandle.volume;
        }
        const formingSnapshot: Candle = {
          time: state.formingBar.time,
          open: state.formingBar.open,
          high: state.formingBar.high,
          low: state.formingBar.low,
          close: state.formingBar.close,
          volume: state.formingBar.volume,
        };
        completedSlice.push(formingSnapshot);
      }

      map.set(tf, completedSlice);
    }

    return map;
  }

  /**
   * BOLT OPTIMIZATION: Bounded Historical Window Slicing for Backtest Simulation.
   * Instead of slicing the full historical array from index 0 on every simulation step (which allocates
   * O(N) array copies up to 4,000 candles per tick), computes a bounded slice window ending at `currentIndex`
   * with size `Math.max(requiredWarmup * 2, 200)`.
   * Uses a `__bt__:` symbol prefix so SignalEngine indicator caches never collide with live/paper state.
   */
  private evaluateSignalOnSlice(
    symbol: string,
    config: SessionConfig,
    interval: string,
    side: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit',
    candles: Candle[],
    currentIndex: number,
    requiredWarmup: number,
    alignedTfMap?: Map<string, Candle[]>,
    trade?: SimulatedPosition,
  ) {
    const btSymbol = `__bt__:${symbol}`;
    if (alignedTfMap && alignedTfMap.size > 0) {
      const baseSlice = alignedTfMap.get(interval);
      return this.signalEngine.checkEntry(btSymbol, config, interval, side, purpose, false, baseSlice, trade, alignedTfMap);
    }
    const maxWindow = Math.max(requiredWarmup * 2, 200);
    const sliceStart = Math.max(0, currentIndex + 1 - maxWindow);
    const candleSlice = candles.slice(sliceStart, currentIndex + 1);
    return this.signalEngine.checkEntry(btSymbol, config, interval, side, purpose, false, candleSlice, trade);
  }

  private openSimulatedPosition(
    direction: 'LONG' | 'SHORT',
    symbol: string,
    currentCandle: Candle,
    entryTs: number,
    balance: number,
    config: SessionConfig,
    activePositions: Map<string, SimulatedPosition>,
    activeSwitchHits: number,
    details?: any,
    candles?: Candle[],
    currentIndex?: number,
    alignedTfMap?: Map<string, Candle[]>,
    scanInterval?: string,
  ): boolean {
    const entryPrice = currentCandle.close;
    if (!entryPrice || entryPrice <= 0) return false;

    let slDistPct = config.sl_distance_pct ?? 2.0;

    // Handle Switch Hit Overrides for SL Distance in backtest simulation
    if (config.tp_mode === 'exp_rr_seq_switch' && config.switched_sl_distance_pct && config.peak_rr_switch_threshold) {
      if (activeSwitchHits >= (config.peak_rr_switch_count || 1)) {
        slDistPct = config.switched_sl_distance_pct;
      }
    }

    let initialSl = direction === 'LONG'
      ? entryPrice * (1 - slDistPct / 100)
      : entryPrice * (1 + slDistPct / 100);

    const isStructuralSl = config.sl_type === 'lookback_low/high'
      || config.sl_type === 'engulfing_boundary'
      || config.sl_type === 'streak_extreme'
      || config.sl_type === 'supertrend';

    // Calculate SL strictly according to selected sl_type
    if (config.sl_type === 'lookback_low/high') {
      const rawPeriod = config.sl_lookback_period ?? 5;
      const slTf = (!config.sl_lookback_timeframe || config.sl_lookback_timeframe === 'default')
        ? (scanInterval || config.scan_interval || '5m')
        : config.sl_lookback_timeframe;

      const slCandles = (alignedTfMap && alignedTfMap.get(slTf)) || candles;
      if (slCandles && slCandles.length > 0) {
        const endIdx = (slCandles === candles && currentIndex !== undefined)
          ? (config.sl_include_forming_candle ? currentIndex : Math.max(0, currentIndex - 1))
          : (config.sl_include_forming_candle ? slCandles.length - 1 : Math.max(0, slCandles.length - 2));

        let extreme: number;
        if (rawPeriod === 0) {
          extreme = direction === 'LONG' ? slCandles[endIdx].low : slCandles[endIdx].high;
        } else {
          extreme = direction === 'LONG' ? Infinity : -Infinity;
          const startIdx = Math.max(0, endIdx - rawPeriod + 1);
          for (let idx = startIdx; idx <= endIdx; idx++) {
            if (direction === 'LONG') {
              if (slCandles[idx].low < extreme) extreme = slCandles[idx].low;
            } else {
              if (slCandles[idx].high > extreme) extreme = slCandles[idx].high;
            }
          }
        }
        if (extreme > 0 && Number.isFinite(extreme)) {
          initialSl = extreme;
        }
      }
    } else if (config.sl_type === 'engulfing_boundary' || config.sl_type === 'streak_extreme') {
      const mode = config.engulfing_mode || 'range';
      const useBody = mode === 'body' || mode === 'close_body';
      let boundary: number | undefined;
      if (details) {
        for (const sigKey of Object.keys(details)) {
          const d = details[sigKey];
          if (!d) continue;
          if (direction === 'LONG') {
            boundary = (useBody && d.body_low !== undefined) ? d.body_low : (d.pattern_low ?? d.body_low ?? d.slPrice);
          } else {
            boundary = (useBody && d.body_high !== undefined) ? d.body_high : (d.pattern_high ?? d.body_high ?? d.slPrice);
          }
          if (boundary !== undefined) break;
        }
      }
      if (boundary && boundary > 0) {
        initialSl = boundary;
      }
    } else if (config.sl_type === 'supertrend') {
      let supertrendSl: number | undefined;
      if (details) {
        for (const sigKey of Object.keys(details)) {
          if (details[sigKey]?.slPrice && typeof details[sigKey].slPrice === 'number') {
            supertrendSl = details[sigKey].slPrice;
            break;
          }
        }
      }
      if (supertrendSl && supertrendSl > 0) {
        initialSl = supertrendSl;
      }
    }

    // Apply SL floor/ceiling clamping or rejection AFTER structural SL computation (matching RiskEngine.computeSl)
    if (isStructuralSl) {
      const minPct = config.sl_min_pct ?? 0.3;
      const maxPct = config.sl_max_pct ?? 3.0;
      const action = config.sl_out_of_bounds_action || 'clamp';

      // Guard wrong-side structural SL
      const wrongSide = direction === 'LONG' ? initialSl >= entryPrice : initialSl <= entryPrice;
      if (wrongSide) {
        if (action === 'reject') return false;
        initialSl = direction === 'LONG'
          ? entryPrice * (1 - minPct / 100)
          : entryPrice * (1 + minPct / 100);
      }

      const distPct = (Math.abs(entryPrice - initialSl) / entryPrice) * 100;
      if (minPct > 0 && distPct < minPct) {
        if (action === 'reject') return false;
        initialSl = direction === 'LONG'
          ? entryPrice * (1 - minPct / 100)
          : entryPrice * (1 + minPct / 100);
      } else if (maxPct > 0 && distPct > maxPct) {
        if (action === 'reject' || config.reject_entry_if_sl_exceeds_max === true) {
          // Only reject on reject_entry_if_sl_exceeds_max when action is explicitly reject; preserve clamp default
          if (action === 'reject') return false;
        }
        initialSl = direction === 'LONG'
          ? entryPrice * (1 - maxPct / 100)
          : entryPrice * (1 + maxPct / 100);
      }
    }

    const riskPct = config.risk_pct_per_trade ?? 1.0;
    const riskUsdt = balance * (riskPct / 100);
    if (riskUsdt <= 0) return false;

    const slDistAbs = Math.abs(entryPrice - initialSl);
    const qty = slDistAbs > 0 ? riskUsdt / slDistAbs : (riskUsdt / entryPrice);
    if (!Number.isFinite(qty) || qty <= 0) return false;

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
      entry_index: currentIndex,
      qty,
      initial_sl: initialSl,
      current_sl: initialSl,
      tp_price: tpPrice,
      risk_usdt: riskUsdt,
      peak_rr: 0,
      is_knife: isKnife,
      trigger_candle_low: currentCandle.low,
      trigger_candle_high: currentCandle.high,
      trigger_candle_time: currentCandle.time,
      trigger_candle_timeframe: scanInterval || config.scan_interval || '5m',
    });

    return true;
  }

  private async fetchHistoricalCandles(
    symbol: string,
    interval: string,
    totalCount: number,
    restBase: string = ENGINE_CONSTANTS.BINANCE_REST_BASE,
  ): Promise<HistoricalFetchResult> {
    const cacheKey = `${restBase}_${symbol}_${interval}_${totalCount}`;
    const cached = this.candleCacheMap.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.fetchedAt) < this.CACHE_TTL_MS) {
      return { candles: cached.candles };
    }

    let lastHttpStatus: number | undefined;
    let lastErrorMessage: string | undefined;

    try {
      let accumulatedCandles: Candle[] = [];
      let endTimeParam: number | null = null;
      const maxBatchCount = Math.min(Math.ceil(totalCount / 1000), 100);
      const useProxyFetch = typeof (this.binanceClientFactory as any)?.proxyFetch === 'function';

      for (let b = 0; b < maxBatchCount; b++) {
        const needed = totalCount - accumulatedCandles.length;
        if (needed <= 0) break;

        const limit = Math.min(needed, 1000);
        let url = `${restBase}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        if (endTimeParam) {
          url += `&endTime=${endTimeParam}`;
        }

        const response = useProxyFetch
          ? await this.binanceClientFactory.proxyFetch(url, { signal: AbortSignal.timeout(15000) })
          : await fetch(url, { signal: AbortSignal.timeout(15000) });

        if (!response || !response.ok) {
          lastHttpStatus = response?.status;
          lastErrorMessage = `HTTP ${response?.status || 'error'} for ${symbol} ${interval}`;
          if (lastHttpStatus === 451 || lastHttpStatus === 429 || lastHttpStatus === 418) {
            this.logger.warn(`[Backtest] Binance returned HTTP ${lastHttpStatus} fetching ${symbol} ${interval} klines.`);
          }
          break;
        }

        const raw = (await response.json()) as any[][];
        if (!Array.isArray(raw) || raw.length === 0) break;

        const batchCandles: Candle[] = raw.map(k => ({
          time: Number(k[0]),
          open: parseFloat(String(k[1])),
          high: parseFloat(String(k[2])),
          low: parseFloat(String(k[3])),
          close: parseFloat(String(k[4])),
          volume: parseFloat(String(k[5])),
          closeTime: Number(k[6]),
        }));

        accumulatedCandles = batchCandles.concat(accumulatedCandles);
        const earliestTime = batchCandles[0].time;
        endTimeParam = earliestTime - 1;

        if (batchCandles.length < limit) {
          break;
        }

        // Gentle pacing for multi-batch fetches to stay well below Binance weight limits
        if (b >= 2 && b + 1 < maxBatchCount) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }

      if (accumulatedCandles.length > 0) {
        if (this.candleCacheMap.size > 200) {
          for (const [k, v] of this.candleCacheMap.entries()) {
            if (now - v.fetchedAt > this.CACHE_TTL_MS) {
              this.candleCacheMap.delete(k);
            }
          }
          if (this.candleCacheMap.size > 200) {
            const firstKey = this.candleCacheMap.keys().next().value;
            if (firstKey) this.candleCacheMap.delete(firstKey);
          }
        }
        this.candleCacheMap.set(cacheKey, { candles: accumulatedCandles, fetchedAt: now });
      }

      return {
        candles: accumulatedCandles,
        httpStatus: lastHttpStatus,
        errorMessage: lastErrorMessage,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to fetch historical klines for ${symbol} (${interval}): ${msg}`);
      return {
        candles: [],
        httpStatus: lastHttpStatus,
        errorMessage: msg,
      };
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
      case 'M': return val * 30 * 24 * 60 * 60 * 1000;
      default: return val * 60 * 1000;
    }
  }
}
