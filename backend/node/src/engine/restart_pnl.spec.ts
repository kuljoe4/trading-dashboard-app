import { TradingSessionService } from './trading_session.service';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('TradingSessionService Restart PnL Consistency', () => {
  let service: TradingSessionService;
  let sessionState: any;
  let orderManager: any;
  let sessionLifecycle: any;

  beforeEach(() => {
    sessionState = {
      reset: jest.fn(),
      getBalance: jest.fn().mockReturnValue(9999.6),
      balancePaper: 9999.6,
      setActiveTrades: jest.fn(),
      minimize: jest.fn(),
      updateStatsOnClose: jest.fn(),
      addClosedTrade: jest.fn(),
    };
    orderManager = {
      setBinanceClient: jest.fn(),
    };
    sessionLifecycle = {
      start: jest.fn(),
      stop: jest.fn(),
    };

    service = new TradingSessionService(
      { clear: jest.fn() } as any, // tickerCache
      { clear: jest.fn() } as any, // klineStore
      {} as any, // signalEngine
      {} as any, // riskEngine
      { activeList: () => [], activeCount: () => 0, setEntering: jest.fn(), removeTrade: jest.fn(), recalculateTotalRisk: jest.fn(), totalRisk: () => 0, clear: jest.fn() } as any, // positionTracker
      orderManager as any,
      { setCandleCloseCallback: jest.fn(), stop: jest.fn() } as any, // marketFeed
      { stop: jest.fn() } as any, // momentumScanner
      { recordHotLoop: jest.fn(), recordMainLoop: jest.fn(), clearAppMetrics: jest.fn() } as any, // monitoringService
      {} as any, // analyticsService
      {} as any, // executionService
      sessionLifecycle as any,
      { setWsBroadcaster: jest.fn(), broadcast: jest.fn() } as any, // broadcastService
      sessionState as any,
      {} as any, // variantAnalytics
      { minimize: jest.fn(), getLastTickData: jest.fn(), getLastRiskResult: jest.fn(), getLastAnalyticsResult: jest.fn() } as any, // engineBroadcaster
      { mapGateState: jest.fn(), isInsideTradingWindow: jest.fn().mockReturnValue(true) } as any, // gatingService
      {} as any, // maintenanceService
      { log: jest.fn() } as any, // auditLog
      { emit: jest.fn() } as any, // eventEmitter
    );
  });

  afterEach(async () => {
    await service.stop();
  });

  it('should initialize appliedPnL from open trades on start to prevent double-counting', async () => {
    const config = { paper_mode: true, hot_loop_interval_ms: 100000, main_loop_interval_ms: 100000 } as SessionConfig;
    // Trade that already has -0.4 PnL (entry fee)
    const openTrade = { id: 'trade-1', pnl: -0.4, symbol: 'BTCUSDT' } as Trade;

    // Start session with curBal=9999.6 (which already has -0.4 applied)
    await service.start(config, null, 'session-1', [], 9999.6, [openTrade]);

    // appliedPnL should be initialized
    // @ts-ignore
    expect(service.appliedPnL.get('trade-1')).toBe(-0.4);

    // Simulate an update with same PnL
    // @ts-ignore
    await service.updateBalance(openTrade);

    // Balance should remain 9999.6 (NOT 9999.6 - 0.4 = 9999.2)
    expect(sessionState.balancePaper).toBe(9999.6);

    // Simulate an update that changes PnL (exit at +50 gross)
    // Net PnL = 50 (gross) - 0.4 (entry fee) - 0.42 (exit fee) = 49.18
    const closedTrade = { ...openTrade, pnl: 49.18 };
    // @ts-ignore
    await service.updateBalance(closedTrade);

    // Delta = 49.18 - (-0.4) = 49.58
    // New Balance = 9999.6 + 49.58 = 10049.18
    // Verification: Initial 10000 + Net 49.18 = 10049.18. CORRECT.
    expect(sessionState.balancePaper).toBe(10049.18);
  });

  it('should mark trade as CLOSED_ORPHANED and not fabricate PnL or balance updates on stop if closeTrade fails', async () => {
    const config = { paper_mode: true, hot_loop_interval_ms: 100000, main_loop_interval_ms: 100000 } as SessionConfig;
    const openTrade = { id: 'trade-2', pnl: -0.4, symbol: 'BTCUSDT', direction: 'LONG', entry_price: 100.0, qty: 1 } as Trade;

    // Start session
    await service.start(config, null, 'session-2', [], 10000.0, [openTrade]);

    // Override activeList and activeCount of positionTracker mock
    const activeListMock = [openTrade];
    // @ts-ignore
    service.positionTracker.activeList = jest.fn().mockReturnValue(activeListMock);
    // @ts-ignore
    service.positionTracker.activeCount = jest.fn().mockReturnValue(1);
    // @ts-ignore
    service.positionTracker.closeTrade = jest.fn().mockResolvedValue({ exitOccurred: false });

    // Mock tickerCache to return a price
    // @ts-ignore
    service.tickerCache.getPrice = jest.fn().mockResolvedValue(105.0);

    const onTradeUpdateSpy = jest.fn();
    service.setTradeUpdateCallback(onTradeUpdateSpy);

    // Stop session
    await service.stop();

    // Verify trade was marked CLOSED_ORPHANED, has its old pnl, and removeTrade was called
    expect(openTrade.status).toBe('CLOSED_ORPHANED');
    expect(openTrade.pnl).toBe(-0.4); // unmodified PnL
    expect(openTrade.exit_reason).toBe('SESSION_TERMINATED');
    expect(openTrade.exit_price).toBe(105.0); // reference price logged

    // Verify we did NOT call updateStatsOnClose or updateBalance on failed close
    expect(sessionState.updateStatsOnClose).not.toHaveBeenCalled();
    expect(onTradeUpdateSpy).toHaveBeenCalledWith(openTrade, 9999.6);
  });
});
