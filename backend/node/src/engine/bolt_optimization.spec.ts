import { TradingSessionService } from './trading_session.service';
import { Trade } from '../models/Trade';

describe('Bolt Optimizations in TradingSessionService', () => {
  let service: TradingSessionService;

  beforeEach(() => {
    service = new TradingSessionService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        activeList: () => [],
        totalRisk: () => 0
      } as any,
      {} as any,
      {} as any,
      {} as any,
      { recordHotLoop: jest.fn(), getMetrics: jest.fn().mockReturnValue({}) } as any,
      {} as any,
    );
  });

  describe('calculateVariantStats', () => {
    it('correctly aggregates stats for multiple strategies', () => {
      // Mock strategy configs
      (service as any).config = {
        strategy_label: 'Momentum Strategy', // Match default label logic
        strategy_variants: [
          { strategy_label: 'Variant A', enabled: true },
          { strategy_label: 'Variant B', enabled: true }
        ]
      };

      // Mock closed trades stats cache
      (service as any).cachedClosedTradesStats = {
        'Momentum Strategy': { pnl: 100, count: 2, hits: 1 },
        'Variant A': { pnl: -50, count: 1, hits: 0 }
      };
      (service as any).lastClosedTradesStatsCount = 3;
      (service as any).closedTrades = [{}, {}, {}]; // Length must match lastClosedTradesStatsCount

      const activeTrades: any[] = [
        { strategy_label: 'Momentum Strategy', pnl: 10, risk_usdt: 5 },
        { strategy_label: 'Variant A', pnl: 20, risk_usdt: 10 },
        { strategy_label: 'Variant B', pnl: -5, risk_usdt: 2 }
      ];

      (service as any).balancePaper = 1000;
      (service as any).config.paper_mode = true;

      const stats = (service as any).calculateVariantStats(activeTrades);

      expect(stats['Momentum Strategy']).toEqual({
        totalPnl: 110, // 100 closed + 10 active
        entryCount: 3, // 2 closed + 1 active
        hitCount: 2,   // 1 closed + 1 active
        totalRiskPct: 0.5, // (5 / 1000) * 100
        activeTradeCount: 1
      });

      expect(stats['Variant A']).toEqual({
        totalPnl: -30, // -50 closed + 20 active
        entryCount: 2, // 1 closed + 1 active
        hitCount: 1,   // 0 closed + 1 active
        totalRiskPct: 1, // (10 / 1000) * 100
        activeTradeCount: 1
      });

      expect(stats['Variant B']).toEqual({
        totalPnl: -5,  // 0 closed + -5 active
        entryCount: 1, // 0 closed + 1 active
        hitCount: 0,   // 0 closed + 0 active
        totalRiskPct: 0.2, // (2 / 1000) * 100
        activeTradeCount: 1
      });
    });
  });

  describe('getClosedTradesStats', () => {
    it('lazily updates and caches stats when closed trades count changes', () => {
      const closedTrades: any[] = [
        { strategy_label: 'Momentum Strategy', pnl: 10 },
        { strategy_label: 'Momentum Strategy', pnl: 20 },
        { strategy_label: 'Variant A', pnl: -5 }
      ];

      (service as any).closedTrades = closedTrades;
      const stats1 = (service as any).getClosedTradesStats();

      expect(stats1['Momentum Strategy']).toEqual({ pnl: 30, count: 2, hits: 2 });
      expect(stats1['Variant A']).toEqual({ pnl: -5, count: 1, hits: 0 });

      // Should return cached version
      const stats2 = (service as any).getClosedTradesStats();
      expect(stats2).toBe(stats1);

      // Should recalculate if count changes
      (service as any).closedTrades = [...closedTrades, { strategy_label: 'Variant A', pnl: 15 }];
      const stats3 = (service as any).getClosedTradesStats();
      expect(stats3).not.toBe(stats1);
      expect(stats3['Variant A']).toEqual({ pnl: 10, count: 2, hits: 1 });
    });
  });
});
