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
      const headers = { 'x-forwarded-for': ['203.0.113.1, 198.51.100.2', '192.0.2.1, 192.0.2.2'] };
      expect(extractIp(headers, '1.2.3.4')).toBe('192.0.2.2');
    });

    it('should fall back to default IP if the extracted IP is invalid (Log Injection attempt)', () => {
      const headers = { 'x-forwarded-for': '203.0.113.1, <script>alert(1)</script>' };
      expect(extractIp(headers, '1.2.3.4')).toBe('1.2.3.4');
    });

    it('should fall back to default IP if the extracted IP is malformed', () => {
      const headers = { 'x-forwarded-for': '203.0.113.1, not-an-ip' };
      expect(extractIp(headers, '1.2.3.4')).toBe('1.2.3.4');
    });
  });
});
