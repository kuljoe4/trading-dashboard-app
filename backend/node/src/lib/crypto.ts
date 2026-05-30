import * as crypto from "crypto";
import { Logger } from "@nestjs/common";

const logger = new Logger("Crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  // We don't want to crash during compilation or when the module is just loaded in some contexts,
  // but we must not allow actual encryption/decryption without a real key.
  logger.warn(
    "⚠️  ENCRYPTION_KEY environment variable is not set. API keys will NOT be encrypted/decrypted correctly.",
  );
}

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is not set. Cannot perform cryptographic operations.",
    );
  }
  // Use a fixed salt for scrypt to ensure the same key is generated from the same environment variable
  return crypto.scryptSync(key, "momentum-engine-salt", 32);
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

export function decrypt(text: string): string {
  const key = getEncryptionKey();
  const parts = text.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Timing-safe string comparison using SHA-256 hashing.
 * Prevents timing attacks and handles differing string lengths securely.
 */
export function safeCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;

  const aHash = crypto.createHash("sha256").update(a).digest();
  const bHash = crypto.createHash("sha256").update(b).digest();

  return crypto.timingSafeEqual(aHash, bHash);
}
