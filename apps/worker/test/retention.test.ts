import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, documents } from "@rater/db";
import type { Db } from "@rater/db";
import { ObjectNotFoundError } from "@rater/storage";
import type { LocalStorage, ObjectStorage } from "@rater/storage";
import { sweepExpiredDocuments } from "../src/retention";
import { createTempStorage, seedDocument, seedOrg } from "./helpers/seed";
import { createTestDatabase, DATABASE_URL } from "./helpers/test-db";
import type { TestDatabase } from "./helpers/test-db";

const logger = pino({ level: "silent" });
const HOUR = 3_600_000;

describe.skipIf(!DATABASE_URL)("sweepExpiredDocuments", () => {
  let testDb: TestDatabase;
  let db: Db;
  let storage: LocalStorage;
  let cleanupStorage: () => Promise<void>;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    ({ storage, cleanup: cleanupStorage } = await createTempStorage());
  }, 60_000);

  afterAll(async () => {
    await testDb?.drop();
    await cleanupStorage?.();
  }, 60_000);

  const pdf = Buffer.from("%PDF-1.7 synthetic test file");

  async function documentRow(id: string) {
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    return row;
  }

  async function fileExists(key: string): Promise<boolean> {
    try {
      await storage.get(key);
      return true;
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return false;
      throw error;
    }
  }

  it("deletes expired files only, records deleted_at and audits each deletion", async () => {
    const now = new Date();
    const org = await seedOrg(db);
    const expired = await seedDocument(db, storage, {
      ...org,
      pdf,
      deleteAfter: new Date(now.getTime() - HOUR),
    });
    const kept = await seedDocument(db, storage, {
      ...org,
      pdf,
      deleteAfter: new Date(now.getTime() + HOUR),
    });

    const result = await sweepExpiredDocuments({ db, storage, logger, now });
    expect(result).toEqual({ deleted: 1, failed: 0 });

    expect(await fileExists(expired.storageKey)).toBe(false);
    expect((await documentRow(expired.documentId))?.deletedAt?.getTime()).toBe(
      now.getTime(),
    );
    expect(await fileExists(kept.storageKey)).toBe(true);
    expect((await documentRow(kept.documentId))?.deletedAt).toBeNull();

    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, expired.documentId));
    expect(audit).toEqual([
      expect.objectContaining({
        orgId: org.orgId,
        userId: null,
        action: "auto_delete",
        targetId: expired.documentId,
      }),
    ]);
  });

  it("is idempotent: a second sweep deletes and audits nothing more", async () => {
    const now = new Date();
    const org = await seedOrg(db);
    const expired = await seedDocument(db, storage, {
      ...org,
      pdf,
      deleteAfter: new Date(now.getTime() - HOUR),
    });

    await sweepExpiredDocuments({ db, storage, logger, now });
    expect(await sweepExpiredDocuments({ db, storage, logger, now })).toEqual({
      deleted: 0,
      failed: 0,
    });
    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, expired.documentId));
    expect(audit).toHaveLength(1);
  });

  it("marks a document deleted even when its file is already gone", async () => {
    const now = new Date();
    const org = await seedOrg(db);
    const missing = await seedDocument(db, storage, {
      ...org,
      pdf: null,
      deleteAfter: new Date(now.getTime() - HOUR),
    });
    const result = await sweepExpiredDocuments({ db, storage, logger, now });
    expect(result.deleted).toBe(1);
    expect((await documentRow(missing.documentId))?.deletedAt).not.toBeNull();
  });

  it("leaves a document for the next sweep when storage fails", async () => {
    const now = new Date();
    const org = await seedOrg(db);
    const stuck = await seedDocument(db, storage, {
      ...org,
      pdf,
      deleteAfter: new Date(now.getTime() - HOUR),
    });
    const failingStorage: ObjectStorage = {
      put: (key, body, type) => storage.put(key, body, type),
      get: (key) => storage.get(key),
      delete: async () => {
        throw new Error("bucket unavailable");
      },
    };

    const result = await sweepExpiredDocuments({
      db,
      storage: failingStorage,
      logger,
      now,
    });
    expect(result).toEqual({ deleted: 0, failed: 1 });
    expect((await documentRow(stuck.documentId))?.deletedAt).toBeNull();
    expect(await fileExists(stuck.storageKey)).toBe(true);

    expect(await sweepExpiredDocuments({ db, storage, logger, now })).toEqual({
      deleted: 1,
      failed: 0,
    });
  });
});
