import * as crypto from "crypto";
import { Logger } from "@nestjs/common";
import { ConfigValidationException } from "./exceptions";

const logger = new Logger("Crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// SENTINEL: Cache for derived encryption key to prevent CPU-intensive scryptSync on every operation
let cachedKey: Buffer | null = null;
let lastUsedRawKey: string | null = null;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new ConfigValidationException(
      "ENCRYPTION_KEY environment variable is not set. Cannot perform cryptographic operations like API key encryption/decryption.",
    );
  }

  // SENTINEL: If the environment variable matches our cache, return the cached buffer
  if (cachedKey && lastUsedRawKey === key) {
    return cachedKey;
  }

  // SENTINEL: Enforce minimum key length for adequate entropy
  if (key.length < 32) {
    if (key.length < 16) {
      logger.error("CRITICAL: ENCRYPTION_KEY is too short (min 16 chars). Cryptographic operations are at risk.");
      throw new ConfigValidationException("ENCRYPTION_KEY must be at least 16 characters long for security.");
    }
    logger.warn("SECURITY WARNING: ENCRYPTION_KEY is shorter than 32 characters. Consider using a longer key for maximum entropy.");
  }

  // Use a fixed salt for scrypt to ensure the same key is generated from the same environment variable
  const derived = crypto.scryptSync(key, "momentum-engine-salt", 32);

  // Update cache
  cachedKey = derived;
  lastUsedRawKey = key;

  return derived;
}

export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag();

  // Format: iv:tag:encrypted
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

export function decrypt(text: string | null | undefined): string {
  if (!text) return "";

  const parts = text.split(":");
  if (parts.length !== 3) {
    // SENTINEL: Removed legacy plaintext fallback.
    // Invalid formats now return an empty string to prevent accidental data disclosure.
    logger.warn("Rejected decryption request: Invalid data format (expected iv:tag:encrypted)");
    return "";
  }

  // SENTINEL: Validate IV and Tag lengths to prevent malformed buffer exploits
  // IV should be 12 bytes (24 hex chars), Tag should be 16 bytes (32 hex chars)
  if (parts[0].length !== 24 || parts[1].length !== 32) {
    logger.warn(`Rejected malformed encrypted string: Invalid IV or Tag length`);
    return "";
  }

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (e) {
    // SENTINEL: Removed dangerous fallback that returned ciphertext on failure.
    // Returning an empty string or throwing is safer to prevent information leakage
    // or accidental use of ciphertext as plaintext.
    logger.error(`Decryption failed: ${e instanceof Error ? e.message : String(e)}`);
    return "";
  }
}

/**
 * Timing-safe string comparison using SHA-256 hashing.
 * Prevents timing attacks and handles differing string lengths securely.
 */
export function safeCompare(a: string | undefined | null, b: string | undefined | null): boolean {
  // Audit Item 30: Added null/undefined checks
  if (!a || !b) return false;
  if (typeof a !== "string" || typeof b !== "string") return false;

  const aHash = crypto.createHash("sha256").update(a).digest();
  const bHash = crypto.createHash("sha256").update(b).digest();

  return crypto.timingSafeEqual(aHash, bHash);
}
