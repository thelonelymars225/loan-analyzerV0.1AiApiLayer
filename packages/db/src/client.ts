import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

/** The handle passed to `db.transaction(async (tx) => ...)`. Accepts the same queries as Db. */
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface CreateDbOptions {
  /** Maximum open connections. pg's default is 10. */
  max?: number;
  /**
   * Called when an idle pooled connection fails (for example the database restarted).
   * Without a listener, pg would crash the process. Defaults to logging the error.
   */
  onIdleError?: (error: Error) => void;
}

/**
 * Opens a connection pool and wraps it in Drizzle with the full schema, so both
 * `db.select()...` and `db.query.<table>.findMany()` work.
 * Call `await pool.end()` on shutdown.
 */
export function createDb(
  connectionString: string,
  options: CreateDbOptions = {},
): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString, max: options.max });
  pool.on("error", options.onIdleError ?? logIdleError);
  const db = drizzle({ client: pool, schema });
  return { db, pool };
}

function logIdleError(error: Error): void {
  console.error("[db] idle connection error:", error.message);
}
