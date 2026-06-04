import { TradingSessionService } from './trading_session.service';
import { VariantAnalyticsService } from './variant-analytics.service';

describe('Bolt Optimizations in TradingSessionService', () => {
  let service: TradingSessionService;
  let variantAnalytics: VariantAnalyticsService;

  beforeEach(() => {
    variantAnalytics = new VariantAnalyticsService();
    service = new TradingSessionService(
      {} as any, {} as any, {} as any, {} as any,
      { activeList: () => [], totalRisk: () => 0 } as any,
      {} as any, {} as any, {} as any,
      { recordHotLoop: jest.fn(), getMetrics: jest.fn().mockReturnValue({}) } as any,
      {} as any, {} as any,
      { reset: jest.fn(), cachedClosedTradesStats: {} } as any,
      variantAnalytics, {} as any, {} as any, { emit: jest.fn() } as any
    );
  });

  describe('calculateVariantStats', () => {
    it('correctly aggregates stats for multiple strategies', () => {
      (service as any).config = {
        strategy_label: 'Momentum Strategy',
        strategy_variants: [
          { strategy_label: 'Variant A', enabled: true },
          { strategy_label: 'Variant B', enabled: true }
        ]
      };

      (service as any).sessionState = {
        cachedClosedTradesStats: {
          'Momentum Strategy': { pnl: 100, count: 2, hits: 1 },
          'Variant A': { pnl: -50, count: 1, hits: 0 }
        },
        closedTrades: [{}, {}, {}],
        getBalance: () => 1000
      };

      const activeTrades: any[] = [
        { strategy_label: 'Momentum Strategy', pnl: 10, risk_usdt: 5 },
        { strategy_label: 'Variant A', pnl: 20, risk_usdt: 10 },
        { strategy_label: 'Variant B', pnl: -5, risk_usdt: 2 }
      ];

      const stats = variantAnalytics.calculateVariantStats(
        activeTrades,
        1000,
        (service as any).sessionState.cachedClosedTradesStats,
        (service as any).getStrategyConfigs()
      );

      expect(stats['Momentum Strategy']).toEqual({
        totalPnl: 110,
        entryCount: 3,
        hitCount: 2,
        totalRiskPct: 0.5,
        activeTradeCount: 1
      });
    });
  });
});
