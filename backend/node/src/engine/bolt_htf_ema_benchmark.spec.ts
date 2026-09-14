import { MomentumScannerService } from './momentum_scanner.service';
import { Candle } from './kline_store.service';

function computeEmaArrayOriginal(candles: Candle[], period: number): number[] {
  const len = candles.length;
  const ema = new Array<number>(len);
  if (len < period) return ema;

  let k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
    ema[i] = candles[i].close;
  }
  ema[period - 1] = sum / period;

  for (let i = period; i < len; i++) {
    ema[i] = (candles[i].close - ema[i - 1]) * k + ema[i - 1];
  }

  return ema;
}

function computeDualEmaArraysOriginal(candles: Candle[], fastPeriod: number, slowPeriod: number) {
  const fastEma = computeEmaArrayOriginal(candles, fastPeriod);
  const slowEma = computeEmaArrayOriginal(candles, slowPeriod);
  return { fastEma, slowEma };
}

describe('HTF EMA Dual Calculation Optimization & Benchmark', () => {
  const mockKlineStore: any = {};
  const mockTickerCache: any = {};
  const mockMarketFeed: any = {};
  const scanner = new MomentumScannerService(mockKlineStore, mockTickerCache, mockMarketFeed);

  const candles: Candle[] = Array.from({ length: 500 }, (_, i) => ({
    time: 100000 + i * 14400000,
    open: 100 + (i % 10),
    high: 105 + (i % 10),
    low: 95 + (i % 10),
    close: 100 + Math.sin(i * 0.1) * 10 + (i * 0.05),
    volume: 1000 + i * 10,
  }));

  it('produces identical output arrays across all elements for fast and slow EMAs in MomentumScannerService', () => {
    const orig = computeDualEmaArraysOriginal(candles, 9, 21);
    const opt = (scanner as any).computeDualEmaArrays(candles, 9, 21);

    expect(opt.fastEma.length).toBe(orig.fastEma.length);
    expect(opt.slowEma.length).toBe(orig.slowEma.length);

    // Check all array elements starting from index 0
    for (let i = 0; i < candles.length; i++) {
      expect(opt.fastEma[i]).toBeCloseTo(orig.fastEma[i], 10);
      expect(opt.slowEma[i]).toBeCloseTo(orig.slowEma[i], 10);
    }
  });

  it('benchmark: measures speedup of single-pass dual EMA calculation', () => {
    const iterations = 100000;

    const startOriginal = performance.now();
    for (let i = 0; i < iterations; i++) {
      computeDualEmaArraysOriginal(candles, 9, 21);
    }
    const timeOriginal = performance.now() - startOriginal;

    const startOptimized = performance.now();
    for (let i = 0; i < iterations; i++) {
      (scanner as any).computeDualEmaArrays(candles, 9, 21);
    }
    const timeOptimized = performance.now() - startOptimized;

    const speedup = (timeOriginal / timeOptimized).toFixed(2);
    console.log(`\n⚡ Bolt Performance Benchmark (computeDualEmaArrays, ${iterations} iterations):`);
    console.log(`  - Original (2 separate passes + array allocations): ${timeOriginal.toFixed(2)} ms`);
    console.log(`  - Optimized (Single-pass loop fusion):              ${timeOptimized.toFixed(2)} ms`);
    console.log(`  - Execution Speedup:                                ${speedup}x faster\n`);

    expect(timeOptimized).toBeLessThan(timeOriginal);
  });
});
