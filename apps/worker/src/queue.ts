import { QUEUES, RATE_QUEUE_OPTIONS } from "@rater/contracts";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import { z } from "zod";
import { processRating } from "./rate-job";
import type { RateJobDeps, RatingOutcome } from "./rate-job";
import { sweepExpiredDocuments } from "./retention";
import type { SweepResult } from "./retention";
import { failStuckRatings } from "./stuck-ratings";

/** What the API sends to QUEUES.rate. */
export const RateJobData = z.object({ ratingId: z.string().min(1) });
export type RateJobData = z.infer<typeof RateJobData>;

/** The hourly sweep (QUEUES.retention) runs every hour, on the hour (UTC). */
export const RETENTION_CRON = "0 * * * *";

/** Creates both queues, starts their workers and schedules the hourly sweep. */
export async function registerJobs(
  boss: PgBoss,
  deps: RateJobDeps,
  concurrency: number,
): Promise<void> {
  await boss.createQueue(QUEUES.rate, { ...RATE_QUEUE_OPTIONS });
  await boss.createQueue(QUEUES.retention, { retryLimit: 1 });

  await boss.work(
    QUEUES.rate,
    { batchSize: 1, localConcurrency: concurrency, includeMetadata: true },
    async ([job]: JobWithMetadata<unknown>[]) =>
      job ? { outcome: await handleRateJob(job, deps) } : null,
  );
  await boss.work(QUEUES.retention, { batchSize: 1 }, () => runHourlySweep(deps));
  // "once": after downtime, run one sweep for the missed hours instead of none.
  await boss.schedule(QUEUES.retention, RETENTION_CRON, null, {
    tz: "UTC",
    missed: "once",
  });
}

export interface HourlySweepResult {
  /** Ratings marked failed because their job was lost. */
  timedOutRatings: number;
  documents: SweepResult;
}

/** The hourly job: fail ratings whose job was lost, then delete PDFs past their retention. */
export async function runHourlySweep(
  deps: Pick<RateJobDeps, "db" | "storage" | "logger">,
): Promise<HourlySweepResult> {
  const logger = deps.logger.child({ job: QUEUES.retention });
  const timedOutRatings = await failStuckRatings({ db: deps.db, logger });
  const documents = await sweepExpiredDocuments({
    db: deps.db,
    storage: deps.storage,
    logger,
  });
  return { timedOutRatings, documents };
}

type RateJob = Pick<
  JobWithMetadata<unknown>,
  "id" | "data" | "retryCount" | "retryLimit"
>;

/**
 * Rates the job's rating. Unexpected errors propagate so pg-boss retries the job; the
 * rating is marked failed only on the last attempt (retryCount has reached retryLimit).
 */
export async function handleRateJob(
  job: RateJob,
  deps: RateJobDeps,
): Promise<RatingOutcome | "invalid_job"> {
  const parsed = RateJobData.safeParse(job.data);
  if (!parsed.success) {
    // No retry can fix a malformed job, so it completes without doing anything.
    deps.logger.error({ jobId: job.id }, "Rate job has no valid ratingId; dropping it");
    return "invalid_job";
  }
  return processRating(parsed.data.ratingId, deps, {
    finalAttempt: job.retryCount >= job.retryLimit,
  });
}
