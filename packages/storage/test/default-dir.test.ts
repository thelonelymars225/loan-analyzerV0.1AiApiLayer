import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultLocalStorageDir, findWorkspaceRoot, LocalStorage } from "../src";

/** This repository's root: packages/storage/test/ is three folders below it. */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const encryptionKey = randomBytes(32).toString("base64");

describe("defaultLocalStorageDir", () => {
  it("is .data/storage in the repository root", () => {
    expect(defaultLocalStorageDir()).toBe(path.join(REPO_ROOT, ".data", "storage"));
  });

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

  it("still uses LOCAL_STORAGE_DIR when it is set", () => {
    const dir = path.join(tmpdir(), "rater-storage-configured");
    const storage = LocalStorage.fromEnv({
      LOCAL_STORAGE_DIR: dir,
      STORAGE_ENCRYPTION_KEY: encryptionKey,
    });
    expect(storage.root).toBe(dir);
  });
});

describe("findWorkspaceRoot", () => {
  let temp: string;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(tmpdir(), "rater-workspace-"));
  });

  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  it("returns the nearest folder above the start that has pnpm-workspace.yaml", async () => {
    const nested = path.join(temp, "packages", "storage", "src");
    await mkdir(nested, { recursive: true });
    await writeFile(
      path.join(temp, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
    );

    expect(findWorkspaceRoot(nested)).toBe(temp);
    expect(findWorkspaceRoot(temp)).toBe(temp);
  });

  it("asks for LOCAL_STORAGE_DIR when there is no workspace above the start", () => {
    expect(() => findWorkspaceRoot(temp)).toThrow(/LOCAL_STORAGE_DIR/);
  });
});
