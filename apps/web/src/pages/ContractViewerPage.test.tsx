import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { syntheticReport } from "../test/fixtures";
import { jsonResponse, renderWithProviders, routeFetch } from "../test/render";
import { ContractViewerPage } from "./ContractViewerPage";

const PATH = "/ratings/:id/contract";
const DELETED = { pages: 10, available: false, deletedAt: "2026-11-06T03:00:00Z" };

function serveReport(overrides: Partial<ReturnType<typeof syntheticReport>> = {}) {
  return routeFetch({
    "GET /api/v1/ratings/rt_test_0001": (url) =>
      jsonResponse({
        ...syntheticReport(url.searchParams.get("view") === "hr" ? "hr" : "employee"),
        ...overrides,
      }),
  });
}

function panel() {
  return screen.getByRole("complementary", { name: "Findings in this contract" });
}

function listedTitles(): string[] {
  return within(panel())
    .getAllByRole("listitem")
    .map((item) => within(item).getByRole("button").textContent ?? "");
}

describe("ContractViewerPage", () => {
  it("shows every page with the issues marked, and lists them by severity", async () => {
    serveReport();
    renderWithProviders(<ContractViewerPage />, {
      route: "/ratings/rt_test_0001/contract",
      path: PATH,
    });

    expect(await screen.findByRole("heading", { name: "Contract" })).toBeInTheDocument();
    expect(screen.getByText("10 pages")).toBeInTheDocument();
    const pages = screen.getAllByRole("img", { name: /^Page \d+ of the contract$/ });
    expect(pages).toHaveLength(10);
    expect(pages[7]).toHaveAttribute("src", "/api/v1/ratings/rt_test_0001/pages/8");

    // Numbers follow the contract (15.1 → 1 … 15.6 → 4); the list follows severity, then
    // the contract. The review item only has "Section 15" as its place, so no number.
    expect(listedTitles()).toEqual([
      "1Contract type contradicts Section 1High severityClause 15.1 · Page 8",
      "3Early-termination compensation below the defaultHigh severityClause 15.4 · Page 8",
      "4End-of-service on basic wage onlyHigh severityClause 15.6 · Page 8",
      "2Transfer anywhere in the KingdomMedium severityClause 15.3 · Page 8",
      "·Clause needs reviewLow severitySection 15 · Page 8",
    ]);
    // Every passage is marked: five issues, the conflict twice (clause 15.1 and Section 1).
    const marks = screen.getAllByTestId("page-mark");
    expect(marks).toHaveLength(6);
    // The conflict is marked twice: at clause 15.1 and at Section 1, both with its number.
    expect(
      screen.getAllByRole("button", {
        name: "Finding 1: Contract type contradicts Section 1",
      }),
    ).toHaveLength(2);
  });

  it("opens on the passage a report card links to", async () => {
    serveReport();
    renderWithProviders(<ContractViewerPage />, {
      route:
        "/ratings/rt_test_0001/contract?view=employee&focus=finding-EOS-BASE-01-15-6&clause=15.6&page=8",
      path: PATH,
    });
    await screen.findByRole("heading", { name: "Contract" });

    const selected = within(panel()).getByRole("button", { expanded: true });
    expect(selected).toHaveTextContent("End-of-service on basic wage only");
    expect(screen.getByText(/calculated on your full actual wage/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Finding 4: End-of-service on basic wage only",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "Read in the report" })).toHaveAttribute(
      "href",
      "/ratings/rt_test_0001?view=employee#finding-EOS-BASE-01-15-6",
    );
  });

  it("switches to what's good", async () => {
    serveReport();
    renderWithProviders(<ContractViewerPage />, {
      route: "/ratings/rt_test_0001/contract",
      path: PATH,
    });
    await screen.findByRole("heading", { name: "Contract" });

    await userEvent.click(screen.getByRole("tab", { name: "What's good (1)" }));
    expect(listedTitles()).toEqual([
      "·Annual leave above the minimumNot located in the PDF",
    ]);
    // No issue marks while the good tab is open (and this good finding has no passage).
    expect(screen.queryAllByTestId("page-mark")).toHaveLength(0);
  });

  it("falls back to the clause text once the PDF has been deleted", async () => {
    serveReport({ document: DELETED });
    renderWithProviders(<ContractViewerPage />, {
      route: "/ratings/rt_test_0001/contract",
      path: PATH,
    });
    await screen.findByRole("heading", { name: "Contract" });

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/deleted on 6 Nov 2026/);
    expect(
      screen.getByText("تُحتسب مكافأة نهاية الخدمة على الأجر الأساسي."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open PDF" })).not.toBeInTheDocument();
  });

  it("waits for the rating to finish", async () => {
    serveReport({ status: "extracting", score: null });
    renderWithProviders(<ContractViewerPage />, {
      route: "/ratings/rt_test_0001/contract",
      path: PATH,
    });
    expect(
      await screen.findByText("The contract viewer opens once the rating has finished."),
    ).toBeInTheDocument();
  });
});
