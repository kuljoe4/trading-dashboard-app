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
  avgWin: number;
  avgLoss: number;
  avgWinLossRatio: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  /**
   * BOLT OPTIMIZATION: Optimized to single-pass processing with minimal allocations.
   * Reduces GC pressure in the engine hot loop.
   */
  calculateAnalytics(trades: TradeEntity[], startingBalance: number = 10000): AnalyticsResult {
    // BOLT OPTIMIZATION: Combine multiple iterations into a single-pass loop
    // 1. Initial filter and sort (necessary for equity curve)
    const sortedTrades = [...trades]
      .filter(t => t.status !== 'OPEN' && t.exit_ts)
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

    const cumulativePnL: { ts: string; pnl: number }[] = new Array(totalTrades);
    // Time of day analysis (0-23 hours) - Fixed size array for better performance
    const todStats = Array.from({ length: 24 }, () => ({ pnl: 0, wins: 0, total: 0 }));

    // BOLT OPTIMIZATION: Single-pass calculation for all metrics to avoid multiple array iterations
    for (let i = 0; i < totalTrades; i++) {
      const t = sortedTrades[i];
      const pnl = Number(t.pnl || 0);

      // Equity curve & Drawdown
      currentPnL += pnl;
      if (currentPnL > maxPnL) maxPnL = currentPnL;

      // Drawdown tracking
      const dd = maxPnL - currentPnL;
      if (dd > maxDD) maxDD = dd;

      const peakBalance = startingBalance + maxPnL;
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

      // Wins
      if (pnl > 0) {
        stats.wins += 1;
        totalWins += 1;
        grossProfit += pnl;
      } else if (pnl < 0) {
        totalLosses += 1;
        grossLoss += Math.abs(pnl);
      }
    }

    const timeOfDay = todStats.map((stats, hour) => ({
      hour,
      ...stats,
      winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
    }));

    const avgWin = totalWins > 0 ? grossProfit / totalWins : 0;
    const avgLoss = totalLosses > 0 ? grossLoss / totalLosses : 0;
    const avgWinLossRatio = avgLoss > 0 ? avgWin / avgLoss : 0;

    return {
      cumulativePnL,
      maxDrawdown: roundTo(maxDD, 2),
      maxDrawdownPct: roundTo(maxDDPct, 2),
      timeOfDay,
      totalTrades,
      overallWinRate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0,
      avgWin: roundTo(avgWin, 2),
      avgLoss: roundTo(avgLoss, 2),
      avgWinLossRatio: roundTo(avgWinLossRatio, 2),
    };
  }
}
