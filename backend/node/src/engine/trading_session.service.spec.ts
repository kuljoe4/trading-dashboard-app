import { EngineBroadcasterService } from './engine-broadcaster.service';
import { VariantAnalyticsService } from './variant-analytics.service';
import { TradingSessionService } from './trading_session.service';

describe('TradingSessionService', () => {
  let service: TradingSessionService;

  beforeEach(() => {
    service = new TradingSessionService(
      {} as any, {} as any, {} as any, {} as any,
      { activeList: () => [], activeCount: () => 0, totalRisk: () => 0 } as any,
      {} as any, {} as any, {} as any,
      { recordHotLoop: jest.fn(), recordMainLoop: jest.fn() } as any,
      {} as any, {} as any, {} as any,
      { setWsBroadcaster: jest.fn(), broadcast: jest.fn() } as any,
      { reset: jest.fn(), getBalance: () => 10000, closedTrades: [] } as any,
      {} as any, // variantAnalytics
      new EngineBroadcasterService({} as any, {} as any, {} as any, {} as any, {} as any, new VariantAnalyticsService()),
      {} as any, // gatingService
      { log: jest.fn() } as any, // auditLog
      { emit: jest.fn() } as any
    );
  });

  it('serializes trade with finite pnl and rr values', () => {
    const trade = {
      symbol: 'BTCUSDT',
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
