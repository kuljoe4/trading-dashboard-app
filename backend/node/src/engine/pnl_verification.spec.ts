import { TradingSessionService } from './trading_session.service';

describe('TradingSession Mock', () => {
  let service: TradingSessionService;

  beforeEach(() => {
    service = new TradingSessionService(
      {} as any, // tickerCache
      {} as any, // klineStore
      {} as any, // signalEngine
      {} as any, // riskEngine
      { activeList: () => [], activeCount: () => 0, totalRisk: () => 0, recalculateTotalRisk: jest.fn() } as any, // positionTracker
      {} as any, // orderManager
      {} as any, // marketFeed
      {} as any, // momentumScanner
      { recordHotLoop: jest.fn(), recordMainLoop: jest.fn() } as any, // monitoringService
      {} as any, // analyticsService
      {} as any, // executionService
      {} as any, // sessionLifecycle
      { setWsBroadcaster: jest.fn(), broadcast: jest.fn() } as any, // broadcastService
      { reset: jest.fn(), getBalance: () => 10000, closedTrades: [] } as any, // sessionState
      {} as any, // variantAnalytics
      { serializeTrade: jest.fn(), minimize: jest.fn(), getLastTickData: jest.fn(), getLastRiskResult: jest.fn(), getLastAnalyticsResult: jest.fn() } as any, // engineBroadcaster
      { mapGateState: jest.fn(), isInsideTradingWindow: jest.fn().mockReturnValue(true) } as any, // gatingService
      {} as any, // maintenanceService
      { log: jest.fn() } as any, // auditLog
      { emit: jest.fn() } as any // eventEmitter
    );
  });

  it('instantiates', () => {
    expect(service).toBeDefined();
  });
});
