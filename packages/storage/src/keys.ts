import { InvalidStorageKeyError } from "./types";

const MAX_KEY_LENGTH = 512;

/**
 * One path segment: starts with a letter or digit, then letters, digits, ".", "_" or "-".
 * Starting with a letter or digit rules out "." and ".." segments and hidden files.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Keys are relative paths made of safe segments joined by "/". This is an allow-list
 * rather than a search for "..", so absolute paths, backslashes, empty segments and
 * control characters are all rejected too. Both drivers apply it, so a key that works
 * locally also works in S3 and the other way round.
 */
export function assertValidKey(key: string): void {
  if (key.length === 0) {
    throw new InvalidStorageKeyError(key, "it is empty");
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new InvalidStorageKeyError(
      key,
      `it is longer than ${MAX_KEY_LENGTH} characters`,
    );
  }
  for (const segment of key.split("/")) {
    if (!SEGMENT.test(segment)) {
      throw new InvalidStorageKeyError(
        key,
        "use path segments of letters, digits, '.', '_' or '-' separated by '/'",
      );
    }
  }
}
