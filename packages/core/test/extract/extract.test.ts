import { ContractFields } from "@rater/contracts";
import type { Clause } from "@rater/contracts";
import { describe, expect, it } from "vitest";
import {
  attachArabicOcr,
  extractContract,
  hashClauseText,
  mapContractType,
  parseMoney,
  parseQiwaDate,
  parseTermMonths,
} from "../../src/extract";
import type { BboxWord } from "../../src/types";
import {
  cell,
  cellRight,
  fixturePages,
  footer,
  heading,
  labelled,
  page,
  para,
} from "./layout";

const ALL_HOLIDAYS = [
  "eid_al_fitr",
  "eid_al_adha",
  "national_day",
  "foundation_day",
  "sick_leave",
];

describe("extractContract on the synthetic fixtures", () => {
  it("reads every field of a fixed-term contract", () => {
    const result = extractContract(fixturePages("fixed-term-bad-s15"));
    expect(result.fields).toEqual({
      contractType: "fixed_term",
      contractTypeRaw: "Fixed-term Contract",
      executionDate: "2025-03-01",
      commencementDate: "2025-03-02",
      endDate: "2026-03-01",
      termMonths: 12,
      autoRenew: true,
      renewalNoticeDays: 30,
      probationDays: 180,
      probationExcludedDays: ALL_HOLIDAYS,
      workDaysPerWeek: 5,
      dailyHours: 8,
      weeklyHours: 40,
      restDaysPerWeek: 2,
      annualLeaveDays: 22,
      wage: { basic: 11000, housing: 2750, transport: 1100, other: 0, total: 14850 },
      overtimePremiumPct: 50,
      nationality: "saudi",
      occupation: "Software Developer",
      workLocation: "Riyadh",
    });
    expect(() => ContractFields.parse(result.fields)).not.toThrow();
    expect(result.issues).toEqual([]);
    expect(result.needsReview).toBe(false);
    expect(result.provenance.probationDays).toEqual({ page: 3, confidence: "high" });
    expect(result.provenance.weeklyHours?.confidence).toBe("medium");
  });

  it("splits Section 15 into its seven numbered clauses, English column only", () => {
    const { clauses } = extractContract(fixturePages("fixed-term-bad-s15"));
    expect(clauses.map((c) => c.number)).toEqual([
      "15.1",
      "15.2",
      "15.3",
      "15.4",
      "15.5",
      "15.6",
      "15.7",
    ]);
    expect(clauses[0]).toEqual({
      section: 15,
      number: "15.1",
      textEn:
        "This contract is for an unlimited period and ends upon completion of the project in accordance with Article 57 of the Labor Law.",
      textAr: null,
      textHash: hashClauseText(
        "This contract is for an unlimited period and ends upon completion of the project in accordance with Article 57 of the Labor Law.",
      ),
    });
    expect(clauses[5]?.textEn).toBe(
      "The end-of-service award shall be calculated on the basis of the basic salary only.",
    );
    // No Arabic, no appendix text, no footer.
    for (const clause of clauses) {
      expect(clause.textEn).not.toMatch(/[؀-ۿ]|Appendix|Portal/);
    }
  });

  it("returns the Arabic half of the Section 15 area for OCR", () => {
    const { section15ArabicRegions } = extractContract(
      fixturePages("fixed-term-bad-s15"),
    );
    expect(section15ArabicRegions).toHaveLength(1);
    const [region] = section15ArabicRegions;
    expect(region?.page).toBe(8);
    expect(region?.xMin).toBeCloseTo(297.96, 1);
    expect(region?.xMax).toBeCloseTo(595.92, 1);
    expect(region && region.yMax - region.yMin).toBeGreaterThan(250);
  });

  it("collects the parties' names in both languages and the footer downloader", () => {
    const result = extractContract(fixturePages("fixed-term-bad-s15"));
    // Arabic comes out of pdftotext in visual (reversed) order, which is "as printed".
    expect(result.identifyingStrings).toEqual([
      "Example Trading Co.",
      "ةراجتلل لاثملا ةكرش",
      "يبرحلا رون",
      "Fahad Al-Mithali",
      "يلاثملا دهف",
      "يبيتعلا ةراس",
    ]);
    expect(result.namePlaceholders).toEqual({
      "Example Trading Co.": "[EMPLOYER]",
      "ةراجتلل لاثملا ةكرش": "[EMPLOYER]",
      "يبرحلا رون": "[EMPLOYEE]",
      "Fahad Al-Mithali": "[NAME]",
      "يلاثملا دهف": "[NAME]",
      "يبيتعلا ةراس": "[NAME]",
    });
  });

  it("reads an indefinite contract with a Latin employee name and a wrapped Arabic employer name", () => {
    const result = extractContract(fixturePages("indefinite-clean"));
    expect(result.fields).toMatchObject({
      contractType: "indefinite",
      endDate: null,
      termMonths: null,
      autoRenew: null,
      renewalNoticeDays: null,
      probationDays: 90,
      annualLeaveDays: 30,
      weeklyHours: 40,
      nationality: "non_saudi",
      occupation: "Accountant",
      workLocation: "Jeddah",
      wage: { basic: 8000, housing: 2000, transport: 800, other: 0, total: 10800 },
    });
    expect(result.needsReview).toBe(false);
    expect(result.clauses).toHaveLength(3);
    expect(result.identifyingStrings).toContain("Omar Haddad");
    // Two printed lines, joined so that reversing the string gives logical order.
    expect(result.identifyingStrings).toContain("ةيتسجوللا تامدخلل ةنيعلا ةكرش");
    expect(result.namePlaceholders?.["Omar Haddad"]).toBe("[EMPLOYEE]");
  });

  it("flags wage parts that do not add up to the total", () => {
    const result = extractContract(fixturePages("wage-mismatch"));
    expect(result.fields.wage).toEqual({
      basic: 9000,
      housing: 2250,
      transport: 900,
      other: 500,
      total: 13000,
    });
    expect(result.fields).toMatchObject({
      termMonths: 24,
      autoRenew: false,
      renewalNoticeDays: null,
      workDaysPerWeek: 6,
      weeklyHours: 48,
      restDaysPerWeek: 1,
    });
    expect(result.issues).toEqual([
      {
        field: "wage",
        message: "Wage parts add up to 12650.00 but the total wage is 13000.00.",
      },
    ]);
    expect(result.needsReview).toBe(true);
  });
});

describe("extractContract on hand-built layouts", () => {
  /** A minimal contract: every required field, with values at varied x offsets. */
  function minimalContract(...extra: ReturnType<typeof cell>[]) {
    return page(
      1,
      heading("1. Contract Information", 100),
      labelled("Contract type:", "Indefinite Contract", 122),
      // Value far from its label, centred on the midline.
      cell("Commencement date:", 45.4, 146),
      cell("2025/02/01", 272, 146),
      heading("6. Probationary Period", 200),
      para("6.1 The Second Party is subject to a specified probationary", 222),
      para("period of 90 days, starting from the commencement date.", 236),
      heading("7. Work Hours & Weekly Rest", 280),
      para("Normal working days shall be 5 days per week and working", 302),
      para("hours shall be daily 8. In addition, the Second Party shall", 316),
      para("be entitled to 2 rest days per week.", 330),
      heading("8. Annual Leaves", 370),
      para("8.1 The Second Party shall be entitled to a pre-paid", 392),
      para("vacation of 21 calendar days, each year.", 406),
      heading("9. Wage & Benefits", 450),
      labelled("9.1.1.1 Basic Wage:", "10,000.00 Monthly", 472),
      labelled("9.1.1.2 Housing Allowance:", "2,500.00 Monthly", 496),
      // Label wrapped onto two lines; the value is on the first.
      labelled("9.1.1.3 Transportation", "1,000.00 Monthly", 520),
      para("Allowance:", 534),
      labelled("9.1.1.4 Food Allowance:", "300.00 Monthly", 558),
      labelled("9.1.1.5 Total Wage:", "13,800.00 Monthly", 582),
      ...extra,
    );
  }

  it("reads labels however the value is positioned, including wrapped labels", () => {
    const result = extractContract([minimalContract()]);
    expect(result.fields).toMatchObject({
      contractType: "indefinite",
      commencementDate: "2025-02-01",
      probationDays: 90,
      dailyHours: 8,
      weeklyHours: 40,
      annualLeaveDays: 21,
      wage: { basic: 10000, housing: 2500, transport: 1000, other: 300, total: 13800 },
    });
    expect(result.needsReview).toBe(false);
  });

  it("reads 'not subject to a probationary period' as 0 days", () => {
    const layout = page(
      1,
      heading("6. Probationary Period", 100),
      para("6.1 The Second Party is not subject to a probationary period.", 122),
    );
    const result = extractContract([layout]);
    expect(result.fields.probationDays).toBe(0);
    expect(result.issues.map((i) => i.field)).not.toContain("probationDays");
  });

  it("asks for review when a required field is missing", () => {
    const layout = page(
      1,
      heading("1. Contract Information", 100),
      labelled("Contract type:", "Fixed-term Contract", 122),
    );
    const result = extractContract([layout]);
    expect(result.needsReview).toBe(true);
    expect(result.issues.map((i) => i.field)).toEqual(
      expect.arrayContaining([
        "commencementDate",
        "probationDays",
        "annualLeaveDays",
        "wage",
        "weeklyHours",
      ]),
    );
  });

  it("ignores footers and takes Section 15 across pages, stopping at the appendix", () => {
    const pages = [
      minimalContract(
        heading("15. Additional Terms", 640),
        para("15.1 The employee shall comply with the company dress", 662),
        para("code and internal policies.", 676),
        para("15.2 Overtime shall be compensated at 25% of the basic", 700),
        footer("يبرحلا رون", "1000000001"),
      ),
      page(
        2,
        para("hourly wage.", 25),
        para("15.3 The employer may transfer the employee to any of its", 49),
        para("branches.", 63),
        // Arabic text of the clause, in the right half.
        cellRight("15.3 يجوز لصاحب العمل نقل الموظف", 550.8, 49),
        heading("16. Appendix", 101),
        para("The following table illustrates the meaning of some of", 123),
        footer("يبرحلا رون", "1000000001"),
      ),
    ];
    const result = extractContract(pages);
    expect(result.clauses.map((c) => [c.number, c.textEn])).toEqual([
      [
        "15.1",
        "The employee shall comply with the company dress code and internal policies.",
      ],
      ["15.2", "Overtime shall be compensated at 25% of the basic hourly wage."],
      ["15.3", "The employer may transfer the employee to any of its branches."],
    ]);
    expect(result.section15ArabicRegions.map((r) => r.page)).toEqual([1, 2]);
    const [first, second] = result.section15ArabicRegions;
    expect(first?.yMin).toBeGreaterThan(640);
    expect(first?.yMax).toBeLessThan(803.4);
    expect(second?.yMax).toBeLessThan(101);
    expect(result.identifyingStrings).toEqual(["يبرحلا رون"]);
  });

  it("does not split a clause on a wrapped line that starts with a number", () => {
    const layout = minimalContract(
      heading("15. Additional Terms", 640),
      para("15.1 The employee is entitled to a bonus of", 662),
      para("15.5% of the basic wage each year.", 676),
      heading("16. Appendix", 720),
    );
    const { clauses } = extractContract([layout]);
    expect(clauses).toHaveLength(1);
    expect(clauses[0]?.textEn).toBe(
      "The employee is entitled to a bonus of 15.5% of the basic wage each year.",
    );
  });

  it("reports a missing Section 15 without failing", () => {
    const result = extractContract([minimalContract()]);
    expect(result.clauses).toEqual([]);
    expect(result.section15ArabicRegions).toEqual([]);
    expect(result.issues.map((i) => i.field)).toEqual(["section15"]);
  });

  it("asks for review when the Section 15 heading is missing between sections that were found", () => {
    const result = extractContract([
      minimalContract(
        heading("14. General Provisions", 620),
        para("15.1 The employee shall comply with the dress code.", 662),
        heading("16. Appendix", 720),
      ),
    ]);
    expect(result.issues.map((i) => i.field)).toEqual(["section15.missing"]);
    expect(result.needsReview).toBe(true);
  });

  it("does not make up a daily figure for a contract on the weekly criterion", () => {
    const weekly = page(
      1,
      heading("7. Work Hours & Weekly Rest", 280),
      para("Normal working days shall be 5 days per week and working", 302),
      para("hours shall be weekly 45. In addition, the Second Party", 316),
      para("shall be entitled to 2 rest days per week.", 330),
    );
    const { fields, issues } = extractContract([weekly]);
    expect(fields).toMatchObject({
      workDaysPerWeek: 5,
      dailyHours: null,
      weeklyHours: 45,
    });
    expect(issues.map((i) => i.field)).not.toContain("weeklyHours");
  });

  describe("Section 15 items with Arabic text only", () => {
    /** The minimal contract plus a Section 15 with these rows (Arabic cells end in "15.N"). */
    function withSection15(...rows: BboxWord[][]) {
      return [
        minimalContract(
          heading("15. Additional Terms", 640),
          ...rows,
          heading("16. Appendix", 740),
        ),
      ];
    }

    it("keeps a numbered Arabic row that has no English as a clause for OCR, and asks for review", () => {
      const result = extractContract(
        withSection15(
          para("15.1 The employee shall comply with the dress code.", 662),
          cellRight("يلتزم الموظف بقواعد اللباس 15.1", 550.8, 662),
          cellRight("تحسب المكافأة على الأجر الأساسي 15.2", 550.8, 692),
        ),
      );
      expect(result.clauses.map((c) => [c.number, c.textEn])).toEqual([
        ["15.1", "The employee shall comply with the dress code."],
        ["15.2", ""],
      ]);
      expect(result.issues).toEqual([
        {
          field: "section15.textEn",
          message:
            "Clause 15.2 has Arabic text but no English text; only the Arabic OCR can read it.",
        },
      ]);
      expect(result.needsReview).toBe(true);
    });

    it("joins an item's Arabic row to its English row when the Arabic sits slightly higher", () => {
      const result = extractContract(
        withSection15(
          cellRight("يلتزم الموظف بقواعد اللباس 15.1", 550.8, 656),
          para("15.1 The employee shall comply with the dress code.", 662),
        ),
      );
      expect(result.clauses.map((c) => [c.number, c.textEn])).toEqual([
        ["15.1", "The employee shall comply with the dress code."],
      ]);
      expect(result.issues).toEqual([]);
      expect(result.needsReview).toBe(false);
    });

    it("keeps a numbered English row whose text is missing", () => {
      const result = extractContract(
        withSection15(para("15.1", 662), cellRight("تحسب المكافأة 15.1", 550.8, 662)),
      );
      expect(result.clauses.map((c) => [c.number, c.textEn])).toEqual([["15.1", ""]]);
      expect(result.needsReview).toBe(true);
    });

    it("gives an unnumbered Arabic-only Section 15 one clause for OCR to fill", () => {
      const result = extractContract(
        withSection15(cellRight("تحسب المكافأة على الأجر الأساسي", 550.8, 662)),
      );
      expect(result.clauses.map((c) => [c.number, c.textEn])).toEqual([["15.1", ""]]);
      expect(result.section15ArabicRegions).toHaveLength(1);
      expect(result.needsReview).toBe(true);
    });

    it("does not ask for review when the English says there are no terms", () => {
      const result = extractContract(
        withSection15(para("None.", 662), cellRight("لا يوجد", 550.8, 662)),
      );
      expect(result.clauses).toEqual([]);
      expect(result.issues).toEqual([]);
      expect(result.needsReview).toBe(false);
    });
  });
});

describe("value parsers", () => {
  it("parses Qiwa dates to ISO and rejects impossible dates", () => {
    expect(parseQiwaDate("2025/11/15")).toBe("2025-11-15");
    expect(parseQiwaDate("15/11/2025")).toBe("2025-11-15");
    expect(parseQiwaDate("2025/02/30")).toBeNull();
    expect(parseQiwaDate("-")).toBeNull();
  });

  it("parses amounts with thousands separators and the period", () => {
    expect(parseMoney("10,000.00 Monthly")).toEqual({ amount: 10000, period: "monthly" });
    expect(parseMoney("950")).toEqual({ amount: 950, period: null });
    expect(parseMoney("none")).toBeNull();
  });

  it("maps contract types", () => {
    expect(mapContractType("Fixed-term Contract")).toBe("fixed_term");
    expect(mapContractType("Indefinite Contract")).toBe("indefinite");
    expect(mapContractType("Unlimited Contract")).toBe("indefinite");
    expect(mapContractType("Contract for a Specific Work")).toBe("specific_work");
    expect(mapContractType("Seasonal")).toBe("unknown");
    expect(mapContractType(null)).toBe("unknown");
  });

  it("reads the term from clause 5.1 in months", () => {
    expect(
      parseTermMonths("This contract is valid for a period of 1 year, starting"),
    ).toBe(12);
    expect(parseTermMonths("valid for a period of 2 years")).toBe(24);
    expect(parseTermMonths("valid for a period of (18) months")).toBe(18);
    expect(parseTermMonths("valid for a period of one year")).toBe(12);
    expect(parseTermMonths("valid for an indefinite period")).toBeNull();
  });
});

describe("attachArabicOcr", () => {
  const clauses: Clause[] = ["15.1", "15.2", "15.3"].map((number) => ({
    section: 15,
    number,
    textEn: `clause ${number}`,
    textAr: null,
    textHash: "h",
  }));

  it("assigns text by the sub-number Tesseract keeps at the start of each clause", () => {
    const ocr =
      "1 يسري هذا العقد لمدة غير محددة\nوينتهي بانتهاء المشروع\n\n2 لا يجوز الإفصاح\n3 يجوز النقل داخل المملكة";
    const result = attachArabicOcr(clauses, ocr);
    expect(result.map((c) => c.textAr)).toEqual([
      "يسري هذا العقد لمدة غير محددة وينتهي بانتهاء المشروع",
      "لا يجوز الإفصاح",
      "يجوز النقل داخل المملكة",
    ]);
  });

  it("accepts full, mirrored and Arabic-Indic clause numbers", () => {
    const ocr = "15.1 النص الأول\n2.15 النص الثاني\n١٥٫٣ النص الثالث";
    expect(attachArabicOcr(clauses, ocr).map((c) => c.textAr)).toEqual([
      "النص الأول",
      "النص الثاني",
      "النص الثالث",
    ]);
  });

  it("does not start a clause on a wrapped line that begins with another number", () => {
    const ocr =
      "1 يستحق العامل مكافأة قدرها\n3 رواتب عند نهاية الخدمة\n2 النص الثاني\n3 النص الثالث";
    expect(attachArabicOcr(clauses, ocr).map((c) => c.textAr)).toEqual([
      "يستحق العامل مكافأة قدرها 3 رواتب عند نهاية الخدمة",
      "النص الثاني",
      "النص الثالث",
    ]);
  });

  it("leaves clauses it cannot place untouched", () => {
    const result = attachArabicOcr(clauses, "نص بلا أرقام");
    expect(result.map((c) => c.textAr)).toEqual([null, null, null]);
    expect(attachArabicOcr(clauses, "")).toBe(clauses);
  });

  it("gives all the text to a single clause when there are no numbers", () => {
    const [only] = attachArabicOcr([clauses[0] as Clause], "نص  البند\nالوحيد");
    expect(only?.textAr).toBe("نص البند الوحيد");
  });
});

describe("hashClauseText", () => {
  it("ignores case and whitespace differences", () => {
    expect(hashClauseText("The  End of\nService")).toBe(
      hashClauseText("the end of service "),
    );
    expect(hashClauseText("a")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashClauseText("a")).not.toBe(hashClauseText("b"));
  });
});
