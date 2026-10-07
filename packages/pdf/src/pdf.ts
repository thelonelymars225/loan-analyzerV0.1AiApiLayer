import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PdfToolError, canRun, runTool, withTempDir, writePdf } from "./run";

/** A rectangle on a page in PDF points from the top-left corner. Same shape as core's PageRegion. */
export interface PageRegion {
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
  onError?: (error: Error, region: PageRegion) => void;
}

export interface CropOptions {
  /** Render resolution. 144 dpi is twice the CSS pixel density, crisp on most screens. */
  dpi?: number;
  timeoutMs?: number;
}

export interface ToolsAvailable {
  pdftotext: boolean;
  pdftoppm: boolean;
  tesseract: boolean;
  tesseractAra: boolean;
}

const TEXT_TIMEOUT_MS = 30_000;
const OCR_TIMEOUT_MS = 60_000;
/** A page or a crop renders in well under a second; a document that needs longer is odd. */
const CROP_TIMEOUT_MS = 15_000;
const POINTS_PER_INCH = 72;
const DEFAULT_CROP_DPI = 144;

/**
 * Runs `pdftotext -bbox-layout` and returns its XHTML (word boxes per page). `firstPageOnly`
 * converts page 1 alone, which is all the API's upload check reads. Page 1 of a contract
 * takes milliseconds and about 30 KB, so that mode gets a tighter time and size limit.
 */
export async function pdftotextBbox(
  pdf: Buffer,
  options: { firstPageOnly?: boolean } = {},
): Promise<string> {
  const firstPage = options.firstPageOnly === true;
  return withTempDir(async (dir) => {
    const input = await writePdf(dir, pdf);
    const { stdout } = await runTool(
      "pdftotext",
      [
        ...(firstPage ? ["-f", "1", "-l", "1"] : []),
        "-bbox-layout",
        "-enc",
        "UTF-8",
        input,
        "-",
      ],
      firstPage
        ? { timeoutMs: 10_000, maxBufferBytes: 2 * 1024 * 1024 }
        : { timeoutMs: TEXT_TIMEOUT_MS },
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
  regions: PageRegion[],
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
        const image = await renderToFile(
          input,
          region.page,
          cropArgs(region, options.dpi ?? 300),
          join(dir, `region-${index}`),
          { gray: true, timeoutMs: options.timeoutMs ?? OCR_TIMEOUT_MS },
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

/**
 * Renders one region of one page as a colour PNG, for showing the passage behind a finding.
 * The PDF and the image only ever exist in a private temporary folder that is removed before
 * this returns; the caller decides what to do with the bytes (the API sends them uncached).
 */
export async function renderPageCrop(
  pdf: Buffer,
  region: PageRegion,
  options: CropOptions = {},
): Promise<Buffer> {
  return renderPng(pdf, region.page, cropArgs(region, options.dpi ?? DEFAULT_CROP_DPI), {
    gray: false,
    timeoutMs: options.timeoutMs ?? CROP_TIMEOUT_MS,
  });
}

/** Renders one whole page as a colour PNG, for the contract viewer. Same handling as a crop. */
export async function renderPage(
  pdf: Buffer,
  page: number,
  options: CropOptions = {},
): Promise<Buffer> {
  return renderPng(pdf, page, pageArgs(page, options.dpi ?? DEFAULT_CROP_DPI), {
    gray: false,
    timeoutMs: options.timeoutMs ?? CROP_TIMEOUT_MS,
  });
}

/** pdftoppm arguments that select one page at a resolution. */
function pageArgs(page: number, dpi: number): string[] {
  return ["-r", String(dpi), "-f", String(page), "-l", String(page)];
}

/** pdftoppm arguments that crop one region of one page, converting points to pixels. */
export function cropArgs(region: PageRegion, dpi: number): string[] {
  const scale = dpi / POINTS_PER_INCH;
  const x = Math.max(0, Math.floor(region.xMin * scale));
  const y = Math.max(0, Math.floor(region.yMin * scale));
  const width = Math.max(1, Math.ceil((region.xMax - region.xMin) * scale));
  const height = Math.max(1, Math.ceil((region.yMax - region.yMin) * scale));
  return [
    ...pageArgs(region.page, dpi),
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

/** Writes the PDF to a private temporary folder, renders with pdftoppm, and returns the PNG bytes. */
async function renderPng(
  pdf: Buffer,
  page: number,
  selection: string[],
  options: { gray: boolean; timeoutMs: number },
): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const input = await writePdf(dir, pdf);
    const image = await renderToFile(input, page, selection, join(dir, "page"), options);
    return readFile(image);
  });
}

/** Renders `selection` (a page, or a crop of one) to `${outPrefix}.png` and returns that path. */
async function renderToFile(
  input: string,
  page: number,
  selection: string[],
  outPrefix: string,
  options: { gray: boolean; timeoutMs: number },
): Promise<string> {
  const args = [
    ...selection,
    "-q",
    ...(options.gray ? ["-gray"] : []),
    "-png",
    "-singlefile",
    input,
    outPrefix,
  ];
  await runTool("pdftoppm", args, { timeoutMs: options.timeoutMs });
  const image = `${outPrefix}.png`;
  // pdftoppm exits 0 but writes nothing for a page out of range; fail here with a clear error.
  await readFile(image).catch(() => {
    throw new PdfToolError("pdftoppm", `no image for page ${page}`);
  });
  return image;
}

async function recognise(
  image: string,
  lang: string,
  options: OcrOptions,
): Promise<string> {
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
