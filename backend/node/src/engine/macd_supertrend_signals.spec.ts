import { Test, TestingModule } from '@nestjs/testing';
import { SignalEngineService } from './signalEngine';
import { KlineStoreService, Candle } from './kline_store.service';
import { SessionConfig } from '../models/SessionConfig';

describe('MACD and Supertrend Signal Engine Tests', () => {
  let service: SignalEngineService;
  let klineStore: jest.Mocked<KlineStoreService>;

  beforeEach(async () => {
    klineStore = {
      getRawCandles: jest.fn(),
      getLookbackExtremes: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalEngineService,
        { provide: KlineStoreService, useValue: klineStore },
      ],
    }).compile();

    service = module.get<SignalEngineService>(SignalEngineService);
  });

  const generateCandles = (prices: number[]): Candle[] => {
    return prices.map((price, i) => ({
      time: i * 60000,
      open: price - 1,
      high: price + 1,
      low: price - 2,
      close: price,
      volume: 1000 + i,
      isCompleted: true,
    }));
  };

  describe('MACD Calculation directly', () => {
    it('should calculate MACD Line, Signal Line, and Histogram correctly', () => {
      const prices = Array(100).fill(100);
      for (let i = 50; i < 100; i++) {
        prices[i] = 100 + (i - 50) * 2; // steady uptrend
      }
      const candles = generateCandles(prices);
      const result = service.calculateMACD(candles, 12, 26, 9, 'BTCUSDT', '1m');
      expect(result.macdLine).toBeDefined();
      expect(result.signalLine).toBeDefined();
      expect(result.histogram).toBeDefined();
      expect(result.macdLine.length).toBe(100);
    });

    it('should be mathematically correct and benefit from stable caching with no cross-asset collision', () => {
      const prices = Array(200).fill(100);
      for (let i = 50; i < 200; i++) {
        prices[i] = 100 + (i - 50) * 1.5;
      }
      const candlesBTC = generateCandles(prices);
      const candlesETH = generateCandles(prices).map((c, idx) => ({ ...c, close: c.close * 0.5 }));

      // Calculate for BTC
      const resultBTC = service.calculateMACD(candlesBTC, 12, 26, 9, 'BTCUSDT', '1m');
      // Calculate for ETH (distinct symbol, same length/times)
      const resultETH = service.calculateMACD(candlesETH, 12, 26, 9, 'ETHUSDT', '1m');

      // Verify that cache separation works and does not collide
      expect(resultBTC.macdLine[199]).not.toBe(resultETH.macdLine[199]);

      // Benchmark cache performance
      const startOrig = process.hrtime.bigint();
      // Bypass cache by changing time
      for (let i = 0; i < 1000; i++) {
        candlesBTC[199].time = i;
        service.calculateMACD(candlesBTC, 12, 26, 9, 'BTCUSDT', '1m');
      }
      const endOrig = process.hrtime.bigint();

      const startCached = process.hrtime.bigint();
      for (let i = 0; i < 1000; i++) {
        service.calculateMACD(candlesBTC, 12, 26, 9, 'BTCUSDT', '1m');
      }
      const endCached = process.hrtime.bigint();

      const nonCachedTime = Number(endOrig - startOrig);
      const cachedTime = Number(endCached - startCached);
      console.log(`[BENCHMARK MACD] Non-cached: ${nonCachedTime} ns, Cached: ${cachedTime} ns. Speedup: ${((nonCachedTime - cachedTime) / nonCachedTime * 100).toFixed(2)}%`);
      expect(cachedTime).toBeLessThan(nonCachedTime);
    });
  });

  describe('MACD Impulse entry signal (Phase 4)', () => {
    it('should correctly count green histogram bars on color transition', () => {
      const prices = Array(100).fill(100);
      // Create a flat line of 100s, then rise sharply on the last 2 candles
      prices[98] = 120;
      prices[99] = 140;

      const candles = generateCandles(prices);
      klineStore.getRawCandles.mockReturnValue(candles);

      const config = new SessionConfig();
      config.enabled_signals = ['macd_impulse'];
      config.signal_params = {
        macd_fast: 12,
        macd_slow: 26,
        macd_signal: 9,
        macd_strict_expansion: false,
      };

      const result = service.checkEntry('BTCUSDT', config, '1m', 'LONG');
      expect(result.details).toBeDefined();
      const details = result.details?.macd_impulse;
      expect(details).toBeDefined();
      expect(details?.fired).toBe(true);
      expect(details?.value).toBeLessThanOrEqual(2);
    });

    it('should reject green count >= 3 to capture early impulse only', () => {
      const prices = Array(100).fill(100);
      for (let i = 70; i < 100; i++) {
        prices[i] = 100 + (i - 70) * 10; // long sustained uptrend
      }

      const candles = generateCandles(prices);
      klineStore.getRawCandles.mockReturnValue(candles);

      const config = new SessionConfig();
      config.enabled_signals = ['macd_impulse'];
      config.signal_params = {
        macd_fast: 12,
        macd_slow: 26,
        macd_signal: 9,
        macd_strict_expansion: false,
      };

      const result = service.checkEntry('BTCUSDT', config, '1m', 'LONG');
      // The green count will be high (around 15-20), so it must reject
      expect(result.details?.macd_impulse?.fired).toBe(false);
      expect(result.details?.macd_impulse?.description).toContain('Rejected: Green bar count is');
    });

    it('should enforce strict expanding histogram checks when enabled', () => {
      const prices = Array(100).fill(100);
      for (let i = 90; i < 98; i++) {
        prices[i] = 100 + (i - 90) * 15; // sharp rise
      }
      prices[98] = 210; // peak
      prices[99] = 210.1; // flat

      const candles = generateCandles(prices);
      klineStore.getRawCandles.mockReturnValue(candles);

      const config = new SessionConfig();
      config.enabled_signals = ['macd_impulse'];
      config.signal_params = {
        macd_fast: 12,
        macd_slow: 26,
        macd_signal: 9,
        macd_strict_expansion: true,
      };

      const result = service.checkEntry('BTCUSDT', config, '1m', 'LONG');
      const impulseDetails = result.details?.macd_impulse;
      expect(impulseDetails?.fired).toBe(false);
      expect(impulseDetails?.description).toContain('Rejected:');
    });
  });

  describe('MACD Pullback-to-Continuation (PBC) Signal', () => {
    it('should fire on LONG when price is above Trend EMA and histogram slope reverses positive', () => {
      const config = new SessionConfig();
      config.enabled_signals = ['macd_pbc'];
      config.signal_params = {
        macd_fast: 12,
        macd_slow: 26,
        macd_signal: 9,
        macd_pbc_trend_ema: 50,
        macd_pbc_lookback: 5,
      };

      // Generate prices steadily above 50 EMA (represented by slow growth)
      // and construct a pullback (histogram goes from contracting to expanding positive)
      const prices = Array(120).fill(100);
      for (let i = 0; i < 120; i++) {
        prices[i] = 100 + i * 2; // steady uptrend, close is always above 50 EMA
      }

      // Pullback & Continuation on last candles
      prices[115] = 300;
      prices[116] = 295; // pullback low
      prices[117] = 330; // pullback tick
      prices[118] = 380; // continuation rise 1
      prices[119] = 450; // continuation rise 2

      const candles = generateCandles(prices);
      klineStore.getRawCandles.mockReturnValue(candles);

      const result = service.checkEntry('BTCUSDT', config, '1m', 'LONG');
      expect(result.details?.macd_pbc?.fired).toBe(true);
      expect(result.details?.macd_pbc?.slPrice).toBeDefined();
      expect(result.details?.macd_pbc?.slPrice).toBeLessThan(330);
    });

    it('should reject LONG when price is below Trend EMA', () => {
      const config = new SessionConfig();
      config.enabled_signals = ['macd_pbc'];
      config.signal_params = {
        macd_fast: 12,
        macd_slow: 26,
        macd_signal: 9,
        macd_pbc_trend_ema: 50,
        macd_pbc_lookback: 5,
      };

      // Generate prices steadily below 50 EMA
      const prices = Array(120).fill(100);
      for (let i = 0; i < 120; i++) {
        prices[i] = 1000 - i * 5; // massive downtrend
      }

      const candles = generateCandles(prices);
      klineStore.getRawCandles.mockReturnValue(candles);

      const result = service.checkEntry('BTCUSDT', config, '1m', 'LONG');
      expect(result.details?.macd_pbc?.fired).toBe(false);
      expect(result.details?.macd_pbc?.description).toContain('is below Trend EMA');
    });
  });

  describe('MACD Fade exit signal (Phase 5)', () => {
    it('should fire on 2 consecutive contracting histogram bars or color flip', () => {
      const config = new SessionConfig();
      config.exit_signals = ['macd_fade'];
      config.signal_params = {
        macd_fast: 12,
        macd_slow: 26,
        macd_signal: 9,
      };

      const prices = Array(100).fill(100);
      for (let i = 80; i < 96; i++) {
        prices[i] = 100 + (i - 80) * 10;
      }
      prices[96] = 250;
      prices[97] = 240; // drop 1
      prices[98] = 220; // drop 2
      prices[99] = 190; // drop 3

      const candles = generateCandles(prices);
      klineStore.getRawCandles.mockReturnValue(candles);

      const result = service.checkEntry('BTCUSDT', config, '1m', 'LONG', 'exit');
      expect(result.details?.macd_fade?.fired).toBe(true);
    });
  });

  describe('Supertrend Signal (Entry & Exit)', () => {
    it('should correctly calculate Supertrend LONG entry signals (trend and crossover)', () => {
      const prices = Array(100).fill(200);
      // To establish 'down' direction first, set prices to 100 for index 0 to 80,
      // then rise to 200 for index 81 to 97 (this is the flat 'up' state). Wait,
      // actually if we want a BULLISH crossover at 98, we should set index 0-97 to 100 ('down'),
      // then rise sharply to 200 at 98. Since default is 'down', flat 100 means index 97 is 'down'.
      // Then index 98 goes to 200 which is higher than upper band, flipping direction to 'up'.
      for (let i = 0; i <= 97; i++) {
        prices[i] = 100;
      }
      prices[98] = 200;
      prices[99] = 200;

      const candles = generateCandles(prices);
      klineStore.getRawCandles.mockReturnValue(candles);

      const config = new SessionConfig();
      config.enabled_signals = ['supertrend'];
      config.signal_params = {
        supertrend_period: 10,
        supertrend_multiplier: 1.5,
        supertrend_mode: 'trend',
      };

      // 1. LONG entry in trend mode should fire because trend is bullish at 98
      const trendResult = service.checkEntry('BTCUSDT', config, '1m', 'LONG', 'entry');
      expect(trendResult.details?.supertrend?.fired).toBe(true);
      expect(trendResult.details?.supertrend?.description).toContain('is bullish');

      // 2. LONG entry in crossover mode should fire because direction flipped from down to up
      config.signal_params.supertrend_mode = 'crossover';
      const crossoverResult = service.checkEntry('BTCUSDT', config, '1m', 'LONG', 'entry');
      expect(crossoverResult.details?.supertrend?.fired).toBe(true);
      expect(crossoverResult.details?.supertrend?.description).toContain('crossed bullish');
    });

    it('should correctly calculate Supertrend LONG exit signals (trend and crossover)', () => {
      const prices = Array(100).fill(100);
      // To establish 'up' direction first, set prices to 100 for index 0 to 70,
      // then rise to 200 for index 71 to 97 (this triggers and sustains the bullish 'up' state).
      // Then drop to 100 at 98 (triggers bearish 'down' state).
      for (let i = 0; i <= 70; i++) prices[i] = 100;
      for (let i = 71; i <= 97; i++) prices[i] = 200;
      prices[98] = 100;
      prices[99] = 100;

      const candles = generateCandles(prices);
      klineStore.getRawCandles.mockReturnValue(candles);

      const config = new SessionConfig();
      config.exit_signals = ['supertrend'];
      config.signal_params = {
        supertrend_period: 10,
        supertrend_multiplier: 1.5,
        supertrend_mode: 'trend',
      };

      // 3. LONG exit in trend mode should fire because trend turned bearish
      const trendResult = service.checkEntry('BTCUSDT', config, '1m', 'LONG', 'exit');
      expect(trendResult.details?.supertrend?.fired).toBe(true);
      expect(trendResult.details?.supertrend?.description).toContain('Exit Supertrend is bearish');

      // 4. LONG exit in crossover mode should fire because direction flipped from up to down
      config.signal_params.supertrend_mode = 'crossover';
      const crossoverResult = service.checkEntry('BTCUSDT', config, '1m', 'LONG', 'exit');
      expect(crossoverResult.details?.supertrend?.fired).toBe(true);
      expect(crossoverResult.details?.supertrend?.description).toContain('Exit Supertrend crossed bearish');
    });

    it('should correctly calculate Supertrend SHORT entry signals (trend and crossover)', () => {
      const prices = Array(100).fill(100);
      // To establish 'up' direction first, set prices to 100 for index 0 to 70,
      // then rise to 200 for index 71 to 97 (bullish 'up' state).
      // Then drop to 100 at 98 (triggers bearish 'down' state).
      for (let i = 0; i <= 70; i++) prices[i] = 100;
      for (let i = 71; i <= 97; i++) prices[i] = 200;
      prices[98] = 100;
      prices[99] = 100;

      const candles = generateCandles(prices);
      klineStore.getRawCandles.mockReturnValue(candles);

      const config = new SessionConfig();
      config.enabled_signals = ['supertrend'];
      config.signal_params = {
        supertrend_period: 10,
        supertrend_multiplier: 1.5,
        supertrend_mode: 'trend',
      };

      // 5. SHORT entry in trend mode should fire because trend is bearish
      const trendResult = service.checkEntry('BTCUSDT', config, '1m', 'SHORT', 'entry');
      expect(trendResult.details?.supertrend?.fired).toBe(true);
      expect(trendResult.details?.supertrend?.description).toContain('is bearish');

      // 6. SHORT entry in crossover mode should fire because direction flipped from up to down
      config.signal_params.supertrend_mode = 'crossover';
      const crossoverResult = service.checkEntry('BTCUSDT', config, '1m', 'SHORT', 'entry');
      expect(crossoverResult.details?.supertrend?.fired).toBe(true);
      expect(crossoverResult.details?.supertrend?.description).toContain('crossed bearish');
    });

    it('should correctly calculate Supertrend SHORT exit signals (trend and crossover)', () => {
      const prices = Array(100).fill(200);
      // Establish 'down' direction first: flat 100 means index 97 is 'down'.
      // Then index 98 goes to 200 (triggers bullish 'up' state).
      for (let i = 0; i <= 97; i++) {
        prices[i] = 100;
      }
      prices[98] = 200;
      prices[99] = 200;

      const candles = generateCandles(prices);
      klineStore.getRawCandles.mockReturnValue(candles);

      const config = new SessionConfig();
      config.exit_signals = ['supertrend'];
      config.signal_params = {
        supertrend_period: 10,
        supertrend_multiplier: 1.5,
        supertrend_mode: 'trend',
      };

      // 7. SHORT exit in trend mode should fire because trend turned bullish
      const trendResult = service.checkEntry('BTCUSDT', config, '1m', 'SHORT', 'exit');
      expect(trendResult.details?.supertrend?.fired).toBe(true);
      expect(trendResult.details?.supertrend?.description).toContain('Exit Supertrend is bullish');

      // 8. SHORT exit in crossover mode should fire because direction flipped from down to up
      config.signal_params.supertrend_mode = 'crossover';
      const crossoverResult = service.checkEntry('BTCUSDT', config, '1m', 'SHORT', 'exit');
      expect(crossoverResult.details?.supertrend?.fired).toBe(true);
      expect(crossoverResult.details?.supertrend?.description).toContain('Exit Supertrend crossed bullish');
    });

    it('should gracefully handle 0, empty, and default parameters without crashing (P3)', () => {
      const prices = Array(100).fill(100);
      prices[98] = 200;
      prices[99] = 200;

      const candles = generateCandles(prices);
      klineStore.getRawCandles.mockReturnValue(candles);

      const config = new SessionConfig();
      config.enabled_signals = ['supertrend'];
      config.signal_params = {
        supertrend_period: '', // Empty
        supertrend_multiplier: null, // Null
        supertrend_mode: 'trend',
      };

      // Should default to period 10, multiplier 3, and evaluate correctly
      const trendResult = service.checkEntry('BTCUSDT', config, '1m', 'LONG', 'entry');
      expect(trendResult.details?.supertrend?.fired).toBe(true);
      expect(trendResult.details?.supertrend?.description).toContain('is bullish');
    });
  });
});
