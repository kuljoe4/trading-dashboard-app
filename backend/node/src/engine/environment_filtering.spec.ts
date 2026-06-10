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
        null as any, // tickerCache
        null as any, // sessionState
        mockAuditLog as any,
        { emit: jest.fn() } as any,
    );
    (orderManager as any).marketFeed = marketFeed;
    const mockRest = {
      tradeApi: {
        newOrder: jest.fn().mockResolvedValue({ data: { orderId: 'mock' }, headers: {} }),
        newAlgoOrder: jest.fn().mockResolvedValue({ data: { orderId: 'mock' }, headers: {} })
      },
      accountApi: {
        userCommissionRate: jest.fn().mockResolvedValue({ data: { takerCommissionRate: '0.0004' } })
      }
    };
    orderManager.setBinanceClient({ restAPI: mockRest } as any, false); // Live mode

    const result = await orderManager.enter('sess', 'BTCUSDT', 'LONG', 50000, 1, 49000, 55000);
    expect(result.status).toBe('ORDER_REJECTED');
    expect(result.error).toContain('not tradable');

    const resultSuccess = await orderManager.enter('sess', 'TRADABLE', 'LONG', 1, 100, 0.5, 2);
    // Should NOT be ORDER_REJECTED for the filter reason (might fail for other reasons like missing client setup, but we check status)
    expect(result.status).not.toBe('SUCCESS'); // it fails later because mock client is empty, but it passed the filter check
    expect(resultSuccess.status).not.toBe('ORDER_REJECTED');
  })
})
