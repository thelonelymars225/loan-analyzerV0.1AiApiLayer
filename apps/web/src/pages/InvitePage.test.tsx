import type { InvitePreview, MeResponse } from "@rater/contracts";
import { screen } from "@testing-library/react";
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

// Better Auth's client keeps its own reference to fetch, so sign-in is stubbed here instead.
const auth = vi.hoisted(() => ({ signedIn: false }));
vi.mock("../lib/auth", () => ({
  signIn: async () => {
    auth.signedIn = true;
    return { ok: true };
  },
  signUp: async () => ({ ok: true }),
  signOut: async () => {},
}));

const preview: InvitePreview = {
  id: "inv_1",
  orgName: "Example Trading Co.",
  role: "member",
  email: "nour@example.com",
  status: "pending",
  expiresAt: "2026-10-11T09:00:00Z",
};

/** Before accepting, the user only has their personal workspace. */
function personalOnly(): MeResponse {
  const me = syntheticMe("org_personal");
  return { ...me, orgs: me.orgs.filter((org) => org.kind === "personal") };
}

describe("InvitePage", () => {
  it("shows the invitation, accepts it and opens the joined workspace", async () => {
    let me = personalOnly();
    const fetchMock = routeFetch({
      "GET /api/v1/me": () => jsonResponse(me),
      "GET /api/v1/invites/inv_1": () => jsonResponse(preview),
      "POST /api/v1/invites/inv_1/accept": () => {
        me = syntheticMe("org_co", "member");
        return jsonResponse(me);
      },
      "GET /api/v1/ratings": () => jsonResponse({ items: [], nextCursor: null }),
    });
    renderWithProviders(<AppRoutes />, { route: "/invite/inv_1" });

    expect(
      await screen.findByRole("heading", { name: "Join Example Trading Co." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/invited as Member/)).toHaveTextContent(
      "The invitation is for nour@example.com",
    );
    expect(screen.getByText(/Your personal workspace stays private/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Accept and join" }));

    expect(
      await screen.findByRole("heading", { name: "Workspace ratings" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace")).toHaveValue("org_co");
    expect(
      screen.getByText("You joined Example Trading Co. and are now working in it."),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/invites/inv_1/accept",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("says when the invite is not for this account or has expired", async () => {
    routeFetch({
      "GET /api/v1/me": () => jsonResponse(personalOnly()),
      "GET /api/v1/invites/inv_x": () => problemResponse(404, "not_found", "Not found."),
    });
    renderWithProviders(<AppRoutes />, { route: "/invite/inv_x" });

    expect(
      await screen.findByText(/This invite is not for this account or has expired/),
    ).toHaveTextContent("You are signed in as nour@example.com");
    expect(
      screen.queryByRole("button", { name: "Accept and join" }),
    ).not.toBeInTheDocument();
  });

  it("says the same when accepting fails because the invite is gone", async () => {
    routeFetch({
      "GET /api/v1/me": () => jsonResponse(personalOnly()),
      "GET /api/v1/invites/inv_1": () => jsonResponse(preview),
      "POST /api/v1/invites/inv_1/accept": () => problemResponse(404, "not_found"),
    });
    renderWithProviders(<AppRoutes />, { route: "/invite/inv_1" });

    await userEvent.click(await screen.findByRole("button", { name: "Accept and join" }));

    expect(
      await screen.findByText(/This invite is not for this account or has expired/),
    ).toBeInTheDocument();
  });

  it("sends signed-out visitors to sign in first, then back to the invitation", async () => {
    auth.signedIn = false;
    routeFetch({
      "GET /api/v1/me": () =>
        auth.signedIn
          ? jsonResponse(personalOnly())
          : problemResponse(401, "unauthorized"),
      "GET /api/v1/invites/inv_1": () => jsonResponse(preview),
    });
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: "/invite/inv_1" });

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(
      screen.getByText(/with the email address the invitation is for/),
    ).toBeInTheDocument();

    // Switching to "create an account" keeps the way back to the invitation.
    await user.click(screen.getByRole("link", { name: "Create an account" }));
    expect(
      await screen.findByText(/with the email address the invitation is for/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Sign in" }));

    await user.type(await screen.findByLabelText("Email"), "nour@example.com");
    await user.type(screen.getByLabelText("Password"), "a-long-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByRole("heading", { name: "Join Example Trading Co." }),
    ).toBeInTheDocument();
  });
});
