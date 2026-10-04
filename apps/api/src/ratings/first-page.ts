import { execFile } from "node:child_process";
import { PdfToolError } from "@rater/pdf";

/*
 * The poppler calls behind the upload check. Detection only looks at page 1, so only page 1
 * is converted: a long PDF would otherwise cost a full-document pdftotext run and a large
 * synchronous parse inside the API. The worker reads the whole document later.
 */

/** Page 1 of a contract takes tens of milliseconds; a PDF that needs this long is not one. */
const TOOL_TIMEOUT_MS = 10_000;
/** Page-1 XHTML of a Qiwa contract is about 30 KB. */
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/** Word boxes of page 1 only, as `pdftotext -bbox-layout` XHTML. */
export function firstPageBbox(pdf: Buffer): Promise<string> {
  const args = ["-f", "1", "-l", "1", "-bbox-layout", "-enc", "UTF-8", "-", "-"];
  return runPoppler("pdftotext", args, pdf);
}

/** The number of pages, from `pdfinfo` (it does not render anything). */
export async function pageCount(pdf: Buffer): Promise<number> {
  const info = await runPoppler("pdfinfo", ["-"], pdf);
  const match = /^Pages:\s+(\d+)/m.exec(info);
  if (!match?.[1]) throw new PdfToolError("pdfinfo", "no page count in output");
  return Number(match[1]);
}

/**
 * Runs a poppler tool on the PDF, which goes in on stdin ("-") and so is never written to
 * disk. Rejects with PdfToolError, like @rater/pdf, when the tool fails, times out, prints
 * more than MAX_OUTPUT_BYTES or is not installed (cause.code "ENOENT").
 */
function runPoppler(tool: string, args: string[], pdf: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      timeout: TOOL_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      encoding: "utf8" as const,
    };
    const child = execFile(tool, args, options, (error, stdout) => {
      if (error) reject(new PdfToolError(tool, error.message, { cause: error }));
      else resolve(stdout);
    });
    // A tool that gives up early (say, on a file that is not a PDF) stops reading stdin;
    // the failed write is expected and the exit is reported through the callback above.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(pdf);
  });
}
