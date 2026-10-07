import { readdir } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DISCLAIMER_AR,
  DISCLAIMER_EN,
  ListRatingsResponse,
  Problem,
  RatingEvent,
  RatingReport,
} from "@rater/contracts";
import type { FindingInput } from "@rater/contracts";
import {
  auditEvents,
  clauseLocations,
  clauses,
  contractFields,
  documents,
  findings,
  newId,
  ratings,
} from "@rater/db";
import { ObjectNotFoundError } from "@rater/storage";
import {
  DATABASE_URL,
  api,
  createTestContext,
  fixture,
  multipart,
  ORIGIN,
  signUp,
  upload,
  type TestContext,
  type TestUser,
} from "./helpers";

/** The synthetic Qiwa contract and the synthetic non-Qiwa PDF from packages/core fixtures. */
let qiwaPdf: Buffer;
let notQiwaPdf: Buffer;

beforeAll(async () => {
  qiwaPdf = await fixture("fixed-term-bad-s15.pdf");
  notQiwaPdf = await fixture("not-qiwa.pdf");
});

describe.skipIf(!DATABASE_URL)("POST /ratings", () => {
  let t: TestContext;
  let user: TestUser;

  beforeAll(async () => {
    t = await createTestContext({ env: { MAX_UPLOAD_BYTES: String(1024 * 1024) } });
    user = await signUp(t.app);
  });
  afterAll(async () => {
    await t?.close();
  });

  it("stores the PDF, creates a queued rating and enqueues it", async () => {
    const response = await upload(t.app, user.cookie, qiwaPdf);
    expect(response.statusCode).toBe(202);
    const body = response.json<{ id: string; status: string }>();
    expect(body.status).toBe("queued");
    expect(t.queue.sent).toContain(body.id);

    const [rating] = await t.db.select().from(ratings).where(eq(ratings.id, body.id));
    expect(rating).toMatchObject({
      status: "queued",
      createdBy: user.id,
      defaultView: "employee", // personal workspace
    });

    const [document] = await t.db
      .select()
      .from(documents)
      .where(eq(documents.id, rating?.documentId ?? ""));
    expect(document).toMatchObject({
      orgId: rating?.orgId,
      uploadedBy: user.id,
      storageKey: `orgs/${rating?.orgId}/documents/${document?.id}.pdf`,
      sizeBytes: qiwaPdf.length,
    });
    expect(document?.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The check reads page 1 only; the page count still covers the whole document.
    expect(document?.pages).toBe(10);
    const retentionMs = (document?.deleteAfter.getTime() ?? 0) - t.clock.now.getTime();
    expect(retentionMs).toBe(30 * 24 * 60 * 60 * 1000);

    expect(await t.storage.get(document?.storageKey ?? "")).toEqual(qiwaPdf);

    const audit = await t.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, body.id));
    expect(audit.map((event) => event.action)).toEqual(["upload"]);
  });

  it('uses the "view" form field as the default view', async () => {
    const response = await upload(t.app, user.cookie, qiwaPdf, { view: "hr" });
    expect(response.statusCode).toBe(202);
    const [rating] = await t.db
      .select()
      .from(ratings)
      .where(eq(ratings.id, response.json<{ id: string }>().id));
    expect(rating?.defaultView).toBe("hr");
  });

  it("rejects a PDF that is not a Qiwa contract with 422 unsupported_document", async () => {
    const response = await upload(t.app, user.cookie, notQiwaPdf);
    expect(response.statusCode).toBe(422);
    expect(Problem.parse(response.json()).code).toBe("unsupported_document");
  });

  it("rejects a file that is not a PDF with 422 unsupported_document", async () => {
    const response = await upload(t.app, user.cookie, Buffer.from("just some text"));
    expect(response.statusCode).toBe(422);
    expect(Problem.parse(response.json()).code).toBe("unsupported_document");
  });

  it("rejects a file over the size limit with 413 file_too_large", async () => {
    const big = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(1024 * 1024)]);
    const response = await upload(t.app, user.cookie, big);
    expect(response.statusCode).toBe(413);
    expect(Problem.parse(response.json()).code).toBe("file_too_large");
  });

  it("answers 400 validation_error for a bad view or a missing file", async () => {
    const badView = await upload(t.app, user.cookie, qiwaPdf, { view: "boss" });
    expect(badView.statusCode).toBe(400);
    expect(Problem.parse(badView.json()).code).toBe("validation_error");

    const body = await multipart({ view: "hr" });
    const noFile = await t.app.inject({
      method: "POST",
      url: "/api/v1/ratings",
      headers: { ...body.headers, cookie: user.cookie, origin: ORIGIN },
      payload: body.payload,
    });
    expect(noFile.statusCode).toBe(400);
    expect(Problem.parse(noFile.json()).code).toBe("validation_error");
  });

  it("leaves nothing behind when the job cannot be enqueued", async () => {
    const before = await t.db.select().from(ratings);
    const uploadsBefore = await uploadEvents(t, user.id);
    t.queue.failNext = true;
    const response = await upload(t.app, user.cookie, qiwaPdf);
    expect(response.statusCode).toBe(500);
    expect(Problem.parse(response.json()).code).toBe("internal");

    expect(await t.db.select().from(ratings)).toHaveLength(before.length);
    // Nor does it count towards the daily limit.
    expect(await uploadEvents(t, user.id)).toHaveLength(uploadsBefore.length);
    const stored = await readdir(t.storageDir, { recursive: true });
    const pdfs = stored.filter((name) => String(name).endsWith(".pdf"));
    expect(pdfs).toHaveLength(before.length);
  });

  it("requires a session", async () => {
    const body = await multipart({}, { content: qiwaPdf });
    const response = await t.app.inject({
      method: "POST",
      url: "/api/v1/ratings",
      headers: body.headers,
      payload: body.payload,
    });
    expect(response.statusCode).toBe(401);
  });

  it("works over a real socket: upload, oversized upload and event stream", async () => {
    const address = await t.app.listen({ port: 0, host: "127.0.0.1" });
    const headers = { cookie: user.cookie, origin: ORIGIN };
    const send = (content: Buffer) => {
      const form = new FormData();
      form.append("view", "employee");
      form.append("file", new Blob([new Uint8Array(content)]), "contract.pdf");
      return fetch(`${address}/api/v1/ratings`, { method: "POST", headers, body: form });
    };

    const created = await send(qiwaPdf);
    expect(created.status).toBe(202);
    const { id } = (await created.json()) as { id: string };

    const tooBig = await send(Buffer.concat([qiwaPdf, Buffer.alloc(1024 * 1024)]));
    expect(tooBig.status).toBe(413);
    expect(((await tooBig.json()) as Problem).code).toBe("file_too_large");

    await t.db.update(ratings).set({ status: "failed" }).where(eq(ratings.id, id));
    const events = await fetch(`${address}/api/v1/ratings/${id}/events`, { headers });
    expect(events.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(events.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(await events.text()).toBe(
      `event: status\ndata: ${JSON.stringify({ id, status: "failed" })}\n\n`,
    );
  });
});

describe.skipIf(!DATABASE_URL)("daily limit", () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestContext({ env: { RATE_LIMIT_PER_DAY: "2" } });
  });
  afterAll(async () => {
    await t?.close();
  });

  it("answers 429 rate_limited with Retry-After once the limit is reached", async () => {
    const user = await signUp(t.app);
    const start = new Date("2026-10-04T08:00:00Z");
    t.clock.now = start;
    expect((await upload(t.app, user.cookie, qiwaPdf)).statusCode).toBe(202);
    t.clock.now = new Date(start.getTime() + 60 * 60 * 1000);
    expect((await upload(t.app, user.cookie, qiwaPdf)).statusCode).toBe(202);

    t.clock.now = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const limited = await upload(t.app, user.cookie, qiwaPdf);
    expect(limited.statusCode).toBe(429);
    expect(Problem.parse(limited.json()).code).toBe("rate_limited");
    // The first upload leaves the 24-hour window 22 hours later.
    expect(limited.headers["retry-after"]).toBe(String(22 * 60 * 60));

    t.clock.now = new Date(start.getTime() + 24 * 60 * 60 * 1000 + 1000);
    expect((await upload(t.app, user.cookie, qiwaPdf)).statusCode).toBe(202);
  });

  it("gives no quota back when ratings are deleted", async () => {
    const user = await signUp(t.app);
    t.clock.now = new Date("2026-10-05T08:00:00Z");
    for (let round = 0; round < 2; round++) {
      const accepted = await upload(t.app, user.cookie, qiwaPdf);
      expect(accepted.statusCode).toBe(202);
      const id = accepted.json<{ id: string }>().id;
      expect((await api(t.app, user.cookie, "DELETE", `/ratings/${id}`)).statusCode).toBe(
        204,
      );
    }
    const limited = await upload(t.app, user.cookie, qiwaPdf);
    expect(limited.statusCode).toBe(429);
    expect(Problem.parse(limited.json()).code).toBe("rate_limited");
  });
});

describe.skipIf(!DATABASE_URL)("event stream limits", () => {
  let t: TestContext;
  let user: TestUser;
  let ratingId: string;
  let address: string;

  beforeAll(async () => {
    t = await createTestContext();
    user = await signUp(t.app);
    // The fake queue never runs it, so the rating stays queued and its streams stay open.
    const uploaded = await upload(t.app, user.cookie, qiwaPdf);
    ratingId = uploaded.json<{ id: string }>().id;
    address = await t.app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(async () => {
    await t?.close();
  });

  function openStream(signal?: AbortSignal): Promise<Response> {
    return fetch(`${address}/api/v1/ratings/${ratingId}/events`, {
      headers: { cookie: user.cookie, origin: ORIGIN },
      signal,
    });
  }

  it("answers 429 over the per-user cap and frees a slot when a client leaves", async () => {
    const clients = [new AbortController(), new AbortController(), new AbortController()];
    for (const client of clients) {
      expect((await openStream(client.signal)).status).toBe(200);
    }

    const refused = await openStream();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("content-type")).toMatch(/^application\/problem\+json/);
    expect(((await refused.json()) as Problem).code).toBe("rate_limited");

    // Closing one stream stops its polling and gives its slot back.
    clients[0]?.abort();
    const replacement = new AbortController();
    const reopened = await retryUntil(async () => {
      const response = await openStream(replacement.signal);
      if (response.status === 200) return response;
      await response.body?.cancel();
      return null;
    });
    expect(reopened.status).toBe(200);
    for (const client of [...clients, replacement]) client.abort();
  });
});

describe.skipIf(!DATABASE_URL)("reading, streaming and deleting ratings", () => {
  let t: TestContext;
  let owner: TestUser;
  let stranger: TestUser;

  beforeAll(async () => {
    t = await createTestContext();
    owner = await signUp(t.app, "Nour Al-Harbi");
    stranger = await signUp(t.app, "Salem Al-Otaibi");
  });
  afterAll(async () => {
    await t?.close();
  });

  async function newRating(user: TestUser): Promise<string> {
    const response = await upload(t.app, user.cookie, qiwaPdf);
    expect(response.statusCode).toBe(202);
    return response.json<{ id: string }>().id;
  }

  async function report(
    id: string,
    query = "",
    headers: Record<string, string> = {},
  ): Promise<RatingReport> {
    const response = await api(
      t.app,
      owner.cookie,
      "GET",
      `/ratings/${id}${query}`,
      undefined,
      headers,
    );
    expect(response.statusCode).toBe(200);
    return RatingReport.parse(response.json());
  }

  it("lists ratings newest first in pages of 20", async () => {
    const orgId = (await t.db.select().from(ratings).limit(1))[0]?.orgId;
    const fresh = await signUp(t.app, "Huda Al-Shehri");
    const freshOrg = (await api(t.app, fresh.cookie, "GET", "/me")).json<{
      activeOrgId: string;
    }>().activeOrgId;
    expect(freshOrg).not.toBe(orgId);

    const base = Date.parse("2026-01-01T00:00:00Z");
    const ids: string[] = [];
    for (let i = 0; i < 23; i++) {
      const id = newId("rt");
      ids.push(id);
      await t.db.insert(ratings).values({
        id,
        orgId: freshOrg,
        createdBy: fresh.id,
        defaultView: "employee",
        // Two ratings share each timestamp, so the id breaks ties.
        createdAt: new Date(base + Math.floor(i / 2) * 1000),
      });
    }
    const newestFirst = [...ids].reverse();

    const first = await api(t.app, fresh.cookie, "GET", "/ratings");
    const page1 = ListRatingsResponse.parse(first.json());
    expect(page1.items.map((item) => item.id)).toEqual(newestFirst.slice(0, 20));
    expect(page1.nextCursor).not.toBeNull();

    const second = await api(
      t.app,
      fresh.cookie,
      "GET",
      `/ratings?cursor=${encodeURIComponent(page1.nextCursor ?? "")}`,
    );
    const page2 = ListRatingsResponse.parse(second.json());
    expect(page2.items.map((item) => item.id)).toEqual(newestFirst.slice(20));
    expect(page2.nextCursor).toBeNull();
    expect(page2.items[0]).toMatchObject({
      status: "queued",
      defaultView: "employee",
      scoreOverall: null,
      band: null,
    });

    const bad = await api(t.app, fresh.cookie, "GET", "/ratings?cursor=not-a-cursor");
    expect(bad.statusCode).toBe(400);
    expect(Problem.parse(bad.json()).code).toBe("validation_error");

    // Other users never see these.
    const others = ListRatingsResponse.parse(
      (await api(t.app, stranger.cookie, "GET", "/ratings")).json(),
    );
    expect(others.items.map((item) => item.id)).not.toContain(ids[0]);
  });

  it("renders a queued rating as a report without a score", async () => {
    const id = await newRating(owner);
    const queued = await report(id);
    expect(queued).toMatchObject({
      id,
      status: "queued",
      view: "employee",
      score: null,
      error: null,
      findings: [],
      fields: null,
      versions: null,
      document: { pages: 10, available: true, deletedAt: null },
      disclaimer: DISCLAIMER_EN,
    });
    expect((await report(id, "", { "accept-language": "ar,en;q=0.8" })).disclaimer).toBe(
      DISCLAIMER_AR,
    );
  });

  it("renders a finished rating in both views from the stored findings", async () => {
    const id = await newRating(owner);
    await storeResults(t, id);

    const employee = await report(id);
    expect(employee.view).toBe("employee");
    expect(employee.status).toBe("done");
    expect(employee.score).not.toBeNull();
    // Employee view: largest SAR first, then severity.
    expect(employee.findings.map((f) => f.ruleId)).toEqual([
      "COMP-ART77-01",
      "EOS-BASE-01",
      "TYPE-CONFLICT-01",
      "TRANSFER-KSA-01",
      "CONFIDENTIAL-01",
    ]);
    const eos = employee.findings.find((f) => f.ruleId === "EOS-BASE-01");
    expect(eos).toMatchObject({
      message: "Employee: end-of-service is on basic wage only.",
      action: "Ask for the award on the full wage.",
      impactSar: { "1y": 1750, "5y": 8750, "10y": 26250 },
    });
    expect(employee.good.map((f) => f.ruleId)).toEqual(["LEAVE-MIN-01"]);
    expect(employee.info.map((f) => f.ruleId)).toEqual(["SETTLE-TIME-01"]);
    expect(employee.deadlines).toEqual([
      {
        ruleId: "RENEW-DEADLINE-01",
        kind: "renewal_notice",
        date: "2027-05-02",
        message: "Give notice by 2027-05-02.",
      },
    ]);
    expect(employee.fields).toMatchObject({
      contractType: "fixed_term",
      probationDays: 90,
      annualLeaveDays: 22,
      endDate: null,
    });
    expect(employee.versions).toEqual({
      law: "2025-11",
      ruleset: "0.1.0",
      prompt: "s15-v1",
      model: "heuristic-v1",
    });

    const hr = await report(id, "?view=hr");
    expect(hr.view).toBe("hr");
    // HR view: severity first, then legal risk; ties keep the stored order.
    expect(hr.findings.map((f) => f.ruleId)).toEqual([
      "EOS-BASE-01",
      "TYPE-CONFLICT-01",
      "TRANSFER-KSA-01",
      "COMP-ART77-01",
      "CONFIDENTIAL-01",
    ]);
    expect(hr.findings[0]).toMatchObject({
      message: "HR: clause 15.6 computes the award on basic wage.",
      action: "The award is calculated on the last actual wage.",
    });
    // Same findings, so the same sub-scores; each view weighs them its own way.
    expect(hr.score).toMatchObject({
      legal: employee.score?.legal,
      market: employee.score?.market,
      clarity: employee.score?.clarity,
    });
    expect(employee.reviewReasons).toEqual([]);
  });

  it("points each finding at the passages behind it", async () => {
    const id = await newRating(owner);
    await storeResults(t, id);
    const { findings: problems, good, info, document } = await report(id);
    expect(document).toEqual({ pages: 10, available: true, deletedAt: null });

    // A located Section 15 clause: its box, the crop to ask for, and its stored text.
    const eos = problems.find((f) => f.ruleId === "EOS-BASE-01");
    expect(eos?.passages).toEqual([
      {
        clause: "15.6",
        page: 8,
        pageWidth: 595.92,
        pageHeight: 842.04,
        box: { xMin: 45.4, yMin: 600, xMax: 574.2, yMax: 640 },
        crop: { xMin: 0, yMin: 582, xMax: 595.92, yMax: 658 },
        textEn: "End of service is calculated on the basic wage.",
        textAr: "تحتسب مكافأة نهاية الخدمة على الأجر الأساسي",
        approximate: false,
      },
    ]);
    // A conflict shows its clause and then the template clause it contradicts.
    const conflict = problems.find((f) => f.ruleId === "TYPE-CONFLICT-01");
    expect(conflict?.passages.map((p) => [p.clause, p.page])).toEqual([
      ["15.1", 8],
      ["1", 1],
    ]);
    // A clause that was not located falls back to its section, marked approximate.
    const confidential = problems.find((f) => f.ruleId === "CONFIDENTIAL-01");
    expect(confidential?.passages).toHaveLength(1);
    expect(confidential?.passages[0]).toMatchObject({ clause: "15", approximate: true });
    // Template clauses have a place but no stored text; a finding with no clause has none.
    expect(good[0]?.passages[0]).toMatchObject({ clause: "8.1", page: 2, textEn: null });
    expect(info[0]?.passages).toEqual([]);
  });

  it("cuts the passage behind a finding from the PDF on request, storing nothing", async () => {
    const id = await newRating(owner);
    await storeResults(t, id);
    const storedBefore = await readdir(t.storageDir, { recursive: true });
    const response = await api(
      t.app,
      owner.cookie,
      "GET",
      `/ratings/${id}/passages/15.6/8`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    // The crop (0, 582) to (595.92, 658) at 144 dpi: 1192 by 152 pixels (PNG IHDR).
    const png = response.rawPayload;
    expect(png.readUInt32BE(16)).toBe(1192);
    expect(png.readUInt32BE(20)).toBe(152);

    // Not audited (viewing the report is), and nothing new in storage.
    const audit = await t.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, id));
    expect(audit.map((event) => event.action)).toEqual(["upload"]);
    expect(await readdir(t.storageDir, { recursive: true })).toEqual(storedBefore);

    for (const url of [
      `/ratings/${id}/passages/15.9/8`, // not located
      `/ratings/${id}/passages/15.6/9`, // located, but not on that page
    ]) {
      const missing = await api(t.app, owner.cookie, "GET", url);
      expect(missing.statusCode, url).toBe(404);
      expect(Problem.parse(missing.json()).code).toBe("not_found");
    }
    const malformed = await api(
      t.app,
      owner.cookie,
      "GET",
      `/ratings/${id}/passages/x/8`,
    );
    expect(malformed.statusCode).toBe(400);
  });

  it("says why a rating needs review", async () => {
    const id = await newRating(owner);
    const reasons = ["The wage parts do not add up to the total wage."];
    await t.db
      .update(ratings)
      .set({ status: "needs_review", reviewReasons: reasons, finishedAt: new Date() })
      .where(eq(ratings.id, id));
    const needsReview = await report(id);
    expect(needsReview.status).toBe("needs_review");
    expect(needsReview.reviewReasons).toEqual(reasons);
  });

  it("shows the error of a failed rating", async () => {
    const id = await newRating(owner);
    await t.db
      .update(ratings)
      .set({
        status: "failed",
        errorCode: "unsupported_document",
        error: "Not a Qiwa contract.",
        finishedAt: new Date(),
      })
      .where(eq(ratings.id, id));
    const failed = await report(id);
    expect(failed.error).toEqual({
      code: "unsupported_document",
      message: "Not a Qiwa contract.",
    });
    expect(failed.score).toBeNull();
  });

  it("streams status changes as server-sent events until the rating is final", async () => {
    const id = await newRating(owner);
    const stream = api(t.app, owner.cookie, "GET", `/ratings/${id}/events`);
    await delay(150);
    await t.db.update(ratings).set({ status: "extracting" }).where(eq(ratings.id, id));
    await delay(150);
    await t.db.update(ratings).set({ status: "done" }).where(eq(ratings.id, id));

    const response = await stream;
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/event-stream/);
    const events = response.body
      .split("\n\n")
      .filter((block) => block.startsWith("event: status"))
      .map((block) => RatingEvent.parse(JSON.parse(block.split("data: ")[1] ?? "")));
    expect(events).toEqual([
      { id, status: "queued" },
      { id, status: "extracting" },
      { id, status: "done" },
    ]);
  });

  it("answers 404 for another user's rating on every route", async () => {
    const id = await newRating(owner);
    for (const [method, url] of [
      ["GET", `/ratings/${id}`],
      ["GET", `/ratings/${id}/events`],
      ["GET", `/ratings/${id}/document`],
      ["GET", `/ratings/${id}/passages/15.6/8`],
      ["GET", `/ratings/${id}/pages/1`],
      ["DELETE", `/ratings/${id}`],
    ] as const) {
      const response = await api(t.app, stranger.cookie, method, url);
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(Problem.parse(response.json()).code).toBe("not_found");
    }
    expect((await report(id)).id).toBe(id);
  });

  it("lets the uploader download the PDF and audits it", async () => {
    const id = await newRating(owner);
    const response = await api(t.app, owner.cookie, "GET", `/ratings/${id}/document`);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="contract-${id}.pdf"`,
    );
    expect(response.rawPayload).toEqual(qiwaPdf);
    const audit = await t.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, id));
    expect(audit.map((event) => event.action).sort()).toEqual(["download", "upload"]);
  });

  it("renders a whole page for the contract viewer, and 404 past the last page", async () => {
    const id = await newRating(owner);
    const response = await api(t.app, owner.cookie, "GET", `/ratings/${id}/pages/8`);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    // A4 at 144 dpi (PNG IHDR).
    expect(response.rawPayload.readUInt32BE(16)).toBe(1192);
    expect(response.rawPayload.readUInt32BE(20)).toBe(1684);

    const past = await api(t.app, owner.cookie, "GET", `/ratings/${id}/pages/11`);
    expect(past.statusCode).toBe(404);
    expect(Problem.parse(past.json()).code).toBe("not_found");
    const zero = await api(t.app, owner.cookie, "GET", `/ratings/${id}/pages/0`);
    expect(zero.statusCode).toBe(400);
  });

  it("opens the PDF inline for the contract viewer and audits that separately", async () => {
    const id = await newRating(owner);
    const response = await api(
      t.app,
      owner.cookie,
      "GET",
      `/ratings/${id}/document?disposition=inline`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["content-disposition"]).toBe(
      `inline; filename="contract-${id}.pdf"`,
    );
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const audit = await t.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, id));
    expect(audit.map((event) => event.action).sort()).toEqual([
      "upload",
      "view_document",
    ]);
  });

  it("answers 404 for the PDF once retention has removed it", async () => {
    const id = await newRating(owner);
    const [rating] = await t.db.select().from(ratings).where(eq(ratings.id, id));
    const [document] = await t.db
      .select()
      .from(documents)
      .where(eq(documents.id, rating?.documentId ?? ""));
    await t.storage.delete(document?.storageKey ?? "");

    const response = await api(t.app, owner.cookie, "GET", `/ratings/${id}/document`);
    expect(response.statusCode).toBe(404);
    expect(Problem.parse(response.json()).code).toBe("not_found");

    // The passages go with it; the report says so instead of offering them.
    await storeResults(t, id);
    const passage = await api(
      t.app,
      owner.cookie,
      "GET",
      `/ratings/${id}/passages/15.6/8`,
    );
    expect(passage.statusCode).toBe(404);
    const page = await api(t.app, owner.cookie, "GET", `/ratings/${id}/pages/1`);
    expect(page.statusCode).toBe(404);
    await t.db
      .update(documents)
      .set({ deletedAt: t.clock.now })
      .where(eq(documents.id, document?.id ?? ""));
    expect((await report(id)).document).toEqual({
      pages: 10,
      available: false,
      deletedAt: t.clock.now.toISOString(),
    });
  });

  it("deletes the rating, its rows and the stored PDF", async () => {
    const id = await newRating(owner);
    await storeResults(t, id);
    const [rating] = await t.db.select().from(ratings).where(eq(ratings.id, id));
    const [document] = await t.db
      .select()
      .from(documents)
      .where(eq(documents.id, rating?.documentId ?? ""));

    const response = await api(t.app, owner.cookie, "DELETE", `/ratings/${id}`);
    expect(response.statusCode).toBe(204);

    expect(await t.db.select().from(ratings).where(eq(ratings.id, id))).toEqual([]);
    expect(await t.db.select().from(findings).where(eq(findings.ratingId, id))).toEqual(
      [],
    );
    expect(
      await t.db
        .select()
        .from(documents)
        .where(eq(documents.id, document?.id ?? "")),
    ).toEqual([]);
    await expect(t.storage.get(document?.storageKey ?? "")).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
    const audit = await t.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, id));
    expect(audit.map((event) => event.action).sort()).toEqual(["delete", "upload"]);

    const again = await api(t.app, owner.cookie, "GET", `/ratings/${id}`);
    expect(again.statusCode).toBe(404);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Calls `attempt` every 50 ms until it returns a value (at most 2 seconds). */
async function retryUntil<T>(attempt: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    const result = await attempt();
    if (result !== null) return result;
    if (Date.now() > deadline) throw new Error("gave up waiting");
    await delay(50);
  }
}

/** The user's "upload" audit events (what the daily limit counts). */
function uploadEvents(t: TestContext, userId: string) {
  return t.db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.userId, userId), eq(auditEvents.action, "upload")));
}

/** Writes what the worker would: findings, fields, deadlines, versions and status "done". */
async function storeResults(t: TestContext, ratingId: string): Promise<void> {
  const results: FindingInput[] = [
    {
      ruleId: "EOS-BASE-01",
      clause: "15.6",
      verdict: "likely_void",
      severity: "high",
      confidence: "high",
      categories: ["legal"],
      articles: ["Art. 84"],
      impact: { kind: "eos_gap", sar: { "1y": 1750, "5y": 8750, "10y": 26250 } },
      explanation: "The award is based on basic wage only.",
      employeeMsg: "Employee: end-of-service is on basic wage only.",
      hrMsg: "HR: clause 15.6 computes the award on basic wage.",
      askFor: "Ask for the award on the full wage.",
      suggestedWording: "The award is calculated on the last actual wage.",
      source: "clause",
    },
    {
      ruleId: "TYPE-CONFLICT-01",
      clause: "15.1",
      relatedClause: "1",
      verdict: "conflict",
      severity: "high",
      confidence: "high",
      categories: ["legal", "clarity"],
      articles: ["Art. 55"],
      impact: null,
      explanation: "Section 15 calls the contract unlimited; Section 1 says fixed-term.",
      employeeMsg: "Employee: the contract type contradicts itself.",
      hrMsg: "HR: clause 15.1 contradicts Section 1.",
      source: "cross_check",
    },
    {
      ruleId: "TRANSFER-KSA-01",
      clause: "15.3",
      verdict: "worse_than_default",
      severity: "medium",
      confidence: "high",
      categories: ["market"],
      articles: ["Art. 58"],
      impact: null,
      explanation: "Transfer anywhere in the Kingdom.",
      employeeMsg: "Employee: you may be moved anywhere.",
      hrMsg: "HR: broad transfer clause.",
      source: "clause",
    },
    {
      ruleId: "COMP-ART77-01",
      clause: "15.4",
      verdict: "worse_than_default",
      severity: "medium",
      confidence: "high",
      categories: ["market"],
      articles: ["Art. 77"],
      impact: { kind: "art77_gap", sar: { contract: 20000, default: 62222, gap: 40000 } },
      explanation: "Two months of basic wage instead of the rest of the term.",
      employeeMsg: "Employee: compensation is capped.",
      hrMsg: "HR: compensation replaces Art. 77.",
      source: "clause",
    },
    {
      ruleId: "CONFIDENTIAL-01",
      clause: "15.2",
      verdict: "unclear",
      severity: "low",
      confidence: "medium",
      categories: ["clarity"],
      articles: ["Art. 83"],
      impact: null,
      explanation: "No time limit.",
      employeeMsg: "Employee: confidentiality has no end date.",
      hrMsg: "HR: add a time limit.",
      source: "clause",
    },
    {
      ruleId: "LEAVE-MIN-01",
      clause: "8.1",
      verdict: "better_than_law",
      severity: "none",
      confidence: "high",
      categories: ["legal"],
      articles: ["Art. 109"],
      impact: null,
      explanation: "22 days is more than 21.",
      employeeMsg: "Employee: more leave than the minimum.",
      hrMsg: "HR: leave above the minimum.",
      source: "field_rule",
    },
    {
      ruleId: "SETTLE-TIME-01",
      clause: null,
      verdict: "compliant",
      severity: "none",
      confidence: "high",
      categories: ["legal"],
      articles: ["Art. 88"],
      impact: null,
      explanation: "Final dues are due within a week.",
      employeeMsg: "Employee: final pay is due within a week.",
      hrMsg: "HR: settle within a week.",
      source: "info",
    },
  ];
  await t.db.insert(findings).values(
    results.map((finding, position) => ({
      id: newId("fd"),
      ratingId,
      ruleId: finding.ruleId,
      clauseRef: finding.clause,
      relatedClause: finding.relatedClause ?? null,
      verdict: finding.verdict,
      severity: finding.severity,
      confidence: finding.confidence,
      categories: finding.categories,
      articles: finding.articles,
      impact: finding.impact,
      explanation: finding.explanation,
      employeeMsg: finding.employeeMsg,
      hrMsg: finding.hrMsg,
      askFor: finding.askFor,
      suggestedWording: finding.suggestedWording,
      source: finding.source,
      position,
    })),
  );
  await t.db.insert(clauses).values([
    {
      id: newId("cl"),
      ratingId,
      section: 15,
      number: "15.6",
      textEn: "End of service is calculated on the basic wage.",
      textAr: "تحتسب مكافأة نهاية الخدمة على الأجر الأساسي",
      textHash: "a".repeat(64),
    },
  ]);
  // Boxes on the synthetic contract's A4 pages (the worker would get them from the extractor).
  const a4 = { pageWidth: 595.92, pageHeight: 842.04, xMin: 45.4, xMax: 574.2 };
  await t.db.insert(clauseLocations).values([
    { ratingId, clause: "1", page: 1, ...a4, yMin: 100, yMax: 160 },
    { ratingId, clause: "8.1", page: 2, ...a4, yMin: 300, yMax: 330 },
    { ratingId, clause: "15", page: 8, ...a4, yMin: 360, yMax: 700 },
    { ratingId, clause: "15.1", page: 8, ...a4, yMin: 400, yMax: 440 },
    { ratingId, clause: "15.3", page: 8, ...a4, yMin: 480, yMax: 510 },
    { ratingId, clause: "15.4", page: 8, ...a4, yMin: 520, yMax: 560 },
    { ratingId, clause: "15.6", page: 8, ...a4, yMin: 600, yMax: 640 },
  ]);
  await t.db.insert(contractFields).values([
    { ratingId, field: "contractType", value: "fixed_term", page: 1, confidence: "high" },
    { ratingId, field: "probationDays", value: 90, page: 2, confidence: "high" },
    { ratingId, field: "annualLeaveDays", value: 22, page: 2, confidence: "high" },
  ]);
  await t.db
    .update(ratings)
    .set({
      status: "done",
      lawVersion: "2025-11",
      rulesetVersion: "0.1.0",
      promptVersion: "s15-v1",
      model: "heuristic-v1",
      deadlines: [
        {
          ruleId: "RENEW-DEADLINE-01",
          date: "2027-05-02",
          kind: "renewal_notice",
          employeeMsg: "Give notice by {deadline}.",
          hrMsg: "Notice is due by {deadline}.",
        },
      ],
      finishedAt: new Date(),
    })
    .where(eq(ratings.id, ratingId));
}
