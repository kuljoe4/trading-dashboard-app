import { MomentumScannerService } from './momentum_scanner.service'

describe('MomentumScannerService', () => {
  let service: MomentumScannerService
  let klineStore: any
  let tickerCache: any

  beforeEach(() => {
    klineStore = {
      getRecentCandles: jest.fn(),
    }

    tickerCache = {
      getTicker: jest.fn(),
      topByVolume: jest.fn().mockResolvedValue([{ symbol: 'BTCUSDT' }]),
    }

    service = new MomentumScannerService(klineStore, tickerCache)
  })

  it('skips scanning symbols with invalid candle prices', async () => {
    const invalidCandles = Array.from({ length: 20 }, (_, idx) => ({
      time: idx,
      open: 1,
      high: 1,
      low: 1,
      close: idx === 19 ? 0 : 1,
      volume: 1,
    }))

    klineStore.getRecentCandles.mockResolvedValueOnce(invalidCandles)

    const result = await (service as any).scanSymbol('BTCUSDT', '1m', { scan_lookback: 1 })

    expect(result).toBeNull()
  })

  it('calculates momentum from valid candles', async () => {
    const validCandles = Array.from({ length: 20 }, (_, idx) => ({
      time: idx,
      open: idx === 19 ? 50 : 49,
      high: idx === 19 ? 60 : 50,
      low: idx === 19 ? 40 : 48,
      close: idx === 19 ? 60 : 50,
      volume: 1,
    }))

    klineStore.getRecentCandles.mockResolvedValueOnce(validCandles)
    tickerCache.getTicker.mockResolvedValue({ price: 60, volume_24h: 1000 })

    const result = await (service as any).scanSymbol('BTCUSDT', '1m', { scan_lookback: 1 })

    expect(result).not.toBeNull()
    expect(result.opp.symbol).toBe('BTCUSDT')
    expect(result.opp.momentum).toBeCloseTo(20)
    expect(result.opp.price).toBe(60)
    expect(result.opp.volume_24h).toBe(1000)
  })
})
