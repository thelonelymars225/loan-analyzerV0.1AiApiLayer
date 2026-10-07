/**
 * Where uploaded PDFs live. Postgres only keeps the key.
 * Keys are app-generated paths such as "users/<userId>/documents/<documentId>.pdf"
 * (see `assertValidKey` for the exact rules).
 */
export interface ObjectStorage {
  /** Stores `body` under `key`, replacing any existing object. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Reads the object. Throws ObjectNotFoundError when there is none. */
  get(key: string): Promise<Buffer>;
  /** Removes the object. Deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  override readonly name = "ObjectNotFoundError";

  constructor(readonly key: string) {
    super(`No stored object for key "${key}"`);
  }
}

/** The stored bytes were changed, truncated, moved to another key, or written with another key. */
export class StorageIntegrityError extends Error {
  override readonly name = "StorageIntegrityError";

  constructor(readonly key: string) {
    super(`Stored object "${key}" failed its integrity check`);
  }
}

export class InvalidStorageKeyError extends Error {
  override readonly name = "InvalidStorageKeyError";

  constructor(
    readonly key: string,
    reason: string,
  ) {
    super(`Invalid storage key ${JSON.stringify(key)}: ${reason}`);
  }
}
