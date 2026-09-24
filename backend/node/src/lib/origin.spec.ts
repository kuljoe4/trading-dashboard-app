import { checkOrigin } from './origin';

describe('checkOrigin', () => {
  it('should return false for invalid origins', () => {
    expect(checkOrigin(null, ['http://localhost'])).toBe(false);
    expect(checkOrigin(undefined, ['http://localhost'])).toBe(false);
    expect(checkOrigin(123, ['http://localhost'])).toBe(false);
    expect(checkOrigin({}, ['http://localhost'])).toBe(false);
    expect(checkOrigin('', ['http://localhost'])).toBe(false);
  });

  it('should return false if origin length exceeds 512 characters', () => {
    const longOrigin = 'http://' + 'a'.repeat(506); // 513 chars
    expect(checkOrigin(longOrigin, ['http://localhost'])).toBe(false);
  });

  it('should match exact origins case-insensitively', () => {
    expect(checkOrigin('http://localhost:3000', ['http://localhost:3000'])).toBe(true);
    expect(checkOrigin('HTTP://LOCALHOST:3000', ['http://localhost:3000'])).toBe(true);
    expect(checkOrigin('http://localhost:3000', ['HTTP://LOCALHOST:3000'])).toBe(true);
  });

  it('should handle trailing slashes on both origin and patterns', () => {
    expect(checkOrigin('http://localhost:3000/', ['http://localhost:3000'])).toBe(true);
    expect(checkOrigin('http://localhost:3000', ['http://localhost:3000/'])).toBe(true);
    expect(checkOrigin('http://localhost:3000/', ['http://localhost:3000/'])).toBe(true);
  });

  it('should correctly strip quotes from allowed origin patterns', () => {
    expect(checkOrigin('http://localhost:3000', ['"http://localhost:3000"'])).toBe(true);
    expect(checkOrigin('http://localhost:3000', ["'http://localhost:3000'"])).toBe(true);
    // Unbalanced quotes
    expect(checkOrigin('http://localhost:3000', ['"http://localhost:3000'])).toBe(true);
    expect(checkOrigin('http://localhost:3000', ["http://localhost:3000'"])).toBe(true);
  });

  it('should match using wildcards', () => {
    expect(checkOrigin('https://api.example.com', ['https://*.example.com'])).toBe(true);
    expect(checkOrigin('https://sub.api.example.com', ['https://*.example.com'])).toBe(true);
    expect(checkOrigin('https://example.com', ['https://*.example.com'])).toBe(false);
  });

  it('should reject non-matching origins', () => {
    expect(checkOrigin('https://attacker.com', ['https://example.com'])).toBe(false);
    expect(checkOrigin('https://example.com.attacker.com', ['https://example.com'])).toBe(false);
  });
});
