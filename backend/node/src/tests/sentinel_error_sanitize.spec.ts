import { sanitize } from '../lib/logger';

describe('Sentinel: Error Sanitization', () => {
  it('should mask sensitive info in Error messages', () => {
    const error = new Error('Failed to connect with api_key=secret123');
    const sanitized = sanitize(error);

    expect(sanitized.message).toBeDefined();
    expect(sanitized.message).not.toContain('secret123');
    expect(sanitized.message).toContain('[MASKED]');
  });

  it('should mask sensitive info in Error stacks', () => {
    const error = new Error('Error with password=mypass');
    const sanitized = sanitize(error);

    expect(sanitized.stack).toBeDefined();
    expect(sanitized.stack).not.toContain('mypass');
  });
});
