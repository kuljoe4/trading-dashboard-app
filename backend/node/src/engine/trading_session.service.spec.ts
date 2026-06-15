import { EngineBroadcasterService } from './engine-broadcaster.service';
import { VariantAnalyticsService } from './variant-analytics.service';
import { TradingSessionService } from './trading_session.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('TradingSessionService', () => {
  let service: TradingSessionService;

  beforeEach(() => {
    const variantAnalytics = new VariantAnalyticsService();
    const positionTracker = { activeList: () => [], activeCount: () => 0, totalRisk: () => 0, recalculateTotalRisk: jest.fn() } as any;
    const engineBroadcaster = new EngineBroadcasterService({} as any, {} as any, {} as any, {} as any, {} as any, variantAnalytics, {} as any, positionTracker);

    service = new TradingSessionService(
      {} as any, // 1 tickerCache
      {} as any, // 2 klineStore
      {} as any, // 3 signalEngine
      {} as any, // 4 riskEngine
      positionTracker, // 5 positionTracker
      {} as any, // 6 orderManager
      {} as any, // 7 marketFeed
      {} as any, // 8 momentumScanner
      { recordHotLoop: jest.fn(), recordMainLoop: jest.fn() } as any, // 9 monitoringService
      {} as any, // 10 analyticsService
      {} as any, // 11 executionService
      {} as any, // 12 sessionLifecycle
      { setWsBroadcaster: jest.fn(), broadcast: jest.fn() } as any, // 13 broadcastService
      { reset: jest.fn(), getBalance: () => 10000, closedTrades: [] } as any, // 14 sessionState
      variantAnalytics, // 15 variantAnalytics
      engineBroadcaster, // 16 engineBroadcaster
      {} as any, // 17 gatingService
      {} as any, // 18 maintenanceService
      { log: jest.fn() } as any, // 19 auditLog
      { emit: jest.fn() } as any // 20 eventEmitter
    );
  });

  it('serializes trade with finite pnl and rr values', () => {
    const trade: any = {
      id: 'test-id',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 50000,
      initial_sl: 49000,
      qty: 0.1,
      status: 'OPEN'
    };
    const serialized = (service as any).engineBroadcaster.serializeTrade(trade, {}, 51000);
    expect(serialized.pnl).toBe(100);
    expect(serialized.rr).toBe(1);
  });
});
