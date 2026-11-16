import { SignalEngineService } from './signalEngine';
import { KlineStoreService } from './kline_store.service';
import { ConfigService } from '@nestjs/config';

describe('SignalEngineService - EMA Warmup', () => {
  let signalEngine: SignalEngineService;

  beforeEach(() => {
    // Mock KlineStoreService since we don't need its real functionality for getRequiredWarmup
    const mockKlineStore = {} as any;
    signalEngine = new SignalEngineService(mockKlineStore);
  });

  it('should take the max period for ema_close when entry is larger', () => {
    const config = {
      enabled_signals: ['ema_close'],
      exit_signals: ['ema_close'],
      signal_params: {
        entry_ema_period: 50,
        exit_ema_period: 10,
        ema_period: 12
      }
    };
    // 50 * 2 = 100
    expect(signalEngine.getRequiredWarmup(config as any)).toBe(100);
  });

  it('should take the max period for ema_close when exit is larger', () => {
    const config = {
      enabled_signals: ['ema_close'],
      exit_signals: ['ema_close'],
      signal_params: {
        entry_ema_period: 10,
        exit_ema_period: 60,
        ema_period: 12
      }
    };
    // 60 * 2 = 120
    expect(signalEngine.getRequiredWarmup(config as any)).toBe(120);
  });

  it('should calculate EMA Dual warmup independently for entry and exit', () => {
    const config = {
      enabled_signals: ['ema_dual_cross'],
      exit_signals: ['ema_dual_cross'],
      signal_params: {
        entry_ema_fast: 9,
        entry_ema_slow: 21,
        exit_ema_fast: 20,
        exit_ema_slow: 50
      }
    };
    // Max of (9, 21, 20, 50) is 50. 50 * 2 = 100
    expect(signalEngine.getRequiredWarmupForSignal(config as any, 'ema_dual_cross', 'entry')).toBe(42);
    expect(signalEngine.getRequiredWarmupForSignal(config as any, 'ema_dual_cross', 'exit')).toBe(100);
  });

  it('should use independent exit defaults when exit EMA parameters are omitted', () => {
    const config = {
      enabled_signals: ['ema_dual_close'],
      exit_signals: ['ema_dual_close'],
      signal_params: {
        entry_ema_fast: 15,
        entry_ema_slow: 35
      }
    };
    expect(signalEngine.getRequiredWarmupForSignal(config as any, 'ema_dual_close', 'entry')).toBe(70);
    expect(signalEngine.getRequiredWarmupForSignal(config as any, 'ema_dual_close', 'exit')).toBe(42);
  });
});
