import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QUEUES } from "@rater/contracts";
import type { ArticleLookup } from "@rater/core";
import { ratings } from "@rater/db";
import { loadRules, MemoryArticleLookup } from "@rater/law";
import { HeuristicLlmClient } from "@rater/llm";
import { loadConfig } from "../src/config";
import { PgClauseCache } from "../src/pg-clause-cache";
import { handleRateJob, RETENTION_CRON, runHourlySweep } from "../src/queue";
import type { RateJobDeps } from "../src/rate-job";
import { startWorker } from "../src/worker";
import {
  createTempStorage,
  readFixturePdf,
  seedDocument,
  seedOrg,
  seedRating,
} from "./helpers/seed";
import type { TempStorage } from "./helpers/seed";
import { createTestDatabase, DATABASE_URL } from "./helpers/test-db";
import type { TestDatabase } from "./helpers/test-db";

const logger = pino({ level: "silent" });

describe("handleRateJob", () => {
  it("drops a job without a ratingId instead of retrying it", async () => {
    // No database is touched for an invalid job.
    const deps = { logger } as RateJobDeps;
    const job = { id: "job-1", data: { rating: "rt_1" }, retryCount: 0, retryLimit: 2 };
    expect(await handleRateJob(job, deps)).toBe("invalid_job");
  });
});

describe.skipIf(!DATABASE_URL)("rating jobs against Postgres", () => {
  let testDb: TestDatabase;
  let temp: TempStorage;
  let org: { orgId: string; userId: string };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    temp = await createTempStorage();
    org = await seedOrg(testDb.db);
  }, 60_000);

  afterAll(async () => {
    await testDb?.drop();
    await temp?.cleanup();
  }, 60_000);

  async function status(ratingId: string) {
    const [row] = await testDb.db
      .select({ status: ratings.status, errorCode: ratings.errorCode })
      .from(ratings)
      .where(eq(ratings.id, ratingId));
    return row;
  }

  async function queuedRating(): Promise<string> {
    const { ratingId } = await seedRating(testDb.db, temp.storage, {
      ...org,
      pdf: await readFixturePdf("fixed-term-bad-s15"),
    });
    return ratingId;
  }

  it("marks the rating failed only once retryCount reaches retryLimit", async () => {
    const brokenLookup: ArticleLookup = {
      byRefs: async () => {
        throw new Error("connection reset");
      },
    };
    const deps: RateJobDeps = {
      db: testDb.db,
      storage: temp.storage,
      llm: new HeuristicLlmClient(),
      articles: brokenLookup,
      cache: new PgClauseCache(testDb.db),
      rules: loadRules(),
      logger,
    };
    const ratingId = await queuedRating();
    const attempt = (retryCount: number) =>
      handleRateJob({ id: "job-1", data: { ratingId }, retryCount, retryLimit: 2 }, deps);

    await expect(attempt(0)).rejects.toThrow("connection reset");
    expect(await status(ratingId)).toEqual({ status: "analysing", errorCode: null });
    await expect(attempt(1)).rejects.toThrow("connection reset");
    expect(await status(ratingId)).toEqual({ status: "analysing", errorCode: null });
    await expect(attempt(2)).rejects.toThrow("connection reset");
    expect(await status(ratingId)).toEqual({ status: "failed", errorCode: "internal" });

    // A healthy run of the same job afterwards still works.
    const healthy = { ...deps, articles: new MemoryArticleLookup() };
    expect(
      await handleRateJob(
        { id: "job-2", data: { ratingId }, retryCount: 0, retryLimit: 2 },
        healthy,
      ),
    ).toBe("done");
  });

  it("runs the hourly sweep: fails stuck ratings and deletes expired PDFs", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    const stuck = await queuedRating();
    await testDb.db
      .update(ratings)
      .set({ status: "analysing", startedAt: twoHoursAgo })
      .where(eq(ratings.id, stuck));
    await seedDocument(testDb.db, temp.storage, {
      ...org,
      pdf: Buffer.from("%PDF-1.7 synthetic test file"),
      deleteAfter: twoHoursAgo,
    });

    expect(
      await runHourlySweep({ db: testDb.db, storage: temp.storage, logger }),
    ).toEqual({
      timedOutRatings: 1,
      documents: { deleted: 1, failed: 0 },
    });
    expect(await status(stuck)).toEqual({ status: "failed", errorCode: "timeout" });
  });

  it("starts the worker, rates a job sent the way the API sends it, and stops", async () => {
    const env = {
      DATABASE_URL: testDb.url,
      LLM_PROVIDER: "heuristic",
      STORAGE_DRIVER: "local",
      LOCAL_STORAGE_DIR: temp.dir,
      STORAGE_ENCRYPTION_KEY: temp.encryptionKey.toString("base64"),
      OCR_ENABLED: "false",
      WORKER_CONCURRENCY: "1",
    };
    const worker = await startWorker({ config: loadConfig(env), env, logger });
    const producer = new PgBoss(testDb.url);
    await producer.start();
    try {
      const ratingId = await queuedRating();
      await producer.send(QUEUES.rate, { ratingId });

      await expect
        .poll(async () => (await status(ratingId))?.status, {
          timeout: 20_000,
          interval: 250,
        })
        .toBe("done");

      const schedule = await producer.getSchedule(QUEUES.retention);
      expect(schedule?.cron).toBe(RETENTION_CRON);
      const queue = await producer.getQueue(QUEUES.rate);
      expect(queue?.retryLimit).toBe(2);
    } finally {
      await producer.stop();
      await worker.stop();
    }
  }, 60_000);
});
