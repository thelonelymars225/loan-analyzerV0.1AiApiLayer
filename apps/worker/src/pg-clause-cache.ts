import { and, eq } from "drizzle-orm";
import type { ClauseCache } from "@rater/core";
import { clauseCache } from "@rater/db";
import type { Db } from "@rater/db";

/** The five parts of a key built by core's clauseCacheKey(), in order. */
interface CacheKey {
  textHash: string;
  lawVersion: string;
  rulesetVersion: string;
  promptVersion: string;
  model: string;
}

/**
 * Validated clause analyses in the clause_cache table, so an identical clause is analysed once
 * per law, ruleset, prompt and model version, across ratings, retries and worker processes.
 * Core validates a cached value again before using it, so a stale row is never trusted blindly.
 */
export class PgClauseCache implements ClauseCache {
  constructor(private readonly db: Db) {}

  async get(key: string): Promise<unknown> {
    const parts = parseCacheKey(key);
    const [row] = await this.db
      .select({ result: clauseCache.result })
      .from(clauseCache)
      .where(
        and(
          eq(clauseCache.textHash, parts.textHash),
          eq(clauseCache.lawVersion, parts.lawVersion),
          eq(clauseCache.rulesetVersion, parts.rulesetVersion),
          eq(clauseCache.promptVersion, parts.promptVersion),
          eq(clauseCache.model, parts.model),
        ),
      )
      .limit(1);
    return row?.result;
  }

  /** Two workers may analyse the same clause at once; the later answer simply replaces the earlier. */
  async set(key: string, value: unknown): Promise<void> {
    const parts = parseCacheKey(key);
    await this.db
      .insert(clauseCache)
      .values({ ...parts, result: value })
      .onConflictDoUpdate({
        target: [
          clauseCache.textHash,
          clauseCache.lawVersion,
          clauseCache.rulesetVersion,
          clauseCache.promptVersion,
          clauseCache.model,
        ],
        set: { result: value, createdAt: new Date() },
      });
  }
}

/** Splits "textHash|law|ruleset|prompt|model" (core's clauseCacheKey format). */
export function parseCacheKey(key: string): CacheKey {
  const parts = key.split("|");
  const [textHash, lawVersion, rulesetVersion, promptVersion, model] = parts;
  if (
    parts.length !== 5 ||
    !textHash ||
    !lawVersion ||
    !rulesetVersion ||
    !promptVersion ||
    !model
  ) {
    throw new Error(
      `Clause cache key must have 5 non-empty parts separated by "|" (got ${parts.length})`,
    );
  }
  return { textHash, lawVersion, rulesetVersion, promptVersion, model };
}
