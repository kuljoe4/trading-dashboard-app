import { EngineBroadcasterService } from './engine-broadcaster.service';
import { VariantAnalyticsService } from './variant-analytics.service';
import { TradingSessionService } from './trading_session.service';
describe('TradingSessionService', () => {
    let service;
    beforeEach(() => {
        const variantAnalytics = new VariantAnalyticsService();
        const positionTracker = { activeList: () => [], activeCount: () => 0, totalRisk: () => 0, recalculateTotalRisk: jest.fn(), clear: jest.fn() };
        const engineBroadcaster = new EngineBroadcasterService({}, {}, {}, {}, {}, variantAnalytics, {}, positionTracker);
        service = new TradingSessionService({}, // 1 tickerCache
        {}, // 2 klineStore
        {}, // 3 signalEngine
        {}, // 4 riskEngine
        positionTracker, // 5 positionTracker
        {}, // 6 orderManager
        {}, // 7 marketFeed
        {}, // 8 momentumScanner
        { recordHotLoop: jest.fn(), recordMainLoop: jest.fn() }, // 9 monitoringService
        {}, // 10 analyticsService
        {}, // 11 executionService
        {}, // 12 sessionLifecycle
        { setWsBroadcaster: jest.fn(), broadcast: jest.fn() }, // 13 broadcastService
        { reset: jest.fn(), getBalance: () => 10000, closedTrades: [] }, // 14 sessionState
        variantAnalytics, // 15 variantAnalytics
        engineBroadcaster, // 16 engineBroadcaster
        {}, // 17 gatingService
        {}, // 18 maintenanceService
        { log: jest.fn() }, // 19 auditLog
        { emit: jest.fn() } // 20 eventEmitter
        );
    });
    it('serializes trade with finite pnl and rr values', () => {
        const trade = {
            id: 'test-id',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            entry_price: 50000,
            initial_sl: 49000,
            qty: 0.1,
            status: 'OPEN'
        };
        const serialized = service.engineBroadcaster.serializeTrade(trade, {}, 51000);
        expect(serialized.pnl).toBe(100);
        expect(serialized.rr).toBe(1);
    });
});
