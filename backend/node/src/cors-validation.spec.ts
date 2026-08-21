import { checkOrigin } from './lib/origin';

describe('checkOrigin', () => {
  const allowedOrigins = [
    'http://localhost:5173',
    'https://*.up.railway.app',
    'https://example.com'
  ];

  it('should allow exact matches', () => {
    expect(checkOrigin('http://localhost:5173', allowedOrigins)).toBe(true);
    expect(checkOrigin('https://example.com', allowedOrigins)).toBe(true);
  });

  it('should allow wildcard matches', () => {
    expect(checkOrigin('https://frontend-staging-f45a.up.railway.app', allowedOrigins)).toBe(true);
    expect(checkOrigin('https://another-site.up.railway.app', allowedOrigins)).toBe(true);
  });

  it('should handle trailing slashes in origin', () => {
    expect(checkOrigin('http://localhost:5173/', allowedOrigins)).toBe(true);
    expect(checkOrigin('https://frontend-staging-f45a.up.railway.app/', allowedOrigins)).toBe(true);
  });

  it('should handle trailing slashes in patterns', () => {
    const patternsWithSlash = ['https://*.example.org/'];
    expect(checkOrigin('https://test.example.org', patternsWithSlash)).toBe(true);
    expect(checkOrigin('https://test.example.org/', patternsWithSlash)).toBe(true);
  });

  it('should block unauthorized origins', () => {
    expect(checkOrigin('https://malicious.com', allowedOrigins)).toBe(false);
    expect(checkOrigin('http://up.railway.app', allowedOrigins)).toBe(false); // Wrong protocol
    expect(checkOrigin('https://up.railway.app', allowedOrigins)).toBe(false); // Missing subdomain for *.up.railway.app
  });

  it('should be case insensitive (hostnames are case-insensitive)', () => {
    expect(checkOrigin('https://EXAMPLE.COM', allowedOrigins)).toBe(true);
  });

  it('should handle complex wildcards', () => {
    const complexPatterns = ['https://api-*.service.*.com'];
    expect(checkOrigin('https://api-v1.service.prod.com', complexPatterns)).toBe(true);
    expect(checkOrigin('https://api-v2.service.staging.com', complexPatterns)).toBe(true);
    expect(checkOrigin('https://api.service.prod.com', complexPatterns)).toBe(false);
  });

  it('should handle quoted patterns from environment variables', () => {
    const quotedPatterns = ['"https://*.up.railway.app"', "'http://localhost:5173'"];
    expect(checkOrigin('https://frontend-staging.up.railway.app', quotedPatterns)).toBe(true);
    expect(checkOrigin('http://localhost:5173', quotedPatterns)).toBe(true);
  });

  it('should handle whitespace in patterns', () => {
    const messyPatterns = ['  https://example.com  ', ' https://*.example.org '];
    expect(checkOrigin('https://example.com', messyPatterns)).toBe(true);
    expect(checkOrigin('https://test.example.org', messyPatterns)).toBe(true);
  });

  it('should block malicious bypass attempts using permissive wildcards', () => {
    const wildcardPatterns = ['https://*.example.com'];

    // Path injection: would match if using .*
    expect(checkOrigin('https://attacker.com/.example.com', wildcardPatterns)).toBe(false);

    // Query parameter injection: would match if using .*
    expect(checkOrigin('https://attacker.com?q=test.example.com', wildcardPatterns)).toBe(false);

    // Fragment injection: would match if using .*
    expect(checkOrigin('https://attacker.com#test.example.com', wildcardPatterns)).toBe(false);

    // Subdomain with special characters that should be blocked
    expect(checkOrigin('https://sub/folder.example.com', wildcardPatterns)).toBe(false);
  });

  it('should handle null, undefined, non-string, and extremely long origins safely', () => {
    expect(checkOrigin(null, allowedOrigins)).toBe(false);
    expect(checkOrigin(undefined, allowedOrigins)).toBe(false);
    expect(checkOrigin(12345 as any, allowedOrigins)).toBe(false);
    expect(checkOrigin({} as any, allowedOrigins)).toBe(false);

    const extremelyLongOrigin = 'https://' + 'a'.repeat(600) + '.example.com';
    expect(checkOrigin(extremelyLongOrigin, allowedOrigins)).toBe(false);
  });
});
