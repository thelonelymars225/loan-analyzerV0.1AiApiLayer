import type { Passage, ReportDocument } from "@rater/contracts";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { syntheticPassage } from "../../test/fixtures";
import { renderWithProviders } from "../../test/render";
import { PassagePreview } from "./PassagePreview";

const AVAILABLE = { pages: 10, available: true, deletedAt: null };
const DELETED = { pages: 10, available: false, deletedAt: "2026-11-06T03:00:00Z" };

const eos = syntheticPassage("15.6", 8, 600, {
  textEn: "The end-of-service award is calculated on the basic wage.",
  textAr: "تُحتسب مكافأة نهاية الخدمة على الأجر الأساسي.",
});

function renderPreview(
  overrides: { passages?: Passage[]; document?: ReportDocument } = {},
) {
  return renderWithProviders(
    <PassagePreview
      ratingId="rt_test_0001"
      itemId="finding-EOS-BASE-01-15-6"
      view="employee"
      passages={overrides.passages ?? [eos]}
      document={overrides.document ?? AVAILABLE}
      tone="critical"
    />,
  );
}

describe("PassagePreview", () => {
  it("loads the page crop from the API and marks the clause once it is shown", () => {
    renderPreview();
    expect(screen.getByText("In the contract")).toBeInTheDocument();
    expect(screen.getByText("Clause 15.6")).toBeInTheDocument();
    expect(screen.getByText("Page 8")).toBeInTheDocument();

    const image = screen.getByRole("img", {
      name: "Page 8 of the contract with clause 15.6 highlighted",
    });
    expect(image).toHaveAttribute("src", "/api/v1/ratings/rt_test_0001/passages/15.6/8");
    // No highlight until the image is there, or it would float over the placeholder.
    expect(screen.queryByTestId("passage-highlight")).not.toBeInTheDocument();

    fireEvent.load(image);
    const highlight = screen.getByTestId("passage-highlight");
    // The box is 40 pt high inside a 76 pt crop that starts 18 pt above it.
    expect(highlight.style.top).toBe(`${(18 / 76) * 100}%`);
    expect(highlight.style.height).toBe(`${(40 / 76) * 100}%`);
    expect(highlight.style.left).toBe(`${(45.4 / 595.92) * 100}%`);
    expect(highlight).toHaveClass("ring-critical");
  });

  it("shows the clause text instead once the PDF has been deleted", () => {
    renderPreview({ document: DELETED });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(
      screen.getByText("تُحتسب مكافأة نهاية الخدمة على الأجر الأساسي."),
    ).toHaveAttribute("dir", "rtl");
    expect(
      screen.getByText("The end-of-service award is calculated on the basic wage."),
    ).toBeInTheDocument();
    expect(screen.getByText(/deleted on 6 Nov 2026/)).toBeInTheDocument();
  });

  it("falls back to the text when the image cannot be loaded", () => {
    renderPreview();
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText(/calculated on the basic wage/)).toBeInTheDocument();
  });

  it("says so when there is neither an image nor stored text", () => {
    renderPreview({ document: DELETED, passages: [syntheticPassage("8.1", 2, 300)] });
    expect(screen.getByText("No text was stored for this passage.")).toBeInTheDocument();
  });

  it("lets the reader switch between a conflict's two passages", async () => {
    renderPreview({
      passages: [syntheticPassage("15.1", 8, 400), syntheticPassage("1", 1, 120)],
    });
    const picker = screen.getByRole("group", { name: "Passages" });
    const [clause, section] = within(picker).getAllByRole("button");
    expect(clause).toHaveTextContent("Clause 15.1");
    expect(clause).toHaveAttribute("aria-pressed", "true");
    expect(section).toHaveTextContent("Section 1");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/v1/ratings/rt_test_0001/passages/15.1/8",
    );

    await userEvent.click(section!);
    expect(section).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/v1/ratings/rt_test_0001/passages/1/1",
    );
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });

  it("explains an approximate passage", () => {
    renderPreview({ passages: [syntheticPassage("15", 8, 360, { approximate: true })] });
    expect(screen.getByText("Section 15")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The exact lines were not found, so this shows Section 15 as a whole.",
      ),
    ).toBeInTheDocument();
  });

  it("renders nothing for a finding with no passage", () => {
    renderPreview({ passages: [] });
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(screen.queryByText("In the contract")).not.toBeInTheDocument();
  });
});
