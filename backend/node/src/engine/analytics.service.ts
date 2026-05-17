import { Injectable, Logger } from '@nestjs/common';
import { TradeEntity } from '../models/entities/Trade.entity';

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
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  calculateAnalytics(trades: TradeEntity[], startingBalance: number = 10000): AnalyticsResult {
    // BOLT OPTIMIZATION: Combine multiple iterations into a single-pass loop
    // 1. Initial filter and sort (necessary for equity curve)
    const sortedTrades = [...trades]
      .filter(t => t.status !== 'OPEN' && t.exit_ts)
      .sort((a, b) => a.exit_ts!.getTime() - b.exit_ts!.getTime());

    let currentPnL = 0;
    let maxPnL = 0;
    let maxDD = 0;
    let maxDDPct = 0;
    let totalWins = 0;

    const cumulativePnL: { ts: string; pnl: number }[] = [];

    // TOD Optimization: Use fixed-size array instead of Map
    const todStats = Array.from({ length: 24 }, () => ({ pnl: 0, wins: 0, total: 0 }));

    for (const t of sortedTrades) {
      const pnl = Number(t.pnl || 0);
      currentPnL += pnl;

      // Equity curve
      if (currentPnL > maxPnL) maxPnL = currentPnL;

      // Drawdown tracking
      const dd = maxPnL - currentPnL;
      if (dd > maxDD) maxDD = dd;

      const peakBalance = startingBalance + maxPnL;
      const ddPct = peakBalance > 0 ? (dd / peakBalance) * 100 : 0;
      if (ddPct > maxDDPct) maxDDPct = ddPct;

      cumulativePnL.push({
        ts: t.exit_ts!.toISOString(),
        pnl: currentPnL,
      });

      // TOD stats
      const hour = t.exit_ts!.getUTCHours();
      const stats = todStats[hour];
      stats.pnl += pnl;
      stats.total += 1;

      if (pnl > 0) {
        stats.wins += 1;
        totalWins++;
      }
    }

    const timeOfDay = todStats.map((stats, hour) => ({
      hour,
      ...stats,
      winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
    }));

    const totalTrades = sortedTrades.length;

    return {
      cumulativePnL,
      maxDrawdown: maxDD,
      maxDrawdownPct: maxDDPct,
      timeOfDay,
      totalTrades,
      overallWinRate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0,
    };
  }
}
