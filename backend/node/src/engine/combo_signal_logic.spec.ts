import { Test, TestingModule } from '@nestjs/testing';
import { SignalEngineService } from './signalEngine';
import { KlineStoreService } from './kline_store.service';
import { SessionConfig } from '../models/SessionConfig';

describe('Combo Signal Logic (AND + ANY)', () => {
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

  it('should pass in COMBO mode when ALL required signals fire AND ANY optional signal fires', () => {
    const config: SessionConfig = {
      enabled_signals: ['momentum_pct', 'supertrend'],
      signal_logic: 'combo',
      required_signals: ['momentum_pct'],
      scan_lookback: 3,
      scan_pct_threshold: 1.0,
      signal_params: {
        supertrend_period: 5,
        supertrend_multiplier: 2,
      },
    } as any;

    // Generate mock candles with 2% upward momentum
    const candles = Array.from({ length: 50 }, (_, i) => ({
      time: i * 60000,
      open: 100 + i * 0.5,
      high: 101 + i * 0.5,
      low: 99.5 + i * 0.5,
      close: 100.5 + i * 0.5,
      volume: 1000,
    }));

    jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);

    const result = signalEngine.checkEntry('BTCUSDT', config, '1m', 'LONG', 'entry', false);
    expect(result.allFired).toBe(true);
    expect(result.firedSignals).toContain('momentum_pct');
    expect(result.reason).toContain('Combo');
  });

  it('should fail in COMBO mode when a REQUIRED signal fails to fire', () => {
    const config: SessionConfig = {
      enabled_signals: ['momentum_pct', 'supertrend'],
      signal_logic: 'combo',
      required_signals: ['momentum_pct'],
      scan_lookback: 3,
      scan_pct_threshold: 10.0, // High threshold so momentum fails
      signal_params: {
        supertrend_period: 5,
        supertrend_multiplier: 2,
      },
    } as any;

    // Generate flat candles (0% momentum)
    const candles = Array.from({ length: 50 }, (_, i) => ({
      time: i * 60000,
      open: 100,
      high: 100.1,
      low: 99.9,
      close: 100,
      volume: 1000,
    }));

    jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);

    const result = signalEngine.checkEntry('BTCUSDT', config, '1m', 'LONG', 'entry', false);
    expect(result.allFired).toBe(false);
  });

  it('should fail in COMBO mode when required signal fires but NO optional signal fires', () => {
    const config: SessionConfig = {
      enabled_signals: ['momentum_pct', 'breakout_hl'],
      signal_logic: 'combo',
      required_signals: ['momentum_pct'],
      scan_lookback: 3,
      scan_pct_threshold: 0.1, // Low threshold so momentum passes
    } as any;

    // Generate candles where momentum passes (+2.5%) but breakout fails
    const candles = Array.from({ length: 50 }, (_, i) => ({
      time: i * 60000,
      open: 100,
      high: 110,
      low: 90,
      close: i === 49 ? 102.5 : 100,
      volume: 1000,
    }));

    jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);
    jest.spyOn(klineStore, 'getLookbackExtremes').mockReturnValue({ minLow: 90, maxHigh: 110 });

    const result = signalEngine.checkEntry('BTCUSDT', config, '1m', 'LONG', 'entry', false);
    expect(result.firedSignals).toContain('momentum_pct');
    expect(result.allFired).toBe(false);
  });

  it('should perform early returns in minimal mode for COMBO logic', () => {
    const config: SessionConfig = {
      enabled_signals: ['momentum_pct', 'supertrend'],
      signal_logic: 'combo',
      required_signals: ['momentum_pct'],
      scan_lookback: 3,
      scan_pct_threshold: 10.0,
    } as any;

    const candles = Array.from({ length: 50 }, (_, i) => ({
      time: i * 60000,
      open: 100,
      high: 100.1,
      low: 99.9,
      close: 100,
      volume: 1000,
    }));

    jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);

    const result = signalEngine.checkEntry('BTCUSDT', config, '1m', 'LONG', 'entry', true);
    expect(result.allFired).toBe(false);
  });

  it('should correctly evaluate minimal mode when required passes but optional fails', () => {
    const config: SessionConfig = {
      enabled_signals: ['momentum_pct', 'breakout_hl'],
      signal_logic: 'combo',
      required_signals: ['momentum_pct'],
      scan_lookback: 3,
      scan_pct_threshold: 0.1, // Low threshold so momentum passes
    } as any;

    const candles = Array.from({ length: 50 }, (_, i) => ({
      time: i * 60000,
      open: 100,
      high: 110,
      low: 90,
      close: i === 49 ? 102.5 : 100,
      volume: 1000,
    }));

    jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);
    jest.spyOn(klineStore, 'getLookbackExtremes').mockReturnValue({ minLow: 90, maxHigh: 110 });

    const result = signalEngine.checkEntry('BTCUSDT', config, '1m', 'LONG', 'entry', true);
    expect(result.allFired).toBe(false);
  });
});
