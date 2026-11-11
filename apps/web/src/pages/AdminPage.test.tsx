import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "../App";
import { syntheticMe } from "../test/fixtures";
import { jsonResponse, renderWithProviders, routeFetch } from "../test/render";

const customer = {
  id: "u_2",
  name: "Salem Al-Otaibi",
  email: "salem@example.com",
  apiAccess: false,
  createdAt: "2026-11-01T08:00:00.000Z",
};

describe("AdminPage", () => {
  it("lets an admin grant API access, and shows the API keys link only with access", async () => {
    const fetchMock = routeFetch({
      "GET /api/v1/me": () => jsonResponse({ ...syntheticMe(), isAdmin: true }),
      "GET /api/v1/admin/users": () => jsonResponse({ users: [customer] }),
      "POST /api/v1/admin/users/u_2/api-access": () =>
        new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: "/admin" });

    expect(await screen.findByText("salem@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "API keys" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Grant access" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/users/u_2/api-access",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("is not there for other users", async () => {
    routeFetch({ "GET /api/v1/me": () => jsonResponse(syntheticMe()) });
    renderWithProviders(<AppRoutes />, { route: "/admin" });
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });
});
