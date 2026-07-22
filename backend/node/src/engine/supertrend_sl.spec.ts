import { RiskEngineService } from './riskEngine';
import { SessionConfig } from '../models/SessionConfig';

describe('RiskEngineService - Supertrend Stop Loss', () => {
  let service: RiskEngineService;
  let mockConfig: SessionConfig;

  beforeEach(() => {
    service = new RiskEngineService();
    mockConfig = new SessionConfig();
    mockConfig.sl_type = 'supertrend';
    mockConfig.sl_min_pct = 0.3;
    mockConfig.sl_max_pct = 3.0;
    mockConfig.sl_out_of_bounds_action = 'clamp';
  });

  it('should successfully compute Supertrend SL when it is within limits', () => {
    const entryPrice = 100;
    const supertrendSlPrice = 98.5; // distance is 1.5%, within 0.3% - 3.0%
    const result = service.computeSl(
      entryPrice,
      'LONG',
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
    expect(result.slPrice).toBe(98.5);
  });

  it('should clamp Supertrend SL to minimum limit when distance is too small and action is clamp', () => {
    const entryPrice = 100;
    const supertrendSlPrice = 99.9; // distance is 0.1%, below 0.3%
    const result = service.computeSl(
      entryPrice,
      'LONG',
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
    expect(result.slPrice).toBe(99.7); // 100 - (100 * 0.3%)
  });

  it('should reject entry when distance is too small and action is reject', () => {
    mockConfig.sl_out_of_bounds_action = 'reject';
    const entryPrice = 100;
    const supertrendSlPrice = 99.9; // distance is 0.1%
    const result = service.computeSl(
      entryPrice,
      'LONG',
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

    expect(result.rejected).toBe(true);
    expect(result.reason).toContain('below minimum');
  });

  it('should clamp Supertrend SL to maximum limit when distance is too large and action is clamp', () => {
    const entryPrice = 100;
    const supertrendSlPrice = 95.0; // distance is 5.0%, above 3.0%
    const result = service.computeSl(
      entryPrice,
      'LONG',
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
    expect(result.slPrice).toBe(97.0); // 100 - (100 * 3.0%)
  });

  it('should reject entry when distance is too large and action is reject', () => {
    mockConfig.sl_out_of_bounds_action = 'reject';
    const entryPrice = 100;
    const supertrendSlPrice = 95.0; // distance is 5.0%
    const result = service.computeSl(
      entryPrice,
      'LONG',
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

    expect(result.rejected).toBe(true);
    expect(result.reason).toContain('exceeds maximum');
  });

  it('should fallback to Pct SL if supertrend price is missing or invalid', () => {
    mockConfig.sl_distance_pct = 1.0;
    const entryPrice = 100;
    const result = service.computeSl(
      entryPrice,
      'LONG',
      mockConfig,
      undefined,
      undefined,
      'BTCUSDT',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined // missing supertrend price
    );

    expect(result.rejected).toBe(false);
    expect(result.slPrice).toBe(99.0); // Fallback to 1.0%
  });
});
