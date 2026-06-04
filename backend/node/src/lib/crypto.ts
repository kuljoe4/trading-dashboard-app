import * as crypto from "crypto";
import { Logger } from "@nestjs/common";
import { ConfigValidationException } from "./exceptions";

const logger = new Logger("Crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new ConfigValidationException(
      "ENCRYPTION_KEY environment variable is not set. Cannot perform cryptographic operations like API key encryption/decryption.",
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

export function decrypt(text: string | null | undefined): string {
  if (!text) return "";

  const parts = text.split(":");
  if (parts.length !== 3) {
    // If not in iv:tag:encrypted format, assume it's legacy plaintext
    return text;
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
    // If decryption fails, return original text as fallback (legacy compatibility)
    return text;
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
