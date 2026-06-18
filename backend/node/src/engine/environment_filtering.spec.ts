import { MomentumScannerService } from './momentum_scanner.service'
import { OrderManagerService } from './orderManager'

describe('MomentumScannerService Environment Filtering', () => {
  let service: MomentumScannerService
  let klineStore: any
  let tickerCache: any
  let marketFeed: any

  beforeEach(() => {
    klineStore = {
      getRawCandles: jest.fn(),
    }

    tickerCache = {
      getTicker: jest.fn(),
      topByVolume: jest.fn().mockReturnValue([{ symbol: 'BTCUSDT' }, { symbol: 'TRADABLE' }]),
    }

    marketFeed = {
        getSymbolFilters: jest.fn((symbol: string) => {
            if (symbol === 'TRADABLE') return { filters: [] };
            return null;
        })
    }

    service = new MomentumScannerService(klineStore, tickerCache, marketFeed);
  })

  it('filters out symbols that are not in the current exchange info', () => {
    const validCandles = Array.from({ length: 20 }, (_, idx) => ({
      time: idx,
      open: 50,
      high: 60,
      low: 40,
      close: 60,
      volume: 1,
    }))

    klineStore.getRawCandles.mockReturnValue(validCandles)
    tickerCache.getTicker.mockImplementation((symbol: string) => ({ symbol, price: 60, volume_24h: 1000 }))

    // BTCUSDT has no filters (returns null from marketFeed.getSymbolFilters)
    const resultBtc = (service as any).scanSymbol('BTCUSDT', '1m', { scan_lookback: 1 })
    expect(resultBtc).toBeNull()

    // TRADABLE has filters
    const resultTradable = (service as any).scanSymbol('TRADABLE', '1m', { scan_lookback: 1 })
    expect(resultTradable).not.toBeNull()
    expect(resultTradable.opp.symbol).toBe('TRADABLE')
  })

  it('rejects live orders for symbols without filters in OrderManagerService', async () => {
    const mockSignalEngine = { checkEntry: jest.fn() }
    const mockAuditLog = { log: jest.fn() }
    const orderManager = new OrderManagerService(
        mockSignalEngine as any,
        marketFeed as any,
        { getTicker: jest.fn(), getPrice: jest.fn() } as any, // tickerCache
        { incrementApiRequests: jest.fn() } as any, // monitoringService
        {
          isRateLimited: () => false,
          isOrderRateLimited: () => false,
          binanceRateLimit: { used_1m: 0, limit: 2400 },
          updateRateLimit: jest.fn(),
          updateOrderRateLimits: jest.fn(),
          realTimePositions: new Map()
        } as any, // sessionState
        mockAuditLog as any,
        { emit: jest.fn() } as any,
    );
    (orderManager as any).marketFeed = marketFeed;
    const mockRest = {
      newOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ orderId: 'mock', avgPrice: '50000', executedQty: '1' }), headers: {} }),
      newAlgoOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ algoId: 'mock-sl', algoStatus: 'NEW' }), headers: {} }),
      cancelAllOpenOrders: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ code: 0 }), headers: {} }),
      userCommissionRate: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ takerCommissionRate: '0.0004' }) }),
      queryOrder: jest.fn(),
    };
    orderManager.setBinanceClient({ restAPI: mockRest } as any, false); // Live mode

    const result = await orderManager.enter('sess', 'BTCUSDT', 'LONG', 50000, 1, 49000, 55000);
    expect(result.status).toBe('ORDER_REJECTED');
    expect(result.error).toContain('not tradable');

    // Mock getTicker and newOrder to return reasonable price for slippage check
    (orderManager as any).tickerCache.getTicker = jest.fn().mockReturnValue({ price: 1, symbol: 'TRADABLE' });
    mockRest.newOrder.mockResolvedValue({ data: () => Promise.resolve({ orderId: 'mock', avgPrice: '1', executedQty: '100' }), headers: {} });
    mockRest.newAlgoOrder.mockResolvedValue({ data: () => Promise.resolve({ algoId: 'mock-sl', algoStatus: 'NEW' }), headers: {} });
    const resultSuccess = await orderManager.enter('sess', 'TRADABLE', 'LONG', 1, 100, 0.5, 2);
    // Should be SUCCESS now that we mocked changeInitialLeverage and newOrder correctly
    expect(resultSuccess.status).toBe('SUCCESS');
  })
})
