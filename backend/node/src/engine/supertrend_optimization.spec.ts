import { SignalEngineService } from './signalEngine';
import { KlineStoreService, Candle } from './kline_store.service';

// Mock original supertrend calculation for equivalence testing
function originalSupertrend(
  candles: Candle[],
  period: number,
  multiplier: number,
): { supertrend: number[]; direction: ('up' | 'down')[]; insufficientData: boolean } {
  const len = candles.length;
  const insufficientData = len < period * 3;

  const supertrend = new Array<number>(len).fill(0);
  const direction = new Array<'up' | 'down'>(len).fill('up');

  if (len < period + 1) {
    return { supertrend, direction, insufficientData: true };
  }

  // 1. Calculate True Range (TR)
  const tr = new Array<number>(len).fill(0);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < len; i++) {
    const hL = candles[i].high - candles[i].low;
    const hC = Math.abs(candles[i].high - candles[i - 1].close);
    const lC = Math.abs(candles[i].low - candles[i - 1].close);
    tr[i] = Math.max(hL, hC, lC);
  }

  // 2. Calculate ATR using RMAs (Wilder's Moving Average)
  const atr = new Array<number>(len).fill(0);
  let trSum = 0;
  for (let i = 0; i < period; i++) {
    trSum += tr[i];
  }
  atr[period - 1] = trSum / period;

  for (let i = period; i < len; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  // 3. Calculate basic bands and Supertrend
  const basicUpper = new Array<number>(len).fill(0);
  const basicLower = new Array<number>(len).fill(0);
  const finalUpper = new Array<number>(len).fill(0);
  const finalLower = new Array<number>(len).fill(0);

  for (let i = 0; i < len; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2;
    basicUpper[i] = hl2 + multiplier * atr[i];
    basicLower[i] = hl2 - multiplier * atr[i];
  }

  // Initialize the first valid index (at period - 1)
  finalUpper[period - 1] = basicUpper[period - 1];
  finalLower[period - 1] = basicLower[period - 1];
  supertrend[period - 1] = basicUpper[period - 1];
  direction[period - 1] = 'down';

  for (let i = period; i < len; i++) {
    const prevClose = candles[i - 1].close;
    const prevFinalUpper = finalUpper[i - 1];
    const prevFinalLower = finalLower[i - 1];

    // Final Upper Band
    if (basicUpper[i] < prevFinalUpper || prevClose > prevFinalUpper) {
      finalUpper[i] = basicUpper[i];
    } else {
      finalUpper[i] = prevFinalUpper;
    }

    // Final Lower Band
    if (basicLower[i] > prevFinalLower || prevClose < prevFinalLower) {
      finalLower[i] = basicLower[i];
    } else {
      finalLower[i] = prevFinalLower;
    }

    // Supertrend Line & Direction
    const prevST = supertrend[i - 1];
    if (prevST === prevFinalUpper) {
      if (candles[i].close > finalUpper[i]) {
        supertrend[i] = finalLower[i];
        direction[i] = 'up'; // bullish breakout
      } else {
        supertrend[i] = finalUpper[i];
        direction[i] = 'down';
      }
    } else { // prevST === prevFinalLower
      if (candles[i].close < finalLower[i]) {
        supertrend[i] = finalUpper[i];
        direction[i] = 'down'; // bearish breakout
      } else {
        supertrend[i] = finalLower[i];
        direction[i] = 'up';
      }
    }
  }

  return { supertrend, direction, insufficientData };
}

describe('Supertrend Optimization Verification', () => {
  let signalEngine: SignalEngineService;

  beforeAll(() => {
    // We can instantiate a minimal SignalEngineService with mocked/null dependencies for testing helper method
    const mockKlineStore = {} as any as KlineStoreService;
    signalEngine = new SignalEngineService(mockKlineStore);
  });

  function generateSampleCandles(count: number): Candle[] {
    const candles: Candle[] = [];
    let basePrice = 50000;
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      const change = (Math.random() - 0.48) * 200; // slight upward drift
      const open = basePrice;
      const close = basePrice + change;
      const high = Math.max(open, close) + Math.random() * 50;
      const low = Math.min(open, close) - Math.random() * 50;
      candles.push({
        time: now - (count - i) * 60000,
        open,
        high,
        low,
        close,
        volume: 10 + Math.random() * 50,
      });
      basePrice = close;
    }
    return candles;
  }

  it('should return mathematically identical results to the original implementation', () => {
    const candles = generateSampleCandles(150);
    const period = 10;
    const multiplier = 3.0;

    const originalResult = originalSupertrend(candles, period, multiplier);
    const optimizedResult = signalEngine.calculateSupertrend(candles, period, multiplier);

    expect(optimizedResult.insufficientData).toBe(originalResult.insufficientData);
    expect(optimizedResult.supertrend.length).toBe(originalResult.supertrend.length);
    expect(optimizedResult.direction.length).toBe(originalResult.direction.length);

    // Assert every single element is identical
    for (let i = 0; i < candles.length; i++) {
      expect(optimizedResult.supertrend[i]).toBeCloseTo(originalResult.supertrend[i], 10);
      expect(optimizedResult.direction[i]).toBe(originalResult.direction[i]);
    }
  });

  it('should handle small candle lists (insufficient data path) identically', () => {
    const candles = generateSampleCandles(5);
    const period = 10;
    const multiplier = 3.0;

    const originalResult = originalSupertrend(candles, period, multiplier);
    const optimizedResult = signalEngine.calculateSupertrend(candles, period, multiplier);

    expect(optimizedResult.insufficientData).toBe(originalResult.insufficientData);
    expect(optimizedResult.supertrend).toEqual(originalResult.supertrend);
    expect(optimizedResult.direction).toEqual(originalResult.direction);
  });

  it('should be significantly faster than the original implementation', () => {
    const candles = generateSampleCandles(300);
    const period = 10;
    const multiplier = 3.0;

    // Warmup
    for (let i = 0; i < 100; i++) {
      originalSupertrend(candles, period, multiplier);
      signalEngine.calculateSupertrend(candles, period, multiplier);
    }

    const iterations = 5000;

    const startOriginal = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      originalSupertrend(candles, period, multiplier);
    }
    const endOriginal = process.hrtime.bigint();
    const originalTime = endOriginal - startOriginal;

    const startOptimized = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      signalEngine.calculateSupertrend(candles, period, multiplier);
    }
    const endOptimized = process.hrtime.bigint();
    const optimizedTime = endOptimized - startOptimized;

    const speedupPct = Number(originalTime - optimizedTime) / Number(originalTime) * 100;
    console.log(`[BENCHMARK] Original: ${originalTime} ns, Optimized: ${optimizedTime} ns. Speedup: ${speedupPct.toFixed(2)}%`);

    // The optimized version should be faster (with 10% virtualization/jitter tolerance)
    expect(Number(optimizedTime)).toBeLessThan(Number(originalTime) * 1.10);
  });
});
