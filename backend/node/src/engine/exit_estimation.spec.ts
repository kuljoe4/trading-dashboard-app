import { Test, TestingModule } from '@nestjs/testing';
import { ExitEstimationService } from './exit_estimation.service';
import { KlineStoreService, Candle } from './kline_store.service';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';

describe('ExitEstimationService', () => {
  let service: ExitEstimationService;
  let klineStore: jest.Mocked<KlineStoreService>;

  beforeEach(async () => {
    klineStore = {
      getRawCandles: jest.fn(),
      getLookbackExtremes: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExitEstimationService,
        { provide: KlineStoreService, useValue: klineStore },
      ],
    }).compile();

    service = module.get<ExitEstimationService>(ExitEstimationService);
  });

  const generateCandles = (prices: number[]): Candle[] => {
    return prices.map((price, i) => ({
      time: i * 60000,
      open: price - 0.5,
      high: price + 1,
      low: price - 1,
      close: price,
      volume: 1000 + i,
    }));
  };

  const createTrade = (overrides: Partial<Trade> = {}): Trade => ({
    id: 'trade-123',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    entry_price: 100,
    qty: 10,
    initial_sl: 95,
    current_sl: 95,
    initial_risk_usdt: 50,
    risk_usdt: 50,
    status: 'OPEN',
    pnl: 0,
    entry_ts: new Date(),
    ...overrides,
  } as Trade);

  describe('estimateExitSignal - Dual EMA Convergence', () => {
    it('should correctly estimate ETA and projected exit price when Fast and Slow EMAs are converging', () => {
      const trade = createTrade({ direction: 'LONG', entry_price: 100, qty: 10 });
      const config = new SessionConfig();
      config.exit_signals = ['ema_dual_cross'];

      // Generate candles rising steadily
      const prices = [100, 101, 102, 103, 104];
      const candles = generateCandles(prices);

      const signalDetail = {
        fired: false,
        value: 101.20, // Fast EMA
        threshold: 101.80, // Slow EMA
        prevFast: 100.80,
        prevSlow: 101.90,
        status: 'approaching'
      };

      const est = service.estimateExitSignal('ema_dual_cross', trade, config, '1m', candles, signalDetail);

      expect(est.state).toBe('approaching');
      expect(est.method).toBe('dual_convergence');
      expect(est.etaCandles).toBeGreaterThan(0);
      expect(est.estimatedExitPrice).toBeDefined();
      expect(est.estimatedPnl).toBeDefined();
      expect(est.confidence).toBe(78);
      expect(est.components?.fastValue).toBe(101.20);
      expect(est.components?.slowValue).toBe(101.80);
    });

    it('should evaluate state as diverging when Fast/Slow EMA spread is widening', () => {
      const trade = createTrade({ direction: 'LONG', entry_price: 100, qty: 10 });
      const config = new SessionConfig();
      config.exit_signals = ['ema_dual_cross'];

      const prices = [100, 99, 98, 97, 96];
      const candles = generateCandles(prices);

      const signalDetail = {
        fired: false,
        value: 101.00, // Fast
        threshold: 102.50, // Slow - spread is 1.50
        prevFast: 101.20,
        prevSlow: 102.00, // prev spread was 0.80 -> spread widening
        status: 'approaching'
      };

      const est = service.estimateExitSignal('ema_dual_cross', trade, config, '1m', candles, signalDetail);

      expect(est.state).toBe('diverging');
      expect(est.proximity).toBe(0);
      expect(est.etaCandles).toBeNull();
      expect(est.estimatedExitPrice).toBeNull();
    });

    it('should return state = blocked and 0% proximity when MACD filter rejects the signal', () => {
      const trade = createTrade();
      const config = new SessionConfig();
      config.exit_signals = ['ema_dual_cross'];

      const candles = generateCandles([100, 101, 102, 103, 104]);
      const signalDetail = {
        fired: false,
        status: 'blocked',
        rejected: true,
        description: 'Rejected by MACD histogram'
      };

      const est = service.estimateExitSignal('ema_dual_cross', trade, config, '1m', candles, signalDetail);

      expect(est.state).toBe('blocked');
      expect(est.proximity).toBe(0);
      expect(est.etaCandles).toBeNull();
    });
  });

  describe('estimateExitSignal - Non-Dual Signal Estimators (Supertrend, MACD, Momentum)', () => {
    it('should estimate Supertrend using true ATR distance scaling', () => {
      const trade = createTrade({ direction: 'LONG', entry_price: 100, qty: 10 });
      const config = new SessionConfig();
      config.exit_signals = ['supertrend'];

      // Generate 15 candles with clear high/low spread for ATR
      const candles: Candle[] = [];
      for (let i = 0; i < 20; i++) {
        candles.push({
          time: i * 60000,
          open: 100 + i * 0.2,
          high: 102 + i * 0.2,
          low: 99 + i * 0.2,
          close: 101 + i * 0.2,
          volume: 1000,
        });
      }

      const signalDetail = {
        fired: false,
        threshold: 98.0, // Supertrend line
        status: 'approaching'
      };

      const est = service.estimateExitSignal('supertrend', trade, config, '1m', candles, signalDetail);

      expect(est.signalType).toBe('supertrend');
      expect(est.state).toBe('approaching');
      expect(est.method).toBe('indicator_convergence');
      expect(est.etaCandles).toBeGreaterThan(0);
      expect(est.estimatedExitPrice).toBe(98.0);
      expect(est.components?.atr).toBeGreaterThan(0);
      expect(est.components?.distance).toBeDefined();
    });

    it('should estimate MACD Impulse reversal using histogram velocity and zero-cross projection', () => {
      const trade = createTrade({ direction: 'LONG', entry_price: 100, qty: 10 });
      const config = new SessionConfig();
      config.exit_signals = ['macd_impulse'];

      const candles: Candle[] = [];
      // Generate 50 candles with declining close price to trigger fading green histogram
      for (let i = 0; i < 50; i++) {
        const p = i < 35 ? 100 + i * 0.5 : 117.5 - (i - 35) * 0.4;
        candles.push({
          time: i * 60000,
          open: p - 0.1,
          high: p + 0.2,
          low: p - 0.2,
          close: p,
          volume: 1000,
        });
      }

      const est = service.estimateExitSignal('macd_impulse', trade, config, '1m', candles, {});

      expect(est.signalType).toBe('macd_impulse');
      expect(est.method).toBe('momentum_projection');
      expect(est.components?.currHist).toBeDefined();
      expect(est.components?.histVelocity).toBeDefined();
    });

    it('should estimate Breakout H/L using boundary price distance', () => {
      const trade = createTrade({ direction: 'LONG', entry_price: 100, qty: 10 });
      const config = new SessionConfig();
      config.exit_signals = ['breakout_hl'];
      config.signal_params = { scan_lookback: 3 };

      const candles = generateCandles([100, 102, 101, 99.5, 98.0]);

      const est = service.estimateExitSignal('breakout_hl', trade, config, '1m', candles, {});

      expect(est.signalType).toBe('breakout_hl');
      expect(est.state).toBe('approaching');
      expect(est.components?.boundPrice).toBeDefined();
    });
  });

  describe('estimateExitMonitoring - Composite Signal Aggregation', () => {
    it('should bottleneck composite proximity at the weakest signal for ALL logic', () => {
      const trade = createTrade();
      const config = new SessionConfig();
      config.exit_signals = ['sig1', 'sig2', 'sig3'];
      config.exit_signal_logic = 'all';

      const candles = generateCandles([100, 101, 102, 103, 104]);

      const signalDetails = {
        sig1: { fired: false, value: 104.5, threshold: 105, status: 'approaching', threshold_is_price: true }, // ~90%
        sig2: { fired: false, value: 104.8, threshold: 105, status: 'approaching', threshold_is_price: true }, // ~95%
        sig3: { fired: false, value: 101.0, threshold: 105, status: 'approaching', threshold_is_price: true }, // ~20%
      };

      const comp = service.estimateExitMonitoring(trade, config, '1m', candles, signalDetails);

      expect(comp.selectedSignalKey).toBe('sig3');
      expect(comp.proximity).toBeLessThan(40);
    });

    it('should select the shortest actionable ETA signal for ANY logic', () => {
      const trade = createTrade();
      const config = new SessionConfig();
      config.exit_signals = ['ema_cross_fast', 'ema_cross_slow'];
      config.exit_signal_logic = 'any';

      const candles = generateCandles([100, 101, 102, 103, 104]);

      const signalDetails = {
        ema_cross_slow: { fired: false, value: 102, threshold: 105, status: 'approaching' },
        ema_cross_fast: { fired: false, value: 104.5, threshold: 105, status: 'approaching' }
      };

      const comp = service.estimateExitMonitoring(trade, config, '1m', candles, signalDetails);

      expect(comp.selectedSignalKey).toBe('ema_cross_fast');
      expect(comp.proximity).toBeGreaterThan(50);
    });
  });
});
