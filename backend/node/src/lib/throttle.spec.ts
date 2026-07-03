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
      const headers = { 'x-forwarded-for': ['203.0.113.1', '198.51.100.2'] };
      // It should join them and take the last one (and it must be a valid IP).
      expect(extractIp(headers, '1.2.3.4')).toBe('198.51.100.2');
    });

    it('should handle multiple x-forwarded-for headers where each is comma-separated', () => {
      const headers = { 'x-forwarded-for': ['1.1.1.1, 2.2.2.2', '3.3.3.3, 4.4.4.4'] };
      expect(extractIp(headers, '1.2.3.4')).toBe('4.4.4.4');
    });

    it('should validate IPv4 addresses', () => {
      const headers = { 'x-forwarded-for': '127.0.0.1' };
      expect(extractIp(headers, '1.2.3.4')).toBe('127.0.0.1');
    });

    it('should validate IPv6 addresses', () => {
      const headers = { 'x-forwarded-for': '2001:0db8:85a3:0000:0000:8a2e:0370:7334' };
      expect(extractIp(headers, '1.2.3.4')).toBe('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
    });

    it('should fall back to default IP for malformed IP strings', () => {
      const headers = { 'x-forwarded-for': 'not-an-ip' };
      expect(extractIp(headers, '1.2.3.4')).toBe('1.2.3.4');
    });

    it('should fall back to default IP for script tags (XSS attempt)', () => {
      const headers = { 'x-forwarded-for': '<script>alert(1)</script>' };
      expect(extractIp(headers, '1.2.3.4')).toBe('1.2.3.4');
    });

    it('should fall back to default IP for overly long strings (DoS attempt)', () => {
      const headers = { 'x-forwarded-for': 'a'.repeat(1000) };
      expect(extractIp(headers, '1.2.3.4')).toBe('1.2.3.4');
    });

    it('should fall back to default IP for invalid IP formats', () => {
      const headers = { 'x-forwarded-for': '999.999.999.999' };
      expect(extractIp(headers, '1.2.3.4')).toBe('1.2.3.4');
    });
  });
});
