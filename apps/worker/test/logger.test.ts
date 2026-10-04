import { DrizzleQueryError, sql } from "drizzle-orm";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createDb } from "@rater/db";
import { errorForLog } from "../src/logger";
import { DATABASE_URL } from "./helpers/test-db";

/** Stands in for contract text in a query parameter. One line looks like a stack frame. */
const SECRET = "SECRET CLAUSE TEXT, wage 12000 SAR\n    at the employer's discretion";

describe("errorForLog", () => {
  it("keeps name, message, code and stack, and drops row details", () => {
    // Shaped like a pg DatabaseError, whose `detail` can echo the failed row.
    const error = Object.assign(new Error("null value in column violates not-null"), {
      code: "23502",
      detail: "Failing row contains (cl_1, The employee shall not ...).",
    });
    const logged = errorForLog(error);
    expect(logged).toMatchObject({
      name: "Error",
      message: "null value in column violates not-null",
      code: "23502",
    });
    expect(logged.stack).toEqual(expect.any(String));
    expect(JSON.stringify(logged)).not.toContain("Failing row");
  });

  it("handles values that are not errors", () => {
    expect(errorForLog("boom")).toEqual({ message: "boom" });
  });

  it("logs a failed Drizzle query without its parameters", () => {
    const pgError = Object.assign(
      new Error(`invalid input syntax for type integer: "${SECRET}"`),
      { code: "22P02", detail: SECRET },
    );
    const error = new DrizzleQueryError(
      'insert into "clauses" ("id", "text_en") values ($1, $2)',
      ["cl_1", SECRET],
      pgError,
    );

    const logged = errorForLog(error);
    expect(logged).toMatchObject({
      name: "DrizzleQueryError",
      message: 'Failed query: insert into "clauses" ("id", "text_en") values ($1, $2)',
      code: "22P02",
      cause: { name: "Error", code: "22P02" },
    });
    // The stack frames stay, so the log still says where the query came from.
    expect(logged.stack).toMatch(/^\s+at /);
    const text = JSON.stringify(logged);
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("employer's discretion");
  });
});

describe.skipIf(!DATABASE_URL)("errorForLog with a real failed query", () => {
  it("writes no query parameter into the log line", async () => {
    const { db, pool } = createDb(DATABASE_URL!, { max: 1 });
    const lines: string[] = [];
    const logger = pino({ level: "info" }, { write: (line: string) => lines.push(line) });
    try {
      // Postgres rejects the text as an integer and quotes it in its own message.
      const failure = await db
        .execute(sql`select ${SECRET}::int as n`)
        .then(() => undefined)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(DrizzleQueryError);
      logger.error({ err: errorForLog(failure) }, "Rating job crashed");
    } finally {
      await pool.end();
    }

    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line).toContain('"code":"22P02"');
    expect(line).toContain("select $1::int as n");
    expect(line).not.toContain("SECRET");
    expect(line).not.toContain("employer's discretion");
  });
});
