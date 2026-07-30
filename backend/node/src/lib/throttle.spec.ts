import { extractIp } from './throttle';

describe('Throttle Library', () => {
  describe('extractIp', () => {
    it('should return default IP when no headers are provided', () => {
      expect(extractIp({}, '1.2.3.4')).toBe('1.2.3.4');
    });

    it('should extract the last IP from a comma-separated x-forwarded-for header', () => {
      const headers = { 'x-forwarded-for': '203.0.113.1, 198.51.100.2' };
      expect(extractIp(headers, '1.2.3.4')).toBe('198.51.100.2');
    });

    it('should handle a single IP in x-forwarded-for header', () => {
      const headers = { 'x-forwarded-for': '203.0.113.1' };
      expect(extractIp(headers, '1.2.3.4')).toBe('203.0.113.1');
    });

    it('should handle multiple x-forwarded-for headers (array case)', () => {
      // In Node.js, multiple headers with the same name are often represented as an array
      const headers = { 'x-forwarded-for': ['1.1.1.1', '2.2.2.2'] };
      // SENTINEL: It should join them and take the last one.
      expect(extractIp(headers, '1.2.3.4')).toBe('2.2.2.2');
    });

    it('should handle multiple x-forwarded-for headers where each is comma-separated', () => {
      const headers = { 'x-forwarded-for': ['1.1.1.1, 2.2.2.2', '3.3.3.3, 4.4.4.4'] };
      expect(extractIp(headers, '1.2.3.4')).toBe('4.4.4.4');
    });

    it('should skip invalid IPs in x-forwarded-for header', () => {
      const headers = { 'x-forwarded-for': 'invalid-ip, 5.5.5.5, malformed' };
      expect(extractIp(headers, '1.2.3.4')).toBe('5.5.5.5');
    });

    it('should prioritize cf-connecting-ip if valid', () => {
      const headers = {
        'cf-connecting-ip': '203.0.113.50',
        'x-real-ip': '198.51.100.2',
        'x-forwarded-for': '1.1.1.1'
      };
      expect(extractIp(headers, '1.2.3.4')).toBe('203.0.113.50');
    });

    it('should prioritize x-real-ip if cf-connecting-ip is missing', () => {
      const headers = {
        'x-real-ip': '198.51.100.2',
        'x-forwarded-for': '1.1.1.1'
      };
      expect(extractIp(headers, '1.2.3.4')).toBe('198.51.100.2');
    });

    it('should ignore malformed/invalid cf-connecting-ip or x-real-ip and fall back', () => {
      const headers = {
        'cf-connecting-ip': 'invalid-ip-format',
        'x-real-ip': 'not-a-valid-ip',
        'x-forwarded-for': '198.51.100.5'
      };
      expect(extractIp(headers, '1.2.3.4')).toBe('198.51.100.5');
    });

    it('should ignore cf-connecting-ip or x-real-ip if too long and fall back', () => {
      const headers = {
        'cf-connecting-ip': '203.0.113.50' + 'a'.repeat(50),
        'x-real-ip': '198.51.100.2',
        'x-forwarded-for': '198.51.100.5'
      };
      // should skip cfIp because of length constraint, and return valid realIp
      expect(extractIp(headers, '1.2.3.4')).toBe('198.51.100.2');
    });

    it('should handle array formats for cf-connecting-ip and x-real-ip', () => {
      const headers = {
        'cf-connecting-ip': ['203.0.113.80', '203.0.113.90'],
        'x-real-ip': ['198.51.100.10', '198.51.100.20'],
      };
      expect(extractIp(headers, '1.2.3.4')).toBe('203.0.113.80');
    });
  });
});
