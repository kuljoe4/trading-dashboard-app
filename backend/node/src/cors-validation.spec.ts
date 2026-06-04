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

  it('should be case sensitive (standard CORS behavior)', () => {
    expect(checkOrigin('https://EXAMPLE.COM', allowedOrigins)).toBe(false);
  });

  it('should handle complex wildcards', () => {
    const complexPatterns = ['https://api-*.service.*.com'];
    expect(checkOrigin('https://api-v1.service.prod.com', complexPatterns)).toBe(true);
    expect(checkOrigin('https://api-v2.service.staging.com', complexPatterns)).toBe(true);
    expect(checkOrigin('https://api.service.prod.com', complexPatterns)).toBe(false);
  });
});
