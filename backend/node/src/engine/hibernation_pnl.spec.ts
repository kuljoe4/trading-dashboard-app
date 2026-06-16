import { TradingSessionService } from './trading_session.service';
import { Trade } from '../models/Trade';

describe('Hibernation PnL Integrity', () => {
  let service: TradingSessionService;
  let sessionState: any;

  beforeEach(() => {
    sessionState = {
        balancePaper: 10000,
        balanceLive: 10000,
        closedTrades: [],
        updateStatsOnEntry: jest.fn(),
        updateStatsOnClose: jest.fn(),
        addClosedTrade: jest.fn(),
        setActiveTrades: jest.fn(),
        getBalance: jest.fn().mockReturnValue(10000),
        isEcoMode: jest.fn().mockReturnValue(false),
        isGated: jest.fn().mockReturnValue(false),
        minimize: jest.fn(),
        stats: { totalPnl: 0 }
    };

    service = new TradingSessionService(
      { clear: jest.fn() } as any, // tickerCache
      { clear: jest.fn() } as any, // klineStore
      {} as any, // signalEngine
      { canEnter: () => ({ canEnter: true }) } as any, // riskEngine
      { activeList: () => [], activeCount: () => 0, totalRisk: () => 0, recalculateTotalRisk: jest.fn(), removeTrade: jest.fn() } as any, // positionTracker
      { getTakerFeeRate: () => 0.0004 } as any, // orderManager
      {} as any, // marketFeed
      { start: jest.fn(), stop: jest.fn() } as any, // momentumScanner
      { recordHotLoop: jest.fn(), recordMainLoop: jest.fn(), clearAppMetrics: jest.fn() } as any, // monitoringService
      {} as any, // analyticsService
      {} as any, // executionService
      { start: jest.fn(), stop: jest.fn() } as any, // sessionLifecycle
      { setWsBroadcaster: jest.fn(), broadcast: jest.fn() } as any, // broadcastService
      sessionState,
      {} as any, // variantAnalytics
      { serializeTrade: jest.fn(), minimize: jest.fn(), getLastTickData: jest.fn(), getLastRiskResult: jest.fn(), getLastAnalyticsResult: jest.fn() } as any, // engineBroadcaster
      { mapGateState: jest.fn(), isInsideTradingWindow: jest.fn().mockReturnValue(true), enterHibernation: jest.fn(), exitHibernation: jest.fn() } as any, // gatingService
      { checkFundingFees: jest.fn(), protectionWatchdog: jest.fn() } as any, // maintenanceService
      { log: jest.fn() } as any, // auditLog
      { emit: jest.fn() } as any // eventEmitter
    );
  });

  it('should preserve appliedPnL through minimizeMemoryUsage', async () => {
    // 1. Setup a trade with applied PnL (e.g. entry fee)
    const tradeId = 'test-trade-1';
    const entryFee = -0.4;

    // We need to access the private appliedPnL for testing
    const appliedPnL = (service as any).appliedPnL;
    appliedPnL.set(tradeId, entryFee);

    // 2. Trigger minimization (simulating hibernation)
    service.minimizeMemoryUsage();

    // 3. Verify appliedPnL is preserved
    expect(appliedPnL.get(tradeId)).toBe(entryFee);
  });

  it('should clear appliedPnL only on session stop', async () => {
     const tradeId = 'test-trade-1';
     const appliedPnL = (service as any).appliedPnL;
     appliedPnL.set(tradeId, -0.4);

     // @ts-ignore
     service.config = { paper_mode: true };
     // @ts-ignore
     service.running = true;

     await service.stop();

     expect(appliedPnL.size).toBe(0);
  });
});
