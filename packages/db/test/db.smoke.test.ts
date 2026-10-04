import { randomBytes } from "node:crypto";
import { cosineDistance, eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMBEDDING_DIM } from "@rater/contracts";
import {
  createDb,
  documents,
  findings,
  lawArticles,
  memberships,
  migrate,
  newId,
  orgs,
  ratings,
  users,
} from "../src";
import type { Db } from "../src";

/**
 * Migrates a throwaway database (rater_test_<random>) on the server in DATABASE_URL,
 * writes one row into each core table and runs a vector search. Skipped without
 * DATABASE_URL. All data is synthetic.
 */
const DATABASE_URL = process.env.DATABASE_URL;

/** A unit vector of EMBEDDING_DIM dimensions, mostly along `axis`. */
function embedding(axis: number, lean = 0): number[] {
  const vector = new Array<number>(EMBEDDING_DIM).fill(0);
  vector[axis] = 1;
  vector[axis + 1] = lean;
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

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

  it("creates every table, the vector extension and the HNSW index", async () => {
    const tables = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      "accounts",
      "audit_events",
      "clause_cache",
      "clauses",
      "contract_fields",
      "documents",
      "findings",
      "invitations",
      "law_articles",
      "memberships",
      "orgs",
      "ratings",
      "sessions",
      "users",
      "verifications",
    ]);

    const extension = await pool.query(
      "select 1 from pg_extension where extname = 'vector'",
    );
    expect(extension.rowCount).toBe(1);

    const index = await pool.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where indexname = 'law_articles_embedding_idx'",
    );
    expect(index.rows[0]?.indexdef).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
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

  it("orders law articles by cosine distance to a query embedding", async () => {
    await db.insert(lawArticles).values(
      [
        { id: "test:art-77", article: "77", embedding: embedding(0) },
        { id: "test:art-84", article: "84", embedding: embedding(10) },
        { id: "test:art-109", article: "109", embedding: embedding(10, 0.5) },
      ].map((row) => ({ ...row, lawVersion: "2025-11", sourceDoc: "labor_law" })),
    );

    const query = embedding(10, 0.1);
    const distance = cosineDistance(lawArticles.embedding, query);
    const nearest = await db
      .select({ article: lawArticles.article, distance })
      .from(lawArticles)
      .orderBy(distance)
      .limit(3);

    expect(nearest.map((row) => row.article)).toEqual(["84", "109", "77"]);
    expect(Number(nearest[0]?.distance)).toBeLessThan(0.01);

    const [stored] = await db
      .select()
      .from(lawArticles)
      .where(eq(lawArticles.id, "test:art-84"));
    expect(stored?.embedding).toHaveLength(EMBEDDING_DIM);
  });
});
