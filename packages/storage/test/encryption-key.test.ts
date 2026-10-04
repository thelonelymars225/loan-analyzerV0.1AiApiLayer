import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

/** A fresh copy of the module, so the "warn once" state starts clean in each test. */
async function freshLoadEncryptionKey() {
  vi.resetModules();
  const module = await import("../src/encryption");
  return module.loadEncryptionKey;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadEncryptionKey", () => {
  it("decodes a base64 key of 32 bytes", async () => {
    const loadEncryptionKey = await freshLoadEncryptionKey();
    const key = randomBytes(32);
    expect(loadEncryptionKey({ STORAGE_ENCRYPTION_KEY: key.toString("base64") })).toEqual(
      key,
    );
  });

  it("rejects a key of the wrong length", async () => {
    const loadEncryptionKey = await freshLoadEncryptionKey();
    const short = randomBytes(16).toString("base64");
    expect(() => loadEncryptionKey({ STORAGE_ENCRYPTION_KEY: short })).toThrow(
      /32 bytes/,
    );
  });

  it("refuses to start in production without a key", async () => {
    const loadEncryptionKey = await freshLoadEncryptionKey();
    expect(() => loadEncryptionKey({ NODE_ENV: "production" })).toThrow(
      /required in production/,
    );
  });

  it("falls back to a stable development key and warns only once", async () => {
    const loadEncryptionKey = await freshLoadEncryptionKey();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = loadEncryptionKey({ NODE_ENV: "development" });
    const second = loadEncryptionKey({});
    expect(first).toHaveLength(32);
    expect(second).toEqual(first);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/insecure development key/);
  });
});
