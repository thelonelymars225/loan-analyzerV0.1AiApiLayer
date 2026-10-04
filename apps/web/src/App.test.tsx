import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "./App";
import { jsonResponse, renderWithProviders, routeFetch } from "./test/render";

const me = {
  user: { id: "u_1", email: "nour@example.com", name: "Nour Al-Harbi" },
  activeOrgId: "org_co",
  orgs: [
    {
      id: "org_personal",
      name: "Nour Al-Harbi",
      kind: "personal",
      role: "owner",
      retentionDays: 30,
    },
    {
      id: "org_co",
      name: "Example Trading Co.",
      kind: "company",
      role: "admin",
      retentionDays: 60,
    },
  ],
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

  it("opens a company workspace in the HR view with its retention days", async () => {
    routeFetch({
      "GET /api/v1/me": () => jsonResponse(me),
      "GET /api/v1/ratings": () => jsonResponse({ items: [], nextCursor: null }),
    });
    renderWithProviders(<AppRoutes />, { route: "/" });

    expect(
      await screen.findByRole("heading", { name: "Workspace ratings" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace")).toHaveValue("org_co");
    expect(screen.getByLabelText("Open the report in")).toHaveValue("hr");
    expect(screen.getByText(/deleted automatically after 60 days/)).toBeInTheDocument();
    expect(await screen.findByText("No ratings yet")).toBeInTheDocument();
  });

  it("lists members of a company workspace in its settings", async () => {
    routeFetch({
      "GET /api/v1/me": () => jsonResponse(me),
      "GET /api/v1/orgs/org_co/members": () =>
        jsonResponse({
          items: [
            {
              userId: "u_1",
              email: "nour@example.com",
              name: "Nour Al-Harbi",
              role: "admin",
            },
            {
              userId: "u_2",
              email: "sami@example.com",
              name: "Sami Example",
              role: "member",
            },
            {
              userId: "u_3",
              email: "owner@example.com",
              name: "Lina Example",
              role: "owner",
            },
          ],
        }),
    });
    renderWithProviders(<AppRoutes />, { route: "/workspace" });

    expect(await screen.findByText("Sami Example")).toBeInTheDocument();
    // An admin can change a member's role, but not their own and not the owner's.
    expect(screen.getByLabelText("Role for Sami Example")).toHaveValue("member");
    expect(screen.queryByLabelText("Role for Nour Al-Harbi")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Role for Lina Example")).not.toBeInTheDocument();
    // Only the owner changes retention.
    expect(screen.getByLabelText("Delete PDFs after (days)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send invite" })).toBeInTheDocument();
  });
});
