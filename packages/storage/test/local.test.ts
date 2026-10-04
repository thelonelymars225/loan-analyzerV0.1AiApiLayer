import { randomBytes } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  copyFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InvalidStorageKeyError,
  LocalStorage,
  ObjectNotFoundError,
  StorageIntegrityError,
} from "../src";

const KEY = "orgs/org_test/documents/doc_test.pdf";
const PDF = Buffer.from("%PDF-1.7\nSynthetic contract for Example Trading Co.\n%%EOF\n");

let dir: string;
let storage: LocalStorage;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "rater-storage-"));
  storage = new LocalStorage({ dir, encryptionKey: randomBytes(32) });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("LocalStorage", () => {
  it("returns exactly the bytes that were stored", async () => {
    await storage.put(KEY, PDF, "application/pdf");
    expect(await storage.get(KEY)).toEqual(PDF);
  });

  it("round-trips empty and binary bodies", async () => {
    const binary = randomBytes(64 * 1024);
    await storage.put("empty", Buffer.alloc(0), "application/octet-stream");
    await storage.put("binary.bin", binary, "application/octet-stream");
    expect(await storage.get("empty")).toEqual(Buffer.alloc(0));
    expect(await storage.get("binary.bin")).toEqual(binary);
  });

  it("encrypts the file on disk", async () => {
    await storage.put(KEY, PDF, "application/pdf");
    const onDisk = await readFile(path.join(dir, KEY));
    expect(onDisk.includes(Buffer.from("Example Trading"))).toBe(false);
    expect(onDisk.includes(Buffer.from("%PDF"))).toBe(false);
  });

  it("replaces an existing object and leaves no temporary files", async () => {
    await storage.put(KEY, PDF, "application/pdf");
    await storage.put(KEY, Buffer.from("second version"), "application/pdf");
    expect((await storage.get(KEY)).toString()).toBe("second version");
    expect(await readdir(path.dirname(path.join(dir, KEY)))).toEqual(["doc_test.pdf"]);
  });

  it("detects a changed byte in the ciphertext", async () => {
    await storage.put(KEY, PDF, "application/pdf");
    const file = path.join(dir, KEY);
    const sealed = await readFile(file);
    const last = sealed.length - 1;
    sealed[last] = (sealed[last] ?? 0) ^ 0x01;
    await writeFile(file, sealed);
    await expect(storage.get(KEY)).rejects.toThrow(StorageIntegrityError);
  });

  it("detects a truncated or foreign file", async () => {
    await mkdir(path.join(dir, "orgs"), { recursive: true });
    await writeFile(path.join(dir, "orgs", "plain.pdf"), PDF);
    await writeFile(path.join(dir, "short"), Buffer.from("RSE1"));
    await expect(storage.get("orgs/plain.pdf")).rejects.toThrow(StorageIntegrityError);
    await expect(storage.get("short")).rejects.toThrow(StorageIntegrityError);
  });

  it("rejects a file copied to another key's path", async () => {
    await storage.put(KEY, PDF, "application/pdf");
    await storage.put("other.pdf", Buffer.from("other"), "application/pdf");
    await copyFile(path.join(dir, KEY), path.join(dir, "other.pdf"));
    await expect(storage.get("other.pdf")).rejects.toThrow(StorageIntegrityError);
  });

  it("cannot read files written with a different encryption key", async () => {
    await storage.put(KEY, PDF, "application/pdf");
    const other = new LocalStorage({ dir, encryptionKey: randomBytes(32) });
    await expect(other.get(KEY)).rejects.toThrow(StorageIntegrityError);
  });

  it("throws ObjectNotFoundError for a missing key", async () => {
    await expect(storage.get("missing.pdf")).rejects.toThrow(ObjectNotFoundError);
    await expect(storage.get("missing/deeper/file.pdf")).rejects.toThrow(
      ObjectNotFoundError,
    );
  });

  it("deletes objects, and deleting twice or deleting a missing key is fine", async () => {
    await storage.put(KEY, PDF, "application/pdf");
    await storage.delete(KEY);
    await expect(storage.get(KEY)).rejects.toThrow(ObjectNotFoundError);
    await expect(storage.delete(KEY)).resolves.toBeUndefined();
    await expect(storage.delete("never/stored.pdf")).resolves.toBeUndefined();
  });

  it("rejects keys that would leave the storage folder, before touching the disk", async () => {
    const outside = path.join(path.dirname(dir), "escaped.txt");
    for (const key of ["../escaped.txt", "a/../../escaped.txt", outside]) {
      await expect(storage.put(key, PDF, "application/pdf")).rejects.toThrow(
        InvalidStorageKeyError,
      );
      await expect(storage.get(key)).rejects.toThrow(InvalidStorageKeyError);
      await expect(storage.delete(key)).rejects.toThrow(InvalidStorageKeyError);
    }
    await expect(readFile(outside)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses an encryption key of the wrong length", () => {
    expect(() => new LocalStorage({ dir, encryptionKey: randomBytes(16) })).toThrow(
      /32-byte/,
    );
  });
});
