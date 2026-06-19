import { Injectable, Logger } from '@nestjs/common';
import { TradeEntity } from '../models/entities/Trade.entity';
import { roundTo } from '../lib/math';

export interface AnalyticsResult {
  cumulativePnL: { ts: string; pnl: number }[];
  maxDrawdown: number;
  maxDrawdownPct: number;
  timeOfDay: {
    hour: number;
    pnl: number;
    wins: number;
    total: number;
    winRate: number;
  }[];
  totalTrades: number;
  overallWinRate: number;
  overallPnlPct: number;
  avgWin: number;
  avgLoss: number;
  avgWinPct: number;
  avgLossPct: number;
  expectancyPct: number;
  avgWinLossRatio: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  /**
   * BOLT OPTIMIZATION: Optimized to single-pass processing with minimal allocations.
   * Reduces GC pressure in the engine hot loop.
   *
   * @param currentBalance (Optional) The current account balance for high-fidelity percentage basis.
   * If provided, overallPnlPct is calculated as (netPnL / (currentBalance - netPnL)) * 100.
   */
  calculateAnalytics(trades: TradeEntity[], startingBalance: number = 10000, currentBalance?: number): AnalyticsResult {
    // BOLT OPTIMIZATION: Combine multiple iterations into a single-pass loop
    // 1. Initial filter and sort (necessary for equity curve)
    const sortedTrades = [...trades]
      .filter(t => t.status !== 'OPEN' && t.exit_ts && !t.is_reconciliation)
      .sort((a, b) => a.exit_ts!.getTime() - b.exit_ts!.getTime());

    const totalTrades = sortedTrades.length;
    let currentPnL = 0;
    let maxPnL = 0;
    let maxDD = 0;
    let maxDDPct = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let grossProfitPct = 0;
    let grossLossPct = 0;

    // Sharpe/Sortino pre-calc (Return-based for Trading Edge accuracy)
    let sumReturnPct = 0;
    let sumSquaredReturnPct = 0;
    let downsideSumSquaredReturnPct = 0;

    // Performance Engineering: If currentBalance is provided, anchor the entire history
    // to the current account power to ensure scale-invariant drawdown and performance.
    const totalNetPnL = sortedTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
    const effectiveStartingBalance = (currentBalance && currentBalance > 0)
      ? Math.max(1, currentBalance - totalNetPnL)
      : startingBalance;

    let rollingBalance = effectiveStartingBalance;
    const cumulativePnL: { ts: string; pnl: number }[] = new Array(totalTrades);
    // Time of day analysis (0-23 hours) - Fixed size array for better performance
    const todStats = Array.from({ length: 24 }, () => ({ pnl: 0, wins: 0, total: 0 }));

    // BOLT OPTIMIZATION: Single-pass calculation for ALL metrics to avoid multiple array iterations
    for (let i = 0; i < totalTrades; i++) {
      const t = sortedTrades[i];
      const pnl = Number(t.pnl || 0);

      // Calculate return percentage relative to balance at time of trade
      const tradeReturnPct = rollingBalance > 0 ? (pnl / rollingBalance) * 100 : 0;
      rollingBalance = Math.max(1, rollingBalance + pnl);

      // Equity curve & Drawdown
      currentPnL += pnl;
      if (currentPnL > maxPnL) maxPnL = currentPnL;

      // Drawdown tracking
      const dd = maxPnL - currentPnL;
      if (dd > maxDD) maxDD = dd;

      const peakBalance = effectiveStartingBalance + maxPnL;
      const ddPct = peakBalance > 0 ? (dd / peakBalance) * 100 : 0;
      if (ddPct > maxDDPct) maxDDPct = ddPct;

      cumulativePnL[i] = {
        ts: t.exit_ts!.toISOString(),
        pnl: roundTo(currentPnL, 2),
      };

      // Time of Day
      const hour = t.exit_ts!.getUTCHours();
      const stats = todStats[hour];
      stats.pnl += pnl;
      stats.total += 1;

      // Wins & Return Sums (Performance Engineering: use returns for ratios)
      sumReturnPct += tradeReturnPct;
      sumSquaredReturnPct += tradeReturnPct * tradeReturnPct;

      if (pnl > 0) {
        stats.wins += 1;
        totalWins += 1;
        grossProfit += pnl;
        grossProfitPct += tradeReturnPct;
      } else if (pnl < 0) {
        totalLosses += 1;
        grossLoss += Math.abs(pnl);
        grossLossPct += Math.abs(tradeReturnPct);
        downsideSumSquaredReturnPct += tradeReturnPct * tradeReturnPct;
      }
    }

    const timeOfDay = todStats.map((stats, hour) => ({
      hour,
      ...stats,
      winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
    }));

    const avgWin = totalWins > 0 ? grossProfit / totalWins : 0;
    const avgLoss = totalLosses > 0 ? grossLoss / totalLosses : 0;
    const avgWinPct = totalWins > 0 ? grossProfitPct / totalWins : 0;
    const avgLossPct = totalLosses > 0 ? grossLossPct / totalLosses : 0;
    const expectancyPct = totalTrades > 0 ? sumReturnPct / totalTrades : 0;

    const avgWinLossRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 100 : 0);

    // Performance Engineering: Use the calculated effective starting balance for PnL %
    const overallPnlPct = effectiveStartingBalance > 0 ? (currentPnL / effectiveStartingBalance) * 100 : 0;

    // Sharpe and Sortino Ratios (Return-based)
    // BOLT: Using Welford-inspired Sum of Squares for single-pass variance on % returns
    let sharpeRatio = 0;
    let sortinoRatio = 0;

    if (totalTrades > 1) {
      const meanReturn = sumReturnPct / totalTrades;
      // Variance = E[X^2] - (E[X])^2
      const variance = Math.max(0, (sumSquaredReturnPct / totalTrades) - (meanReturn * meanReturn));
      const stdDev = Math.sqrt(variance);

      // Sortino: uses target return of 0
      const downsideVariance = downsideSumSquaredReturnPct / totalTrades;
      const downsideStdDev = Math.sqrt(downsideVariance);

      if (stdDev > 0) sharpeRatio = meanReturn / stdDev;
      if (downsideStdDev > 0) sortinoRatio = meanReturn / downsideStdDev;
    }

    return {
      cumulativePnL,
      maxDrawdown: roundTo(maxDD, 2),
      maxDrawdownPct: roundTo(maxDDPct, 2),
      timeOfDay,
      totalTrades,
      overallWinRate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0,
      overallPnlPct: roundTo(overallPnlPct, 2),
      avgWin: roundTo(avgWin, 2),
      avgLoss: roundTo(avgLoss, 2),
      avgWinPct: roundTo(avgWinPct, 2),
      avgLossPct: roundTo(avgLossPct, 2),
      expectancyPct: roundTo(expectancyPct, 2),
      avgWinLossRatio: roundTo(avgWinLossRatio, 2),
      profitFactor: roundTo(profitFactor, 2),
      sharpeRatio: roundTo(sharpeRatio, 2),
      sortinoRatio: roundTo(sortinoRatio, 2),
    };
  }
}
