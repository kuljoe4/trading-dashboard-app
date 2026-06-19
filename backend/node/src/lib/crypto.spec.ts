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
    process.env.ENCRYPTION_KEY = 'valid-encryption-key-12345678901234567890';
    const invalidFormat = '123:456:789';
    expect(decrypt(invalidFormat)).toBe('');
  });

  it('should NO LONGER support legacy plaintext for non-formatted strings', () => {
    const plaintext = 'legacy-data';
    expect(decrypt(plaintext)).toBe('');
  });

  it('should cache derived keys and update if ENCRYPTION_KEY changes', () => {
    const key1 = 'first-encryption-key-long-enough-32-chars';
    const key2 = 'second-encryption-key-long-enough-32-chars';

    process.env.ENCRYPTION_KEY = key1;
    const encrypted1 = encrypt('data1');
    expect(decrypt(encrypted1)).toBe('data1');

    process.env.ENCRYPTION_KEY = key2;
    const encrypted2 = encrypt('data2');
    expect(decrypt(encrypted2)).toBe('data2');

    // Decrypting data1 with key2 should fail
    expect(decrypt(encrypted1)).toBe('');

    // Decrypting data2 with key2 should still work
    expect(decrypt(encrypted2)).toBe('data2');
  });
});
