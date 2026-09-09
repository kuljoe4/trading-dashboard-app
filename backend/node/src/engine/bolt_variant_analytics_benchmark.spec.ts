import { VariantAnalyticsService } from './variant-analytics.service';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { roundEight, roundTo } from '../lib/math';

function calculateVariantStatsUnoptimized(
  activeTrades: Trade[],
  balance: number,
  closedStats: Record<string, { pnl: number; count: number; hits: number }>,
  strategyConfigs: SessionConfig[]
): Record<string, any> {
  const variantStats: Record<string, any> = {};
  const groups: Record<string, { pnl: number; risk: number; count: number; hits: number; estPnlToRealize: number }> = {};

  for (let i = 0; i < activeTrades.length; i++) {
    const t = activeTrades[i];
    const l = t.strategy_label || 'Momentum Strategy';
    if (!groups[l]) groups[l] = { pnl: 0, risk: 0, count: 0, hits: 0, estPnlToRealize: 0 };
    groups[l].pnl = roundEight(groups[l].pnl + (t.pnl || 0));
    groups[l].risk = roundEight(groups[l].risk + (t.risk_usdt || 0));
    groups[l].count++;
    if ((t.pnl || 0) > 0) groups[l].hits++;
    groups[l].estPnlToRealize = roundEight(groups[l].estPnlToRealize + (t.est_pnl_to_realize || 0));
  }

  const allLabels = new Set<string>();
  strategyConfigs.forEach(cfg => {
    if (cfg.strategy_label) allLabels.add(cfg.strategy_label);
  });
  Object.keys(groups).forEach(l => allLabels.add(l));
  Object.keys(closedStats).forEach(l => allLabels.add(l));

  allLabels.forEach(l => {
    const a = groups[l] || { pnl: 0, risk: 0, count: 0, hits: 0, estPnlToRealize: 0 };
    const c = closedStats[l] || { pnl: 0, count: 0, hits: 0 };
    variantStats[l] = {
      totalPnl: roundEight(c.pnl + a.pnl),
      entryCount: c.count + a.count,
      hitCount: c.hits + a.hits,
      totalRiskPct: roundTo(balance > 0 ? (a.risk / balance) * 100 : 0, 2),
      activeTradeCount: a.count,
      totalSlUsed: roundTo(a.risk, 2),
      totalEstPnlToRealize: roundTo(a.estPnlToRealize || 0, 2)
    };
  });

  return variantStats;
}

describe('VariantAnalyticsService Optimization & Benchmark', () => {
  const service = new VariantAnalyticsService();

  const mockActiveTrades: any[] = Array.from({ length: 50 }, (_, i) => ({
    id: `trade_${i}`,
    strategy_label: i % 3 === 0 ? 'Momentum Strategy' : i % 3 === 1 ? 'Scalp Variant A' : 'Breakout Variant B',
    pnl: (i % 2 === 0 ? 1 : -1) * (i * 0.45 + 1.2345678),
    risk_usdt: 10 + i * 0.5,
    est_pnl_to_realize: i * 0.25,
  }));

  const mockClosedStats = {
    'Momentum Strategy': { pnl: 150.12345678, count: 20, hits: 12 },
    'Scalp Variant A': { pnl: -45.54321, count: 15, hits: 6 },
    'Breakout Variant B': { pnl: 210.00000001, count: 30, hits: 20 },
    'Legacy Variant C': { pnl: 12.5, count: 5, hits: 3 },
  };

  const mockConfigs: any[] = [
    { strategy_label: 'Momentum Strategy' },
    { strategy_label: 'Scalp Variant A' },
    { strategy_label: 'Breakout Variant B' },
    { strategy_label: 'Unused Strategy D' },
  ];

  it('produces identical result structure and values to original implementation', () => {
    const resUnoptimized = calculateVariantStatsUnoptimized(mockActiveTrades, 10000, mockClosedStats, mockConfigs);
    const resOptimized = service.calculateVariantStats(mockActiveTrades, 10000, mockClosedStats, mockConfigs);

    expect(resOptimized).toEqual(resUnoptimized);
  });

  it('benchmark: measures speedup of optimized variant analytics', () => {
    const iterations = 50000;

    const startUnoptimized = performance.now();
    for (let i = 0; i < iterations; i++) {
      calculateVariantStatsUnoptimized(mockActiveTrades, 10000, mockClosedStats, mockConfigs);
    }
    const timeUnoptimized = performance.now() - startUnoptimized;

    const startOptimized = performance.now();
    for (let i = 0; i < iterations; i++) {
      service.calculateVariantStats(mockActiveTrades, 10000, mockClosedStats, mockConfigs);
    }
    const timeOptimized = performance.now() - startOptimized;

    const speedup = (timeUnoptimized / timeOptimized).toFixed(2);
    console.log(`\n⚡ Bolt Performance Benchmark (calculateVariantStats, ${iterations} iterations):`);
    console.log(`  - Original (Set + Object.keys + .forEach + in-loop roundEight): ${timeUnoptimized.toFixed(2)} ms`);
    console.log(`  - Optimized (Loop Fusion + for...in key tracking):              ${timeOptimized.toFixed(2)} ms`);
    console.log(`  - Execution Speedup:                                            ${speedup}x faster\n`);

    expect(timeOptimized).toBeLessThan(timeUnoptimized);
  });
});
