import { asc, count, eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ContractFields } from "@rater/contracts";
import { extractContract, MemoryClauseCache, parseBboxXhtml } from "@rater/core";
import type { ArticleLookup } from "@rater/core";
import { clauseCache, clauses, contractFields, findings, ratings } from "@rater/db";
import type { Db } from "@rater/db";
import { loadRules } from "@rater/law";
import { HeuristicLlmClient } from "@rater/llm";
import { ocrArabicRegions, pdftotextBbox } from "@rater/pdf";
import type { LocalStorage } from "@rater/storage";
import { PgArticleLookup } from "../src/pg-article-lookup";
import { PgClauseCache } from "../src/pg-clause-cache";
import {
  DOCUMENT_MISSING_MESSAGE,
  INTERNAL_ERROR_MESSAGE,
  processRating,
  todayInRiyadh,
  UNREADABLE_PDF_MESSAGE,
} from "../src/rate-job";
import type { RateJobDeps } from "../src/rate-job";
import { UNANALYSED_CLAUSE_REASON } from "../src/rating-store";
import {
  createTempStorage,
  readFixturePdf,
  seedDocument,
  seedOrg,
  seedRating,
} from "./helpers/seed";
import { createTestDatabase, DATABASE_URL, ingestCorpus } from "./helpers/test-db";
import type { TestDatabase } from "./helpers/test-db";

const TODAY = "2026-10-04";

describe("todayInRiyadh", () => {
  it("uses the Saudi calendar date (UTC+3)", () => {
    expect(todayInRiyadh(new Date("2026-10-04T20:59:00Z"))).toBe("2026-10-04");
    expect(todayInRiyadh(new Date("2026-10-04T21:00:00Z"))).toBe("2026-10-05");
  });
});

describe.skipIf(!DATABASE_URL)("processRating against Postgres", () => {
  let testDb: TestDatabase;
  let db: Db;
  let storage: LocalStorage;
  let cleanupStorage: () => Promise<void>;
  let org: { orgId: string; userId: string };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await ingestCorpus(db);
    ({ storage, cleanup: cleanupStorage } = await createTempStorage());
    org = await seedOrg(db);
  }, 60_000);

  afterAll(async () => {
    await testDb?.drop();
    await cleanupStorage?.();
  }, 60_000);

  /** Real Postgres lookup and cache, the offline analyser, no OCR unless a test adds it. */
  function deps(overrides: Partial<RateJobDeps> = {}): RateJobDeps {
    return {
      db,
      storage,
      llm: new HeuristicLlmClient(),
      articles: new PgArticleLookup(db),
      cache: new PgClauseCache(db),
      rules: loadRules(),
      logger: pino({ level: "silent" }),
      today: TODAY,
      ...overrides,
    };
  }

  async function ratingRow(ratingId: string) {
    const [row] = await db.select().from(ratings).where(eq(ratings.id, ratingId));
    if (!row) throw new Error(`rating ${ratingId} not found`);
    return row;
  }

  async function rowCounts(ratingId: string) {
    const countRows = async (
      table: typeof findings | typeof clauses | typeof contractFields,
    ) => {
      const [row] = await db
        .select({ n: count() })
        .from(table)
        .where(eq(table.ratingId, ratingId));
      return row?.n ?? 0;
    };
    return {
      fields: await countRows(contractFields),
      clauses: await countRows(clauses),
      findings: await countRows(findings),
    };
  }

  async function rate(
    fixture: Parameters<typeof readFixturePdf>[0],
    overrides: Partial<RateJobDeps> = {},
    defaultView: "employee" | "hr" = "employee",
  ) {
    const { ratingId } = await seedRating(db, storage, {
      ...org,
      pdf: await readFixturePdf(fixture),
      defaultView,
    });
    const outcome = await processRating(ratingId, deps(overrides));
    return { ratingId, outcome };
  }

  it("rates the bad Section 15 fixture and saves fields, clauses, findings and scores", async () => {
    const { ratingId, outcome } = await rate("fixed-term-bad-s15");
    expect(outcome).toBe("done");

    const rating = await ratingRow(ratingId);
    expect(rating).toMatchObject({
      status: "done",
      lastStep: "save",
      errorCode: null,
      error: null,
      lawVersion: "2025-11",
      rulesetVersion: "0.1.0",
      promptVersion: "s15-v1",
      model: "heuristic-v2",
      // Employee view (the default): same numbers as the core calibration test.
      scoreOverall: 64,
      reviewReasons: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect(rating.scoreLegal).toBeLessThan(100);
    expect(rating.startedAt).toBeInstanceOf(Date);
    expect(rating.finishedAt!.getTime()).toBeGreaterThanOrEqual(
      rating.startedAt!.getTime(),
    );
    expect(rating.deadlines).toEqual([
      expect.objectContaining({ ruleId: "RENEW-DEADLINE-01", kind: "renewal_notice" }),
    ]);

    const savedFindings = await db
      .select()
      .from(findings)
      .where(eq(findings.ratingId, ratingId))
      .orderBy(asc(findings.position));
    const problems = savedFindings
      .filter((f) => !["compliant", "better_than_law"].includes(f.verdict))
      .map((f) => `${f.ruleId}@${f.clauseRef}:${f.severity}`);
    expect(problems).toEqual([
      "TYPE-ART57-01@15.1:high",
      "CONFIDENTIAL-01@15.2:low",
      "TRANSFER-KSA-01@15.3:medium",
      "COMP-ART77-01@15.4:high",
      "LEAVE-FORFEIT-01@15.5:low",
      "EOS-BASE-01@15.6:high",
      "TYPE-CONFLICT-01@15.1:high",
    ]);
    expect(savedFindings.map((f) => f.position)).toEqual(
      savedFindings.map((_, index) => index),
    );
    const eos = savedFindings.find((f) => f.ruleId === "EOS-BASE-01");
    expect(eos?.impact?.kind).toBe("eos_gap");
    expect(eos?.articles.length).toBeGreaterThan(0);

    const savedClauses = await db
      .select()
      .from(clauses)
      .where(eq(clauses.ratingId, ratingId));
    expect(savedClauses.map((c) => c.number).sort()).toEqual([
      "15.1",
      "15.2",
      "15.3",
      "15.4",
      "15.5",
      "15.6",
      "15.7",
    ]);
    // No OCR in this test.
    expect(savedClauses.every((c) => c.textAr === null && c.textHash.length === 64)).toBe(
      true,
    );

    // Every field has a row, so the API can rebuild ContractFields from them.
    const fieldRows = await db
      .select()
      .from(contractFields)
      .where(eq(contractFields.ratingId, ratingId));
    const fields = ContractFields.parse(
      Object.fromEntries(fieldRows.map((row) => [row.field, row.value])),
    );
    expect(fields).toMatchObject({ contractType: "fixed_term", annualLeaveDays: 22 });
    expect(fieldRows.find((row) => row.field === "contractType")).toMatchObject({
      page: 1,
      confidence: "high",
    });
  });

  it("stores the score of the rating's default view", async () => {
    const { ratingId } = await rate("fixed-term-bad-s15", {}, "hr");
    expect(await ratingRow(ratingId)).toMatchObject({ status: "done", scoreOverall: 61 });
  });

  it("rates a clean contract as done with a high score", async () => {
    const { ratingId, outcome } = await rate("indefinite-clean");
    expect(outcome).toBe("done");
    const rating = await ratingRow(ratingId);
    expect(rating.scoreOverall).toBeGreaterThanOrEqual(85);
    expect(rating.deadlines).toEqual([]);
    expect(await rowCounts(ratingId)).toMatchObject({ clauses: 3 });
  });

  it("marks a contract whose wage parts don't add up as needs_review, and says why", async () => {
    const { ratingId, outcome } = await rate("wage-mismatch");
    expect(outcome).toBe("needs_review");
    const rating = await ratingRow(ratingId);
    expect(rating).toMatchObject({ status: "needs_review", lastStep: "save" });
    expect(rating.reviewReasons).toContainEqual(
      expect.stringMatching(
        /^Wage parts add up to [\d.]+ but the total wage is [\d.]+\.$/,
      ),
    );
    expect(rating.reviewReasons).not.toContain(UNANALYSED_CLAUSE_REASON);
  });

  it("asks for a manual check when the analyser fails on a clause twice", async () => {
    const llm = new HeuristicLlmClient();
    vi.spyOn(llm, "analyzeClause").mockResolvedValue({
      json: { not: "a clause analysis" },
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    // A fresh cache, so no clause is answered from an earlier test's analysis.
    const { ratingId, outcome } = await rate("indefinite-clean", {
      llm,
      cache: new MemoryClauseCache(),
    });
    expect(outcome).toBe("needs_review");
    expect((await ratingRow(ratingId)).reviewReasons).toEqual([UNANALYSED_CLAUSE_REASON]);
  });

  it("clears the reasons an earlier attempt stored when the rating ends done", async () => {
    const { ratingId } = await seedRating(db, storage, {
      ...org,
      pdf: await readFixturePdf("indefinite-clean"),
    });
    await db
      .update(ratings)
      .set({ status: "needs_review", reviewReasons: ["Left by an earlier attempt."] })
      .where(eq(ratings.id, ratingId));

    expect(await processRating(ratingId, deps())).toBe("done");
    expect((await ratingRow(ratingId)).reviewReasons).toEqual([]);
  });

  it("stores only redacted text, in English and in the Arabic OCR", async () => {
    // This fixture's Section 15 mentions the parties and an ID number.
    const pdf = await readFixturePdf("wage-mismatch");
    const pages = parseBboxXhtml(await pdftotextBbox(pdf));
    const names = extractContract(pages).identifyingStrings;
    expect(names.length).toBeGreaterThan(0);

    const { ratingId } = await rate("wage-mismatch", {
      ocr: (file, regions) => ocrArabicRegions(file, regions),
    });
    const stored = JSON.stringify([
      await ratingRow(ratingId),
      await db.select().from(clauses).where(eq(clauses.ratingId, ratingId)),
      await db.select().from(contractFields).where(eq(contractFields.ratingId, ratingId)),
      await db.select().from(findings).where(eq(findings.ratingId, ratingId)),
    ]);
    for (const name of names) expect(stored).not.toContain(name);
    expect(stored).toMatch(/\[(EMPLOYER|EMPLOYEE|NAME|ID)\]/);
  }, 60_000);

  it("fails a PDF that is not a Qiwa contract with unsupported_document", async () => {
    const llm = new HeuristicLlmClient();
    const analyse = vi.spyOn(llm, "analyzeClause");
    const { ratingId, outcome } = await rate("not-qiwa", { llm });
    expect(outcome).toBe("failed");
    const rating = await ratingRow(ratingId);
    expect(rating).toMatchObject({
      status: "failed",
      errorCode: "unsupported_document",
      scoreOverall: null,
    });
    expect(rating.error).toMatch(/Unified Employment Contract/);
    expect(rating.finishedAt).toBeInstanceOf(Date);
    expect(analyse).not.toHaveBeenCalled();
    expect(await rowCounts(ratingId)).toEqual({ fields: 0, clauses: 0, findings: 0 });
  });

  it("fails a file that is not a readable PDF with unsupported_document", async () => {
    const { ratingId } = await seedRating(db, storage, {
      ...org,
      pdf: Buffer.from("%PDF-1.7 this is not really a PDF"),
    });
    expect(await processRating(ratingId, deps())).toBe("failed");
    expect(await ratingRow(ratingId)).toMatchObject({
      errorCode: "unsupported_document",
      error: UNREADABLE_PDF_MESSAGE,
    });
  });

  it("fails with document_missing when the PDF is gone", async () => {
    // The file was removed from storage, but the row was not updated.
    const noFile = await seedRating(db, storage, { ...org, pdf: null });
    // Retention already deleted the file and marked the row.
    const swept = await seedRating(db, storage, {
      ...org,
      pdf: await readFixturePdf("indefinite-clean"),
      deletedAt: new Date(),
    });

    for (const { ratingId } of [noFile, swept]) {
      expect(await processRating(ratingId, deps())).toBe("failed");
      expect(await ratingRow(ratingId)).toMatchObject({
        status: "failed",
        errorCode: "document_missing",
        error: DOCUMENT_MISSING_MESSAGE,
      });
    }
  });

  it("does not read a document that belongs to another org", async () => {
    const other = await seedOrg(db);
    const { documentId } = await seedDocument(db, storage, {
      ...other,
      pdf: await readFixturePdf("indefinite-clean"),
    });
    const { ratingId } = await seedRating(db, storage, { ...org, pdf: null });
    await db.update(ratings).set({ documentId }).where(eq(ratings.id, ratingId));

    expect(await processRating(ratingId, deps())).toBe("failed");
    expect(await ratingRow(ratingId)).toMatchObject({ errorCode: "document_missing" });
  });

  it("is idempotent: running the same rating again replaces its rows", async () => {
    const { ratingId } = await rate("fixed-term-bad-s15");
    const first = await rowCounts(ratingId);
    const firstRating = await ratingRow(ratingId);

    expect(await processRating(ratingId, deps())).toBe("done");
    expect(await rowCounts(ratingId)).toEqual(first);
    expect(first).toEqual({ fields: 20, clauses: 7, findings: 16 });
    const again = await ratingRow(ratingId);
    expect(again.scoreOverall).toBe(firstRating.scoreOverall);
    expect(again.deadlines).toEqual(firstRating.deadlines);
  });

  it("caches clause analyses in Postgres and answers the next run from the cache", async () => {
    await db.delete(clauseCache);
    const firstLlm = new HeuristicLlmClient();
    const firstCalls = vi.spyOn(firstLlm, "analyzeClause");
    await rate("indefinite-clean", { llm: firstLlm });
    expect(firstCalls).toHaveBeenCalledTimes(3);
    const [cached] = await db.select({ n: count() }).from(clauseCache);
    expect(cached?.n).toBe(3);

    const secondLlm = new HeuristicLlmClient();
    const secondCalls = vi.spyOn(secondLlm, "analyzeClause");
    const { outcome } = await rate("indefinite-clean", { llm: secondLlm });
    expect(outcome).toBe("done");
    expect(secondCalls).not.toHaveBeenCalled();
  });

  it("stores redacted Arabic OCR text with the clauses", async () => {
    const { ratingId, outcome } = await rate("fixed-term-bad-s15", {
      ocr: (pdf, regions) => ocrArabicRegions(pdf, regions),
    });
    expect(outcome).toBe("done");
    const savedClauses = await db
      .select()
      .from(clauses)
      .where(eq(clauses.ratingId, ratingId));
    const withArabic = savedClauses.filter((c) => /[؀-ۿ]/.test(c.textAr ?? ""));
    expect(withArabic.length).toBeGreaterThanOrEqual(5);
  }, 60_000);

  it("carries on in English when OCR throws", async () => {
    const { outcome } = await rate("indefinite-clean", {
      ocr: async () => {
        throw new Error("tesseract crashed");
      },
    });
    expect(outcome).toBe("done");
  });

  describe("unexpected errors", () => {
    const brokenLookup: ArticleLookup = {
      byRefs: async () => {
        throw new Error("connection reset");
      },
      search: async () => [],
    };

    it("rethrows and leaves the rating running while pg-boss will retry", async () => {
      const { ratingId } = await seedRating(db, storage, {
        ...org,
        pdf: await readFixturePdf("fixed-term-bad-s15"),
      });
      await expect(
        processRating(ratingId, deps({ articles: brokenLookup }), {
          finalAttempt: false,
        }),
      ).rejects.toThrow("connection reset");
      expect(await ratingRow(ratingId)).toMatchObject({
        status: "analysing",
        lastStep: "detect",
        errorCode: null,
      });

      // The retry succeeds and clears the attempt's state.
      expect(await processRating(ratingId, deps())).toBe("done");
    });

    it("marks the rating failed with a generic message on the final attempt", async () => {
      const { ratingId } = await seedRating(db, storage, {
        ...org,
        pdf: await readFixturePdf("fixed-term-bad-s15"),
      });
      await expect(
        processRating(ratingId, deps({ articles: brokenLookup }), { finalAttempt: true }),
      ).rejects.toThrow("connection reset");
      expect(await ratingRow(ratingId)).toMatchObject({
        status: "failed",
        errorCode: "internal",
        error: INTERNAL_ERROR_MESSAGE,
      });
    });
  });

  it("skips a rating that no longer exists", async () => {
    expect(await processRating("rt_does_not_exist", deps())).toBe("skipped");
  });
});
