import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  InviteResponse,
  ListMembersResponse,
  ListRatingsResponse,
  MeResponse,
  MemberResponse,
  OrgSummary,
  Problem,
} from "@rater/contracts";
import { documents, ratings } from "@rater/db";
import {
  DATABASE_URL,
  ORIGIN,
  api,
  createTestContext,
  fixture,
  setActiveOrg,
  signUp,
  upload,
  type TestContext,
  type TestUser,
} from "./helpers";

describe.skipIf(!DATABASE_URL)("company workspaces, invites and roles", () => {
  let t: TestContext;
  let owner: TestUser;
  let invitee: TestUser;
  let company: OrgSummary;
  let qiwaPdf: Buffer;

  beforeAll(async () => {
    t = await createTestContext();
    qiwaPdf = await fixture("fixed-term-bad-s15.pdf");
    owner = await signUp(t.app, "Reem Al-Dosari");
    invitee = await signUp(t.app, "Omar Al-Harbi");
  });
  afterAll(async () => {
    await t?.close();
  });

  async function me(user: TestUser) {
    return MeResponse.parse((await api(t.app, user.cookie, "GET", "/me")).json());
  }

  async function members() {
    const response = await api(t.app, owner.cookie, "GET", `/orgs/${company.id}/members`);
    expect(response.statusCode).toBe(200);
    return ListMembersResponse.parse(response.json()).items;
  }

  it("creates a company workspace with the caller as owner", async () => {
    const response = await api(t.app, owner.cookie, "POST", "/orgs", {
      name: "Example Trading Co.",
    });
    expect(response.statusCode).toBe(201);
    company = OrgSummary.parse(response.json());
    expect(company).toMatchObject({
      name: "Example Trading Co.",
      kind: "company",
      role: "owner",
      retentionDays: 30,
    });

    await setActiveOrg(t.app, owner.cookie, company.id);
    const after = await me(owner);
    expect(after.activeOrgId).toBe(company.id);
    expect(after.orgs.map((org) => org.kind).sort()).toEqual(["company", "personal"]);
  });

  it("validates the body with a problem+json validation_error", async () => {
    const response = await api(t.app, owner.cookie, "POST", "/orgs", { name: "x" });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    const problem = Problem.parse(response.json());
    expect(problem).toMatchObject({ status: 400, code: "validation_error" });
    expect(problem.detail).toContain("name");
  });

  it("rates company uploads in the HR view by default", async () => {
    const response = await upload(t.app, owner.cookie, qiwaPdf);
    expect(response.statusCode).toBe(202);
    const [rating] = await t.db
      .select()
      .from(ratings)
      .where(eq(ratings.id, response.json<{ id: string }>().id));
    expect(rating).toMatchObject({ orgId: company.id, defaultView: "hr" });
  });

  it("invites by email through Better Auth, once", async () => {
    const response = await api(
      t.app,
      owner.cookie,
      "POST",
      `/orgs/${company.id}/invites`,
      {
        email: invitee.email,
        role: "member",
      },
    );
    expect(response.statusCode).toBe(201);
    const invitation = InviteResponse.parse(response.json());
    expect(invitation).toMatchObject({
      email: invitee.email,
      role: "member",
      status: "pending",
    });

    const again = await api(t.app, owner.cookie, "POST", `/orgs/${company.id}/invites`, {
      email: invitee.email,
      role: "member",
    });
    expect(again.statusCode).toBe(409);
    expect(Problem.parse(again.json()).code).toBe("conflict");

    // The invitee accepts through Better Auth's organization API.
    const accepted = await t.app.inject({
      method: "POST",
      url: "/api/auth/organization/accept-invitation",
      headers: {
        origin: ORIGIN,
        cookie: invitee.cookie,
        "content-type": "application/json",
      },
      payload: { invitationId: invitation.id },
    });
    expect(accepted.statusCode).toBe(200);
    expect((await members()).map((m) => [m.email, m.role])).toEqual([
      [owner.email, "owner"],
      [invitee.email, "member"],
    ]);
  });

  it("shows members their own uploads only, and owners everything", async () => {
    await setActiveOrg(t.app, invitee.cookie, company.id);
    expect((await me(invitee)).activeOrgId).toBe(company.id);

    const ownUpload = await upload(t.app, invitee.cookie, qiwaPdf);
    expect(ownUpload.statusCode).toBe(202);
    const ownId = ownUpload.json<{ id: string }>().id;

    const asMember = ListRatingsResponse.parse(
      (await api(t.app, invitee.cookie, "GET", "/ratings")).json(),
    );
    expect(asMember.items.map((item) => item.id)).toEqual([ownId]);

    const asOwner = ListRatingsResponse.parse(
      (await api(t.app, owner.cookie, "GET", "/ratings")).json(),
    );
    expect(asOwner.items).toHaveLength(2);

    const ownersRating = asOwner.items.find((item) => item.id !== ownId)?.id;
    const hidden = await api(t.app, invitee.cookie, "GET", `/ratings/${ownersRating}`);
    expect(hidden.statusCode).toBe(404);
    // An owner may delete a member's rating.
    const deleted = await api(t.app, owner.cookie, "DELETE", `/ratings/${ownId}`);
    expect(deleted.statusCode).toBe(204);
  });

  it("keeps members out of member management and settings", async () => {
    const invite = await api(
      t.app,
      invitee.cookie,
      "POST",
      `/orgs/${company.id}/invites`,
      {
        email: "someone@example.com",
        role: "member",
      },
    );
    expect(invite.statusCode).toBe(403);
    expect(Problem.parse(invite.json()).code).toBe("forbidden");

    const promote = await api(
      t.app,
      invitee.cookie,
      "PATCH",
      `/orgs/${company.id}/members/${invitee.id}`,
      { role: "admin" },
    );
    expect(promote.statusCode).toBe(403);

    const settings = await api(t.app, invitee.cookie, "PATCH", `/orgs/${company.id}`, {
      retentionDays: 7,
    });
    expect(settings.statusCode).toBe(403);

    // Every member can see who else is in the workspace.
    const list = await api(t.app, invitee.cookie, "GET", `/orgs/${company.id}/members`);
    expect(list.statusCode).toBe(200);
  });

  it("changes roles, and admins cannot touch owners", async () => {
    const response = await api(
      t.app,
      owner.cookie,
      "PATCH",
      `/orgs/${company.id}/members/${invitee.id}`,
      { role: "admin" },
    );
    expect(response.statusCode).toBe(200);
    expect(MemberResponse.parse(response.json())).toMatchObject({
      userId: invitee.id,
      role: "admin",
    });

    const demoteOwner = await api(
      t.app,
      invitee.cookie,
      "PATCH",
      `/orgs/${company.id}/members/${owner.id}`,
      { role: "member" },
    );
    expect(demoteOwner.statusCode).toBe(403);

    const makeOwner = await api(
      t.app,
      invitee.cookie,
      "PATCH",
      `/orgs/${company.id}/members/${invitee.id}`,
      { role: "owner" },
    );
    expect(makeOwner.statusCode).toBe(403);

    // As an admin, the invitee now sees every rating in the org.
    const asAdmin = ListRatingsResponse.parse(
      (await api(t.app, invitee.cookie, "GET", "/ratings")).json(),
    );
    expect(asAdmin.items).toHaveLength(1);
  });

  it("never demotes or removes the last owner", async () => {
    const demote = await api(
      t.app,
      owner.cookie,
      "PATCH",
      `/orgs/${company.id}/members/${owner.id}`,
      { role: "admin" },
    );
    expect(demote.statusCode).toBe(409);
    expect(Problem.parse(demote.json()).code).toBe("conflict");

    const remove = await api(
      t.app,
      owner.cookie,
      "DELETE",
      `/orgs/${company.id}/members/${owner.id}`,
    );
    expect(remove.statusCode).toBe(409);

    // With a second owner, the first one can step down.
    await api(t.app, owner.cookie, "PATCH", `/orgs/${company.id}/members/${invitee.id}`, {
      role: "owner",
    });
    const stepDown = await api(
      t.app,
      owner.cookie,
      "PATCH",
      `/orgs/${company.id}/members/${owner.id}`,
      { role: "admin" },
    );
    expect(stepDown.statusCode).toBe(200);
  });

  it("removes a member, who then falls back to their personal workspace", async () => {
    const response = await api(
      t.app,
      invitee.cookie,
      "DELETE",
      `/orgs/${company.id}/members/${owner.id}`,
    );
    expect(response.statusCode).toBe(204);
    const left = await api(t.app, invitee.cookie, "GET", `/orgs/${company.id}/members`);
    const remaining = ListMembersResponse.parse(left.json()).items;
    expect(remaining.map((member) => member.userId)).toEqual([invitee.id]);

    const ownerNow = await me(owner);
    expect(ownerNow.orgs.map((org) => org.kind)).toEqual(["personal"]);
    expect(ownerNow.activeOrgId).toBe(ownerNow.orgs[0]?.id);
  });

  it("updates settings as owner; new retention applies to new uploads", async () => {
    const response = await api(t.app, invitee.cookie, "PATCH", `/orgs/${company.id}`, {
      name: "Example Trading Company",
      retentionDays: 7,
    });
    expect(response.statusCode).toBe(200);
    expect(OrgSummary.parse(response.json())).toMatchObject({
      name: "Example Trading Company",
      retentionDays: 7,
    });

    const uploaded = await upload(t.app, invitee.cookie, qiwaPdf);
    const [rating] = await t.db
      .select()
      .from(ratings)
      .where(eq(ratings.id, uploaded.json<{ id: string }>().id));
    const [document] = await t.db
      .select()
      .from(documents)
      .where(eq(documents.id, rating?.documentId ?? ""));
    const days =
      ((document?.deleteAfter.getTime() ?? 0) - t.clock.now.getTime()) / 86_400_000;
    expect(days).toBe(7);
  });

  it("acts only on the active workspace", async () => {
    const personal = (await me(invitee)).orgs.find((org) => org.kind === "personal");
    const response = await api(
      t.app,
      invitee.cookie,
      "GET",
      `/orgs/${personal?.id}/members`,
    );
    expect(response.statusCode).toBe(404);
    expect(Problem.parse(response.json()).code).toBe("not_found");
  });

  it("does not invite people into a personal workspace", async () => {
    const solo = await signUp(t.app, "Lama Al-Mutairi");
    const orgId = (await me(solo)).activeOrgId;
    const response = await api(t.app, solo.cookie, "POST", `/orgs/${orgId}/invites`, {
      email: "friend@example.com",
      role: "member",
    });
    expect(response.statusCode).toBe(409);
  });
});
