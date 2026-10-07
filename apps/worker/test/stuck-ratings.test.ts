import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RATE_QUEUE_OPTIONS } from "@rater/contracts";
import type { RatingStatus } from "@rater/contracts";
import { ratings } from "@rater/db";
import type { Db } from "@rater/db";
import type { LocalStorage } from "@rater/storage";
import {
  failStuckRatings,
  STUCK_QUEUED_MS,
  STUCK_RUNNING_MS,
  TIMEOUT_MESSAGE,
} from "../src/stuck-ratings";
import { createTempStorage, seedUser, seedRating } from "./helpers/seed";
import { createTestDatabase, DATABASE_URL } from "./helpers/test-db";
import type { TestDatabase } from "./helpers/test-db";

const logger = pino({ level: "silent" });
const MINUTE = 60_000;

describe("stuck-rating thresholds", () => {
  it("never times out an attempt pg-boss may still be running", () => {
    // Each attempt sets started_at again and is stopped by pg-boss after expireInSeconds.
    expect(STUCK_RUNNING_MS).toBeGreaterThan(RATE_QUEUE_OPTIONS.expireInSeconds * 1000);
    expect(STUCK_QUEUED_MS).toBeGreaterThan(STUCK_RUNNING_MS);
  });
});

describe.skipIf(!DATABASE_URL)("failStuckRatings", () => {
  let testDb: TestDatabase;
  let db: Db;
  let storage: LocalStorage;
  let cleanupStorage: () => Promise<void>;
  let owner: { userId: string };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    ({ storage, cleanup: cleanupStorage } = await createTempStorage());
    owner = await seedUser(db);
  }, 60_000);

  afterAll(async () => {
    await testDb?.drop();
    await cleanupStorage?.();
  }, 60_000);

  /** A rating in `status`, created and started `ageMs` before `now`. */
  async function ratingIn(status: RatingStatus, ageMs: number, now: Date) {
    const { ratingId } = await seedRating(db, storage, { ...owner, pdf: null });
    const since = new Date(now.getTime() - ageMs);
    await db
      .update(ratings)
      .set({ status, createdAt: since, startedAt: status === "queued" ? null : since })
      .where(eq(ratings.id, ratingId));
    return ratingId;
  }

  async function ratingRow(ratingId: string) {
    const [row] = await db.select().from(ratings).where(eq(ratings.id, ratingId));
    return row;
  }

  it("fails ratings running for over an hour or queued for over a day", async () => {
    const now = new Date();
    const extracting = await ratingIn("extracting", STUCK_RUNNING_MS + MINUTE, now);
    const analysing = await ratingIn("analysing", STUCK_RUNNING_MS + MINUTE, now);
    const queued = await ratingIn("queued", STUCK_QUEUED_MS + MINUTE, now);

    expect(await failStuckRatings({ db, logger, now })).toBe(3);
    for (const ratingId of [extracting, analysing, queued]) {
      expect(await ratingRow(ratingId)).toMatchObject({
        status: "failed",
        errorCode: "timeout",
        error: TIMEOUT_MESSAGE,
        finishedAt: now,
      });
    }
  });

  it("leaves ratings that are still within their time, or already finished", async () => {
    const now = new Date();
    const untouched = [
      await ratingIn("extracting", STUCK_RUNNING_MS - MINUTE, now),
      await ratingIn("analysing", STUCK_RUNNING_MS - MINUTE, now),
      // Queued for hours: the worker may be catching up after downtime.
      await ratingIn("queued", STUCK_RUNNING_MS + MINUTE, now),
      await ratingIn("done", STUCK_QUEUED_MS + MINUTE, now),
      await ratingIn("needs_review", STUCK_QUEUED_MS + MINUTE, now),
    ];
    const before = await Promise.all(untouched.map(ratingRow));

    expect(await failStuckRatings({ db, logger, now })).toBe(0);
    expect(await Promise.all(untouched.map(ratingRow))).toEqual(before);
  });

  it("does not touch a rating that already failed for another reason", async () => {
    const now = new Date();
    const ratingId = await ratingIn("failed", STUCK_QUEUED_MS + MINUTE, now);
    await db
      .update(ratings)
      .set({ errorCode: "internal" })
      .where(eq(ratings.id, ratingId));

    expect(await failStuckRatings({ db, logger, now })).toBe(0);
    expect(await ratingRow(ratingId)).toMatchObject({ errorCode: "internal" });
  });
});
