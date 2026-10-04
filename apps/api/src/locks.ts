import { sql } from "drizzle-orm";
import type { DbTransaction } from "@rater/db";

/**
 * Per-user Postgres advisory locks. Each kind of work has its own namespace (any fixed
 * number, but they must all differ), so locking one never blocks the other.
 */
export const LOCKS = {
  /** Creating the user's personal workspace (orgs.ts). */
  personalOrg: 4_120_771,
  /** Counting and recording uploads against the daily limit (ratings/store.ts). */
  dailyLimit: 4_120_772,
} as const;

/**
 * Waits for the user's lock in `namespace` and holds it until the transaction ends, so a
 * second request for the same user runs only after the first has committed.
 */
export async function lockUser(
  tx: DbTransaction,
  namespace: number,
  userId: string,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${namespace}, hashtext(${userId}))`);
}
