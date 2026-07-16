import { Injectable, Logger } from '@nestjs/common';
import { TradeEntity } from '../models/entities/Trade.entity';
import { roundTo } from '../lib/math';
import { RrOptimizationResult } from './rr-optimization.service';

export interface RiskWidthBucket {
  label: string;
  minPct: number;
  maxPct: number;
  tradesCount: number;
  winRate: number;
  profitFactor: number;
  avgDurationMs: number;
  netPnl: number;
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
  maxWinStreak: number;
  maxLossStreak: number;
  avgDuration: number;
  roiTrends: {
    sevenDay: number;
    fourWeek: number;
  };
  rrOptimization?: RrOptimizationResult;
  riskWidthBuckets?: RiskWidthBucket[];
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
    // BOLT OPTIMIZATION: Fuse filter and PnL summation into a single pass
    const filteredTrades: TradeEntity[] = [];
    let totalNetPnL = 0;

    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      if (t.status !== 'OPEN' && t.exit_ts && !t.is_reconciliation) {
        filteredTrades.push(t);
        totalNetPnL += Number(t.pnl || 0);
      }
    }

    // Sort is necessary for equity curve and drawdown metrics
    const sortedTrades = filteredTrades.sort((a, b) => a.exit_ts!.getTime() - b.exit_ts!.getTime());
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

    // ROI Trends Calculation (UTC-aware) - Pre-calculate boundaries
    const nowMs = Date.now();
    const sevenDaysAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const fourWeeksAgoMs = nowMs - 28 * 24 * 60 * 60 * 1000;
    let sevenDayPnL = 0;
    let fourWeekPnL = 0;

    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;
    let totalDurationMs = 0;

    // Risk Width Buckets - Fused aggregation
    const riskWidthBuckets = [
      { label: 'Tight (<0.6%)', minPct: 0, maxPct: 0.6, grossProfit: 0, grossLoss: 0, totalDuration: 0, wins: 0, count: 0, netPnl: 0 },
      { label: 'Medium (0.6%-1.5%)', minPct: 0.6, maxPct: 1.5, grossProfit: 0, grossLoss: 0, totalDuration: 0, wins: 0, count: 0, netPnl: 0 },
      { label: 'Wide (>1.5%)', minPct: 1.5, maxPct: Infinity, grossProfit: 0, grossLoss: 0, totalDuration: 0, wins: 0, count: 0, netPnl: 0 }
    ];

    // Performance Engineering: Ensure a stable anchor for ROI calculations.
    // If startingBalance is provided (e.g. from session config), use it.
    // Otherwise, fallback to the recomputed balance logic.
    // NOTE: anchoring to (currentBalance - totalNetPnL) is susceptible to drift
    // if the user adds/removes funds. We prioritize startingBalance if available.
    const effectiveStartingBalance = startingBalance > 0
      ? startingBalance
      : ((currentBalance && currentBalance > 0) ? Math.max(1, currentBalance - totalNetPnL) : 10000);

    let rollingBalance = effectiveStartingBalance;
    const cumulativePnL: { ts: string; pnl: number }[] = new Array(totalTrades);
    // Time of day analysis (0-23 hours) - Fixed size array for better performance
    const todStats = Array.from({ length: 24 }, () => ({ pnl: 0, wins: 0, total: 0 }));

    // BOLT OPTIMIZATION: Single-pass calculation for ALL metrics including ROI trends
    for (let i = 0; i < totalTrades; i++) {
      const t = sortedTrades[i];
      const pnl = Number(t.pnl || 0);
      const exitTs = t.exit_ts!;
      const exitTsMs = exitTs.getTime();

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
        ts: exitTs.toISOString(),
        pnl: roundTo(currentPnL, 2),
      };

      // ROI Trends (Fused into main loop)
      if (exitTsMs >= sevenDaysAgoMs) sevenDayPnL += pnl;
      if (exitTsMs >= fourWeeksAgoMs) fourWeekPnL += pnl;

      // Time of Day
      const hour = exitTs.getUTCHours();
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

        currentWinStreak++;
        currentLossStreak = 0;
        if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
      } else if (pnl < 0) {
        totalLosses += 1;
        grossLoss += Math.abs(pnl);
        grossLossPct += Math.abs(tradeReturnPct);
        downsideSumSquaredReturnPct += tradeReturnPct * tradeReturnPct;

        currentLossStreak++;
        currentWinStreak = 0;
        if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
      }

      const entryTs = t.entry_ts;
      let duration = 0;
      if (entryTs) {
        duration = exitTsMs - entryTs.getTime();
        totalDurationMs += duration;
      }

      // Fused Risk-Width processing
      const entryVal = Number(t.entry_price || 0);
      const slVal = Number(t.initial_sl || t.current_sl || 0);
      if (entryVal > 0 && slVal > 0) {
        const slDistPct = (Math.abs(entryVal - slVal) / entryVal) * 100;
        const bucketIdx = slDistPct < 0.6 ? 0 : (slDistPct < 1.5 ? 1 : 2);
        const b = riskWidthBuckets[bucketIdx];
        b.count++;
        b.netPnl += pnl;
        b.totalDuration += duration;
        if (pnl > 0) {
          b.wins++;
          b.grossProfit += pnl;
        } else if (pnl < 0) {
          b.grossLoss += Math.abs(pnl);
        }
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

    const roiTrends = {
      sevenDay: effectiveStartingBalance > 0 ? (sevenDayPnL / effectiveStartingBalance) * 100 : 0,
      fourWeek: effectiveStartingBalance > 0 ? (fourWeekPnL / effectiveStartingBalance) * 100 : 0,
    };

    const finalizedBuckets: RiskWidthBucket[] = riskWidthBuckets.map(b => ({
      label: b.label,
      minPct: b.minPct,
      maxPct: b.maxPct,
      tradesCount: b.count,
      winRate: b.count > 0 ? roundTo((b.wins / b.count) * 100, 2) : 0,
      profitFactor: b.grossLoss > 0 ? roundTo(b.grossProfit / b.grossLoss, 2) : (b.grossProfit > 0 ? 100 : 0),
      avgDurationMs: b.count > 0 ? Math.round(b.totalDuration / b.count) : 0,
      netPnl: roundTo(b.netPnl, 2)
    }));

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
      maxWinStreak,
      maxLossStreak,
      avgDuration: totalTrades > 0 ? Math.round(totalDurationMs / totalTrades) : 0,
      roiTrends: {
        sevenDay: roundTo(roiTrends.sevenDay, 2),
        fourWeek: roundTo(roiTrends.fourWeek, 2),
      },
      riskWidthBuckets: finalizedBuckets,
    };
  }
}
