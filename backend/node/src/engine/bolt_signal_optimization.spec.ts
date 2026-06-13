import { SignalEngineService } from './signalEngine';
import { KlineStoreService } from './kline_store.service';
import { SessionConfig } from '../models/SessionConfig';

describe('SignalEngineService Optimization Benchmark', () => {
  let signalEngine: SignalEngineService;
  let klineStore: KlineStoreService;

  beforeEach(() => {
    klineStore = new KlineStoreService();
    signalEngine = new SignalEngineService(klineStore);
  });

  it('benchmark: getRequiredWarmup caching', () => {
    const config: SessionConfig = {
      enabled_signals: ['momentum_pct', 'ema_dual_cross', 'ema_close'],
      signal_params: {
        entry_ema_fast: '9',
        entry_ema_slow: '21',
        ema_period: '50'
      }
    } as any;

    const iterations = 100000;

    // First call (uncached) then many cached calls
    const start1 = performance.now();
    for (let i = 0; i < iterations; i++) {
      signalEngine.getRequiredWarmup(config);
    }
    const end1 = performance.now();
    console.log(`[BENCHMARK] getRequiredWarmup 100k calls (mostly cached): ${(end1 - start1).toFixed(2)}ms`);

    // Compare with a new config every time (always uncached)
    // We do fewer iterations because it's much slower
    const uncachedIterations = 10000;
    const start2 = performance.now();
    for (let i = 0; i < uncachedIterations; i++) {
        const newConfig = {
            enabled_signals: ['momentum_pct', 'ema_dual_cross', 'ema_close'],
            signal_params: {
              entry_ema_fast: '9',
              entry_ema_slow: '21',
              ema_period: '50'
            }
        } as any;
        signalEngine.getRequiredWarmup(newConfig);
    }
    const end2 = performance.now();
    const timePerCached = (end1 - start1) / iterations;
    const timePerUncached = (end2 - start2) / uncachedIterations;

    console.log(`[BENCHMARK] getRequiredWarmup cached: ${timePerCached.toFixed(6)}ms/call`);
    console.log(`[BENCHMARK] getRequiredWarmup uncached: ${timePerUncached.toFixed(6)}ms/call`);
    expect(timePerCached).toBeLessThan(timePerUncached);
  });

  it('benchmark: EMA caching', () => {
    const symbol = 'BTCUSDT';
    const interval = '1m';
    const period = 50;
    const candles = [];
    const now = Date.now();
    for (let i = 0; i < 200; i++) {
      candles.push({ time: now - (200 - i) * 60000, open: 100, high: 105, low: 95, close: 102 + Math.random(), volume: 1000 });
    }

    // Mock klineStore.getRawCandles
    jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles as any);

    const config: SessionConfig = {
        enabled_signals: ['ema'],
        signal_params: { entry_ema_period: period.toString() }
    } as any;

    const iterations = 5000;

    // 1. Measure with cache
    const start1 = performance.now();
    for (let i = 0; i < iterations; i++) {
        signalEngine.checkEntry(symbol, config, interval, 'LONG');
    }
    const end1 = performance.now();
    const timeCached = end1 - start1;
    console.log(`[BENCHMARK] checkEntry 5k calls (cached EMA): ${timeCached.toFixed(2)}ms`);

    // 2. Measure without cache by modifying the close price on each call
    const start2 = performance.now();
    for (let i = 0; i < iterations; i++) {
        candles[candles.length - 1].close = 100 + i; // Invalidate cache
        signalEngine.checkEntry(symbol, config, interval, 'LONG');
    }
    const end2 = performance.now();
    const timeUncached = end2 - start2;
    console.log(`[BENCHMARK] checkEntry 5k calls (uncached EMA): ${timeUncached.toFixed(2)}ms`);

    expect(timeCached).toBeLessThan(timeUncached);
    console.log(`[BENCHMARK] EMA Caching Speedup: ${(timeUncached / timeCached).toFixed(2)}x`);
  });

  it('correctness: EMA cache yields same results', () => {
    const symbol = 'BTCUSDT';
    const interval = '1m';
    const period = 20;
    const candles = [];
    const now = Date.now();
    for (let i = 0; i < 100; i++) {
      candles.push({ time: now - (100 - i) * 60000, open: 100, high: 105, low: 95, close: 100 + i, volume: 1000 });
    }
    jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles as any);

    const config: SessionConfig = {
        enabled_signals: ['ema'],
        signal_params: { entry_ema_period: period.toString() }
    } as any;

    const res1 = signalEngine.checkEntry(symbol, config, interval, 'LONG');
    const res2 = signalEngine.checkEntry(symbol, config, interval, 'LONG');

    expect(res1).toEqual(res2);
    expect(res1.details?.ema.value).toBeGreaterThan(0);
  });

  it('correctness: EMA cache handles timeframe separation', () => {
    const symbol = 'BTCUSDT';
    const period = 20;
    const now = Date.now();

    // Create identical candle arrays with enough for warmup (period * 2 = 40)
    const candles1 = [];
    for (let i = 0; i < 50; i++) {
        candles1.push({ time: now - (50 - i) * 60000, open: 100, high: 105, low: 95, close: 100 + i, volume: 1000 });
    }
    const candles2 = JSON.parse(JSON.stringify(candles1));

    const config: SessionConfig = {
        enabled_signals: ['ema'],
        signal_params: { entry_ema_period: period.toString() }
    } as any;

    // 1m interval
    jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles1 as any);
    const res1m = signalEngine.checkEntry(symbol, config, '1m', 'LONG');

    // 5m interval - even if candles are identical, cache should not collide
    // We'll manually inject a different value for 5m to see if it's actually recomputed or correctly separated
    // Since it's O(N) calculation, if we change the input slightly, the output must change.
    candles2[0].close = 105;
    jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles2 as any);
    const res5m = signalEngine.checkEntry(symbol, config, '5m', 'LONG');

    expect(res1m.details?.ema.threshold).not.toEqual(res5m.details?.ema.threshold);
  });
});
