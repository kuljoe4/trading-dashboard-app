import { TradingSessionService } from './trading_session.service';
describe('TradingSession Mock', () => {
    let service;
    beforeEach(() => {
        service = new TradingSessionService({}, // tickerCache
        {}, // klineStore
        {}, // signalEngine
        {}, // riskEngine
        { activeList: () => [], activeCount: () => 0, totalRisk: () => 0, recalculateTotalRisk: jest.fn(), clear: jest.fn() }, // positionTracker
        {}, // orderManager
        {}, // marketFeed
        {}, // momentumScanner
        { recordHotLoop: jest.fn(), recordMainLoop: jest.fn() }, // monitoringService
        {}, // analyticsService
        {}, // executionService
        {}, // sessionLifecycle
        { setWsBroadcaster: jest.fn(), broadcast: jest.fn() }, // broadcastService
        { reset: jest.fn(), getBalance: () => 10000, closedTrades: [] }, // sessionState
        {}, // variantAnalytics
        { serializeTrade: jest.fn(), minimize: jest.fn(), getLastTickData: jest.fn(), getLastRiskResult: jest.fn(), getLastAnalyticsResult: jest.fn() }, // engineBroadcaster
        { mapGateState: jest.fn(), isInsideTradingWindow: jest.fn().mockReturnValue(true) }, // gatingService
        {}, // maintenanceService
        { log: jest.fn() }, // auditLog
        { emit: jest.fn() } // eventEmitter
        );
    });
    it('instantiates', () => {
        expect(service).toBeDefined();
    });
});
