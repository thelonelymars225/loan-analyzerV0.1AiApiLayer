import { LocalStorage } from "./local";
import { S3Storage } from "./s3";
import type { ObjectStorage } from "./types";

export * from "./types";
export { assertValidKey } from "./keys";
export { loadEncryptionKey } from "./encryption";
export { DEFAULT_LOCAL_STORAGE_DIR, LocalStorage } from "./local";
export type { LocalStorageOptions } from "./local";
export { S3Storage, s3ConfigFromEnv } from "./s3";

/**
 * Picks the driver from STORAGE_DRIVER: "s3" for a bucket, "local" (the default) for
 * encrypted files on disk. See S3Storage.fromEnv and LocalStorage.fromEnv for the variables.
 */
export function createStorage(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  const driver = env.STORAGE_DRIVER?.trim() || "local";
  switch (driver) {
    case "s3":
      return S3Storage.fromEnv(env);
    case "local":
      return LocalStorage.fromEnv(env);
    default:
      throw new Error(`Unknown STORAGE_DRIVER "${driver}": use "s3" or "local"`);
  }
}
