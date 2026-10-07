import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LocalStorage } from "../src";

/** This repository's root: packages/storage/test/ is three folders below it. */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const encryptionKey = randomBytes(32).toString("base64");

describe("defaultLocalStorageDir", () => {
  // Regression: the default used to be "./.data/storage" resolved against the working
  // directory, so under pnpm dev:* the API wrote to apps/api/.data and the worker read from
  // apps/worker/.data, and every rating failed with document_missing.
  it("gives the API and the worker the same folder when LOCAL_STORAGE_DIR is not set", () => {
    const startFolder = process.cwd();
    try {
      process.chdir(path.join(REPO_ROOT, "apps", "api"));
      const api = LocalStorage.fromEnv({ STORAGE_ENCRYPTION_KEY: encryptionKey });
      process.chdir(path.join(REPO_ROOT, "apps", "worker"));
      const worker = LocalStorage.fromEnv({ STORAGE_ENCRYPTION_KEY: encryptionKey });

      expect(api.root).toBe(path.join(REPO_ROOT, ".data", "storage"));
      expect(worker.root).toBe(api.root);
    } finally {
      process.chdir(startFolder);
    }
  });
});
