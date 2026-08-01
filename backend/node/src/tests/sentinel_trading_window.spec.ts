import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SessionConfig } from '../models/SessionConfig';
import { GatingService } from '../engine/gating.service';

describe('Sentinel: Trading Window Gating & Input Validation', () => {
  describe('Input Validation (SessionConfig)', () => {
    it('should accept valid trading window arrays', async () => {
      const config = plainToInstance(SessionConfig, {
        trading_windows: [
          { start: '08:00', end: '16:00' },
          { start: '22:00', end: '04:00' },
        ],
      });
      const errors = await validate(config);
      expect(errors.find(e => e.property === 'trading_windows')).toBeUndefined();
    });

    it('should reject trading windows with invalid time formats', async () => {
      const invalidWindows = [
        { start: '25:00', end: '16:00' }, // invalid hour
        { start: '08:60', end: '16:00' }, // invalid minute
        { start: '8:00', end: '16:00' },   // missing leading zero
        { start: '08:00', end: '4pm' },    // non-military format
        { start: '', end: '16:00' },       // empty string
      ];

      for (const win of invalidWindows) {
        const config = plainToInstance(SessionConfig, {
          trading_windows: [win],
        });
        const errors = await validate(config);
        const winError = errors.find(e => e.property === 'trading_windows');
        expect(winError).toBeDefined();
      }
    });

    it('should reject trading windows with incorrect types or missing parameters', async () => {
      const badTypes = [
        { start: 800, end: 1600 },        // numbers instead of strings
        { start: '08:00' },               // missing 'end'
        { end: '16:00' },                 // missing 'start'
        { start: true, end: '16:00' },    // boolean type
      ];

      for (const win of badTypes) {
        const config = plainToInstance(SessionConfig, {
          trading_windows: [win as any],
        });
        const errors = await validate(config);
        const winError = errors.find(e => e.property === 'trading_windows');
        expect(winError).toBeDefined();
      }
    });

    it('should reject trading window arrays exceeding the maximum allowed size', async () => {
      const manyWindows = Array.from({ length: 15 }, () => ({
        start: '08:00',
        end: '12:00',
      }));

      const config = plainToInstance(SessionConfig, {
        trading_windows: manyWindows,
      });
      const errors = await validate(config);
      const winError = errors.find(e => e.property === 'trading_windows');
      expect(winError).toBeDefined();
    });
  });

  describe('Runtime Gating & Defense-in-Depth', () => {
    let gatingService: GatingService;

    beforeEach(() => {
      gatingService = new GatingService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
    });

    it('should defensively bypass and not crash when given completely malformed window elements', () => {
      const config = {
        trading_windows: [
          { start: 1200, end: 1400 },       // Numbers instead of strings
          null,                            // Null element
          { end: '12:00' },                // Missing start
          { start: '08:00', end: '16:00' } // One valid element
        ]
      } as any;

      // Executing this should not crash with TypeError (e.g. replace of undefined)
      expect(() => gatingService.isInsideTradingWindow(config)).not.toThrow();

      // Should still resolve correctly for the valid element
      const result = gatingService.isInsideTradingWindow(config);
      expect(typeof result).toBe('boolean');
    });
  });
});
