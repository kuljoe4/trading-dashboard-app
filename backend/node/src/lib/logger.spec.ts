import { sanitize } from './logger';

describe('Logger Sanitization', () => {
  it('should mask existing sensitive fields', () => {
    const input = {
      api_key: 'secret123',
      password: 'password123',
      token: 'jwt-token-here',
      auth: 'Bearer xyz',
      secret: 'my-secret'
    };
    const expected = {
      api_key: '[MASKED]',
      password: '[MASKED]',
      token: '[MASKED]',
      auth: '[MASKED]',
      secret: '[MASKED]'
    };
    const result = sanitize(input);
    expect(result).toEqual(expected);
  });

  it('should mask newly added sensitive fields', () => {
    const input = {
      salt: 'salty-value',
      user_hash: 'hashed-password',
      master_key: 'master-secret',
      pkey: 'private-key-data',
      client_cert: 'certificate-content',
      otp_code: '123456',
      pin: '9999',
      user_ssn: '000-00-0000',
      cvv: '123',
      creditcard_number: '1111222233334444'
    };
    const expected = {
      salt: '[MASKED]',
      user_hash: '[MASKED]',
      master_key: '[MASKED]',
      pkey: '[MASKED]',
      client_cert: '[MASKED]',
      otp_code: '[MASKED]',
      pin: '[MASKED]',
      user_ssn: '[MASKED]',
      cvv: '[MASKED]',
      creditcard_number: '[MASKED]'
    };
    const result = sanitize(input);
    expect(result).toEqual(expected);
  });

  it('should recursively mask nested objects', () => {
    const input = {
      user: {
        name: 'John Doe',
        metadata: {
          pin_code: '1234',
          secret_salt: 'pepper'
        }
      },
      tags: ['public', 'private-salt']
    };
    const result = sanitize(input);
    expect(result.user.metadata.pin_code).toBe('[MASKED]');
    expect(result.user.metadata.secret_salt).toBe('[MASKED]');
    // Note: the string inside the array is not sanitized because it's not a property key
    expect(result.tags[1]).toBe('private-salt');
  });

  it('should handle circular references', () => {
    const input: any = { name: 'circular' };
    input.self = input;
    const result = sanitize(input);
    expect(result.name).toBe('circular');
    expect(result.self).toBe('[Circular]');
  });

  it('should preserve Error identity while sanitizing custom properties', () => {
    const error = new Error('Original Message') as any;
    error.otp = '654321';
    const result = sanitize(error);
    expect(result.name).toBe('Error');
    expect(result.message).toBe('Original Message');
    expect(result.otp).toBe('[MASKED]');
  });
});
