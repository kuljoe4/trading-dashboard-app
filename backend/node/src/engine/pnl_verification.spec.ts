import { TradingSessionService } from './trading_session.service';

describe('TradingSession Mock', () => {
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
      { broadcastTick: jest.fn(), serializeTrade: (t: any) => t } as any,
      {} as any, // gatingService
      { log: jest.fn() } as any, // auditLog
      { emit: jest.fn() } as any
    );
  });

  it('instantiates', () => {
    expect(service).toBeDefined();
  });
});
