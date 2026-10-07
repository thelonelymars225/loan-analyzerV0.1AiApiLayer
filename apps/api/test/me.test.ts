import { readdir } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, documents, findings, newId, ratings } from "@rater/db";
import {
  DATABASE_URL,
  api,
  createTestContext,
  fixture,
  signUp,
  upload,
  type TestContext,
  type TestUser,
} from "./helpers";

describe.skipIf(!DATABASE_URL)("deleting my data", () => {
  let t: TestContext;
  let user: TestUser;
  let other: TestUser;
  let qiwaPdf: Buffer;

  beforeAll(async () => {
    t = await createTestContext();
    qiwaPdf = await fixture("fixed-term-bad-s15.pdf");
    user = await signUp(t.app, "Nour Al-Harbi");
    other = await signUp(t.app, "Salem Al-Otaibi");
  });
  afterAll(async () => {
    await t?.close();
  });

  it("deletes the caller's ratings, documents and PDFs, and no one else's", async () => {
    const mine = [await newRating(user), await newRating(user)];
    const theirs = await newRating(other);
    await t.db.insert(findings).values({
      id: newId("fd"),
      ratingId: mine[0] ?? "",
      ruleId: "CONFIDENTIAL-01",
      clauseRef: "15.2",
      verdict: "unclear",
      severity: "low",
      confidence: "medium",
      categories: ["clarity"],
      articles: ["Art. 83"],
      impact: null,
      explanation: "No time limit.",
      employeeMsg: "Confidentiality has no end date.",
      hrMsg: "Add a time limit.",
      source: "clause",
      position: 0,
    });

    const response = await api(t.app, user.cookie, "DELETE", "/me/data");
    expect(response.statusCode).toBe(204);

    expect(await t.db.select().from(ratings).where(eq(ratings.userId, user.id))).toEqual(
      [],
    );
    expect(
      await t.db.select().from(documents).where(eq(documents.userId, user.id)),
    ).toEqual([]);
    expect(await t.db.select().from(findings)).toEqual([]);
    const files = (await readdir(t.storageDir, { recursive: true })).map(String);
    expect(files.filter((name) => name.includes(user.id))).not.toContainEqual(
      expect.stringMatching(/\.pdf$/),
    );
    expect(files.some((name) => name.includes(other.id) && name.endsWith(".pdf"))).toBe(
      true,
    );

    const left = await t.db.select().from(ratings);
    expect(left.map((rating) => rating.id)).toEqual([theirs]);

    const audited = await t.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.userId, user.id), eq(auditEvents.action, "delete")));
    expect(audited.map((event) => event.targetId).sort()).toEqual([...mine].sort());
  });

  async function newRating(who: TestUser): Promise<string> {
    const response = await upload(t.app, who.cookie, qiwaPdf);
    expect(response.statusCode).toBe(202);
    return response.json<{ id: string }>().id;
  }
});
