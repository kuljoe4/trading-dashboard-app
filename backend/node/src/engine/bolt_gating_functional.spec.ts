import { GatingService } from './gating.service';
import { SessionConfig } from '../models/SessionConfig';

describe('GatingService Functional', () => {
  let gatingService: GatingService;

  beforeEach(() => {
    gatingService = new GatingService(null as any, null as any, null as any, null as any, null as any, null as any, null as any);
  });

  it('should correctly handle intra-day windows', () => {
    const config: SessionConfig = {
      trading_windows: [
        { start: '08:00', end: '12:00' },
      ]
    } as any;

    // Mock hours/minutes
    const originalGetHours = Date.prototype.getUTCHours;
    const originalGetMinutes = Date.prototype.getUTCMinutes;

    try {
      Date.prototype.getUTCHours = jest.fn().mockReturnValue(10);
      Date.prototype.getUTCMinutes = jest.fn().mockReturnValue(30);
      expect(gatingService.isInsideTradingWindow(config)).toBe(true);

      Date.prototype.getUTCHours = jest.fn().mockReturnValue(7);
      expect(gatingService.isInsideTradingWindow(config)).toBe(false);

      Date.prototype.getUTCHours = jest.fn().mockReturnValue(13);
      expect(gatingService.isInsideTradingWindow(config)).toBe(false);
    } finally {
      Date.prototype.getUTCHours = originalGetHours;
      Date.prototype.getUTCMinutes = originalGetMinutes;
    }
  });

  it('should correctly handle overnight windows', () => {
    const config: SessionConfig = {
      trading_windows: [
        { start: '22:00', end: '02:00' },
      ]
    } as any;

    const originalGetHours = Date.prototype.getUTCHours;
    const originalGetMinutes = Date.prototype.getUTCMinutes;

    try {
      Date.prototype.getUTCHours = jest.fn().mockReturnValue(23);
      Date.prototype.getUTCMinutes = jest.fn().mockReturnValue(0);
      expect(gatingService.isInsideTradingWindow(config)).toBe(true);

      Date.prototype.getUTCHours = jest.fn().mockReturnValue(1);
      expect(gatingService.isInsideTradingWindow(config)).toBe(true);

      Date.prototype.getUTCHours = jest.fn().mockReturnValue(10);
      expect(gatingService.isInsideTradingWindow(config)).toBe(false);
    } finally {
      Date.prototype.getUTCHours = originalGetHours;
      Date.prototype.getUTCMinutes = originalGetMinutes;
    }
  });

  it('should use the cache correctly', () => {
    const windows = [
        { start: '08:00', end: '12:00' },
    ];
    const config: SessionConfig = {
      trading_windows: windows
    } as any;

    // First call populates cache
    gatingService.isInsideTradingWindow(config);

    // @ts-ignore
    const cached = gatingService.tradingWindowCache.get(config);
    expect(cached).toBeDefined();
    if (cached) {
      expect(cached[0]).toEqual({ start: 800, end: 1200 });
    }

    // Modify config windows manually to see if it still uses cache (it should since config object is the same)
    if (config.trading_windows) {
      config.trading_windows[0].start = '14:00';
    }

    const originalGetHours = Date.prototype.getUTCHours;
    Date.prototype.getUTCHours = jest.fn().mockReturnValue(10);
    try {
      // Should still return true because it uses cached 08:00-12:00
      expect(gatingService.isInsideTradingWindow(config)).toBe(true);
    } finally {
      Date.prototype.getUTCHours = originalGetHours;
    }
  });
});
