import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { syntheticReport } from "../test/fixtures";
import { jsonResponse, renderWithProviders, routeFetch } from "../test/render";
import { ReportPage } from "./ReportPage";

const PATH = "/ratings/:id";

describe("ReportPage", () => {
  it("loads the default view, then fetches the HR view when the HR tab is chosen", async () => {
    const fetchMock = routeFetch({
      "GET /api/v1/ratings/rt_test_0001": (url) =>
        jsonResponse(
          syntheticReport(url.searchParams.get("view") === "hr" ? "hr" : "employee"),
        ),
    });
    renderWithProviders(<ReportPage />, { route: "/ratings/rt_test_0001", path: PATH });

    expect(await screen.findByText("Is this fair to me?")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/v1/ratings/rt_test_0001");

    await userEvent.click(screen.getByRole("tab", { name: "HR" }));

    expect(await screen.findByText("Is this compliant?")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe(
      "/api/v1/ratings/rt_test_0001?view=hr",
    );
    expect(
      screen.getByRole("heading", { name: "Likely void clauses" }),
    ).toBeInTheDocument();
  });

  it("shows live progress while the rating runs", async () => {
    routeFetch({
      "GET /api/v1/ratings/rt_run": () =>
        jsonResponse({
          ...syntheticReport("employee"),
          id: "rt_run",
          status: "extracting",
          score: null,
        }),
    });
    renderWithProviders(<ReportPage />, { route: "/ratings/rt_run", path: PATH });

    expect(await screen.findByText("Rating in progress")).toBeInTheDocument();
    expect(screen.getByText("Status: Reading")).toHaveAttribute("aria-live", "polite");
    // jsdom has no EventSource, so the page says it polls instead.
    expect(
      screen.getByText("Checking for updates every few seconds."),
    ).toBeInTheDocument();
  });

  it("explains why a rating failed", async () => {
    routeFetch({
      "GET /api/v1/ratings/rt_fail": () =>
        jsonResponse({
          ...syntheticReport("employee"),
          id: "rt_fail",
          status: "failed",
          score: null,
          error: {
            code: "unsupported_document",
            message:
              "The PDF could not be read. It may be damaged or password-protected.",
          },
        }),
    });
    renderWithProviders(<ReportPage />, { route: "/ratings/rt_fail", path: PATH });

    expect(await screen.findByText("We couldn't rate this contract")).toBeInTheDocument();
    // A damaged Qiwa PDF is not called "not a Qiwa contract": the stored reason is shown.
    expect(
      screen.getByText(
        "The PDF could not be read. It may be damaged or password-protected.",
      ),
    ).toBeInTheDocument();
  });

  it("says when a rating does not exist", async () => {
    routeFetch({});
    renderWithProviders(<ReportPage />, { route: "/ratings/rt_gone", path: PATH });

    expect(
      await screen.findByText("This rating doesn't exist or was deleted."),
    ).toBeInTheDocument();
  });

  it("deletes the rating after confirmation and goes back to the list", async () => {
    const fetchMock = routeFetch({
      "GET /api/v1/ratings/rt_test_0001": () => jsonResponse(syntheticReport("employee")),
      "DELETE /api/v1/ratings/rt_test_0001": () => new Response(null, { status: 204 }),
    });
    renderWithProviders(<ReportPage />, { route: "/ratings/rt_test_0001", path: PATH });

    await userEvent.click(await screen.findByRole("button", { name: "Delete rating" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this rating?" });
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "DELETE" }),
    );

    await userEvent.click(
      screen.getAllByRole("button", { name: "Delete rating" }).at(-1)!,
    );

    expect(await screen.findByText("other page")).toBeInTheDocument();
    expect(dialog).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/ratings/rt_test_0001",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(screen.getByText("Rating deleted.")).toBeInTheDocument();
  });
});
