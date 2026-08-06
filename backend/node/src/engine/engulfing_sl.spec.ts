import { RiskEngineService } from './riskEngine';
import { SessionConfig } from '../models/SessionConfig';

describe('RiskEngineService - Engulfing Boundary Stop Loss', () => {
  let service: RiskEngineService;
  let mockConfig: SessionConfig;

  beforeEach(() => {
    service = new RiskEngineService();
    mockConfig = new SessionConfig();
    mockConfig.sl_type = 'engulfing_boundary';
    mockConfig.sl_min_pct = 0.5;
    mockConfig.sl_max_pct = 5.0;
    mockConfig.sl_out_of_bounds_action = 'clamp';
  });

  it('should set LONG SL at the pattern_low', () => {
    const entryPrice = 100;
    const patternLow = 98; // 2% distance
    const result = service.computeSl(entryPrice, 'LONG', mockConfig, undefined, undefined, 'BTCUSDT', patternLow, undefined);

    expect(result.slPrice).toBe(98);
    expect(result.rejected).toBe(false);
  });

  it('should set SHORT SL at the pattern_high', () => {
    const entryPrice = 100;
    const patternHigh = 102; // 2% distance
    const result = service.computeSl(entryPrice, 'SHORT', mockConfig, undefined, undefined, 'BTCUSDT', undefined, patternHigh);

    expect(result.slPrice).toBe(102);
    expect(result.rejected).toBe(false);
  });

  it('should fallback to pct SL if pattern data is missing', () => {
    const entryPrice = 100;
    mockConfig.sl_distance_pct = 1.0;

    // PatternLow is missing
    const result = service.computeSl(entryPrice, 'LONG', mockConfig, undefined, undefined, 'BTCUSDT', undefined, undefined);

    expect(result.slPrice).toBe(99); // 1% of 100
    expect(result.rejected).toBe(false);
  });

  it('should clamp to sl_min_pct if pattern is too tight', () => {
    const entryPrice = 100;
    const patternLow = 99.8; // 0.2% distance, but min is 0.5%
    const result = service.computeSl(entryPrice, 'LONG', mockConfig, undefined, undefined, 'BTCUSDT', patternLow, undefined);

    expect(result.slPrice).toBe(99.5); // 0.5% of 100
    expect(result.rejected).toBe(false);
  });

  it('should clamp to sl_max_pct if pattern is too wide', () => {
    const entryPrice = 100;
    const patternLow = 90; // 10% distance, but max is 5.0%
    const result = service.computeSl(entryPrice, 'LONG', mockConfig, undefined, undefined, 'BTCUSDT', patternLow, undefined);

    expect(result.slPrice).toBe(95); // 5% of 100
    expect(result.rejected).toBe(false);
  });

  it('should reject if out of bounds and action is reject', () => {
    const entryPrice = 100;
    const patternLow = 90; // 10% distance
    mockConfig.sl_out_of_bounds_action = 'reject';

    const result = service.computeSl(entryPrice, 'LONG', mockConfig, undefined, undefined, 'BTCUSDT', patternLow, undefined);

    expect(result.rejected).toBe(true);
    expect(result.reason).toContain('above max 5%');
  });

  it('should use body boundary for close_body mode', () => {
    const entryPrice = 100;
    const bodyLow = 99; // 1% distance
    const patternLow = 97; // 3% distance
    mockConfig.engulfing_mode = 'close_body';

    const result = service.computeSl(entryPrice, 'LONG', mockConfig, undefined, undefined, 'BTCUSDT', patternLow, undefined, bodyLow, undefined);

    expect(result.slPrice).toBe(99);
  });

  it('should use pattern boundary for close_range mode even if body is provided', () => {
    const entryPrice = 100;
    const bodyLow = 99;
    const patternLow = 97;
    mockConfig.engulfing_mode = 'close_range';

    const result = service.computeSl(entryPrice, 'LONG', mockConfig, undefined, undefined, 'BTCUSDT', patternLow, undefined, bodyLow, undefined);

    expect(result.slPrice).toBe(97);
  });
});
