import { describe, expect, it } from "vitest";
import { formatCitation } from "../src";

describe("formatCitation", () => {
  it("cites Labor Law articles and paragraphs", () => {
    expect(formatCitation({ source: "labor_law", article: "84", paragraph: null })).toBe(
      "Art. 84",
    );
    expect(formatCitation({ source: "labor_law", article: "83", paragraph: "1" })).toBe(
      "Art. 83(1)",
    );
    expect(
      formatCitation({ source: "labor_law", article: "79 bis", paragraph: null }),
    ).toBe("Art. 79 bis");
  });

  it("cites the Implementing Regulations", () => {
    expect(
      formatCitation({
        source: "implementing_regulations",
        article: "20",
        paragraph: null,
      }),
    ).toBe("Exec. Reg. Art. 20");
  });

  it("cites Qiwa template clauses", () => {
    expect(
      formatCitation({ source: "qiwa_template", article: "14.5", paragraph: null }),
    ).toBe("Contract cl. 14.5");
  });
});
