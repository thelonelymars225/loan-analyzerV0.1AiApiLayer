import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  documents,
  findings,
  memberships,
  migrate,
  newId,
  orgs,
  ratings,
  users,
} from "../src";
import type { Db } from "../src";

/**
 * Migrates a throwaway database (rater_test_<random>) on the server in DATABASE_URL and
 * writes one row into each core table. Skipped without DATABASE_URL. All data is synthetic.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("database smoke test", () => {
  const databaseName = `rater_test_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let testUrl: string;
  let db: Db;
  let pool: pg.Pool;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`create database "${databaseName}"`);
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${databaseName}`;
    testUrl = url.toString();
    await migrate(testUrl);
    ({ db, pool } = createDb(testUrl, { max: 2 }));
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin.query(`drop database if exists "${databaseName}" with (force)`);
    await admin.end();
  }, 60_000);

  it("creates every table", async () => {
    const tables = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      "accounts",
      "audit_events",
      "clause_cache",
      "clause_locations",
      "clauses",
      "contract_fields",
      "documents",
      "findings",
      "invitations",
      "memberships",
      "orgs",
      "ratings",
      "sessions",
      "users",
      "verifications",
    ]);
  });

  it("is safe to run migrate again", async () => {
    await expect(migrate(testUrl)).resolves.toBeUndefined();
  });

  it("stores an org, user, document, rating and finding, and cascades on org delete", async () => {
    const orgId = newId("org");
    const userId = newId("usr");
    const documentId = newId("doc");
    const ratingId = newId("rt");

    await db
      .insert(users)
      .values({ id: userId, name: "Nour Al-Harbi", email: "nour@example.com" });
    await db
      .insert(orgs)
      .values({ id: orgId, name: "Example Trading Co.", slug: "example-trading" });
    await db.insert(memberships).values({
      id: newId("mem"),
      organizationId: orgId,
      userId,
      role: "owner",
    });
    await db.insert(documents).values({
      id: documentId,
      orgId,
      uploadedBy: userId,
      storageKey: `orgs/${orgId}/documents/${documentId}.pdf`,
      sha256: "0".repeat(64),
      sizeBytes: 1234,
      deleteAfter: new Date(Date.now() + 30 * 86_400_000),
    });
    await db.insert(ratings).values({
      id: ratingId,
      orgId,
      documentId,
      createdBy: userId,
      defaultView: "employee",
    });
    await db.insert(findings).values({
      id: newId("fd"),
      ratingId,
      ruleId: "EOS-BASE-01",
      clauseRef: "15.6",
      verdict: "likely_void",
      severity: "high",
      confidence: "high",
      categories: ["legal"],
      articles: ["Art. 84"],
      impact: { kind: "eos_gap", sar: { "1y": 1750, "5y": 8750, "10y": 26250 } },
      explanation: "End-of-service award computed on basic wage only.",
      employeeMsg: "Your end-of-service award is calculated on the basic wage only.",
      hrMsg: "Clause 15.6 computes the end-of-service award on the basic wage.",
      source: "clause",
    });

    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
    expect(org).toMatchObject({ kind: "personal", retentionDays: 30 });

    const rating = await db.query.ratings.findFirst({ where: eq(ratings.id, ratingId) });
    expect(rating).toMatchObject({ status: "queued", orgId, documentId });

    const [finding] = await db
      .select()
      .from(findings)
      .where(eq(findings.ratingId, ratingId));
    expect(finding).toMatchObject({
      categories: ["legal"],
      needsReview: false,
      position: 0,
    });

    await db.delete(orgs).where(eq(orgs.id, orgId));
    expect(await db.select().from(ratings).where(eq(ratings.orgId, orgId))).toEqual([]);
    expect(
      await db.select().from(findings).where(eq(findings.ratingId, ratingId)),
    ).toEqual([]);
    expect(await db.select().from(users).where(eq(users.id, userId))).toHaveLength(1);
  });
});
