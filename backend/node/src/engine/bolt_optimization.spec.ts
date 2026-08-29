import { MomentumScannerService } from './momentum_scanner.service'
import { ENGINE_CONSTANTS } from '../models/constants'

describe('MomentumScannerService Unified Loop Optimization', () => {
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
      topByVolume: jest.fn(),
    }

    marketFeed = {
      getSymbolFilters: jest.fn().mockReturnValue({ filters: [] })
    }

    service = new MomentumScannerService(klineStore, tickerCache, marketFeed)
  })

  it('deduplicates symbols between global and single monitor', () => {
    const config = {
      global_scanner_enabled: true,
      watchlist_size: 5,
      symbols: ['BTCUSDT', 'ETHUSDT'],
      single_symbol_configs: [
        { symbol: 'BTCUSDT', enabled: true, use_custom_config: true, custom_config: { scan_pct_threshold: 0.1 } }
      ]
    }

    const candles = Array.from({ length: 20 }, (_, idx) => ({
      time: idx,
      open: 100,
      high: 101,
      low: 99,
      close: idx === 19 ? 102 : 100, // 2% momentum
      volume: 1,
    }))

    klineStore.getRawCandles.mockReturnValue(candles)
    tickerCache.getTicker.mockImplementation((s: string) => ({ symbol: s, price: 102, volume_24h: 1000 }))

    const spy = jest.spyOn(service as any, 'scanSymbol')

    const results = service.scan(config as any)

    // BTCUSDT and ETHUSDT should be scanned exactly once each
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenCalledWith('BTCUSDT', '1m', expect.any(Object))
    expect(spy).toHaveBeenCalledWith('ETHUSDT', '1m', expect.any(Object))

    // Results should contain both
    expect(results).toHaveLength(2)
    const symbols = results.map(r => r.symbol).sort()
    expect(symbols).toEqual(['BTCUSDT', 'ETHUSDT'])
  })

  it('preserves volume_rank for overlapping symbols', () => {
    const config = {
      global_scanner_enabled: true,
      watchlist_size: 10,
      symbols: [], // Use topByVolume
      single_symbol_configs: [
        { symbol: 'ETHUSDT', enabled: true } // Overlap with volume list
      ]
    }

    tickerCache.topByVolume.mockReturnValue([
      { symbol: 'BTCUSDT', volume_24h: 10000 },
      { symbol: 'ETHUSDT', volume_24h: 5000 },
    ])

    const candles = Array.from({ length: 20 }, (_, idx) => ({
      time: idx,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    }))

    // Ensure momentum is enough to pass 0 threshold
    candles[19].close = 105;

    klineStore.getRawCandles.mockReturnValue(candles)
    tickerCache.getTicker.mockImplementation((s: string) => ({ symbol: s, price: 105, volume_24h: 1000 }))

    const results = service.scan(config as any)

    const eth = results.find(r => r.symbol === 'ETHUSDT')
    expect(eth).toBeDefined()
    expect(eth?.volume_rank).toBe(2) // Correctly preserved from topByVolume list
  })

  it('correctly slices to MAX_RESULTS and attaches history', () => {
    const config = {
      global_scanner_enabled: true,
      symbols: Array.from({ length: 20 }, (_, i) => `SYM${i}USDT`),
    }

    const candles = Array.from({ length: 30 }, (_, idx) => ({
      time: idx,
      open: 100,
      high: 101,
      low: 99,
      close: 100 + idx,
      volume: 1,
    }))

    klineStore.getRawCandles.mockReturnValue(candles)
    tickerCache.getTicker.mockImplementation((s: string) => ({ symbol: s, price: 130, volume_24h: 1000 }))

    const results = service.scan(config as any)

    expect(results.length).toBeLessThanOrEqual(ENGINE_CONSTANTS.SCANNER_MAX_RESULTS)
    expect(results[0].history).toHaveLength(ENGINE_CONSTANTS.SPARKLINE_HISTORY_LEN)
    expect(results[0].history![results[0].history!.length - 1]).toBe(129) // Last close
  })
})
