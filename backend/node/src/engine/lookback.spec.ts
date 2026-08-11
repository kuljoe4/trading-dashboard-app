import { KlineStoreService, Candle } from './kline_store.service';
import { RiskEngineService } from './riskEngine';
import { SessionConfig } from '../models/SessionConfig';
import { Repository } from 'typeorm';

describe('Lookback SL Logic', () => {
  let klineStore: KlineStoreService;
  let riskEngine: RiskEngineService;
  let mockRepo: Repository<any>;

  beforeEach(() => {
    mockRepo = {
      upsert: jest.fn(),
      find: jest.fn(),
    } as any;
    klineStore = new KlineStoreService(mockRepo);
    riskEngine = new RiskEngineService();
  });

  describe('KlineStoreService.getLookbackExtremes', () => {
    it('should exclude the current (incomplete) candle and use only completed ones', async () => {
      const symbol = 'BTCUSDT';
      const interval = '1m';
      const candles: any[] = [
        [1000, 10, 12, 6, 11, 0, 0, 100], // index 0, Low: 6
        [2000, 11, 13, 9, 12, 0, 0, 100], // index 1, Low: 9
        [3000, 12, 14, 10, 13, 0, 0, 100], // index 2, Low: 10
        [4000, 13, 15, 11, 14, 0, 0, 100], // index 3, Low: 11
        [5000, 14, 16, 7, 15, 0, 0, 100],  // index 4, Low: 7 (Current candle)
      ];

      for (const c of candles) {
        await klineStore.upsertCandle(symbol, interval, c);
      }

      // Period = 3. Expected indices for completed candles: [4-3-1, 4-1] = [0, 4) -> 1, 2, 3
      // Wait, let's re-calculate.
      // candles.length = 5. period = 3.
      // startIdx = max(0, 5 - 3 - 1) = 1.
      // endIdx = 5 - 1 = 4.
      // Scan indices: 1, 2, 3.
      // Lows: 9, 10, 11.
      // MinLow should be 9.
      const result = klineStore.getLookbackExtremes(symbol, interval, 3);

      expect(result.minLow).toBe(9);
      expect(result.minLow).not.toBe(7); // Current candle low is 7
      expect(result.minLow).not.toBe(6); // index 0 low is 6, outside period 3
    });

    it('should detect a time gap in consecutive completed candles and return fallback 0', async () => {
      const symbol = 'BTCUSDT';
      const interval = '1m'; // 1m expected delta = 60,000ms

      const gapCandles: any[] = [
        [100000, 10, 12, 6, 11, 0, 0, 100],
        [160000, 11, 13, 9, 12, 0, 0, 100], // delta = 60000 (Expected, no gap)
        [260000, 12, 14, 10, 13, 0, 0, 100], // delta = 100000 (Gap! > 1.5 * 60,000 = 90,000ms)
        [320000, 13, 15, 11, 14, 0, 0, 100], // current/incomplete candle
      ];

      for (const c of gapCandles) {
        await klineStore.upsertCandle(symbol, interval, c);
      }

      const result = klineStore.getLookbackExtremes(symbol, interval, 3);

      // Gap detected, so it should fallback to 0
      expect(result.minLow).toBe(0);
      expect(result.maxHigh).toBe(0);
    });

    it('should detect stale completed candle data and return fallback 0', async () => {
      const symbol = 'BTCUSDT';
      const interval = '1m'; // 1m expected delta = 60,000ms
      const staleTime = Date.now() - (60000 * 3); // 3 minutes ago (stale, max allowed is 2.5 minutes)

      const staleCandles: any[] = [
        [staleTime - 120000, 10, 12, 6, 11, 0, 0, 100],
        [staleTime - 60000, 11, 13, 9, 12, 0, 0, 100],
        [staleTime, 12, 14, 10, 13, 0, 0, 100], // Last completed candle (too old relative to Date.now())
        [Date.now(), 13, 15, 11, 14, 0, 0, 100], // current/incomplete candle
      ];

      for (const c of staleCandles) {
        await klineStore.upsertCandle(symbol, interval, c);
      }

      const result = klineStore.getLookbackExtremes(symbol, interval, 3);

      // Stale data detected, fallback to 0
      expect(result.minLow).toBe(0);
      expect(result.maxHigh).toBe(0);
    });
  });

  describe('RiskEngineService.computeSl', () => {
    it('should support rejection toggle when SL is out of bounds', () => {
      const config = new SessionConfig();
      config.sl_type = 'lookback_low/high';
      config.sl_min_pct = 1.0;
      config.sl_max_pct = 2.0;
      config.sl_out_of_bounds_action = 'reject';

      const entryPrice = 100;
      const direction = 'LONG';
      const minLow = 95; // 5% distance, should be REJECTED

      const result = riskEngine.computeSl(entryPrice, direction, config, minLow, 105, 'BTCUSDT');

      expect(result.rejected).toBe(true);
      expect(result.reason).toContain('above max 2%');
    });

    it('should still support clamping when configured', () => {
      const config = new SessionConfig();
      config.sl_type = 'lookback_low/high';
      config.sl_min_pct = 1.0;
      config.sl_max_pct = 2.0;
      config.sl_out_of_bounds_action = 'clamp';

      const entryPrice = 100;
      const direction = 'LONG';
      const minLow = 95; // 5% distance

      const result = riskEngine.computeSl(entryPrice, direction, config, minLow, 105, 'BTCUSDT');

      expect(result.rejected).toBe(false);
      expect(result.slPrice).toBe(98); // Clamped to 2% Max
    });

    it('should clamp lookback SL distance to MACD PBC stop-loss distance when lookback SL is less than MACD PBC', () => {
      const config = new SessionConfig();
      config.sl_type = 'lookback_low/high';
      config.sl_min_pct = 1.0;
      config.sl_max_pct = 3.0;
      config.sl_out_of_bounds_action = 'clamp';

      const entryPrice = 100;
      const direction = 'LONG';
      const minLow = 99.5; // Lookback SL distance = 0.5% (less than min 1.0% and less than MACD PBC SL)
      const macdPbcSlPrice = 98.5; // MACD PBC SL distance = 1.5%

      const result = riskEngine.computeSl(
        entryPrice,
        direction,
        config,
        minLow,
        105,
        'BTCUSDT',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        macdPbcSlPrice
      );

      expect(result.rejected).toBe(false);
      expect(result.slPrice).toBe(98.5); // Should be clamped to the MACD PBC SL price
    });

    it('should clamp lookback SL distance to maxDistance when MACD PBC stop-loss distance is higher than the max', () => {
      const config = new SessionConfig();
      config.sl_type = 'lookback_low/high';
      config.sl_min_pct = 1.0;
      config.sl_max_pct = 3.0;
      config.sl_out_of_bounds_action = 'clamp';

      const entryPrice = 100;
      const direction = 'LONG';
      const minLow = 99.5; // Lookback SL distance = 0.5%
      const macdPbcSlPrice = 95.0; // MACD PBC SL distance = 5.0% (higher than max 3.0%)

      const result = riskEngine.computeSl(
        entryPrice,
        direction,
        config,
        minLow,
        105,
        'BTCUSDT',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        macdPbcSlPrice
      );

      expect(result.rejected).toBe(false);
      expect(result.slPrice).toBe(97.0); // Clamped to maxDistance (3.0%)
    });

    it('should support rejection when lookback SL is less than MACD PBC stop-loss and action is reject', () => {
      const config = new SessionConfig();
      config.sl_type = 'lookback_low/high';
      config.sl_min_pct = 1.0;
      config.sl_max_pct = 3.0;
      config.sl_out_of_bounds_action = 'reject';

      const entryPrice = 100;
      const direction = 'LONG';
      const minLow = 99.5; // Lookback SL distance = 0.5%
      const macdPbcSlPrice = 98.5; // MACD PBC SL distance = 1.5%

      const result = riskEngine.computeSl(
        entryPrice,
        direction,
        config,
        minLow,
        105,
        'BTCUSDT',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        macdPbcSlPrice
      );

      expect(result.rejected).toBe(true);
      expect(result.reason).toContain('below MACD PBC adjusted min');
    });

    it('should use MACD PBC stop-loss when lookback extremes are unavailable', () => {
      const config = new SessionConfig();
      config.sl_type = 'lookback_low/high';
      config.sl_min_pct = 1.0;
      config.sl_max_pct = 3.0;
      config.sl_out_of_bounds_action = 'clamp';

      const entryPrice = 100;
      const direction = 'LONG';
      const macdPbcSlPrice = 98.5; // MACD PBC SL distance = 1.5%

      // minLow is undefined (extremes unavailable)
      const result = riskEngine.computeSl(
        entryPrice,
        direction,
        config,
        undefined,
        undefined,
        'BTCUSDT',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        macdPbcSlPrice
      );

      expect(result.rejected).toBe(false);
      expect(result.slPrice).toBe(98.5); // Should use MACD PBC SL instead of falling back to PCT SL
    });
  });
});
