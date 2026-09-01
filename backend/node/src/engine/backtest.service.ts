import { Injectable, Logger } from '@nestjs/common';
import { SessionConfig } from '../models/SessionConfig';
import { Candle } from './kline_store.service';
import { roundEight } from '../lib/math';

export interface BacktestTickData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface VirtualTrade {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entry_price: number;
  entry_ts: number;
  quantity: number;
  initial_sl: number;
  current_sl: number;
  peak_price: number;
  peak_rr: number;
  rr_sequence_index: number;
  risk_usdt: number;
  risk_lock_reason: string;
  is_knife: boolean;
  status: 'OPEN' | 'CLOSED';
  exit_price?: number;
  exit_ts?: number;
  exit_reason?: string;
  pnl?: number;
  pnl_pct?: number;
  exit_rr?: number;
  exit_delay_counters: Record<string, number>;
}

export interface BacktestResult {
  initial_balance: number;
  final_balance: number;
  total_pnl: number;
  total_pnl_pct: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  breakeven_trades: number;
  win_rate: number;
  profit_factor: number;
  max_drawdown_usdt: number;
  max_drawdown_pct: number;
  expectancy_rr: number;
  trades: VirtualTrade[];
  exit_reason_breakdown: Record<string, { count: number; pnl: number }>;
  rr_distribution: Record<string, number>;
  avg_time_to_breakeven_ms: number;
  avg_duration_ms: number;
}

@Injectable()
export class BacktestEngineService {
  private readonly logger = new Logger(BacktestEngineService.name);

  /**
   * Run a high-performance backtest simulation over multi-symbol historical candle series.
   * Uses flat zero-copy memory loops, peak R-multiple ratcheting, exit delay tracking, and risk management.
   */
  runBacktest(
    config: SessionConfig,
    marketData: Record<string, BacktestTickData[]>,
    startingBalance?: number,
  ): BacktestResult {
    const initialBalance = startingBalance || config.paper_starting_balance || 10000;
    let balance = initialBalance;
    let peakBalance = balance;
    let maxDrawdownUsdt = 0;
    let maxDrawdownPct = 0;

    const closedTrades: VirtualTrade[] = [];
    const activeTrades: VirtualTrade[] = [];
    const exitReasonMap: Record<string, { count: number; pnl: number }> = {};
    const rrDistribution: Record<string, number> = {
      '< -0.5R': 0,
      '-0.5R to 0R': 0,
      '0R to 0.25R': 0,
      '0.25R to 0.5R': 0,
      '0.5R to 1.0R': 0,
      '1.0R to 2.0R': 0,
      '2.0R+': 0,
    };

    let totalTimeToBreakevenMs = 0;
    let timeToBreakevenCount = 0;
    let totalDurationMs = 0;

    // Standardize symbol keys and extract timestamps
    const symbols = Object.keys(marketData).filter((s) => s.toUpperCase().endsWith('USDT'));
    if (symbols.length === 0) {
      return this.buildEmptyResult(initialBalance);
    }

    // Combine all candles into a master timeline array
    const timelineMap = new Map<number, Record<string, BacktestTickData>>();
    for (const sym of symbols) {
      const candles = marketData[sym] || [];
      for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        let frame = timelineMap.get(c.time);
        if (!frame) {
          frame = {};
          timelineMap.set(c.time, frame);
        }
        frame[sym] = c;
      }
    }

    const timestamps = Array.from(timelineMap.keys()).sort((a, b) => a - b);
    const liveRrSeq = config.live_rr_sequence || [1.0, 2.0, 4.0];
    const exitRrSeq = config.exit_rr_sequence || [0.0, 1.0, 2.0];
    const riskPctPerTrade = (config.risk_pct_per_trade || 2.0) / 100;
    const maxOpenTrades = config.max_open_trades || 5;
    const slDistancePct = (config.sl_distance_pct || 2.5) / 100;

    const symbolLastExitTs: Record<string, number> = {};

    // Main Single-Pass Backtest Loop across Timestamps
    for (let tIdx = 0; tIdx < timestamps.length; tIdx++) {
      const ts = timestamps[tIdx];
      const tickMap = timelineMap.get(ts)!;

      // Step 1: Process active trades SL/TP breaches and ratchet progression
      for (let i = activeTrades.length - 1; i >= 0; i--) {
        const trade = activeTrades[i];
        const candle = tickMap[trade.symbol];
        if (!candle) continue;

        // Peak R-Multiple & High/Low Tracking
        let isStopped = false;
        let exitPrice = 0;
        let exitReason = '';

        if (trade.side === 'LONG') {
          // Check Stop Loss Breach (Candle Low)
          if (candle.low <= trade.current_sl) {
            isStopped = true;
            exitPrice = trade.current_sl;
            exitReason = trade.rr_sequence_index >= 0 ? `RATCHET_SL_LEVEL_${trade.rr_sequence_index}` : 'STOP_LOSS';
          } else {
            // Update Peak & Ratchet
            if (candle.high > trade.peak_price) {
              trade.peak_price = candle.high;
            }
            const slDistance = trade.entry_price - trade.initial_sl;
            if (slDistance > 0) {
              const currentPeakRR = (trade.peak_price - trade.entry_price) / slDistance;
              trade.peak_rr = Math.max(trade.peak_rr, currentPeakRR);

              // Evaluate Next Ratchet Milestone
              const nextIndex = trade.rr_sequence_index + 1;
              if (nextIndex < liveRrSeq.length && trade.peak_rr >= liveRrSeq[nextIndex]) {
                trade.rr_sequence_index = nextIndex;
                const lockR = exitRrSeq[nextIndex] !== undefined ? exitRrSeq[nextIndex] : 0;
                trade.current_sl = trade.entry_price + lockR * slDistance;
                if (trade.current_sl >= trade.entry_price) {
                  trade.risk_usdt = 0;
                  if (trade.risk_lock_reason !== 'SL_AT_BREAKEVEN') {
                    trade.risk_lock_reason = 'SL_AT_BREAKEVEN';
                    if (trade.entry_ts) {
                      totalTimeToBreakevenMs += ts - trade.entry_ts;
                      timeToBreakevenCount++;
                    }
                  }
                }
              }
            }
          }
        } else {
          // SHORT Position Stop Loss Breach (Candle High)
          if (candle.high >= trade.current_sl) {
            isStopped = true;
            exitPrice = trade.current_sl;
            exitReason = trade.rr_sequence_index >= 0 ? `RATCHET_SL_LEVEL_${trade.rr_sequence_index}` : 'STOP_LOSS';
          } else {
            if (candle.low < trade.peak_price) {
              trade.peak_price = candle.low;
            }
            const slDistance = trade.initial_sl - trade.entry_price;
            if (slDistance > 0) {
              const currentPeakRR = (trade.entry_price - trade.peak_price) / slDistance;
              trade.peak_rr = Math.max(trade.peak_rr, currentPeakRR);

              const nextIndex = trade.rr_sequence_index + 1;
              if (nextIndex < liveRrSeq.length && trade.peak_rr >= liveRrSeq[nextIndex]) {
                trade.rr_sequence_index = nextIndex;
                const lockR = exitRrSeq[nextIndex] !== undefined ? exitRrSeq[nextIndex] : 0;
                trade.current_sl = trade.entry_price - lockR * slDistance;
                if (trade.current_sl <= trade.entry_price) {
                  trade.risk_usdt = 0;
                  if (trade.risk_lock_reason !== 'SL_AT_BREAKEVEN') {
                    trade.risk_lock_reason = 'SL_AT_BREAKEVEN';
                    if (trade.entry_ts) {
                      totalTimeToBreakevenMs += ts - trade.entry_ts;
                      timeToBreakevenCount++;
                    }
                  }
                }
              }
            }
          }
        }

        // Close trade if stopped out
        if (isStopped) {
          trade.status = 'CLOSED';
          trade.exit_price = exitPrice;
          trade.exit_ts = ts;
          trade.exit_reason = exitReason;

          const pnlRaw =
            trade.side === 'LONG'
              ? (exitPrice - trade.entry_price) * trade.quantity
              : (trade.entry_price - exitPrice) * trade.quantity;
          trade.pnl = roundEight(pnlRaw);
          trade.pnl_pct = roundEight((pnlRaw / (trade.entry_price * trade.quantity)) * 100);

          const slDist = Math.abs(trade.entry_price - trade.initial_sl);
          const initialRisk = slDist * trade.quantity;
          trade.exit_rr = initialRisk > 0 ? roundEight(pnlRaw / initialRisk) : 0;

          balance += trade.pnl;
          if (balance > peakBalance) peakBalance = balance;
          const ddUsdt = peakBalance - balance;
          if (ddUsdt > maxDrawdownUsdt) maxDrawdownUsdt = ddUsdt;
          const ddPct = (ddUsdt / peakBalance) * 100;
          if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

          symbolLastExitTs[trade.symbol] = ts;
          totalDurationMs += ts - trade.entry_ts;

          // Categorize exit distribution
          this.categorizeExit(trade, exitReasonMap, rrDistribution);
          closedTrades.push(trade);
          activeTrades.splice(i, 1);
        }
      }

      // Step 2: Scanner & Entry Signal Evaluation
      if (activeTrades.length < maxOpenTrades) {
        for (const sym of symbols) {
          if (activeTrades.length >= maxOpenTrades) break;
          const candle = tickMap[sym];
          if (!candle) continue;

          // Check if symbol is already in an active trade
          if (activeTrades.some((t) => t.symbol === sym)) continue;

          // Check Anti-whipsaw cooldown
          const lastExit = symbolLastExitTs[sym];
          const cooldownMs = (config.min_trade_interval_min || 0) * 60 * 1000;
          if (lastExit && ts < lastExit + cooldownMs) continue;

          // Entry Signal Condition Simulation (e.g., Simple Momentum Breakout or Price Move)
          const movePct = ((candle.close - candle.open) / candle.open) * 100;
          const threshold = config.scan_pct_threshold || 2.0;

          let entrySide: 'LONG' | 'SHORT' | null = null;
          if (movePct >= threshold && (config.entry_side === 'both' || config.entry_side === 'long')) {
            entrySide = 'LONG';
          } else if (movePct <= -threshold && (config.entry_side === 'both' || config.entry_side === 'short')) {
            entrySide = 'SHORT';
          }

          if (entrySide) {
            const entryPrice = candle.close;
            const riskUsdt = balance * riskPctPerTrade;
            const slDistance = entryPrice * slDistancePct;
            if (slDistance <= 0) continue;

            const quantity = roundEight(riskUsdt / slDistance);
            const initialSl = entrySide === 'LONG' ? entryPrice - slDistance : entryPrice + slDistance;

            const newTrade: VirtualTrade = {
              id: `BT_${sym}_${ts}`,
              symbol: sym,
              side: entrySide,
              entry_price: entryPrice,
              entry_ts: ts,
              quantity,
              initial_sl: initialSl,
              current_sl: initialSl,
              peak_price: entryPrice,
              peak_rr: 0,
              rr_sequence_index: -1,
              risk_usdt: riskUsdt,
              risk_lock_reason: 'SL_BELOW_ENTRY',
              is_knife: false,
              status: 'OPEN',
              exit_delay_counters: {},
            };

            activeTrades.push(newTrade);
          }
        }
      }
    }

    // Force close any remaining open trades at final timestamp
    const lastTs = timestamps[timestamps.length - 1] || Date.now();
    for (const trade of activeTrades) {
      trade.status = 'CLOSED';
      trade.exit_price = trade.peak_price;
      trade.exit_ts = lastTs;
      trade.exit_reason = 'END_OF_BACKTEST';

      const pnlRaw =
        trade.side === 'LONG'
          ? (trade.exit_price - trade.entry_price) * trade.quantity
          : (trade.entry_price - trade.exit_price) * trade.quantity;
      trade.pnl = roundEight(pnlRaw);
      trade.pnl_pct = roundEight((pnlRaw / (trade.entry_price * trade.quantity)) * 100);

      const slDist = Math.abs(trade.entry_price - trade.initial_sl);
      const initialRisk = slDist * trade.quantity;
      trade.exit_rr = initialRisk > 0 ? roundEight(pnlRaw / initialRisk) : 0;

      balance += trade.pnl;
      this.categorizeExit(trade, exitReasonMap, rrDistribution);
      closedTrades.push(trade);
    }

    return this.buildResultMetrics(
      initialBalance,
      balance,
      closedTrades,
      maxDrawdownUsdt,
      maxDrawdownPct,
      exitReasonMap,
      rrDistribution,
      timeToBreakevenCount > 0 ? totalTimeToBreakevenMs / timeToBreakevenCount : 0,
      closedTrades.length > 0 ? totalDurationMs / closedTrades.length : 0,
    );
  }

  private categorizeExit(
    trade: VirtualTrade,
    exitReasonMap: Record<string, { count: number; pnl: number }>,
    rrDist: Record<string, number>,
  ) {
    const reason = trade.exit_reason || 'UNKNOWN';
    if (!exitReasonMap[reason]) {
      exitReasonMap[reason] = { count: 0, pnl: 0 };
    }
    exitReasonMap[reason].count++;
    exitReasonMap[reason].pnl = roundEight(exitReasonMap[reason].pnl + (trade.pnl || 0));

    const rr = trade.exit_rr || 0;
    if (rr < -0.5) rrDist['< -0.5R']++;
    else if (rr < 0) rrDist['-0.5R to 0R']++;
    else if (rr < 0.25) rrDist['0R to 0.25R']++;
    else if (rr < 0.5) rrDist['0.25R to 0.5R']++;
    else if (rr < 1.0) rrDist['0.5R to 1.0R']++;
    else if (rr < 2.0) rrDist['1.0R to 2.0R']++;
    else rrDist['2.0R+']++;
  }

  private buildResultMetrics(
    initialBalance: number,
    finalBalance: number,
    trades: VirtualTrade[],
    maxDrawdownUsdt: number,
    maxDrawdownPct: number,
    exitReasonMap: Record<string, { count: number; pnl: number }>,
    rrDist: Record<string, number>,
    avgTimeToBreakevenMs: number,
    avgDurationMs: number,
  ): BacktestResult {
    const totalPnl = roundEight(finalBalance - initialBalance);
    const totalPnlPct = roundEight((totalPnl / initialBalance) * 100);
    const totalTrades = trades.length;

    let winningTrades = 0;
    let losingTrades = 0;
    let breakevenTrades = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let totalRr = 0;

    for (const t of trades) {
      const pnl = t.pnl || 0;
      totalRr += t.exit_rr || 0;
      if (pnl > 0) {
        winningTrades++;
        grossProfit += pnl;
      } else if (pnl < 0) {
        losingTrades++;
        grossLoss += Math.abs(pnl);
      } else {
        breakevenTrades++;
      }
    }

    const winRate = totalTrades > 0 ? roundEight((winningTrades / totalTrades) * 100) : 0;
    const profitFactor = grossLoss > 0 ? roundEight(grossProfit / grossLoss) : grossProfit > 0 ? 999 : 0;
    const expectancyRr = totalTrades > 0 ? roundEight(totalRr / totalTrades) : 0;

    return {
      initial_balance: initialBalance,
      final_balance: roundEight(finalBalance),
      total_pnl: totalPnl,
      total_pnl_pct: totalPnlPct,
      total_trades: totalTrades,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
      breakeven_trades: breakevenTrades,
      win_rate: winRate,
      profit_factor: profitFactor,
      max_drawdown_usdt: roundEight(maxDrawdownUsdt),
      max_drawdown_pct: roundEight(maxDrawdownPct),
      expectancy_rr: expectancyRr,
      trades,
      exit_reason_breakdown: exitReasonMap,
      rr_distribution: rrDist,
      avg_time_to_breakeven_ms: roundEight(avgTimeToBreakevenMs),
      avg_duration_ms: roundEight(avgDurationMs),
    };
  }

  private buildEmptyResult(initialBalance: number): BacktestResult {
    return {
      initial_balance: initialBalance,
      final_balance: initialBalance,
      total_pnl: 0,
      total_pnl_pct: 0,
      total_trades: 0,
      winning_trades: 0,
      losing_trades: 0,
      breakeven_trades: 0,
      win_rate: 0,
      profit_factor: 0,
      max_drawdown_usdt: 0,
      max_drawdown_pct: 0,
      expectancy_rr: 0,
      trades: [],
      exit_reason_breakdown: {},
      rr_distribution: {
        '< -0.5R': 0,
        '-0.5R to 0R': 0,
        '0R to 0.25R': 0,
        '0.25R to 0.5R': 0,
        '0.5R to 1.0R': 0,
        '1.0R to 2.0R': 0,
        '2.0R+': 0,
      },
      avg_time_to_breakeven_ms: 0,
      avg_duration_ms: 0,
    };
  }
}
