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
});
