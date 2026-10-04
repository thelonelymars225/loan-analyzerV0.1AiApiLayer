import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PdfToolError, canRun, runTool, withTempDir, writePdf } from "./run";

/** A rectangle on a page in PDF points from the top-left corner. Same shape as core's PageRegion. */
export interface OcrRegion {
  page: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface OcrOptions {
  /** Render resolution for the crop. 300 dpi is what Tesseract is tuned for. */
  dpi?: number;
  /** Tesseract language. */
  lang?: string;
  /** Tesseract page segmentation mode. 6 = one uniform block of text. */
  psm?: number;
  /** Per-command timeout. */
  timeoutMs?: number;
  /** Called when one region fails; that region is skipped. OCR is best effort. */
  onError?: (error: Error, region: OcrRegion) => void;
}

export interface ToolsAvailable {
  pdftotext: boolean;
  pdftoppm: boolean;
  tesseract: boolean;
  tesseractAra: boolean;
}

const TEXT_TIMEOUT_MS = 30_000;
const OCR_TIMEOUT_MS = 60_000;
const POINTS_PER_INCH = 72;

/** Runs `pdftotext -bbox-layout` and returns its XHTML (word boxes per page). */
export async function pdftotextBbox(pdf: Buffer): Promise<string> {
  return withTempDir(async (dir) => {
    const input = await writePdf(dir, pdf);
    const { stdout } = await runTool(
      "pdftotext",
      ["-bbox-layout", "-enc", "UTF-8", input, "-"],
      {
        timeoutMs: TEXT_TIMEOUT_MS,
      },
    );
    return stdout;
  });
}

/** Number of pages, from `pdfinfo`. */
export async function pdfPageCount(pdf: Buffer): Promise<number> {
  return withTempDir(async (dir) => {
    const input = await writePdf(dir, pdf);
    const { stdout } = await runTool("pdfinfo", [input], { timeoutMs: TEXT_TIMEOUT_MS });
    const match = /^Pages:\s+(\d+)/m.exec(stdout);
    if (!match?.[1]) throw new PdfToolError("pdfinfo", "no page count in output");
    return Number(match[1]);
  });
}

/** Which of the PDF and OCR tools are installed. */
export async function toolsAvailable(): Promise<ToolsAvailable> {
  const [pdftotext, pdftoppm, tesseract] = await Promise.all([
    canRun("pdftotext", ["-v"]),
    canRun("pdftoppm", ["-v"]),
    canRun("tesseract", ["--version"]),
  ]);
  const tesseractAra = tesseract && (await hasTesseractLanguage("ara"));
  return { pdftotext, pdftoppm, tesseract, tesseractAra };
}

async function hasTesseractLanguage(lang: string): Promise<boolean> {
  try {
    const { stdout } = await runTool("tesseract", ["--list-langs"], {
      timeoutMs: 10_000,
    });
    return stdout.split(/\r?\n/).some((line) => line.trim() === lang);
  } catch {
    return false;
  }
}

/**
 * OCRs each region (normally the Arabic column of Section 15) and returns the texts joined by
 * newlines, in region order. Each region is rendered with `pdftoppm` at `dpi` and read with
 * `tesseract -l ara --psm 6`. Returns "" when pdftoppm, tesseract or its language pack is missing.
 */
export async function ocrArabicRegions(
  pdf: Buffer,
  regions: OcrRegion[],
  options: OcrOptions = {},
): Promise<string> {
  if (regions.length === 0) return "";
  const lang = options.lang ?? "ara";
  const tools = await toolsAvailable();
  if (!tools.pdftoppm || !tools.tesseract) return "";
  if (!(await hasTesseractLanguage(lang))) return "";

  return withTempDir(async (dir) => {
    const input = await writePdf(dir, pdf);
    const texts: string[] = [];
    for (const [index, region] of regions.entries()) {
      try {
        const image = await renderRegion(
          input,
          region,
          join(dir, `region-${index}`),
          options,
        );
        const text = await recognise(image, lang, options);
        if (text) texts.push(text);
      } catch (error) {
        options.onError?.(
          error instanceof Error ? error : new Error(String(error)),
          region,
        );
      }
    }
    return texts.join("\n");
  });
}

/** pdftoppm arguments that crop one region of one page, converting points to pixels. */
export function cropArgs(region: OcrRegion, dpi: number): string[] {
  const scale = dpi / POINTS_PER_INCH;
  const x = Math.max(0, Math.floor(region.xMin * scale));
  const y = Math.max(0, Math.floor(region.yMin * scale));
  const width = Math.max(1, Math.ceil((region.xMax - region.xMin) * scale));
  const height = Math.max(1, Math.ceil((region.yMax - region.yMin) * scale));
  const page = String(region.page);
  return [
    "-r",
    String(dpi),
    "-f",
    page,
    "-l",
    page,
    "-x",
    String(x),
    "-y",
    String(y),
    "-W",
    String(width),
    "-H",
    String(height),
  ];
}

async function renderRegion(
  input: string,
  region: OcrRegion,
  outPrefix: string,
  options: OcrOptions,
): Promise<string> {
  const dpi = options.dpi ?? 300;
  const args = [
    ...cropArgs(region, dpi),
    "-q",
    "-gray",
    "-png",
    "-singlefile",
    input,
    outPrefix,
  ];
  await runTool("pdftoppm", args, { timeoutMs: options.timeoutMs ?? OCR_TIMEOUT_MS });
  return `${outPrefix}.png`;
}

async function recognise(
  image: string,
  lang: string,
  options: OcrOptions,
): Promise<string> {
  // Fail early with a clear error if pdftoppm wrote nothing (e.g. page out of range).
  await readFile(image);
  const psm = String(options.psm ?? 6);
  const { stdout } = await runTool(
    "tesseract",
    [image, "stdout", "-l", lang, "--psm", psm],
    {
      timeoutMs: options.timeoutMs ?? OCR_TIMEOUT_MS,
    },
  );
  return stdout.trim();
}
