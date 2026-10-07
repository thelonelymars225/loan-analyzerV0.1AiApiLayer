import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import { syntheticMe } from "../test/fixtures";
import { jsonResponse, renderWithProviders, routeFetch } from "../test/render";

// Better Auth's client keeps its own reference to fetch, so sign-out is stubbed here.
const auth = vi.hoisted(() => ({ signOut: vi.fn(async () => {}) }));
vi.mock("../lib/auth", () => ({
  signIn: async () => ({ ok: true }),
  signUp: async () => ({ ok: true }),
  signOut: auth.signOut,
}));

describe("AccountPage", () => {
  it("'Delete my data' is one server call", async () => {
    const fetchMock = routeFetch({
      "GET /api/v1/me": () => jsonResponse(syntheticMe()),
      "DELETE /api/v1/me/data": () => new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: "/account" });

    await user.click(await screen.findByRole("button", { name: "Delete my data" }));
    await user.click(screen.getByLabelText("I understand that this can't be undone."));
    await user.click(screen.getAllByRole("button", { name: "Delete my data" }).at(-1)!);

    expect(
      await screen.findByText("Your data was deleted and you have been signed out."),
    ).toBeInTheDocument();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    // No listing and no per-rating deletes: the API deletes the user's data itself.
    const changes = fetchMock.mock.calls
      .filter(([, init]) => (init?.method ?? "GET") !== "GET")
      .map(([url, init]) => `${init?.method} ${String(url)}`);
    expect(changes).toEqual(["DELETE /api/v1/me/data"]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(
      "/api/v1/ratings",
    );
  });
});
