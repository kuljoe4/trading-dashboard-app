import { MomentumScannerService } from './momentum_scanner.service'

describe('MomentumScannerService Bolt Optimization', () => {
  let service: MomentumScannerService
  let klineStore: any
  let tickerCache: any

  beforeEach(() => {
    klineStore = {
      getRecentCandles: jest.fn(),
      getRawCandles: jest.fn(),
    }

    tickerCache = {
      getTicker: jest.fn(),
      topByVolume: jest.fn().mockReturnValue([{ symbol: 'BTCUSDT' }]),
    }

    const marketFeed = {
      getSymbolFilters: jest.fn().mockReturnValue({ filters: [] })
    }

    service = new MomentumScannerService(klineStore, tickerCache, marketFeed as any)
  })

  it('skips processing if momentum is below threshold', () => {
    const candles = Array.from({ length: 20 }, (_, idx) => ({
      time: idx,
      open: 100,
      high: 101,
      low: 99,
      close: idx === 19 ? 101 : 100, // 1% momentum
      volume: 1,
    }))

    klineStore.getRawCandles.mockReturnValue(candles)

    // CalculateScore would normally be called, let's spy on it or check results
    const spy = jest.spyOn(service as any, 'calculateScore')

    // 1% momentum, 2% threshold -> should skip
    const result1 = (service as any).scanSymbol('BTCUSDT', '1m', { scan_lookback: 1, scan_pct_threshold: 2.0 })
    expect(result1).toBeNull()
    expect(spy).not.toHaveBeenCalled()

    // 1% momentum, 0.5% threshold -> should pass
    const result2 = (service as any).scanSymbol('BTCUSDT', '1m', { scan_lookback: 1, scan_pct_threshold: 0.5 })
    expect(result2).not.toBeNull()
    expect(spy).toHaveBeenCalled()
  })
})
