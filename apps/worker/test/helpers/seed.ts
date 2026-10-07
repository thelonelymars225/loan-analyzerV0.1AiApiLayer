import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { View } from "@rater/contracts";
import { documents, newId, ratings, users } from "@rater/db";
import type { Db } from "@rater/db";
import { LocalStorage } from "@rater/storage";

/*
 * Synthetic rows and files for the worker tests. Every name, email and contract is made up.
 */

const FIXTURES = fileURLToPath(
  new URL("../../../../packages/core/test/fixtures/", import.meta.url),
);

/** A synthetic Qiwa PDF from packages/core/test/fixtures (rendered from evals/template). */
export function readFixturePdf(
  id: "fixed-term-bad-s15" | "indefinite-clean" | "not-qiwa" | "wage-mismatch",
): Promise<Buffer> {
  return readFile(path.join(FIXTURES, `${id}.pdf`));
}

export interface TempStorage {
  storage: LocalStorage;
  /** The folder and key, for a worker that opens the same storage from its environment. */
  dir: string;
  encryptionKey: Buffer;
  cleanup(): Promise<void>;
}

/** Encrypted local storage in a fresh temporary folder. */
export async function createTempStorage(): Promise<TempStorage> {
  const dir = await mkdtemp(path.join(tmpdir(), "rater-worker-test-"));
  const encryptionKey = randomBytes(32);
  const storage = new LocalStorage({ dir, encryptionKey });
  return {
    storage,
    dir,
    encryptionKey,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

export async function seedUser(db: Db): Promise<{ userId: string }> {
  const userId = newId("usr");
  await db.insert(users).values({
    id: userId,
    name: "Nour Al-Harbi",
    email: `nour.${userId}@example.com`,
  });
  return { userId };
}

export interface SeedDocumentInput {
  userId: string;
  /** Stored in the bucket unless null (a document whose file is gone). */
  pdf: Buffer | null;
  deleteAfter?: Date;
  deletedAt?: Date | null;
}

/** A document row, and its file in storage, as the API writes them on upload. */
export async function seedDocument(
  db: Db,
  storage: LocalStorage,
  input: SeedDocumentInput,
): Promise<{ documentId: string; storageKey: string }> {
  const documentId = newId("doc");
  const storageKey = `users/${input.userId}/documents/${documentId}.pdf`;
  if (input.pdf) await storage.put(storageKey, input.pdf, "application/pdf");
  await db.insert(documents).values({
    id: documentId,
    userId: input.userId,
    storageKey,
    sha256: "0".repeat(64),
    sizeBytes: input.pdf?.length ?? 0,
    deleteAfter: input.deleteAfter ?? new Date(Date.now() + 30 * 86_400_000),
    deletedAt: input.deletedAt ?? null,
  });
  return { documentId, storageKey };
}

/** An uploaded PDF and its queued rating. */
export async function seedRating(
  db: Db,
  storage: LocalStorage,
  input: SeedDocumentInput & { defaultView?: View },
): Promise<{ ratingId: string; documentId: string; storageKey: string }> {
  const document = await seedDocument(db, storage, input);
  const ratingId = newId("rt");
  await db.insert(ratings).values({
    id: ratingId,
    userId: input.userId,
    documentId: document.documentId,
    defaultView: input.defaultView ?? "employee",
  });
  return { ratingId, ...document };
}
