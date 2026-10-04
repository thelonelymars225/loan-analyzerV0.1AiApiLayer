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
    expect(keysOf(ar).sort()).toEqual(keysOf(en).sort());
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
