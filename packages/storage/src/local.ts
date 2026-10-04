import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { decrypt, encrypt, KEY_BYTES, loadEncryptionKey } from "./encryption";
import { assertValidKey } from "./keys";
import { ObjectNotFoundError } from "./types";
import type { ObjectStorage } from "./types";

export const DEFAULT_LOCAL_STORAGE_DIR = "./.data/storage";

export interface LocalStorageOptions {
  /** Root folder. Relative paths resolve against the working directory. */
  dir: string;
  /** 32-byte AES-256-GCM key. */
  encryptionKey: Buffer;
}

/**
 * Stores each object as an encrypted file under `dir`, at the path given by its key.
 * For development and single-machine pilots; production uses S3Storage.
 */
export class LocalStorage implements ObjectStorage {
  private readonly root: string;
  private readonly encryptionKey: Buffer;

  constructor(options: LocalStorageOptions) {
    if (options.encryptionKey.length !== KEY_BYTES) {
      throw new Error(`LocalStorage needs a ${KEY_BYTES}-byte encryption key`);
    }
    this.root = path.resolve(options.dir);
    this.encryptionKey = options.encryptionKey;
  }

  /** Reads LOCAL_STORAGE_DIR and STORAGE_ENCRYPTION_KEY. */
  static fromEnv(env: NodeJS.ProcessEnv): LocalStorage {
    return new LocalStorage({
      dir: env.LOCAL_STORAGE_DIR || DEFAULT_LOCAL_STORAGE_DIR,
      encryptionKey: loadEncryptionKey(env),
    });
  }

  /** The content type is not stored: `get` returns bytes only, and every upload is a PDF. */
  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const file = this.pathFor(key);
    const sealed = encrypt(body, this.encryptionKey, key);
    await mkdir(path.dirname(file), { recursive: true });

    // Write a temporary file and rename it, so a crash never leaves a half-written object.
    // Keys cannot start with ".", so the temporary name never collides with a real key.
    const temp = path.join(
      path.dirname(file),
      `.${path.basename(file)}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temp, sealed, { mode: 0o600 });
      await rename(temp, file);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async get(key: string): Promise<Buffer> {
    const file = this.pathFor(key);
    let sealed: Buffer;
    try {
      sealed = await readFile(file);
    } catch (error) {
      if (isNotFound(error)) throw new ObjectNotFoundError(key);
      throw error;
    }
    return decrypt(sealed, this.encryptionKey, key);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    assertValidKey(key);
    const file = path.resolve(this.root, key);
    // assertValidKey already rules out escaping the root; this is a second, independent check.
    if (!file.startsWith(this.root + path.sep)) {
      throw new Error(`Storage key resolves outside the storage folder: ${key}`);
    }
    return file;
  }
}

function isNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
