import { roundTo, floorStep } from '../lib/math';

describe('Math Performance & Correctness', () => {
  const iterations = 100000;
  const testValue = 123.456789;

  function oldRoundTo(value: number, decimals: number): number {
    return Number(value.toFixed(decimals));
  }

  function oldFloorStep(value: number, step: number): number {
    if (!step || step === 0) return value;
    const precision = Math.log10(1 / step);
    if (precision <= 0) return Math.floor(value / step) * step;
    return Number((Math.floor(value / step) * step).toFixed(Math.max(0, Math.floor(precision))));
  }

  describe('Correctness', () => {
    it('roundTo matches toFixed behavior for positive numbers', () => {
      expect(roundTo(1.234, 2)).toBe(1.23);
      expect(roundTo(1.235, 2)).toBe(1.24);
      expect(roundTo(1.236, 2)).toBe(1.24);
    });

    it('roundTo handles floating point precision errors', () => {
      // 0.1 + 0.2 is 0.30000000000000004
      expect(roundTo(0.1 + 0.2, 1)).toBe(0.3);
    });

    it('floorStep matches old implementation for common exchange filters', () => {
      const cases = [
        { val: 1.234567, step: 0.01, expected: 1.23 },
        { val: 100.9, step: 1, expected: 100 },
        { val: 0.000789, step: 0.0001, expected: 0.0007 },
        { val: 1.23999, step: 0.05, expected: 1.20 },
      ];

      for (const { val, step, expected } of cases) {
        expect(floorStep(val, step)).toBe(expected);
        expect(floorStep(val, step)).toBe(oldFloorStep(val, step));
      }
    });
  });

});
