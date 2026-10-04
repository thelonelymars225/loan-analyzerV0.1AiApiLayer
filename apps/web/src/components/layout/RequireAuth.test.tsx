import type { RatingSummary } from "@rater/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "../../App";
import { syntheticMe } from "../../test/fixtures";
import {
  jsonResponse,
  problemResponse,
  renderWithProviders,
  routeFetch,
} from "../../test/render";

const doneRating: RatingSummary = {
  id: "rt_1",
  status: "done",
  defaultView: "employee",
  scoreOverall: 70,
  band: "Fair",
  createdAt: "2026-10-01T09:00:00Z",
  finishedAt: "2026-10-01T09:01:00Z",
};

describe("Workspaces", () => {
  it("switches through PUT /me/active-org, never Better Auth's organization API", async () => {
    let me = syntheticMe("org_personal");
    const fetchMock = routeFetch({
      "GET /api/v1/me": () => jsonResponse(me),
      "PUT /api/v1/me/active-org": (_url, init) => {
        const { orgId } = JSON.parse(String(init?.body)) as { orgId: string };
        me = syntheticMe(orgId);
        return jsonResponse(me);
      },
      "GET /api/v1/ratings": () => jsonResponse({ items: [], nextCursor: null }),
    });
    renderWithProviders(<AppRoutes />, { route: "/" });

    await userEvent.selectOptions(await screen.findByLabelText("Workspace"), "org_co");

    expect(
      await screen.findByRole("heading", { name: "Workspace ratings" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("You're now working in Example Trading Co."),
    ).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain("/api/v1/me/active-org");
    expect(urls.some((url) => url.includes("/organization/"))).toBe(false);
  });

  it("when another tab switched the workspace, refuses quietly, moves to it and says why", async () => {
    // This tab still shows the personal workspace; another tab made the company active.
    let me = syntheticMe("org_personal");
    const fetchMock = routeFetch({
      "GET /api/v1/me": () => jsonResponse(me),
      "GET /api/v1/ratings": () =>
        jsonResponse({ items: [doneRating], nextCursor: null }),
      "DELETE /api/v1/ratings/rt_1": () => {
        me = syntheticMe("org_co");
        return problemResponse(
          409,
          "conflict",
          "Your active workspace was changed, probably in another tab.",
        );
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: "/" });

    await user.click(await screen.findByRole("button", { name: /^Delete Rating from/ }));
    await user.click(screen.getByRole("button", { name: "Delete rating" }));

    expect(
      await screen.findByText(
        "Your workspace changed to Example Trading Co., probably in another tab, so nothing was saved here. Check it and try again.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Workspace")).toHaveValue("org_co"));
    // The refused change named the workspace this tab was showing.
    const remove = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE")!;
    expect(new Headers(remove[1]?.headers).get("x-org-id")).toBe("org_personal");
  });
});
