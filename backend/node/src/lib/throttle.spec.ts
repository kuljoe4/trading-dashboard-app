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
      const headers = { 'x-forwarded-for': ['spoofed.ip.1', 'reliable.ip.2'] };
      expect(extractIp(headers, '1.2.3.4')).toBe('reliable.ip.2');
    });

    it('should handle multiple x-forwarded-for headers where each is comma-separated', () => {
      const headers = { 'x-forwarded-for': ['ip1, ip2', 'ip3, ip4'] };
      expect(extractIp(headers, '1.2.3.4')).toBe('ip4');
    });

    it('should fallback to defaultIp if x-forwarded-for is empty after trimming', () => {
      const headers = { 'x-forwarded-for': ' , ' };
      expect(extractIp(headers, '1.2.3.4')).toBe('1.2.3.4');
    });
  });
});
