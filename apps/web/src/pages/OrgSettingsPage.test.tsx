import type { InviteResponse } from "@rater/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import { syntheticMe } from "../test/fixtures";
import {
  jsonResponse,
  problemResponse,
  renderWithProviders,
  routeFetch,
} from "../test/render";

const pendingInvite = (id: string, email: string): InviteResponse => ({
  id,
  email,
  role: "member",
  status: "pending",
  expiresAt: "2026-10-11T09:00:00Z",
  acceptPath: `/invite/${id}`,
});

/** The workspace settings of a company where the user is an admin, with invites in memory. */
function setup(pending: InviteResponse[]) {
  const fetchMock = routeFetch({
    "GET /api/v1/me": () => jsonResponse(syntheticMe("org_co")),
    "GET /api/v1/orgs/org_co/members": () => jsonResponse({ items: [] }),
    "GET /api/v1/orgs/org_co/invites": () => jsonResponse({ items: pending }),
    "POST /api/v1/orgs/org_co/invites": (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { email: string };
      const created = pendingInvite("inv_new", body.email);
      pending.unshift(created);
      return jsonResponse(created, 201);
    },
    "DELETE /api/v1/orgs/org_co/invites/inv_old": () => {
      pending.splice(0, pending.length, ...pending.filter((i) => i.id !== "inv_old"));
      return new Response(null, { status: 204 });
    },
  });
  const user = userEvent.setup(); // also gives jsdom a working clipboard
  renderWithProviders(<AppRoutes />, { route: "/workspace" });
  return { fetchMock, user };
}

describe("Invitations in workspace settings", () => {
  it("creates an invite, then lists it with the full link to share and copies it", async () => {
    const { fetchMock, user } = setup([]);

    expect(await screen.findByText(/No email is sent/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "sara@example.com");
    await user.click(screen.getByRole("button", { name: "Create invite" }));

    expect(
      await screen.findByText("Invitation created for sara@example.com."),
    ).toBeInTheDocument();
    const link = `${window.location.origin}/invite/inv_new`;
    const list = await screen.findByRole("region", { name: "Pending invitations" });
    expect(await within(list).findByText(link)).toBeInTheDocument();

    await user.click(
      within(list).getByRole("button", {
        name: "Copy the invite link for sara@example.com",
      }),
    );
    expect(await navigator.clipboard.readText()).toBe(link);
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();

    // The change names the workspace the page shows.
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(new Headers(post[1]?.headers).get("x-org-id")).toBe("org_co");
  });

  it("lists pending invites with their links and cancels one", async () => {
    const { fetchMock, user } = setup([pendingInvite("inv_old", "lina@example.com")]);

    const list = await screen.findByRole("region", { name: "Pending invitations" });
    expect(await within(list).findByText("lina@example.com")).toBeInTheDocument();
    expect(
      within(list).getByText(`${window.location.origin}/invite/inv_old`),
    ).toBeInTheDocument();

    await user.click(
      within(list).getByRole("button", {
        name: "Cancel the invitation for lina@example.com",
      }),
    );

    expect(await within(list).findByText("No pending invitations.")).toBeInTheDocument();
    expect(screen.getByText("Invitation cancelled.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/orgs/org_co/invites/inv_old",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("explains a failed copy instead of claiming success", async () => {
    const { user } = setup([pendingInvite("inv_old", "lina@example.com")]);
    const list = await screen.findByRole("region", { name: "Pending invitations" });
    await within(list).findByText("lina@example.com");

    // For example a page served over plain HTTP from another machine.
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    await user.click(
      within(list).getByRole("button", {
        name: "Copy the invite link for lina@example.com",
      }),
    );
    expect(await screen.findByText(/Couldn't copy the link/)).toBeInTheDocument();
  });

  it("shows the API's reason when the address is already invited", async () => {
    routeFetch({
      "GET /api/v1/me": () => jsonResponse(syntheticMe("org_co")),
      "GET /api/v1/orgs/org_co/members": () => jsonResponse({ items: [] }),
      "GET /api/v1/orgs/org_co/invites": () => jsonResponse({ items: [] }),
      "POST /api/v1/orgs/org_co/invites": () =>
        problemResponse(409, "conflict", "Already a member or invited."),
    });
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: "/workspace" });

    await user.type(await screen.findByLabelText("Email"), "sara@example.com");
    await user.click(screen.getByRole("button", { name: "Create invite" }));

    expect(await screen.findByText("Already a member or invited.")).toBeInTheDocument();
    // An ordinary conflict: the workspace did not change, so the page stays where it is.
    await waitFor(() => expect(screen.getByLabelText("Workspace")).toHaveValue("org_co"));
    expect(screen.queryByText(/changed in another tab/)).not.toBeInTheDocument();
  });
});
