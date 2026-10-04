import { RatingReport } from "@rater/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { syntheticReport } from "../../test/fixtures";
import { ReportView } from "./ReportView";

function findingTitles(): string[] {
  const list = screen
    .getByRole("heading", { name: /issues found/i })
    .parentElement!.querySelector("ol")!;
  return within(list)
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent ?? "");
}

function sectionHeadings(): string[] {
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent ?? "");
}

describe("ReportView", () => {
  it("uses a fixture that matches the API contract", () => {
    expect(RatingReport.safeParse(syntheticReport("employee")).success).toBe(true);
    expect(RatingReport.safeParse(syntheticReport("hr")).success).toBe(true);
  });

  it("employee view: deadlines first, findings by SAR impact, employee wording and 'what to ask for'", () => {
    render(<ReportView report={syntheticReport("employee")} onViewChange={() => {}} />);

    const headings = sectionHeadings();
    expect(headings.indexOf("Deadlines")).toBeLessThan(
      headings.findIndex((h) => h.startsWith("Issues found")),
    );
    expect(headings).not.toContain("Likely void clauses");

    expect(findingTitles()).toEqual([
      "Early-termination compensation below the default",
      "End-of-service on basic wage only",
      "Contract type contradicts Section 1",
      "Transfer anywhere in the Kingdom",
      "Clause needs review",
    ]);

    expect(screen.getByText(/calculated on your full actual wage/)).toBeInTheDocument();
    expect(screen.queryByText(/Likely void and unenforceable/)).not.toBeInTheDocument();
    expect(screen.getAllByText("What to ask for").length).toBeGreaterThan(0);
    expect(screen.queryByText("Suggested wording")).not.toBeInTheDocument();
    expect(screen.getByText("Is this fair to me?")).toBeInTheDocument();
    expect(
      screen.getByText("To stop auto-renewal, give notice on Qiwa by 31 Jan 2027."),
    ).toBeInTheDocument();
  });

  it("HR view: likely-void block first, findings by severity, HR wording and 'suggested wording'", () => {
    render(<ReportView report={syntheticReport("hr")} onViewChange={() => {}} />);

    const headings = sectionHeadings();
    expect(headings[1]).toBe("Likely void clauses");
    expect(headings.indexOf("Deadlines")).toBeGreaterThan(
      headings.findIndex((h) => h.startsWith("Issues found")),
    );

    expect(findingTitles()).toEqual([
      "End-of-service on basic wage only",
      "Contract type contradicts Section 1",
      "Early-termination compensation below the default",
      "Transfer anywhere in the Kingdom",
      "Clause needs review",
    ]);

    const likelyVoid = screen
      .getByRole("heading", { name: "Likely void clauses" })
      .closest("section")!;
    expect(
      within(likelyVoid).getByRole("link", { name: "End-of-service on basic wage only" }),
    ).toHaveAttribute("href", "#finding-EOS-BASE-01-15-6");

    expect(screen.getByText(/Likely void and unenforceable/)).toBeInTheDocument();
    expect(
      screen.queryByText(/calculated on your full actual wage/),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Suggested wording").length).toBeGreaterThan(0);
    expect(screen.queryByText("What to ask for")).not.toBeInTheDocument();
    expect(screen.getByText("Is this compliant?")).toBeInTheDocument();
  });

  it("shows the score, the sub-scores and the low-confidence tag on market fairness", () => {
    render(<ReportView report={syntheticReport("employee")} onViewChange={() => {}} />);

    expect(
      screen.getByRole("img", { name: "Overall score 64 out of 100, rated Fair" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Legal compliance" })).toHaveAttribute(
      "aria-valuenow",
      "52",
    );
    const market = screen.getByRole("progressbar", { name: "Market fairness" });
    expect(market).toHaveAccessibleDescription(/no salary data by occupation/);
  });

  it("renders the SAR impact table, needs-review marker and the versions footer", () => {
    render(<ReportView report={syntheticReport("employee")} onViewChange={() => {}} />);

    const eosCard = document.getElementById("finding-EOS-BASE-01-15-6")!;
    const table = within(eosCard).getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["After 1 year", "After 5 years", "After 10 years"]);
    expect(within(table).getByText("SAR 8,750")).toBeInTheDocument();

    const reviewCard = document.getElementById("finding-REVIEW-00-15-8")!;
    expect(within(reviewCard).getByText(/Needs human review/)).toBeInTheDocument();

    expect(screen.getByText(/Versions used/).closest("p")).toHaveTextContent(
      "Law 2025-11 · Rules 0.1.0 · Prompt s15-v1 · Model heuristic-v1",
    );
    expect(screen.getByText("Rating aid, not legal advice.")).toBeInTheDocument();
  });

  it("asks for the other view when a tab is chosen", async () => {
    const onViewChange = vi.fn();
    render(
      <ReportView report={syntheticReport("employee")} onViewChange={onViewChange} />,
    );

    expect(screen.getByRole("tab", { name: "Employee" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.click(screen.getByRole("tab", { name: "HR" }));
    expect(onViewChange).toHaveBeenCalledWith("hr");
  });
});
