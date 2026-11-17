import { resolveStrategyConfig } from './strategyConfig';

describe('strategy configuration precedence', () => {
  it('preserves explicit scan defaults without mutating base', () => {
    const base = { scan_interval: '1d', signal_timeframes: { ema_dual: '1h', ema_dual_cross: '1h' } };
    const result = resolveStrategyConfig<any>(base, { scan_interval: '5m', signal_timeframes: { ema_dual_cross: 'default' } });
    expect(result.signal_timeframes).toEqual({ ema_dual: '1h', ema_dual_cross: 'default' });
    expect(result.scan_interval).toBe('5m');
    expect(base.signal_timeframes.ema_dual_cross).toBe('1h');
  });
});
