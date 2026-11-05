import { OrderFilterService } from './order-filter.service';
import { OrderManagerService } from './orderManager';
describe('SL Ratchet Race Conditions & Protection Gaps', () => {
    let orderManager;
    let mockSignalEngine;
    let mockMarketFeed;
    let mockTickerCache;
    let mockSessionState;
    let mockAuditLog;
    let mockEventEmitter;
    let mockBinanceClient;
    beforeEach(() => {
        mockSignalEngine = {};
        mockMarketFeed = {
            getSymbolFilters: jest.fn().mockReturnValue({
                filters: [
                    { filterType: 'PRICE_FILTER', tickSize: '0.01' },
                    { filterType: 'LOT_SIZE', stepSize: '0.001' }
                ]
            })
        };
        mockTickerCache = {
            getTicker: jest.fn(),
            getPrice: jest.fn().mockReturnValue(100)
        };
        mockSessionState = {
            isRateLimited: jest.fn().mockReturnValue(false),
            isBanned: jest.fn().mockReturnValue(false),
            isOrderRateLimited: jest.fn().mockReturnValue(false),
            hasOrderCapacity: jest.fn().mockReturnValue(true),
            config: { trailing_guard_buffer_pct: 0.1 },
            realTimeOrders: new Map(),
            realTimePositions: new Map(),
            activeTrades: []
        };
        mockAuditLog = { log: jest.fn() };
        mockEventEmitter = { emit: jest.fn() };
        orderManager = new OrderManagerService(mockSignalEngine, mockMarketFeed, mockTickerCache, { incrementApiRequests: jest.fn() }, {
            getInFlightEntry: jest.fn(),
            setInFlight: jest.fn(),
            clearInFlight: jest.fn(),
            isRatcheting: jest.fn(),
            onRatchetComplete: jest.fn().mockResolvedValue(undefined),
            markDirty: jest.fn(),
            recordRatchetDeferral: jest.fn()
        }, mockSessionState, { broadcast: jest.fn() }, // broadcastService
        mockAuditLog, mockEventEmitter, { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) }, new OrderFilterService(mockMarketFeed, mockTickerCache, { broadcast: jest.fn() }));
        mockBinanceClient = {
            restAPI: {
                cancelOrder: jest.fn().mockResolvedValue({
                    data: () => Promise.resolve({ status: 'CANCELED' }),
                    headers: { get: () => '0' }
                }),
                newAlgoOrder: jest.fn().mockResolvedValue({
                    data: () => Promise.resolve({ algoId: 'new-sl-123', status: 'NEW' }),
                    headers: { get: () => '0' }
                }),
                queryOrder: jest.fn().mockRejectedValue(new Error('Not found')),
                cancelAllOpenOrders: jest.fn().mockResolvedValue({
                    data: () => Promise.resolve({}),
                    headers: { get: () => '0' }
                }),
                cancelAlgoOrder: jest.fn().mockResolvedValue({
                    data: () => Promise.resolve({ status: 'CANCELED' }),
                    headers: { get: () => '0' }
                })
            }
        };
        orderManager.setBinanceClient(mockBinanceClient, false);
    });
    it('should restore previous SL if replacement fails (Rollback Protection)', async () => {
        const trade = {
            id: 'trade-1',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            qty: 1,
            entry_price: 100,
            current_sl: 90,
            binance_stop_order_id: '12345',
            binance_order_id: 'entry-id'
        };
        // 1. Mock cancellation of the old SL
        mockBinanceClient.restAPI.cancelOrder.mockResolvedValueOnce({
            data: () => Promise.resolve({ status: 'CANCELED' }),
            headers: { get: () => '0' }
        });
        // 2. Simulate failure on new SL placement
        mockBinanceClient.restAPI.newAlgoOrder.mockRejectedValueOnce(new Error('PERCENT_PRICE rejection'));
        // 3. Mock the rollback placement of the OLD SL
        mockBinanceClient.restAPI.newAlgoOrder.mockResolvedValueOnce({
            data: () => Promise.resolve({ algoId: 'rollback-sl-id', status: 'NEW' }),
            headers: { get: () => '0' }
        });
        const result = await orderManager.updateStopLoss(trade, 95);
        expect(result.success).toBe(false);
        // Trade should now have the rollback SL ID
        expect(trade.binance_stop_order_id).toBe('rollback-sl-id');
        // Ensure placement was called for 95 (fail) and then rollback placement for 90
        expect(mockBinanceClient.restAPI.newAlgoOrder).toHaveBeenCalledTimes(2);
        expect(mockBinanceClient.restAPI.cancelOrder).toHaveBeenCalled();
    });
    it('should block concurrent ratchets for the same symbol (Mutex Guard)', async () => {
        const trade = {
            id: 'trade-1',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            qty: 1,
            entry_price: 100,
            current_sl: 90,
            binance_stop_order_id: '12345',
            binance_order_id: 'entry-id'
        };
        // Simulate slow cancellation
        let cancelCalls = 0;
        mockBinanceClient.restAPI.cancelOrder.mockImplementation(async () => {
            cancelCalls++;
            await new Promise(resolve => setTimeout(resolve, 100));
            return {
                data: () => Promise.resolve({ status: 'CANCELED' }),
                headers: { get: () => '0' }
            };
        });
        // Fire two updates rapidly
        const p1 = orderManager.updateStopLoss(trade, 91);
        const p2 = orderManager.updateStopLoss(trade, 92);
        const results = await Promise.all([p1, p2]);
        // One should succeed (or proceed), one should be blocked by mutex
        expect(cancelCalls).toBe(1);
        expect(results.some(r => r.success === false)).toBe(true);
    });
});
