import { OrderFilterService } from './order-filter.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { OrderManagerService } from './orderManager';
describe('MomentumScannerService Environment Filtering', () => {
    let service;
    let klineStore;
    let tickerCache;
    let marketFeed;
    beforeEach(() => {
        klineStore = {
            getRawCandles: jest.fn(),
        };
        tickerCache = {
            getTicker: jest.fn(),
            topByVolume: jest.fn().mockReturnValue([{ symbol: 'BTCUSDT' }, { symbol: 'TRADABLEUSDT' }]),
        };
        marketFeed = {
            resolveInterval: jest.fn().mockImplementation((val) => val || "1m"), getSymbolFilters: jest.fn((symbol) => {
                if (symbol === 'TRADABLEUSDT')
                    return { filters: [] };
                return null;
            })
        };
        service = new MomentumScannerService(klineStore, tickerCache, marketFeed);
    });
    it('filters out symbols that are not in the current exchange info', () => {
        const validCandles = Array.from({ length: 20 }, (_, idx) => ({
            time: idx,
            open: 50,
            high: 60,
            low: 40,
            close: 60,
            volume: 1,
        }));
        klineStore.getRawCandles.mockReturnValue(validCandles);
        tickerCache.getTicker.mockImplementation((symbol) => ({ symbol, price: 60, volume_24h: 1000 }));
        // BTCUSDT has no filters (returns null from marketFeed.getSymbolFilters)
        const resultBtc = service.scanSymbol('BTCUSDT', '1m', { scan_lookback: 1 });
        expect(resultBtc).toBeNull();
        // TRADABLEUSDT has filters
        const resultTradable = service.scanSymbol('TRADABLEUSDT', '1m', { scan_lookback: 1 });
        expect(resultTradable).not.toBeNull();
        expect(resultTradable.opp.symbol).toBe('TRADABLEUSDT');
    });
    it('rejects live orders for symbols without filters in OrderManagerService', async () => {
        const mockSignalEngine = { checkEntry: jest.fn() };
        const mockAuditLog = { log: jest.fn() };
        const orderManager = new OrderManagerService(mockSignalEngine, marketFeed, { getTicker: jest.fn(), getPrice: jest.fn() }, // tickerCache
        { incrementApiRequests: jest.fn() }, // monitoringService
        { getInFlightEntry: jest.fn(), setInFlight: jest.fn(), clearInFlight: jest.fn() }, // positionTracker
        { isRateLimited: () => false, isOrderRateLimited: () => false, isBanned: () => false, realTimePositions: new Map(), realTimeOrders: new Map(), binanceRateLimit: { used_1m: 0, limit: 2400 } }, // sessionState
        { broadcast: jest.fn() }, // broadcastService
        mockAuditLog, { emit: jest.fn() }, { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) } // settingsRepository
        , new OrderFilterService(marketFeed, { getTicker: jest.fn(), getPrice: jest.fn() }, // sessionState
        { broadcast: jest.fn() }));
        orderManager.marketFeed = marketFeed;
        const mockRest = {
            newOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ orderId: 'mock', avgPrice: '50000', executedQty: '1' }), headers: {} }),
            newAlgoOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ algoId: 'mock-sl', algoStatus: 'NEW' }), headers: {} }),
            cancelAllOpenOrders: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ code: 0 }), headers: {} }),
            userCommissionRate: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ takerCommissionRate: '0.0004' }) }),
            queryOrder: jest.fn(),
        };
        orderManager.setBinanceClient({ restAPI: mockRest }, false); // Live mode
        const result = await orderManager.enter('sess', 'BTCUSDT', 'LONG', 50000, 1, 49000, 55000);
        expect(result.status).toBe('ORDER_REJECTED');
        expect(result.error).toContain('not tradable');
        // Mock getTicker and newOrder to return reasonable price for slippage check
        orderManager.tickerCache.getTicker = jest.fn().mockReturnValue({ price: 1, symbol: 'TRADABLEUSDT' });
        mockRest.newOrder.mockResolvedValue({ data: () => Promise.resolve({ orderId: 'mock', avgPrice: '1', executedQty: '100' }), headers: {} });
        mockRest.newAlgoOrder.mockResolvedValue({ data: () => Promise.resolve({ algoId: 'mock-sl', algoStatus: 'NEW' }), headers: {} });
        const resultSuccess = await orderManager.enter('sess', 'TRADABLEUSDT', 'LONG', 1, 100, 0.5, 2);
        // Should be SUCCESS now that we mocked changeInitialLeverage and newOrder correctly
        expect(resultSuccess.status).toBe('SUCCESS');
    });
});
