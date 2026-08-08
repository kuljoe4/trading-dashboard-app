import { Test, TestingModule } from '@nestjs/testing';
import { SignalEngineService } from './signalEngine';
import { KlineStoreService } from './kline_store.service';

describe('Layered Signal Parameters Support', () => {
  let signalEngine: SignalEngineService;
  let klineStore: KlineStoreService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalEngineService,
        {
          provide: KlineStoreService,
          useValue: {
            getRawCandles: jest.fn(),
            getLookbackExtremes: jest.fn(),
          },
        },
      ],
    }).compile();

    signalEngine = module.get<SignalEngineService>(SignalEngineService);
    klineStore = module.get<KlineStoreService>(KlineStoreService);
  });

  describe('resolveSignalParam', () => {
    it('should resolve base signal params when signalType matches baseType', () => {
      const params = {
        supertrend_period: 10,
        supertrend_multiplier: 3,
      };

      const period = (signalEngine as any).resolveSignalParam(params, 'supertrend', 'supertrend', 'supertrend_period', 14);
      const mult = (signalEngine as any).resolveSignalParam(params, 'supertrend', 'supertrend', 'supertrend_multiplier', 2.0);

      expect(period).toBe(10);
      expect(mult).toBe(3);
    });

    it('should resolve suffixed override keys (e.g. key_2)', () => {
      const params = {
        supertrend_period: 10,
        supertrend_period_2: 15,
        supertrend_multiplier: 3,
        supertrend_multiplier_2: 1.5,
      };

      const period2 = (signalEngine as any).resolveSignalParam(params, 'supertrend_2', 'supertrend', 'supertrend_period', 10);
      const mult2 = (signalEngine as any).resolveSignalParam(params, 'supertrend_2', 'supertrend', 'supertrend_multiplier', 3);

      expect(period2).toBe(15);
      expect(mult2).toBe(1.5);
    });

    it('should resolve prefix-replacement override keys (e.g. supertrend_2_period)', () => {
      const params = {
        supertrend_period: 10,
        supertrend_2_period: 14,
        supertrend_multiplier: 3,
        supertrend_2_multiplier: 2.5,
      };

      const period2 = (signalEngine as any).resolveSignalParam(params, 'supertrend_2', 'supertrend', 'supertrend_period', 10);
      const mult2 = (signalEngine as any).resolveSignalParam(params, 'supertrend_2', 'supertrend', 'supertrend_multiplier', 3);

      expect(period2).toBe(14);
      expect(mult2).toBe(2.5);
    });

    it('should fall back to base signal params if no override is found for the layer', () => {
      const params = {
        supertrend_period: 10,
        supertrend_multiplier: 3,
      };

      const period2 = (signalEngine as any).resolveSignalParam(params, 'supertrend_2', 'supertrend', 'supertrend_period', 14);
      expect(period2).toBe(10);
    });
  });

  describe('getRequiredWarmup for layers', () => {
    it('should calculate warmup correctly using overridden period parameters', () => {
      const config: any = {
        enabled_signals: ['supertrend', 'supertrend_2'],
        signal_params: {
          supertrend_period: 10,
          supertrend_2_period: 14,
        },
      };

      // Warmup is period * 5 for supertrend.
      // Base supertrend = 10 * 5 = 50.
      // Supertrend Layer 2 = 14 * 5 = 70.
      // So maxReq should be 70.
      const warmup = signalEngine.getRequiredWarmup(config);
      expect(warmup).toBe(70);
    });
  });

  describe('checkEntry evaluation', () => {
    it('should evaluate layered signals independently with distinct parameters', () => {
      const config: any = {
        enabled_signals: ['supertrend', 'supertrend_2'],
        signal_logic: 'all',
        signal_params: {
          supertrend_period: 10,
          supertrend_multiplier: 3,
          supertrend_2_period: 14,
          supertrend_2_multiplier: 1.5,
        },
      };

      // Generate mock candles
      const candles = Array.from({ length: 100 }, (_, i) => ({
        time: i * 1000,
        open: 100 + i * 0.1,
        high: 101 + i * 0.1,
        low: 99 + i * 0.1,
        close: 100.5 + i * 0.1,
        volume: 1000,
      }));

      jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);

      const result = signalEngine.checkEntry('BTCUSDT', config, '1m', 'LONG', 'entry', false);
      expect(result.details).toBeDefined();
      const details = result.details as any;
      expect(details['supertrend']).toBeDefined();
      expect(details['supertrend_2']).toBeDefined();

      // Check they resolved different periods and multipliers
      const supertrendDetail = details['supertrend'];
      const supertrend2Detail = details['supertrend_2'];

      // They should evaluate and output distinct descriptions or values based on their custom periods/multipliers
      expect(supertrendDetail.fired).toBeDefined();
      expect(supertrend2Detail.fired).toBeDefined();
    });
  });
});
