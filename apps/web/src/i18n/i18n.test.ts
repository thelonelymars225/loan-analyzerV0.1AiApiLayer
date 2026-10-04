import { DISCLAIMER_AR, DISCLAIMER_EN } from "@rater/contracts";
import { describe, expect, it } from "vitest";
import ar from "../locales/ar.json";
import en from "../locales/en.json";
import { i18n } from ".";

function keysOf(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

// i18next plural keys end in a CLDR category; English has two, Arabic six.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Keys with plural suffixes folded into one, so "x_one" and "x_other" count as "x". */
function baseKeysOf(value: unknown): string[] {
  return [...new Set(keysOf(value).map((key) => key.replace(PLURAL_SUFFIX, "")))].sort();
}

/** Every plural key must have each form the language uses (CLDR, via Intl). */
function missingPluralForms(value: unknown, language: string): string[] {
  const forms = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
  const keys = keysOf(value);
  const plural = [...new Set(keys.filter((key) => PLURAL_SUFFIX.test(key)))];
  const bases = new Set(plural.map((key) => key.replace(PLURAL_SUFFIX, "")));
  return [...bases].flatMap((base) =>
    forms.map((form) => `${base}_${form}`).filter((key) => !keys.includes(key)),
  );
}

describe("i18n", () => {
  it("switching to Arabic sets <html dir=rtl lang=ar>, and back", async () => {
    await i18n.changeLanguage("ar");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(document.documentElement).toHaveAttribute("lang", "ar");

    await i18n.changeLanguage("en");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });

  it("remembers the chosen language", async () => {
    await i18n.changeLanguage("ar");
    expect(localStorage.getItem("rater.language")).toBe("ar");
  });

  it("has every English string translated to Arabic and nothing extra", () => {
    expect(baseKeysOf(ar)).toEqual(baseKeysOf(en));
  });

  it("has every plural form each language needs", () => {
    expect(missingPluralForms(en, "en")).toEqual([]);
    expect(missingPluralForms(ar, "ar")).toEqual([]);
  });

  it("pluralises the retention days in both languages", () => {
    const english = i18n.getFixedT("en");
    expect(english("upload.privacyBody", { count: 1 })).toMatch(/after 1 day\./);
    expect(english("upload.privacyBody", { count: 30 })).toMatch(/after 30 days\./);

    const arabic = i18n.getFixedT("ar");
    expect(arabic("upload.privacyBody", { count: 1 })).toMatch(/بعد يوم واحد\./);
    expect(arabic("upload.privacyBody", { count: 2 })).toMatch(/بعد يومين\./);
    expect(arabic("upload.privacyBody", { count: 7 })).toMatch(/بعد 7 أيام\./);
    expect(arabic("upload.privacyBody", { count: 30 })).toMatch(/بعد 30 يومًا\./);
    expect(arabic("upload.privacyBody", { count: 100 })).toMatch(/بعد 100 يوم\./);
  });

  it("describes market fairness by the rules that feed it, not leave", () => {
    expect(en.report.lowConfidenceHint).toMatch(/Art\. 77/);
    expect(en.report.lowConfidenceHint).not.toMatch(/leave/);
    expect(ar.report.lowConfidenceHint).not.toMatch(/الإجازات/);
  });

  it("has no empty or untranslated Arabic strings", () => {
    const englishOnly = keysOf(ar).filter((key) => {
      const value = i18n.getResource("ar", "translation", key) as string;
      return value.trim() === "" || !/[؀-ۿ]/.test(value);
    });
    expect(englishOnly).toEqual([]);
  });

  it("uses the shared disclaimer text in both languages", () => {
    expect(en.report.disclaimer).toBe(DISCLAIMER_EN);
    expect(ar.report.disclaimer).toBe(DISCLAIMER_AR);
  });
});
