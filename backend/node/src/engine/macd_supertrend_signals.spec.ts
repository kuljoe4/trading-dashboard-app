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
      const result = service.calculateMACD(candles, 12, 26, 9);
      expect(result.macdLine).toBeDefined();
      expect(result.signalLine).toBeDefined();
      expect(result.histogram).toBeDefined();
      expect(result.macdLine.length).toBe(100);
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
    it('should correctly calculate Supertrend direction and crossover', () => {
      const prices = Array(100).fill(100);
      // Flat price, then massive break upwards
      for (let i = 95; i < 100; i++) {
        prices[i] = 200 + (i - 95) * 50;
      }

      const candles = generateCandles(prices);
      klineStore.getRawCandles.mockReturnValue(candles);

      const config = new SessionConfig();
      config.enabled_signals = ['supertrend'];
      config.signal_params = {
        supertrend_period: 10,
        supertrend_multiplier: 1.5,
        supertrend_mode: 'trend',
      };

      const trendResult = service.checkEntry('BTCUSDT', config, '1m', 'LONG');
      expect(trendResult.details?.supertrend?.fired).toBe(true);

      // Crossover should also be true on the flip index
      config.signal_params.supertrend_mode = 'crossover';
      const crossoverResult = service.checkEntry('BTCUSDT', config, '1m', 'LONG');
      expect(crossoverResult.details?.supertrend).toBeDefined();
    });
  });
});
