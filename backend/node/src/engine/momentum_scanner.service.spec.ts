import { MomentumScannerService } from './momentum_scanner.service'

describe('MomentumScannerService', () => {
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
        getSymbolFilters: jest.fn().mockReturnValue({ filters: [] }),
        resolveInterval: jest.fn().mockImplementation((val) => val || "1m")
    }

    service = new MomentumScannerService(klineStore, tickerCache, marketFeed as any)
  })

  it('skips scanning symbols with invalid candle prices', () => {
    const invalidCandles = Array.from({ length: 20 }, (_, idx) => ({
      time: idx,
      open: 1,
      high: 1,
      low: 1,
      close: idx === 19 ? 0 : 1,
      volume: 1,
    }))

    klineStore.getRawCandles.mockReturnValueOnce(invalidCandles)

    const result = (service as any).scanSymbol('BTCUSDT', '1m', { scan_lookback: 1 })

    expect(result).toBeNull()
  })

  it('excludes active position symbols passed via excludedSymbols', () => {
    const validCandles = Array.from({ length: 20 }, (_, idx) => ({
      time: idx,
      open: 50,
      high: 60,
      low: 40,
      close: idx === 19 ? 60 : 50,
      volume: 1,
    }))
    klineStore.getRawCandles.mockReturnValue(validCandles)
    tickerCache.getTicker.mockReturnValue({ price: 60, volume_24h: 1000 })
    tickerCache.topByVolume.mockReturnValue([{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }])

    const config: any = { global_scanner_enabled: true, watchlist_size: 5 }
    const results = service.scan(config, ['BTCUSDT'])

    expect(results.some(opp => opp.symbol === 'BTCUSDT')).toBe(false)
    expect(results.some(opp => opp.symbol === 'ETHUSDT')).toBe(true)
  })

  it('calculates momentum from valid candles', () => {
    const validCandles = Array.from({ length: 20 }, (_, idx) => ({
      time: idx,
      open: idx === 19 ? 50 : 49,
      high: idx === 19 ? 60 : 50,
      low: idx === 19 ? 40 : 48,
      close: idx === 19 ? 60 : 50,
      volume: 1,
    }))

    klineStore.getRawCandles.mockReturnValueOnce(validCandles)
    tickerCache.getTicker.mockReturnValue({ price: 60, volume_24h: 1000 })

    klineStore.getRawCandles.mockReturnValue(validCandles)
    const result = (service as any).scanSymbol('BTCUSDT', '1m', { scan_lookback: 1 })

    expect(result).not.toBeNull()
    expect(result.opp.symbol).toBe('BTCUSDT')
    expect(result.opp.momentum).toBeCloseTo(20)
    expect(result.opp.price).toBe(60)
    expect(result.opp.volume_24h).toBe(1000)
  })

  it('keeps solo #1 gainer (watchlist_size=1, change_pct, long) active with pinned LONG direction during a counter-trend pullback candle', () => {
    // 2 candles where price pulls back slightly from 100 to 99.8 (-0.2%)
    const pullbackCandles = [
      { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 10 },
      { time: 2, open: 100, high: 100.2, low: 99.5, close: 99.8, volume: 10 },
    ]
    klineStore.getRawCandles.mockReturnValue(pullbackCandles)
    tickerCache.getTicker.mockReturnValue({ price: 99.8, volume_24h: 5000000 })

    const config: any = {
      watchlist_size: 1,
      discovery_mode: 'change_pct',
      entry_side: 'long',
      scan_lookback: 1,
      scan_pct_threshold: 0.3,
      scan_min_volume_usdt: 500000,
    }

    const result = (service as any).scanSymbol('SOLUSDT', '5m', config, false)
    expect(result).not.toBeNull()
    expect(result.opp.symbol).toBe('SOLUSDT')
    expect(result.opp.direction).toBe('LONG')
    expect(result.opp.momentum).toBeCloseTo(-0.2)
  })

  it('keeps solo #1 loser (watchlist_size=1, loss_pct, short) active with pinned SHORT direction during a bounce candle and cold-start warmup', () => {
    const bounceCandles = [
      { time: 1, open: 50, high: 50.5, low: 49.5, close: 50, volume: 10 },
      { time: 2, open: 50, high: 50.2, low: 49.9, close: 50.05, volume: 10 },
    ]
    klineStore.getRawCandles.mockReturnValue(bounceCandles)
    tickerCache.getTicker.mockReturnValue({ price: 50.05, volume_24h: 2000000 })

    const config: any = {
      watchlist_size: 1,
      discovery_mode: 'loss_pct',
      entry_side: 'short',
      scan_lookback: 1,
      scan_pct_threshold: 0,
      scan_min_volume_usdt: 500000,
    }

    const result = (service as any).scanSymbol('XRPUSDT', '5m', config, false)
    expect(result).not.toBeNull()
    expect(result.opp.symbol).toBe('XRPUSDT')
    expect(result.opp.direction).toBe('SHORT')

    // Cold-start warmup (< lookback + 1 candles) should still return the leader opportunity
    klineStore.getRawCandles.mockReturnValue([{ time: 1, open: 50, high: 50, low: 50, close: 50, volume: 10 }])
    const warmingResult = (service as any).scanSymbol('XRPUSDT', '5m', config, false)
    expect(warmingResult).not.toBeNull()
    expect(warmingResult.opp.symbol).toBe('XRPUSDT')
    expect(warmingResult.opp.direction).toBe('SHORT')
    expect(warmingResult.opp.candle_count).toBe(1)
  })

  it('still filters out sub-threshold and wrong-direction symbols for larger dynamic watchlists (watchlist_size > 1)', () => {
    const pullbackCandles = [
      { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 10 },
      { time: 2, open: 100, high: 100.2, low: 99.5, close: 99.8, volume: 10 },
    ]
    klineStore.getRawCandles.mockReturnValue(pullbackCandles)
    tickerCache.getTicker.mockReturnValue({ price: 99.8, volume_24h: 5000000 })

    const config: any = {
      watchlist_size: 50,
      discovery_mode: 'volume',
      entry_side: 'long',
      scan_lookback: 1,
      scan_pct_threshold: 0.3,
      scan_min_volume_usdt: 500000,
    }

    const result = (service as any).scanSymbol('SOLUSDT', '5m', config, false)
    expect(result).toBeNull()
  })
})

