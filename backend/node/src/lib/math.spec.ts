import { getPrecision, formatPrice, roundTo, getPrecisionFromString } from './math';

describe('Math Utilities Precision Fix', () => {
  describe('getPrecision', () => {
    it('should return correct precision for various tick sizes', () => {
      expect(getPrecision(0.1)).toBe(1);
      expect(getPrecision(0.01)).toBe(2);
      expect(getPrecision(0.001)).toBe(3);
      expect(getPrecision(0.0001)).toBe(4);
      expect(getPrecision(0.00001)).toBe(5);
      expect(getPrecision(0.000001)).toBe(6);
      expect(getPrecision(0.0000001)).toBe(7);
      expect(getPrecision(0.00000001)).toBe(8);
      expect(getPrecision(1)).toBe(0);
      expect(getPrecision(10)).toBe(0);
    });

    it('should handle edge cases', () => {
      expect(getPrecision(0)).toBe(8);
      expect(getPrecision(-1)).toBe(8);
    });
  });

  describe('formatPrice', () => {
    it('should format numbers correctly without floating point leaks', () => {
      const leakyPrice = 0.6172000000000001;
      const tickSize = 0.00001;
      expect(formatPrice(leakyPrice, tickSize)).toBe('0.61720');

      expect(formatPrice(1.23456789, 0.01)).toBe('1.23');
      expect(formatPrice(1.23456789, 0.0001)).toBe('1.2346'); // toFixed rounds
    });
  });

  describe('getPrecisionFromString', () => {
    it('should return correct precision for strings', () => {
      expect(getPrecisionFromString('0.1')).toBe(1);
      expect(getPrecisionFromString('0.0001')).toBe(4);
      expect(getPrecisionFromString('1')).toBe(0);
      expect(getPrecisionFromString('10.0')).toBe(0);
      expect(getPrecisionFromString('1e-5')).toBe(5);
    });
  });

  describe('roundTo with precision', () => {
      it('should eliminate floating point artifacts', () => {
          const leaky = 0.6172000000000001;
          expect(roundTo(leaky, 5)).toBe(0.61720);
          expect(roundTo(leaky, 5).toString()).toBe('0.6172'); // toString removes trailing zeros if they are 0
      });
  });
});
