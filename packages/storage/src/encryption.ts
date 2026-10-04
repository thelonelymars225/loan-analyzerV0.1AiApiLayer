import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { StorageIntegrityError } from "./types";

/**
 * File format of the local driver, version 1:
 *
 *   "RSE1" (4 bytes) | IV (12 bytes) | GCM auth tag (16 bytes) | ciphertext
 *
 * AES-256-GCM with a fresh random IV per write. The object key is bound in as additional
 * authenticated data, so a file copied to another key's path fails to decrypt.
 */

export const KEY_BYTES = 32;
const MAGIC = Buffer.from("RSE1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES + TAG_BYTES;

export function encrypt(
  plaintext: Buffer,
  encryptionKey: Buffer,
  objectKey: string,
): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  cipher.setAAD(Buffer.from(objectKey, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decrypt(
  sealed: Buffer,
  encryptionKey: Buffer,
  objectKey: string,
): Buffer {
  if (sealed.length < HEADER_BYTES || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new StorageIntegrityError(objectKey);
  }
  const iv = sealed.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = sealed.subarray(MAGIC.length + IV_BYTES, HEADER_BYTES);
  const ciphertext = sealed.subarray(HEADER_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv);
    decipher.setAAD(Buffer.from(objectKey, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new StorageIntegrityError(objectKey);
  }
}

let warnedAboutDevKey = false;

/**
 * Reads STORAGE_ENCRYPTION_KEY (32 random bytes, base64; `openssl rand -base64 32`).
 * Production refuses to start without it. Elsewhere a fixed development key is used,
 * with one warning per process, so `pnpm dev` works with no setup.
 */
export function loadEncryptionKey(env: NodeJS.ProcessEnv): Buffer {
  const configured = env.STORAGE_ENCRYPTION_KEY?.trim();
  if (configured) {
    const key = Buffer.from(configured, "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `STORAGE_ENCRYPTION_KEY must be ${KEY_BYTES} bytes encoded as base64 ` +
          `(got ${key.length} bytes). Generate one with: openssl rand -base64 32`,
      );
    }
    return key;
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      "STORAGE_ENCRYPTION_KEY is required in production for the local storage driver. " +
        "Generate one with: openssl rand -base64 32",
    );
  }
  if (!warnedAboutDevKey) {
    warnedAboutDevKey = true;
    console.warn(
      "[storage] STORAGE_ENCRYPTION_KEY is not set; using an insecure development key. " +
        "Never use this setup with real contracts.",
    );
  }
  return createHash("sha256")
    .update("contract-rater/local-storage/development-only")
    .digest();
}
