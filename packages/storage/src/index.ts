import { LocalStorage } from "./local";
import type { ObjectStorage } from "./types";

export * from "./types";
export { assertValidKey } from "./keys";
export { loadEncryptionKey } from "./encryption";
export { defaultLocalStorageDir, findWorkspaceRoot, LocalStorage } from "./local";
export type { LocalStorageOptions } from "./local";

/**
 * The storage the API and the worker use: encrypted files on disk. See LocalStorage.fromEnv
 * for the variables.
 */
export function createStorage(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  return LocalStorage.fromEnv(env);
}
