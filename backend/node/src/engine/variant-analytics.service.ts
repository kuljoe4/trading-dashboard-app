import { Injectable } from '@nestjs/common';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { roundEight, roundTo } from '../lib/math';

@Injectable()
export class VariantAnalyticsService {
  calculateVariantStats(
    activeTrades: Trade[],
    balance: number,
    closedStats: Record<string, { pnl: number, count: number, hits: number }>,
    strategyConfigs: SessionConfig[]
  ): Record<string, any> {
    const variantStats: Record<string, any> = {};
    const groups: Record<string, { pnl: number, risk: number, count: number, hits: number }> = {};

    for (let i = 0; i < activeTrades.length; i++) {
      const t = activeTrades[i];
      const l = t.strategy_label || 'Momentum Strategy';
      if (!groups[l]) groups[l] = { pnl: 0, risk: 0, count: 0, hits: 0 };
      groups[l].pnl = roundEight(groups[l].pnl + (t.pnl || 0));
      groups[l].risk = roundEight(groups[l].risk + (t.risk_usdt || 0));
      groups[l].count++;
      if ((t.pnl || 0) > 0) groups[l].hits++;
    }

    strategyConfigs.forEach(cfg => {
      const l = cfg.strategy_label!;
      const a = groups[l] || { pnl: 0, risk: 0, count: 0, hits: 0 };
      const c = closedStats[l] || { pnl: 0, count: 0, hits: 0 };
      variantStats[l] = {
        totalPnl: roundEight(c.pnl + a.pnl),
        entryCount: c.count + a.count,
        hitCount: c.hits + a.hits,
        totalRiskPct: roundTo(balance > 0 ? (a.risk / balance) * 100 : 0, 2),
        activeTradeCount: a.count
      };
    });

    return variantStats;
  }
}
