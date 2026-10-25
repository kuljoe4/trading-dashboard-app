import { SignalEngineService } from './signalEngine';

describe('SignalEngineService - EMA Warmup', () => {
  let signalEngine: SignalEngineService;

  beforeEach(() => {
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

  it('should take the max period for ema_dual_cross', () => {
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
    expect(signalEngine.getRequiredWarmup(config as any)).toBe(100);
  });

  it('should handle missing exit params gracefully by falling back to entry params or defaults', () => {
    const config = {
      enabled_signals: ['ema_dual_close'],
      exit_signals: ['ema_dual_close'],
      signal_params: {
        entry_ema_fast: 15,
        entry_ema_slow: 35
      }
    };
    // Max of (15, 35) is 35. 35 * 2 = 70.
    // Exit params should fall back to 9/21. Max of (15, 35, 9, 21) is 35.
    expect(signalEngine.getRequiredWarmup(config as any)).toBe(70);
  });
});
