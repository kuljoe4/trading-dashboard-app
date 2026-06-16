import { encrypt, decrypt } from './crypto';

describe('Crypto Library', () => {
  const originalEnv = process.env.ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-123';
  });

  afterAll(() => {
    process.env.ENCRYPTION_KEY = originalEnv;
  });

  it('should encrypt and decrypt data correctly', () => {
    const text = 'hello world';
    const encrypted = encrypt(text);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(text);
  });

  it('should throw if ENCRYPTION_KEY is not set', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY environment variable is not set');
  });

  it('should throw if ENCRYPTION_KEY is too short', () => {
    process.env.ENCRYPTION_KEY = 'short';
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be at least 16 characters long');
  });

  it('should return empty string on decryption failure for formatted strings', () => {
    process.env.ENCRYPTION_KEY = 'valid-encryption-key-123';
    // Valid format but tampered content or wrong key
    const tampered = '0'.repeat(24) + ':' + '0'.repeat(32) + ':deadbeef';
    expect(decrypt(tampered)).toBe('');
  });

  it('should return empty string on invalid IV or Tag length', () => {
    process.env.ENCRYPTION_KEY = 'valid-encryption-key-123';
    const invalidFormat = '123:456:789';
    expect(decrypt(invalidFormat)).toBe('');
  });

  it('should still support legacy plaintext for non-formatted strings', () => {
    const plaintext = 'legacy-data';
    expect(decrypt(plaintext)).toBe(plaintext);
  });
});
