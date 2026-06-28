import { Injectable, Logger } from '@nestjs/common';
import { TradeEntity } from '../models/entities/Trade.entity';
import { roundTo } from '../lib/math';

export interface PeriodicStat {
  pnl: number;
  pnlPct: number;
}

export interface HistoryPoint {
  label: string;
  pnl: number;
  pnlPct: number;
}

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
  periodic: {
    daily: PeriodicStat;
    weekly: PeriodicStat;
    monthly: PeriodicStat;
  };
  periodicHistory: {
    daily: HistoryPoint[];
    weekly: HistoryPoint[];
  };
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  /**
   * PERFORMANCE OPTIMIZATION: Single-pass O(N) processing using timestamp math.
   * Eliminates object/string creation inside the hot loop to reduce GC pressure.
   * Enforces strict UTC boundaries for consistent global reporting.
   */
  calculateAnalytics(trades: TradeEntity[], startingBalance: number = 10000, currentBalance?: number): AnalyticsResult {
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
    let sumReturnPct = 0;
    let sumSquaredReturnPct = 0;
    let downsideSumSquaredReturnPct = 0;

    const totalNetPnL = sortedTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
    const effectiveStartingBalance = (currentBalance && currentBalance > 0)
      ? Math.max(1, currentBalance - totalNetPnL)
      : startingBalance;

    let rollingBalance = effectiveStartingBalance;
    const cumulativePnL: { ts: string; pnl: number }[] = new Array(totalTrades);
    const todStats = Array.from({ length: 24 }, () => ({ pnl: 0, wins: 0, total: 0 }));

    // PRE-CALCULATE UTC BOUNDARIES using timestamp math (O(1))
    const now = new Date();
    const nowTs = now.getTime();

    const startOfDayTs = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();

    // Start of week (Monday UTC)
    const dayOfWeek = now.getUTCDay(); // 0 is Sunday
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startOfWeekTs = startOfDayTs - (diff * 86400000);

    const startOfMonthTs = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime();

    let dailyPnL = 0;
    let weeklyPnL = 0;
    let monthlyPnL = 0;

    // Use Maps for buckets (O(1) lookups, minimal overhead)
    const dailyBuckets = new Map<number, { pnl: number, startBal: number }>();
    const weeklyBuckets = new Map<number, { pnl: number, startBal: number }>();

    for (let i = 0; i < totalTrades; i++) {
      const t = sortedTrades[i];
      const pnl = Number(t.pnl || 0);
      const exitTs = t.exit_ts!.getTime();

      const tradeStartBal = rollingBalance;
      const tradeReturnPct = tradeStartBal > 0 ? (pnl / tradeStartBal) * 100 : 0;
      rollingBalance = Math.max(1, rollingBalance + pnl);

      currentPnL += pnl;
      if (currentPnL > maxPnL) maxPnL = currentPnL;
      const dd = maxPnL - currentPnL;
      if (dd > maxDD) maxDD = dd;
      const peakBalance = effectiveStartingBalance + maxPnL;
      const ddPct = peakBalance > 0 ? (dd / peakBalance) * 100 : 0;
      if (ddPct > maxDDPct) maxDDPct = ddPct;

      cumulativePnL[i] = { ts: t.exit_ts!.toISOString(), pnl: roundTo(currentPnL, 2) };

      // Boundary Checks
      if (exitTs >= startOfDayTs) dailyPnL += pnl;
      if (exitTs >= startOfWeekTs) weeklyPnL += pnl;
      if (exitTs >= startOfMonthTs) monthlyPnL += pnl;

      // History Bucketing via Timestamp Math (Zero string creation in loop)
      const dayTs = Math.floor(exitTs / 86400000) * 86400000;
      const dBucket = dailyBuckets.get(dayTs);
      if (!dBucket) dailyBuckets.set(dayTs, { pnl: pnl, startBal: tradeStartBal });
      else dBucket.pnl += pnl;

      // Week Bucket (Monday-based)
      const tradeDate = new Date(exitTs);
      const tDay = tradeDate.getUTCDay();
      const tDiff = tDay === 0 ? 6 : tDay - 1;
      const weekTs = new Date(Date.UTC(tradeDate.getUTCFullYear(), tradeDate.getUTCMonth(), tradeDate.getUTCDate())).getTime() - (tDiff * 86400000);

      const wBucket = weeklyBuckets.get(weekTs);
      if (!wBucket) weeklyBuckets.set(weekTs, { pnl: pnl, startBal: tradeStartBal });
      else wBucket.pnl += pnl;

      const hour = t.exit_ts!.getUTCHours();
      const stats = todStats[hour];
      stats.pnl += pnl;
      stats.total += 1;
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

    // Format History (Outside loop)
    const dailyHistory = Array.from(dailyBuckets.keys())
      .sort((a, b) => a - b)
      .slice(-7)
      .map(ts => {
        const b = dailyBuckets.get(ts)!;
        return {
          label: new Date(ts).toISOString().split('T')[0],
          pnl: roundTo(b.pnl, 2),
          pnlPct: roundTo((b.pnl / Math.max(1, b.startBal)) * 100, 2)
        };
      });

    const weeklyHistory = Array.from(weeklyBuckets.keys())
      .sort((a, b) => a - b)
      .slice(-4)
      .map(ts => {
        const b = weeklyBuckets.get(ts)!;
        return {
          label: `Week of ${new Date(ts).toISOString().split('T')[0]}`,
          pnl: roundTo(b.pnl, 2),
          pnlPct: roundTo((b.pnl / Math.max(1, b.startBal)) * 100, 2)
        };
      });

    const timeOfDay = todStats.map((stats, hour) => ({
      hour, ...stats, winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
    }));

    const avgWin = totalWins > 0 ? grossProfit / totalWins : 0;
    const avgLoss = totalLosses > 0 ? grossLoss / totalLosses : 0;
    const avgWinPct = totalWins > 0 ? grossProfitPct / totalWins : 0;
    const avgLossPct = totalLosses > 0 ? grossLossPct / totalLosses : 0;
    const expectancyPct = totalTrades > 0 ? sumReturnPct / totalTrades : 0;
    const avgWinLossRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 100 : 0);
    const overallPnlPct = effectiveStartingBalance > 0 ? (currentPnL / effectiveStartingBalance) * 100 : 0;

    let sharpeRatio = 0;
    let sortinoRatio = 0;
    if (totalTrades > 1) {
      const meanReturn = sumReturnPct / totalTrades;
      const variance = Math.max(0, (sumSquaredReturnPct / totalTrades) - (meanReturn * meanReturn));
      const stdDev = Math.sqrt(variance);
      const downsideVariance = downsideSumSquaredReturnPct / totalTrades;
      const downsideStdDev = Math.sqrt(downsideVariance);
      if (stdDev > 0) sharpeRatio = meanReturn / stdDev;
      if (downsideStdDev > 0) sortinoRatio = meanReturn / downsideStdDev;
    }

    // Standardized ROI basis: Period PnL / Balance at start of period
    const dailyStartBal = Math.max(1, (currentBalance || startingBalance) - dailyPnL);
    const weeklyStartBal = Math.max(1, (currentBalance || startingBalance) - weeklyPnL);
    const monthlyStartBal = Math.max(1, (currentBalance || startingBalance) - monthlyPnL);

    return {
      cumulativePnL, maxDrawdown: roundTo(maxDD, 2), maxDrawdownPct: roundTo(maxDDPct, 2), timeOfDay, totalTrades,
      overallWinRate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0,
      overallPnlPct: roundTo(overallPnlPct, 2), avgWin: roundTo(avgWin, 2), avgLoss: roundTo(avgLoss, 2),
      avgWinPct: roundTo(avgWinPct, 2), avgLossPct: roundTo(avgLossPct, 2),
      expectancyPct: roundTo(expectancyPct, 2), avgWinLossRatio: roundTo(avgWinLossRatio, 2),
      profitFactor: roundTo(profitFactor, 2), sharpeRatio: roundTo(sharpeRatio, 2), sortinoRatio: roundTo(sortinoRatio, 2),
      periodic: {
        daily: { pnl: roundTo(dailyPnL, 2), pnlPct: roundTo((dailyPnL / dailyStartBal) * 100, 2) },
        weekly: { pnl: roundTo(weeklyPnL, 2), pnlPct: roundTo((weeklyPnL / weeklyStartBal) * 100, 2) },
        monthly: { pnl: roundTo(monthlyPnL, 2), pnlPct: roundTo((monthlyPnL / monthlyStartBal) * 100, 2) },
      },
      periodicHistory: { daily: dailyHistory, weekly: weeklyHistory }
    };
  }
}
