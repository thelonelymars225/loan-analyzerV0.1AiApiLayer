import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectQiwa, extractContract, parseBboxXhtml } from "@rater/core";
import { pdftotextBbox, toolsAvailable } from "@rater/pdf";
import { afterAll, describe, expect, it } from "vitest";
import { CaseSpec } from "../lib/case-spec";
import { fillTemplate, renderQiwaHtml, renderQiwaPdf, spacedIban } from "../lib/render";

describe("CaseSpec", () => {
  it("fills every field with synthetic defaults", () => {
    const spec = CaseSpec.parse({ id: "defaults" });
    expect(spec.contract.type).toBe("fixed_term");
    expect(spec.employee.idNo).toBe("1000000001");
    expect(spec.bank.iban).toBe("SA0000000000000000000000");
    expect(spec.wage.total).toBeNull();
    expect(spec.section15).toEqual([]);
  });

  it("keeps nested defaults when a case overrides one field", () => {
    const spec = CaseSpec.parse({
      id: "partial",
      wage: { basic: 5000 },
      employer: { signatory: { idNo: "1000000099" } },
    });
    expect(spec.wage).toMatchObject({ basic: 5000, housing: 2500, transport: 1000 });
    expect(spec.employer.signatory).toMatchObject({
      idNo: "1000000099",
      name: { en: "Fahad Al-Mithali" },
    });
  });

  it("rejects bad ids, dates and IBANs", () => {
    expect(() => CaseSpec.parse({ id: "Bad Id" })).toThrow();
    expect(() =>
      CaseSpec.parse({ id: "x", contract: { commencementDate: "01/02/2025" } }),
    ).toThrow();
    expect(() => CaseSpec.parse({ id: "x", bank: { iban: "SA00" } })).toThrow();
  });
});

describe("renderQiwaHtml", () => {
  it("prints the case values in Qiwa formats", () => {
    const html = renderQiwaHtml({
      id: "formats",
      contract: { commencementDate: "2025-03-02", termMonths: 12 },
      wage: { basic: 11000, housing: 2750, transport: 1100 },
    });
    expect(html).toContain("2025/03/02");
    expect(html).toContain("2026/03/01"); // end date = commencement + 12 months - 1 day
    expect(html).toContain("valid for a period of 1 year");
    expect(html).toContain("11,000.00 Monthly");
    expect(html).toContain("14,850.00 Monthly"); // total defaults to the sum
    expect(html).toContain("SA 00 0000 0000 0000 0000 0000");
    expect(html).not.toContain("Other Allowances");
    expect(html).not.toMatch(/\{\{/);
  });

  it("numbers Section 15 items and escapes their text", () => {
    const html = renderQiwaHtml({
      id: "s15",
      section15: [
        { en: "First <b>term</b>", ar: "البند الأول" },
        { en: "Second & last", ar: "البند الثاني" },
      ],
    });
    expect(html).toContain("15.1 First &lt;b&gt;term&lt;/b&gt;");
    expect(html).toContain("15.2 Second &amp; last");
    expect(html).toContain("15.2 البند الثاني");
  });

  it("omits the end date for indefinite contracts and prints other allowances when set", () => {
    const html = renderQiwaHtml({
      id: "indef",
      contract: { type: "indefinite" },
      wage: { other: 400 },
    });
    expect(html).not.toContain("Contract end date:");
    expect(html).toContain("valid for an indefinite period");
    expect(html).toContain("9.1.1.4 Other Allowances:");
  });
});

describe("fillTemplate", () => {
  it("throws on an unknown field or slot", () => {
    expect(() => fillTemplate("{{missing}}", {}, {})).toThrow(/unknown field/);
    expect(() => fillTemplate("{{{missing}}}", {}, {})).toThrow(/unknown slot/);
    expect(fillTemplate("<p>{{a}}</p>{{{b}}}", { a: "<x>" }, { b: "<i>raw</i>" })).toBe(
      "<p>&lt;x&gt;</p><i>raw</i>",
    );
  });
});

describe("spacedIban", () => {
  it("groups like the Qiwa form", () => {
    expect(spacedIban("SA0712345678901234567890")).toBe("SA 07 1234 5678 9012 3456 7890");
  });
});

const tools = await toolsAvailable();

describe.skipIf(!tools.pdftotext)("renderQiwaPdf round trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "rater-render-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("renders a PDF that the extractor reads back exactly", async () => {
    const path = join(dir, "case.pdf");
    await renderQiwaPdf(
      {
        id: "round-trip",
        contract: { type: "specific_work", commencementDate: "2025-05-04" },
        employee: { nationality: { en: "Indian", ar: "هندي" } },
        probationDays: 270,
        hours: { workDaysPerWeek: 6, dailyHours: 9, restDaysPerWeek: 1 },
        annualLeaveDays: 15,
        wage: { basic: 6000, housing: 1500, transport: 600, other: 250 },
        overtimePremiumPct: 25,
        section15: [
          { en: "The probationary period is 270 days.", ar: "مدة التجربة 270 يومًا." },
        ],
      },
      path,
    );
    const pages = parseBboxXhtml(await pdftotextBbox(readFileSync(path)));
    expect(detectQiwa(pages)).toEqual({ ok: true });
    const result = extractContract(pages);
    expect(result.fields).toMatchObject({
      contractType: "specific_work",
      commencementDate: "2025-05-04",
      endDate: null,
      probationDays: 270,
      workDaysPerWeek: 6,
      dailyHours: 9,
      weeklyHours: 54,
      restDaysPerWeek: 1,
      annualLeaveDays: 15,
      wage: { basic: 6000, housing: 1500, transport: 600, other: 250, total: 8350 },
      overtimePremiumPct: 25,
      nationality: "non_saudi",
    });
    expect(result.clauses.map((c) => [c.number, c.textEn])).toEqual([
      ["15.1", "The probationary period is 270 days."],
    ]);
    expect(result.needsReview).toBe(false);
  }, 60_000);
});
