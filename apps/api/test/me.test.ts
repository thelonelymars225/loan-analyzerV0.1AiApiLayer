import { readdir } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InviteResponse, MeResponse, OrgSummary, Problem } from "@rater/contracts";
import { auditEvents, documents, findings, newId, ratings } from "@rater/db";
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

describe.skipIf(!DATABASE_URL)("active workspace, x-org-id and deleting my data", () => {
  let t: TestContext;
  let user: TestUser;
  let personal: string;
  let company: OrgSummary;
  let qiwaPdf: Buffer;

  beforeAll(async () => {
    t = await createTestContext();
    qiwaPdf = await fixture("fixed-term-bad-s15.pdf");
    user = await signUp(t.app, "Nour Al-Harbi");
    personal = (await me(user)).activeOrgId ?? "";
    const created = await api(t.app, user.cookie, "POST", "/orgs", {
      name: "Example Trading Co.",
    });
    company = OrgSummary.parse(created.json());
  });
  afterAll(async () => {
    await t?.close();
  });

  async function me(who: TestUser) {
    return MeResponse.parse((await api(t.app, who.cookie, "GET", "/me")).json());
  }

  async function switchTo(orgId: string, headers: Record<string, string> = {}) {
    return api(t.app, user.cookie, "PUT", "/me/active-org", { orgId }, headers);
  }

  it("switches the session's workspace with PUT /me/active-org", async () => {
    const response = await switchTo(company.id);
    expect(response.statusCode).toBe(200);
    expect(MeResponse.parse(response.json()).activeOrgId).toBe(company.id);
    expect((await me(user)).activeOrgId).toBe(company.id);

    // The tab still says "personal": switching is exactly what it asks for, so no 409.
    const back = await switchTo(personal, { "x-org-id": company.id });
    expect(back.statusCode).toBe(200);
    expect((await me(user)).activeOrgId).toBe(personal);
  });

  it("answers 404 for a workspace the user does not belong to", async () => {
    const stranger = await signUp(t.app, "Salem Al-Otaibi");
    const theirs = (await me(stranger)).activeOrgId ?? "";
    for (const orgId of [theirs, "org_does_not_exist"]) {
      const response = await switchTo(orgId);
      expect(response.statusCode).toBe(404);
      expect(Problem.parse(response.json()).code).toBe("not_found");
    }
    expect((await me(user)).activeOrgId).toBe(personal);
  });

  it("refuses a change made from a tab showing another workspace (409)", async () => {
    await switchTo(company.id);
    // This tab still shows the personal workspace.
    const body = await multipart({}, { content: qiwaPdf });
    const stale = await t.app.inject({
      method: "POST",
      url: "/api/v1/ratings",
      headers: {
        ...body.headers,
        cookie: user.cookie,
        origin: ORIGIN,
        "x-org-id": personal,
      },
      payload: body.payload,
    });
    expect(stale.statusCode).toBe(409);
    expect(Problem.parse(stale.json()).code).toBe("conflict");
    expect(await t.db.select().from(ratings)).toHaveLength(0);

    const rename = await api(
      t.app,
      user.cookie,
      "PATCH",
      `/orgs/${company.id}`,
      { name: "Renamed Co." },
      { "x-org-id": personal },
    );
    expect(rename.statusCode).toBe(409);

    // Reads are not checked, and a matching header passes.
    const read = await api(t.app, user.cookie, "GET", "/ratings", undefined, {
      "x-org-id": personal,
    });
    expect(read.statusCode).toBe(200);
    const fresh = await multipart({}, { content: qiwaPdf });
    const current = await t.app.inject({
      method: "POST",
      url: "/api/v1/ratings",
      headers: {
        ...fresh.headers,
        cookie: user.cookie,
        origin: ORIGIN,
        "x-org-id": company.id,
      },
      payload: fresh.payload,
    });
    expect(current.statusCode).toBe(202);
  });

  it("deletes everything in the personal workspace only, whatever is active", async () => {
    await switchTo(personal);
    const mine = [await newRating(), await newRating()];
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
    await switchTo(company.id);
    const companyRatings = await t.db
      .select()
      .from(ratings)
      .where(eq(ratings.orgId, company.id));
    expect(companyRatings.length).toBeGreaterThan(0);

    // The tab shows the company workspace; the route ignores x-org-id and the active org.
    const response = await api(t.app, user.cookie, "DELETE", "/me/data", undefined, {
      "x-org-id": company.id,
    });
    expect(response.statusCode).toBe(204);

    expect(await t.db.select().from(ratings).where(eq(ratings.orgId, personal))).toEqual(
      [],
    );
    expect(
      await t.db.select().from(documents).where(eq(documents.orgId, personal)),
    ).toEqual([]);
    expect(await t.db.select().from(findings)).toEqual([]);
    const files = (await readdir(t.storageDir, { recursive: true })).map(String);
    expect(files.filter((name) => name.includes(personal))).not.toContainEqual(
      expect.stringMatching(/\.pdf$/),
    );
    expect(files.some((name) => name.includes(company.id) && name.endsWith(".pdf"))).toBe(
      true,
    );

    // Company data stays, and the session stays where it was.
    expect(
      await t.db.select().from(ratings).where(eq(ratings.orgId, company.id)),
    ).toHaveLength(companyRatings.length);
    expect((await me(user)).activeOrgId).toBe(company.id);

    const audited = await t.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.orgId, personal), eq(auditEvents.action, "delete")));
    expect(audited.map((event) => event.targetId).sort()).toEqual([...mine].sort());
  });

  async function newRating(): Promise<string> {
    const response = await upload(t.app, user.cookie, qiwaPdf);
    expect(response.statusCode).toBe(202);
    return response.json<{ id: string }>().id;
  }
});

describe.skipIf(!DATABASE_URL)("event streams after losing access", () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestContext();
  });
  afterAll(async () => {
    await t?.close();
  });

  it("ends a member's stream once they are removed from the workspace", async () => {
    const owner = await signUp(t.app, "Reem Al-Dosari");
    const member = await signUp(t.app, "Omar Al-Harbi");
    const created = await api(t.app, owner.cookie, "POST", "/orgs", {
      name: "Example Trading Co.",
    });
    const company = OrgSummary.parse(created.json());
    await api(t.app, owner.cookie, "PUT", "/me/active-org", { orgId: company.id });
    const invite = InviteResponse.parse(
      (
        await api(t.app, owner.cookie, "POST", `/orgs/${company.id}/invites`, {
          email: member.email,
          role: "member",
        })
      ).json(),
    );
    await api(t.app, member.cookie, "POST", `/invites/${invite.id}/accept`);

    const uploaded = await upload(
      t.app,
      member.cookie,
      await fixture("fixed-term-bad-s15.pdf"),
    );
    const { id } = uploaded.json<{ id: string }>();

    // The rating stays queued (no worker), so only losing access ends this stream.
    const stream = api(t.app, member.cookie, "GET", `/ratings/${id}/events`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const removed = await api(
      t.app,
      owner.cookie,
      "DELETE",
      `/orgs/${company.id}/members/${member.id}`,
    );
    expect(removed.statusCode).toBe(204);

    const response = await stream;
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(
      `event: status\ndata: ${JSON.stringify({ id, status: "queued" })}\n\n`,
    );
  });
});
