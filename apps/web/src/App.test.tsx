import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "./App";
import { jsonResponse, renderWithProviders, routeFetch } from "./test/render";

const me = {
  user: { id: "u_1", email: "nour@example.com", name: "Nour Al-Harbi" },
};

describe("App routes", () => {
  it("sends signed-out visitors to the sign-in page", async () => {
    routeFetch({
      "GET /api/v1/me": () =>
        jsonResponse(
          {
            type: "about:blank",
            title: "Unauthorized",
            status: 401,
            code: "unauthorized",
          },
          401,
          "application/problem+json",
        ),
    });
    renderWithProviders(<AppRoutes />, { route: "/" });

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("opens the ratings page in the employee view with the retention days", async () => {
    routeFetch({
      "GET /api/v1/me": () => jsonResponse(me),
      "GET /api/v1/ratings": () => jsonResponse({ items: [], nextCursor: null }),
    });
    renderWithProviders(<AppRoutes />, { route: "/" });

    expect(
      await screen.findByRole("heading", { name: "Your ratings" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Open the report in")).toHaveValue("employee");
    expect(screen.getByText(/deleted automatically after 30 days/)).toBeInTheDocument();
    expect(await screen.findByText("No ratings yet")).toBeInTheDocument();
  });
});
