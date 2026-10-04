import { validationError } from "../errors";

/**
 * Keyset pagination for "newest first": the cursor names the last row of a page by
 * (createdAt, id), encoded as base64url("<ISO createdAt>|<id>"). The next page holds the rows
 * strictly before it in that order.
 */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`).toString(
    "base64url",
  );
}

/** Throws a 400 validation_error for anything this API did not produce. */
export function decodeCursor(value: string): Cursor {
  const text = Buffer.from(value, "base64url").toString("utf8");
  const separator = text.indexOf("|");
  const createdAt = new Date(text.slice(0, separator));
  const id = text.slice(separator + 1);
  if (separator < 0 || Number.isNaN(createdAt.getTime()) || id === "") {
    throw validationError("Invalid cursor.");
  }
  return { createdAt, id };
}
