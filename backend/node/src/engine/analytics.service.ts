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
  byStrategy: Record<string, {
    label: string;
    pnl: number;
    wins: number;
    total: number;
    winRate: number;
  }>;
  totalTrades: number;
  overallWinRate: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  calculateAnalytics(trades: TradeEntity[], startingBalance: number = 10000): AnalyticsResult {
    // Sort trades by exit timestamp to build chronological equity curve
    const sortedTrades = [...trades]
      .filter(t => t.status !== 'OPEN' && t.exit_ts)
      .sort((a, b) => new Date(a.exit_ts!).getTime() - new Date(b.exit_ts!).getTime());

    let currentPnL = 0;
    let maxPnL = 0;
    let maxDD = 0;
    let maxDDPct = 0;

    const cumulativePnL = sortedTrades.map((t) => {
      currentPnL += Number(t.pnl || 0);
      if (currentPnL > maxPnL) maxPnL = currentPnL;

      const dd = maxPnL - currentPnL;
      if (dd > maxDD) maxDD = dd;

      const currentBalance = startingBalance + currentPnL;
      const peakBalance = startingBalance + maxPnL;
      const ddPct = peakBalance > 0 ? (dd / peakBalance) * 100 : 0;
      if (ddPct > maxDDPct) maxDDPct = ddPct;

      return {
        ts: t.exit_ts!.toISOString(),
        pnl: currentPnL,
      };
    });

    // Time of day analysis (0-23 hours)
    const todMap = new Map<number, { pnl: number; wins: number; total: number }>();
    for (let i = 0; i < 24; i++) {
      todMap.set(i, { pnl: 0, wins: 0, total: 0 });
    }

    sortedTrades.forEach((t) => {
      const exitDate = new Date(t.exit_ts!);
      const hour = exitDate.getUTCHours();
      const stats = todMap.get(hour)!;
      stats.pnl += Number(t.pnl || 0);
      stats.total += 1;
      if (Number(t.pnl || 0) > 0) stats.wins += 1;
    });

    const timeOfDay = Array.from(todMap.entries()).map(([hour, stats]) => ({
      hour,
      ...stats,
      winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
    }));

    // Strategy analysis
    const strategyMap = new Map<string, { label: string; pnl: number; wins: number; total: number }>();

    sortedTrades.forEach((t) => {
      const sid = t.strategyId || 'default';
      const label = t.strategyLabel || (t as any).strategyLabel || sid;

      if (!strategyMap.has(sid)) {
        strategyMap.set(sid, { label, pnl: 0, wins: 0, total: 0 });
      }

      const stats = strategyMap.get(sid)!;
      stats.pnl += Number(t.pnl || 0);
      stats.total += 1;
      if (Number(t.pnl || 0) > 0) stats.wins += 1;
    });

    const byStrategy: Record<string, any> = {};
    strategyMap.forEach((stats, sid) => {
      byStrategy[sid] = {
        ...stats,
        winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
      };
    });

    const totalTrades = sortedTrades.length;
    const totalWins = sortedTrades.filter(t => Number(t.pnl || 0) > 0).length;

    return {
      cumulativePnL,
      maxDrawdown: maxDD,
      maxDrawdownPct: maxDDPct,
      timeOfDay,
      byStrategy,
      totalTrades,
      overallWinRate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0,
    };
  }
}
