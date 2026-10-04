import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  InvitePreview,
  InviteResponse,
  ListInvitesResponse,
  ListMembersResponse,
  MeResponse,
  OrgSummary,
  Problem,
} from "@rater/contracts";
import { invitations } from "@rater/db";
import {
  DATABASE_URL,
  ORIGIN,
  api,
  createTestContext,
  setActiveOrg,
  signUp,
  uniqueEmail,
  type TestContext,
  type TestUser,
} from "./helpers";

describe.skipIf(!DATABASE_URL)("invitations", () => {
  let t: TestContext;
  let owner: TestUser;
  let member: TestUser;
  let company: OrgSummary;

  beforeAll(async () => {
    t = await createTestContext();
    owner = await signUp(t.app, "Reem Al-Dosari");
    member = await signUp(t.app, "Omar Al-Harbi");

    const created = await api(t.app, owner.cookie, "POST", "/orgs", {
      name: "Example Trading Co.",
    });
    company = OrgSummary.parse(created.json());
    await setActiveOrg(t.app, owner.cookie, company.id);

    // A plain member, invited and accepted the normal way.
    const invite = await createInvite(member.email, "member");
    const accepted = await api(
      t.app,
      member.cookie,
      "POST",
      `/invites/${invite.id}/accept`,
    );
    expect(accepted.statusCode).toBe(200);
  });
  afterAll(async () => {
    await t?.close();
  });

  async function createInvite(email: string, role: "admin" | "member") {
    const response = await api(
      t.app,
      owner.cookie,
      "POST",
      `/orgs/${company.id}/invites`,
      {
        email,
        role,
      },
    );
    expect(response.statusCode).toBe(201);
    return InviteResponse.parse(response.json());
  }

  async function listInvites(cookie: string) {
    return api(t.app, cookie, "GET", `/orgs/${company.id}/invites`);
  }

  it("returns a link to share, and lists pending invitations to owners and admins", async () => {
    const email = uniqueEmail();
    const invite = await createInvite(email, "admin");
    expect(invite).toMatchObject({
      email,
      role: "admin",
      status: "pending",
      acceptPath: `/invite/${invite.id}`,
    });
    expect(Date.parse(invite.expiresAt)).toBeGreaterThan(t.clock.now.getTime());

    const response = await listInvites(owner.cookie);
    expect(response.statusCode).toBe(200);
    const listed = ListInvitesResponse.parse(response.json()).items;
    expect(listed.map((item) => item.id)).toContain(invite.id);
    // Accepted invitations are not pending any more.
    expect(listed.map((item) => item.email)).not.toContain(member.email);
  });

  it("never shows invitation ids to plain members", async () => {
    await createInvite(uniqueEmail(), "admin");
    await setActiveOrg(t.app, member.cookie, company.id);

    const response = await listInvites(member.cookie);
    expect(response.statusCode).toBe(403);
    expect(Problem.parse(response.json()).code).toBe("forbidden");
  });

  it("closes Better Auth's own organization endpoints (the takeover route)", async () => {
    const invite = await createInvite(uniqueEmail(), "admin");
    const calls: [string, string, object | undefined][] = [
      ["GET", `/organization/list-invitations?organizationId=${company.id}`, undefined],
      [
        "GET",
        `/organization/get-full-organization?organizationId=${company.id}`,
        undefined,
      ],
      ["GET", `/organization/get-invitation?id=${invite.id}`, undefined],
      ["POST", "/organization/accept-invitation", { invitationId: invite.id }],
      ["POST", "/organization/set-active", { organizationId: company.id }],
      [
        "POST",
        "/organization/invite-member",
        { email: uniqueEmail(), role: "owner", organizationId: company.id },
      ],
      ["POST", "/organization/update", { data: { name: "Taken Over Co." } }],
    ];
    for (const [method, path, payload] of calls) {
      const response = await t.app.inject({
        method: method as "GET" | "POST",
        url: `/api/auth${path}`,
        headers: {
          origin: ORIGIN,
          cookie: member.cookie,
          ...(payload ? { "content-type": "application/json" } : {}),
        },
        ...(payload ? { payload } : {}),
      });
      expect(response.statusCode, `${method} ${path}`).toBe(404);
      expect(Problem.parse(response.json()).code).toBe("not_found");
    }

    // Even an account made with the invited address cannot use Better Auth to accept.
    const impostor = await signUp(t.app, "Salem Al-Otaibi", invite.email);
    const viaBetterAuth = await t.app.inject({
      method: "POST",
      url: "/api/auth/organization/accept-invitation",
      headers: {
        origin: ORIGIN,
        cookie: impostor.cookie,
        "content-type": "application/json",
      },
      payload: { invitationId: invite.id },
    });
    expect(viaBetterAuth.statusCode).toBe(404);
    const [stored] = await t.db
      .select()
      .from(invitations)
      .where(eq(invitations.id, invite.id));
    expect(stored?.status).toBe("pending");
  });

  it("answers 404 to anyone but the invitee, on preview and accept", async () => {
    const invite = await createInvite(uniqueEmail(), "admin");
    const outsider = await signUp(t.app, "Huda Al-Shehri");
    for (const user of [outsider, member, owner]) {
      const preview = await api(t.app, user.cookie, "GET", `/invites/${invite.id}`);
      expect(preview.statusCode).toBe(404);
      expect(Problem.parse(preview.json()).code).toBe("not_found");
      const accept = await api(
        t.app,
        user.cookie,
        "POST",
        `/invites/${invite.id}/accept`,
      );
      expect(accept.statusCode).toBe(404);
    }
    const unknown = await api(
      t.app,
      outsider.cookie,
      "GET",
      "/invites/inv_does_not_exist",
    );
    expect(unknown.statusCode).toBe(404);

    const members = ListMembersResponse.parse(
      (await api(t.app, owner.cookie, "GET", `/orgs/${company.id}/members`)).json(),
    ).items;
    expect(members.map((m) => m.userId)).not.toContain(outsider.id);
  });

  it("lets the invitee preview and accept, whatever the letter case of the address", async () => {
    const email = uniqueEmail();
    const invite = await createInvite(email, "admin");
    const invitee = await signUp(t.app, "Lama Al-Mutairi", email.toUpperCase());

    const preview = await api(t.app, invitee.cookie, "GET", `/invites/${invite.id}`);
    expect(preview.statusCode).toBe(200);
    expect(InvitePreview.parse(preview.json())).toEqual({
      id: invite.id,
      orgName: "Example Trading Co.",
      role: "admin",
      email,
      status: "pending",
      expiresAt: invite.expiresAt,
    });

    // The tab shows the personal workspace; accepting switches anyway (no 409).
    const personal = MeResponse.parse(
      (await api(t.app, invitee.cookie, "GET", "/me")).json(),
    ).activeOrgId;
    const accepted = await api(
      t.app,
      invitee.cookie,
      "POST",
      `/invites/${invite.id}/accept`,
      undefined,
      { "x-org-id": personal ?? "" },
    );
    expect(accepted.statusCode).toBe(200);
    const me = MeResponse.parse(accepted.json());
    expect(me.activeOrgId).toBe(company.id);
    expect(me.orgs.find((org) => org.id === company.id)?.role).toBe("admin");
    // The session itself switched, not just this answer.
    const after = MeResponse.parse(
      (await api(t.app, invitee.cookie, "GET", "/me")).json(),
    );
    expect(after.activeOrgId).toBe(company.id);

    // An invitation is used once.
    const again = await api(
      t.app,
      invitee.cookie,
      "POST",
      `/invites/${invite.id}/accept`,
    );
    expect(again.statusCode).toBe(404);
  });

  it("does not accept an expired invitation", async () => {
    const email = uniqueEmail();
    const invite = await createInvite(email, "member");
    const invitee = await signUp(t.app, "Faisal Al-Qahtani", email);
    await t.db
      .update(invitations)
      .set({ expiresAt: new Date(t.clock.now.getTime() - 1000) })
      .where(eq(invitations.id, invite.id));

    expect(
      (await api(t.app, invitee.cookie, "GET", `/invites/${invite.id}`)).statusCode,
    ).toBe(404);
    const accept = await api(
      t.app,
      invitee.cookie,
      "POST",
      `/invites/${invite.id}/accept`,
    );
    expect(accept.statusCode).toBe(404);
    const listed = ListInvitesResponse.parse(
      (await listInvites(owner.cookie)).json(),
    ).items;
    expect(listed.map((item) => item.id)).not.toContain(invite.id);
  });

  it("cancels an invitation (owner or admin only)", async () => {
    const email = uniqueEmail();
    const invite = await createInvite(email, "member");
    const invitee = await signUp(t.app, "Noura Al-Saud", email);
    const path = `/orgs/${company.id}/invites/${invite.id}`;

    const asMember = await api(t.app, member.cookie, "DELETE", path);
    expect(asMember.statusCode).toBe(403);

    expect((await api(t.app, owner.cookie, "DELETE", path)).statusCode).toBe(204);
    expect((await api(t.app, owner.cookie, "DELETE", path)).statusCode).toBe(404);
    const listed = ListInvitesResponse.parse(
      (await listInvites(owner.cookie)).json(),
    ).items;
    expect(listed.map((item) => item.id)).not.toContain(invite.id);
    expect(
      (await api(t.app, invitee.cookie, "GET", `/invites/${invite.id}`)).statusCode,
    ).toBe(404);

    // The same address can be invited again.
    const second = await createInvite(email, "member");
    expect(second.id).not.toBe(invite.id);
  });
});
