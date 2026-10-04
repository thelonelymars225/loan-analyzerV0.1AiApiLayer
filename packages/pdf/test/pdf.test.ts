import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PdfToolError,
  cropArgs,
  ocrArabicRegions,
  pdfPageCount,
  pdftotextBbox,
  toolsAvailable,
  type OcrRegion,
} from "../src/index";

// Synthetic contract rendered by evals/template (no personal data).
const FIXTURE = fileURLToPath(
  new URL("../../core/test/fixtures/fixed-term-bad-s15.pdf", import.meta.url),
);
/** The Arabic half of Section 15 in that fixture (extractContract's section15ArabicRegions). */
const SECTION_15_ARABIC: OcrRegion = {
  page: 8,
  xMin: 297.96,
  yMin: 373.2,
  xMax: 595.92,
  yMax: 700.2,
};

const tools = await toolsAvailable();

describe("cropArgs", () => {
  it("converts a region in points to a pixel crop of one page", () => {
    const args = cropArgs(
      { page: 9, xMin: 297.96, yMin: 38.7, xMax: 595.92, yMax: 417.2 },
      300,
    );
    expect(args).toEqual([
      "-r",
      "300",
      "-f",
      "9",
      "-l",
      "9",
      "-x",
      "1241",
      "-y",
      "161",
      "-W",
      "1242",
      "-H",
      "1578",
    ]);
  });

  it("never asks for a negative offset or an empty crop", () => {
    const args = cropArgs({ page: 1, xMin: -5, yMin: -5, xMax: -5, yMax: -5 }, 72);
    expect(args.slice(6)).toEqual(["-x", "0", "-y", "0", "-W", "1", "-H", "1"]);
  });
});

describe("toolsAvailable", () => {
  it("reports each tool as a boolean", () => {
    expect(Object.keys(tools).sort()).toEqual([
      "pdftoppm",
      "pdftotext",
      "tesseract",
      "tesseractAra",
    ]);
    for (const value of Object.values(tools)) expect(typeof value).toBe("boolean");
  });
});

describe.skipIf(!tools.pdftotext)("pdftotextBbox and pdfPageCount", () => {
  const pdf = readFileSync(FIXTURE);

  it("returns pdftotext's XHTML with word boxes", async () => {
    const xhtml = await pdftotextBbox(pdf);
    expect(xhtml).toMatch(/^<!DOCTYPE html/);
    expect(xhtml.match(/<page /g)).toHaveLength(10);
    expect(xhtml).toMatch(
      /<word xMin="[\d.]+" yMin="[\d.]+" xMax="[\d.]+" yMax="[\d.]+">Unified<\/word>/,
    );
  });

  it("counts pages", async () => {
    await expect(pdfPageCount(pdf)).resolves.toBe(10);
  });

  it("rejects a file that is not a PDF with a PdfToolError", async () => {
    await expect(pdftotextBbox(Buffer.from("not a pdf"))).rejects.toBeInstanceOf(
      PdfToolError,
    );
  });
});

describe.skipIf(!tools.pdftoppm || !tools.tesseractAra)("ocrArabicRegions", () => {
  const pdf = readFileSync(FIXTURE);

  it("reads the Arabic Section 15 text, one numbered clause per line", async () => {
    const text = await ocrArabicRegions(pdf, [SECTION_15_ARABIC]);
    expect(text).toContain("نهاية الخدمة");
    expect(text).toContain("الأساسي");
    // Tesseract keeps the sub-number of each clause at the start of its first line.
    const starts = text
      .split("\n")
      .map((line) => /^\s*(?:15\.)?(\d)\s/.exec(line)?.[1])
      .filter(Boolean);
    expect(starts).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  }, 60_000);

  it("returns an empty string for no regions", async () => {
    await expect(ocrArabicRegions(pdf, [])).resolves.toBe("");
  });

  it("skips a region that fails and reports it", async () => {
    const errors: string[] = [];
    const text = await ocrArabicRegions(pdf, [{ ...SECTION_15_ARABIC, page: 99 }], {
      onError: (error) => errors.push(error.message),
    });
    expect(text).toBe("");
    expect(errors).toHaveLength(1);
  }, 60_000);

  it("returns an empty string when the language pack is missing", async () => {
    await expect(
      ocrArabicRegions(pdf, [SECTION_15_ARABIC], { lang: "zzz" }),
    ).resolves.toBe("");
  });
});
