import type { Clause } from "@rater/contracts";
import { describe, expect, it } from "vitest";
import { attachArabicOcr, extractContract, hashClauseText } from "../../src/extract";
import { buildRedactionContext, redactClauses, redactText } from "../../src/redact";
import type { ExtractionResult, RedactionContext } from "../../src/types";
import { fixturePages } from "./layout";

const NO_NAMES: RedactionContext = { names: [] };

describe("redactText: fixed patterns", () => {
  it.each([
    ["national ID", "ID 1000000001 on file", "ID [ID] on file"],
    ["iqama", "Iqama 2000000021.", "Iqama [ID]."],
    ["establishment unified number", "unified no. 7000000001", "unified no. [ID]"],
    ["Arabic-Indic ID", "الهوية ١٠٠٠٠٠٠٠٠١", "الهوية [ID]"],
  ])("replaces a %s", (_name, input, expected) => {
    expect(redactText(input, NO_NAMES)).toBe(expected);
  });

  it.each([
    ["compact", "IBAN SA0000000000000000000000 end", "IBAN [IBAN] end"],
    ["spaced", "IBAN: SA 00 0000 0000 0000 0000 0000", "IBAN: [IBAN]"],
    ["wrapped across lines", "SA 07 8000 0000 0000\n0000 0000", "[IBAN]"],
    ["first line of a wrapped IBAN", "SA 07 8000 0000 0000", "[IBAN]"],
    ["lower case", "sa0000000000000000000000", "[IBAN]"],
  ])("replaces a %s IBAN", (_name, input, expected) => {
    expect(redactText(input, NO_NAMES)).toBe(expected);
  });

  it.each([
    ["+966 landline", "call +966 11 000 0000 now", "call [PHONE] now"],
    ["+966 mobile", "+966 50 000 0001", "[PHONE]"],
    ["00966", "00966500000001", "[PHONE]"],
    ["dashed", "+966-55-000-0031", "[PHONE]"],
    ["local mobile", "on 0550000031 or", "on [PHONE] or"],
    ["spaced local mobile", "050 000 0001", "[PHONE]"],
    ["Arabic-Indic local mobile", "٠٥٥٠٠٠٠٠٣١", "[PHONE]"],
  ])("replaces a %s number", (_name, input, expected) => {
    expect(redactText(input, NO_NAMES)).toBe(expected);
  });

  it("replaces e-mail addresses", () => {
    expect(
      redactText("write to huda.q@example.com or hr@sample-logistics.example.", NO_NAMES),
    ).toBe("write to [EMAIL] or [EMAIL].");
  });

  it("keeps dates, amounts, percentages, contract numbers and clause numbers", () => {
    const text =
      "Contract 10000011 dated 2025/03/01, 10,000.00 Monthly, 50% overtime, clause 15.4, 06:49 2026-10-03";
    expect(redactText(text, NO_NAMES)).toBe(text);
  });
});

describe("redactText: names", () => {
  const ctx: RedactionContext = {
    names: [
      { text: "Example Trading Co.", placeholder: "[EMPLOYER]" },
      { text: "Omar Haddad", placeholder: "[EMPLOYEE]" },
      // As pdftotext prints it: visual order, reversed.
      { text: "يناطحقلا ىده", placeholder: "[EMPLOYEE]" },
      { text: "ةيتسجوللا تامدخلل ةنيعلا ةكرش", placeholder: "[EMPLOYER]" },
      { text: "Al", placeholder: "[NAME]" },
    ],
  };

  it("replaces Latin names case-insensitively, across line breaks, as whole words", () => {
    expect(redactText("EXAMPLE TRADING CO. pays Omar\nHaddad", ctx)).toBe(
      "[EMPLOYER] pays [EMPLOYEE]",
    );
    expect(redactText("Omar Haddadi", ctx)).toBe("Omar Haddadi");
  });

  it("replaces an Arabic name in logical order (OCR text) and in visual order (pdftotext)", () => {
    expect(redactText("إلى الموظفة هدى القحطاني برسالة", ctx)).toBe(
      "إلى الموظفة [EMPLOYEE] برسالة",
    );
    expect(redactText("ةلاسرب يناطحقلا ىده ةفظوملا", ctx)).toBe(
      "ةلاسرب [EMPLOYEE] ةفظوملا",
    );
  });

  it("tolerates OCR spacing, letter variants and harakat in Arabic names", () => {
    expect(redactText("الموظفة هدي القحطانى", ctx)).toBe("الموظفة [EMPLOYEE]");
    expect(redactText("الموظفة هُدى ال قحطاني", ctx)).toBe("الموظفة [EMPLOYEE]");
    expect(redactText("تلتزم شركة العينة للخدمات اللوجستية بما يلي", ctx)).toBe(
      "تلتزم [EMPLOYER] بما يلي",
    );
  });

  it("skips names too short to redact safely", () => {
    expect(redactText("Al Rajhi", ctx)).toBe("Al Rajhi");
  });
});

function extraction(
  identifyingStrings: string[],
  namePlaceholders?: ExtractionResult["namePlaceholders"],
): ExtractionResult {
  return {
    fields: {} as ExtractionResult["fields"],
    provenance: {},
    clauses: [],
    section15ArabicRegions: [],
    identifyingStrings,
    namePlaceholders,
    issues: [],
    needsReview: false,
  };
}

describe("buildRedactionContext", () => {
  it("uses the placeholder recorded for each name and [NAME] otherwise", () => {
    const ctx = buildRedactionContext(
      extraction(["Example Trading Co.", "نور الحربي", "Fahad Al-Mithali"], {
        "Example Trading Co.": "[EMPLOYER]",
        "نور الحربي": "[EMPLOYEE]",
      }),
    );
    expect(ctx.names).toEqual([
      { text: "Example Trading Co.", placeholder: "[EMPLOYER]" },
      { text: "نور الحربي", placeholder: "[EMPLOYEE]" },
      { text: "Fahad Al-Mithali", placeholder: "[NAME]" },
    ]);
  });

  it("drops blanks and duplicates", () => {
    const ctx = buildRedactionContext(extraction([" Omar  Haddad ", "Omar Haddad", ""]));
    expect(ctx.names).toEqual([{ text: "Omar Haddad", placeholder: "[NAME]" }]);
  });
});

describe("redactClauses", () => {
  const clause: Clause = {
    section: 15,
    number: "15.3",
    textEn: "Notices to Omar Haddad at omar@example.com.",
    textAr: "ترسل الإشعارات إلى Omar Haddad على 0550000001",
    textHash: hashClauseText("Notices to Omar Haddad at omar@example.com."),
  };
  const ctx: RedactionContext = {
    names: [{ text: "Omar Haddad", placeholder: "[EMPLOYEE]" }],
  };

  it("redacts both languages and re-hashes the redacted English", () => {
    const [redacted] = redactClauses([clause], ctx);
    expect(redacted).toEqual({
      ...clause,
      textEn: "Notices to [EMPLOYEE] at [EMAIL].",
      textAr: "ترسل الإشعارات إلى [EMPLOYEE] على [PHONE]",
      textHash: hashClauseText("Notices to [EMPLOYEE] at [EMAIL]."),
    });
  });

  it("keeps a missing Arabic text as null", () => {
    const [redacted] = redactClauses([{ ...clause, textAr: null }], ctx);
    expect(redacted?.textAr).toBeNull();
  });
});

describe("redaction of a whole synthetic contract", () => {
  it("removes names, phone and e-mail from the extracted clauses, in English and in OCR Arabic", () => {
    const result = extractContract(fixturePages("wage-mismatch"));
    const ocr = [
      "1 يُعوّض العمل الإضافي بنسبة 25% من أجر الساعة الأساسي.",
      "2 يلتزم الموظف بالعمل ساعات إضافية كلما اقتضت حاجة العمل ذلك.",
      "3 يجوز لشركة المثال للتجارة إرسال الإشعارات إلى الموظفة",
      "هدى القحطاني برسالة نصية على الرقم 0550000031",
    ].join("\n");
    const clauses = redactClauses(
      attachArabicOcr(result.clauses, ocr),
      buildRedactionContext(result),
    );
    expect(clauses[2]?.textEn).toBe(
      "Notices from [EMPLOYER] to the employee may also be sent by text message to [PHONE] or by e-mail to [EMAIL].",
    );
    expect(clauses[2]?.textAr).toBe(
      "يجوز ل[EMPLOYER] إرسال الإشعارات إلى الموظفة [EMPLOYEE] برسالة نصية على الرقم [PHONE]",
    );
    expect(clauses[0]?.textEn).toBe(
      "Overtime shall be compensated at 25% of the basic hourly wage.",
    );
  });
});
