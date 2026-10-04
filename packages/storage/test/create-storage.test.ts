import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createStorage, LocalStorage, S3Storage } from "../src";

const encryptionKey = randomBytes(32).toString("base64");

describe("createStorage", () => {
  it("defaults to the local driver", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rater-storage-"));
    try {
      const storage = createStorage({
        LOCAL_STORAGE_DIR: dir,
        STORAGE_ENCRYPTION_KEY: encryptionKey,
      });
      expect(storage).toBeInstanceOf(LocalStorage);
      await storage.put("hello.txt", Buffer.from("hi"), "text/plain");
      expect((await storage.get("hello.txt")).toString()).toBe("hi");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("builds the S3 driver", () => {
    const storage = createStorage({ STORAGE_DRIVER: "s3", S3_BUCKET: "contracts" });
    expect(storage).toBeInstanceOf(S3Storage);
  });

  it("refuses the local driver in production without an encryption key", () => {
    expect(() =>
      createStorage({ STORAGE_DRIVER: "local", NODE_ENV: "production" }),
    ).toThrow(/STORAGE_ENCRYPTION_KEY/);
  });

  it("rejects an unknown driver", () => {
    expect(() => createStorage({ STORAGE_DRIVER: "ftp" })).toThrow(
      /Unknown STORAGE_DRIVER/,
    );
  });
});
