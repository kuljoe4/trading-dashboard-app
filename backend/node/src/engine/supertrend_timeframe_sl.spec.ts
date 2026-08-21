import { SignalEngineService } from './signalEngine';
import { RiskEngineService } from './riskEngine';
import { SessionConfig } from '../models/SessionConfig';
import { Candle } from './kline_store.service';

describe('Supertrend Timeframe & SL Computation Suite', () => {
  let signalEngine: SignalEngineService;
  let riskEngine: RiskEngineService;
  let mockKlineStore: any;

  beforeEach(() => {
    mockKlineStore = {
      getRawCandles: jest.fn(),
      getLookbackExtremes: jest.fn(),
    };
    signalEngine = new SignalEngineService(mockKlineStore);
    riskEngine = new RiskEngineService();
  });

  const generateCandles = (count: number, basePrice: number, trend: 'up' | 'down'): Candle[] => {
    const candles: Candle[] = [];
    let price = basePrice;
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      const step = trend === 'up' ? 0.5 : -0.5;
      price += step;
      const open = price - 0.2;
      const high = price + 0.8;
      const low = price - 0.8;
      const close = price;

      candles.push({
        time: now - (count - i) * 300000, // 5m intervals
        open,
        high,
        low,
        close,
        volume: 1000,
      });
    }
    return candles;
  };

  describe('SignalEngineService - Supertrend Timeframe & Direction', () => {
    it('should compute Supertrend slPrice on completed candle for LONG direction', () => {
      const candles = generateCandles(50, 100, 'up');
      const config = {
        signal_params: {
          supertrend_period: 10,
          supertrend_multiplier: 3,
        },
      };

      const result = (signalEngine as any).supertrendSignal(
        'BTCUSDT',
        config,
        '5m',
        'LONG',
        'entry',
        candles
      );

      expect(result.fired).toBe(true);
      expect(result.slPrice).toBeDefined();
      expect(result.slPrice).toBeGreaterThan(0);
      expect(result.slPrice).toBeLessThan(candles[candles.length - 2].close); // For LONG, ST line is below completed candle close
    });

    it('should compute Supertrend slPrice on completed candle for SHORT direction', () => {
      const candles = generateCandles(50, 100, 'down');
      const config = {
        signal_params: {
          supertrend_period: 10,
          supertrend_multiplier: 3,
        },
      };

      const result = (signalEngine as any).supertrendSignal(
        'BTCUSDT',
        config,
        '5m',
        'SHORT',
        'entry',
        candles
      );

      expect(result.fired).toBe(true);
      expect(result.slPrice).toBeDefined();
      expect(result.slPrice).toBeGreaterThan(0);
      expect(result.slPrice).toBeGreaterThan(candles[candles.length - 2].close); // For SHORT, ST line is above completed candle close
    });

    it('should calculate Supertrend on explicit 5m timeframe when multi-timeframe interval is set', () => {
      const candles5m = generateCandles(50, 100, 'up');
      mockKlineStore.getRawCandles.mockImplementation((sym: string, tf: string) => {
        if (tf === '5m') return candles5m;
        return [];
      });

      const config = {
        scan_interval: '1m',
        signal_timeframes: { supertrend: '5m' },
        signal_params: { supertrend_period: 10, supertrend_multiplier: 3 },
      };

      const result = (signalEngine as any).supertrendSignal(
        'BTCUSDT',
        config,
        '5m',
        'LONG',
        'entry'
      );

      expect(mockKlineStore.getRawCandles).toHaveBeenCalledWith('BTCUSDT', '5m');
      expect(result.fired).toBe(true);
      expect(result.slPrice).toBeDefined();
    });
  });

  describe('RiskEngineService - Directional Supertrend SL Safety Clamping', () => {
    let mockConfig: SessionConfig;

    beforeEach(() => {
      mockConfig = new SessionConfig();
      mockConfig.sl_type = 'supertrend';
      mockConfig.sl_min_pct = 0.5;
      mockConfig.sl_max_pct = 3.0;
      mockConfig.sl_out_of_bounds_action = 'clamp';
    });

    it('should accept valid SHORT Supertrend SL within min/max distance bounds', () => {
      const entryPrice = 100;
      const supertrendSlPrice = 101.5; // 1.5% distance above short entry
      const result = riskEngine.computeSl(
        entryPrice,
        'SHORT',
        mockConfig,
        undefined,
        undefined,
        'BTCUSDT',
        undefined,
        undefined,
        undefined,
        undefined,
        supertrendSlPrice
      );

      expect(result.rejected).toBe(false);
      expect(result.slPrice).toBe(101.5);
    });

    it('should clamp SHORT Supertrend SL when distance is above max_pct (3%)', () => {
      const entryPrice = 100;
      const supertrendSlPrice = 105.0; // 5.0% distance (too far)
      const result = riskEngine.computeSl(
        entryPrice,
        'SHORT',
        mockConfig,
        undefined,
        undefined,
        'BTCUSDT',
        undefined,
        undefined,
        undefined,
        undefined,
        supertrendSlPrice
      );

      expect(result.rejected).toBe(false);
      expect(result.slPrice).toBe(103.0); // Clamped to entry + 3%
    });

    it('should clamp SHORT Supertrend SL when distance is below min_pct (0.5%)', () => {
      const entryPrice = 100;
      const supertrendSlPrice = 100.2; // 0.2% distance (too tight)
      const result = riskEngine.computeSl(
        entryPrice,
        'SHORT',
        mockConfig,
        undefined,
        undefined,
        'BTCUSDT',
        undefined,
        undefined,
        undefined,
        undefined,
        supertrendSlPrice
      );

      expect(result.rejected).toBe(false);
      expect(result.slPrice).toBe(100.5); // Clamped to entry + 0.5%
    });
  });
});
