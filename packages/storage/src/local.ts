import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decrypt, encrypt, KEY_BYTES, loadEncryptionKey } from "./encryption";
import { assertValidKey } from "./keys";
import { ObjectNotFoundError } from "./types";
import type { ObjectStorage } from "./types";

/**
 * The folder used when LOCAL_STORAGE_DIR is not set: `.data/storage` in the repository root.
 * It must not depend on the working directory: `pnpm dev:api` runs in apps/api and
 * `pnpm dev:worker` in apps/worker, and the worker has to find the files the API wrote.
 */
export function defaultLocalStorageDir(): string {
  const thisFolder = path.dirname(fileURLToPath(import.meta.url));
  return path.join(findWorkspaceRoot(thisFolder), ".data", "storage");
}

/** The nearest folder at or above `start` that holds pnpm-workspace.yaml. */
export function findWorkspaceRoot(start: string): string {
  let folder = path.resolve(start);
  while (!existsSync(path.join(folder, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(folder);
    if (parent === folder) {
      throw new Error(
        `No pnpm-workspace.yaml found above ${start}. Set LOCAL_STORAGE_DIR to an absolute path.`,
      );
    }
    folder = parent;
  }
  return folder;
}

export interface LocalStorageOptions {
  /** Root folder. Relative paths resolve against the working directory. */
  dir: string;
  /** 32-byte AES-256-GCM key. */
  encryptionKey: Buffer;
}

/**
 * Stores each object as an encrypted file under `dir`, at the path given by its key.
 */
export class LocalStorage implements ObjectStorage {
  /** The absolute root folder. */
  readonly root: string;
  private readonly encryptionKey: Buffer;

  constructor(options: LocalStorageOptions) {
    if (options.encryptionKey.length !== KEY_BYTES) {
      throw new Error(`LocalStorage needs a ${KEY_BYTES}-byte encryption key`);
    }
    this.root = path.resolve(options.dir);
    this.encryptionKey = options.encryptionKey;
  }

  /**
   * Reads LOCAL_STORAGE_DIR (default: the repository's .data/storage, see
   * defaultLocalStorageDir) and STORAGE_ENCRYPTION_KEY.
   */
  static fromEnv(env: NodeJS.ProcessEnv): LocalStorage {
    return new LocalStorage({
      dir: env.LOCAL_STORAGE_DIR || defaultLocalStorageDir(),
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
