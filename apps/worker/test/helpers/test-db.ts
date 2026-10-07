import { randomBytes } from "node:crypto";
import pg from "pg";
import { createDb, migrate } from "@rater/db";
import type { Db } from "@rater/db";

/** Tests that need Postgres run only when DATABASE_URL is set (they skip otherwise). */
export const DATABASE_URL = process.env.DATABASE_URL;

export interface TestDatabase {
  url: string;
  db: Db;
  pool: pg.Pool;
  /** Closes the pool and drops the database. */
  drop(): Promise<void>;
}

/**
 * Creates a throwaway database (rater_worker_test_<random>) on the DATABASE_URL server and
 * applies the migrations, so every test file works on its own empty schema.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const name = `rater_worker_test_${randomBytes(4).toString("hex")}`;
  await adminQuery(`create database "${name}"`);

  const url = new URL(DATABASE_URL);
  url.pathname = `/${name}`;
  await migrate(url.toString());
  const { db, pool } = createDb(url.toString(), { max: 4 });

  return {
    url: url.toString(),
    db,
    pool,
    async drop() {
      await pool.end();
      await adminQuery(`drop database if exists "${name}" with (force)`);
    },
  };
}

async function adminQuery(sql: string): Promise<void> {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(sql);
  } finally {
    await admin.end();
  }
}
