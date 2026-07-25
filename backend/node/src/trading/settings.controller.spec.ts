import { maskApiKey } from './settings.controller';

describe('Sentinel: maskApiKey helper security verification', () => {
  it('should return empty string for non-string, empty, or falsy values', () => {
    expect(maskApiKey(null)).toBe('');
    expect(maskApiKey(undefined)).toBe('');
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey('   ')).toBe('');
    expect(maskApiKey(12345678)).toBe('');
    expect(maskApiKey({})).toBe('');
  });

  it('should completely mask short keys (< 16 chars) to prevent disclosure', () => {
    expect(maskApiKey('abc')).toBe('***');
    expect(maskApiKey('test-key-1')).toBe('********');
    expect(maskApiKey('123456789012345')).toBe('********');
  });

  it('should safely preview keys that are 16 characters or longer', () => {
    // 16 chars key
    expect(maskApiKey('abcdefghijklmnop')).toBe('abcd...mnop');

    // 64 chars standard key
    const standardKey = 'A'.repeat(64);
    expect(maskApiKey(standardKey)).toBe('AAAA...AAAA');
  });
});
