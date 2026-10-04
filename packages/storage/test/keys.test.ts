import { describe, expect, it } from "vitest";
import { assertValidKey, InvalidStorageKeyError } from "../src";

describe("assertValidKey", () => {
  it.each([
    "orgs/org_01k9f3v8wq/documents/doc_01k9f3v8wq.pdf",
    "a",
    "file.v2.pdf",
    "A-b_c/D.e",
    "a..b/c",
  ])("accepts %j", (key) => {
    expect(() => assertValidKey(key)).not.toThrow();
  });

  it.each([
    ["", "empty"],
    ["../secret", "parent segment"],
    ["orgs/../../etc/passwd", "parent segment in the middle"],
    ["./a", "current-folder segment"],
    ["/etc/passwd", "absolute path"],
    ["a//b", "empty segment"],
    ["a/", "trailing slash"],
    ["a\\..\\b", "backslashes"],
    [".env", "hidden file"],
    ["a/.hidden", "hidden file in a folder"],
    ["a\u0000b", "null byte"],
    ["a b", "space"],
    ["عقد.pdf", "non-ASCII"],
    ["x".repeat(513), "too long"],
  ])("rejects %j (%s)", (key) => {
    expect(() => assertValidKey(key)).toThrow(InvalidStorageKeyError);
  });
});
