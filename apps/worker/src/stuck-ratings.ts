import { and, eq, inArray, lt, or } from "drizzle-orm";
import { ratings } from "@rater/db";
import type { Db } from "@rater/db";
import type { Logger } from "pino";
import type { RatingErrorCode } from "./rating-store";

/*
 * Ratings whose job was lost. A job can stop without marking its rating: the worker is killed
 * mid-job, or pg-boss expires the last attempt (after RATE_QUEUE_OPTIONS.expireInSeconds) and
 * gives up without calling our handler. Such a rating would show "in progress" forever, so the
 * hourly sweep marks it failed with error_code "timeout".
 *
 * If a lost job does run after all (say the worker was down for a day), it rates the contract
 * as usual and its result replaces the failure.
 */

/**
 * A rating has been extracting or analysing for this long since its last attempt started.
 * One attempt is stopped by pg-boss after 15 minutes and retries wait seconds, so after an
 * hour no attempt can still be running.
 */
export const STUCK_RUNNING_MS = 60 * 60 * 1000;

/** A rating has waited in the queue this long. A job normally starts within seconds. */
export const STUCK_QUEUED_MS = 24 * 60 * 60 * 1000;

/** Shown to the user. Says nothing about the cause, which is in the worker's logs. */
export const TIMEOUT_MESSAGE =
  "Rating this contract took too long and was stopped. Please upload it again.";

export interface StuckRatingsDeps {
  db: Db;
  logger: Logger;
  /** Defaults to the current time. */
  now?: Date;
}

/**
 * Marks stuck ratings failed in one statement, and returns how many there were. The status
 * check is part of the update, so a rating that finished in the meantime is left alone.
 */
export async function failStuckRatings(deps: StuckRatingsDeps): Promise<number> {
  const now = deps.now ?? new Date();
  const runningSince = new Date(now.getTime() - STUCK_RUNNING_MS);
  const queuedSince = new Date(now.getTime() - STUCK_QUEUED_MS);

  const failed = await deps.db
    .update(ratings)
    .set({
      status: "failed",
      errorCode: "timeout" satisfies RatingErrorCode,
      error: TIMEOUT_MESSAGE,
      finishedAt: now,
    })
    .where(
      or(
        and(
          inArray(ratings.status, ["extracting", "analysing"]),
          lt(ratings.startedAt, runningSince),
        ),
        and(eq(ratings.status, "queued"), lt(ratings.createdAt, queuedSince)),
      ),
    )
    .returning({ id: ratings.id });

  if (failed.length > 0) {
    deps.logger.warn(
      { count: failed.length, ratingIds: failed.map((rating) => rating.id) },
      "Marked stuck ratings failed (timeout)",
    );
  }
  return failed.length;
}
