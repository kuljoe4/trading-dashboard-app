import { TradingSessionService } from './trading_session.service';
describe('Hibernation PnL Integrity', () => {
    let service;
    let sessionState;
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
        service = new TradingSessionService({ clear: jest.fn() }, // tickerCache
        { clear: jest.fn() }, // klineStore
        {}, // signalEngine
        { canEnter: () => ({ canEnter: true }) }, // riskEngine
        { activeList: () => [], activeCount: () => 0, totalRisk: () => 0, recalculateTotalRisk: jest.fn(), removeTrade: jest.fn(), clear: jest.fn() }, // positionTracker
        { getTakerFeeRate: () => 0.0004 }, // orderManager
        {}, // marketFeed
        { start: jest.fn(), stop: jest.fn() }, // momentumScanner
        { recordHotLoop: jest.fn(), recordMainLoop: jest.fn(), clearAppMetrics: jest.fn() }, // monitoringService
        {}, // analyticsService
        {}, // executionService
        { start: jest.fn(), stop: jest.fn() }, // sessionLifecycle
        { setWsBroadcaster: jest.fn(), broadcast: jest.fn() }, // broadcastService
        sessionState, {}, // variantAnalytics
        { serializeTrade: jest.fn(), minimize: jest.fn(), getLastTickData: jest.fn(), getLastRiskResult: jest.fn(), getLastAnalyticsResult: jest.fn() }, // engineBroadcaster
        { mapGateState: jest.fn(), isInsideTradingWindow: jest.fn().mockReturnValue(true), enterHibernation: jest.fn(), exitHibernation: jest.fn() }, // gatingService
        { checkFundingFees: jest.fn(), protectionWatchdog: jest.fn() }, // maintenanceService
        { log: jest.fn() }, // auditLog
        { emit: jest.fn() } // eventEmitter
        );
    });
    it('should preserve appliedPnL through minimizeMemoryUsage', async () => {
        // 1. Setup a trade with applied PnL (e.g. entry fee)
        const tradeId = 'test-trade-1';
        const entryFee = -0.4;
        // We need to access the private appliedPnL for testing
        const appliedPnL = service.appliedPnL;
        appliedPnL.set(tradeId, entryFee);
        // 2. Trigger minimization (simulating hibernation)
        service.minimizeMemoryUsage();
        // 3. Verify appliedPnL is preserved
        expect(appliedPnL.get(tradeId)).toBe(entryFee);
    });
    it('should clear appliedPnL only on session stop', async () => {
        const tradeId = 'test-trade-1';
        const appliedPnL = service.appliedPnL;
        appliedPnL.set(tradeId, -0.4);
        // @ts-ignore
        service.config = { paper_mode: true };
        // @ts-ignore
        service.running = true;
        await service.stop();
        expect(appliedPnL.size).toBe(0);
    });
});
