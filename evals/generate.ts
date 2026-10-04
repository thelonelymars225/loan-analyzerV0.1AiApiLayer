/**
 * Re-renders every eval case PDF from its case.json:
 *
 *   pnpm --filter @rater/evals generate [--case <id>]...
 *
 * Writes evals/cases/<id>/contract.pdf. The PDFs are committed, so running the eval needs
 * poppler but no browser. Needs Playwright Chromium.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { CASES_DIR, caseDirs, readCaseFile } from "./lib/cases";
import { renderOtherDocumentPdf } from "./lib/other-document";
import { renderQiwaPdf } from "./lib/render";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { case: { type: "string", multiple: true } },
    strict: true,
  });
  const only = values.case ?? [];
  const dirs = caseDirs(CASES_DIR).filter(
    (dir) => only.length === 0 || only.some((id) => dir.endsWith(`/${id}`)),
  );
  if (dirs.length === 0) throw new Error("No case matched.");

  const browser = await chromium.launch();
  try {
    for (const dir of dirs) {
      const casePath = join(dir, "case.json");
      if (!existsSync(casePath)) throw new Error(`${dir}: case.json is missing`);
      const caseFile = readCaseFile(casePath);
      const id = caseFile.spec.id;
      if (!dir.endsWith(`/${id}`)) {
        throw new Error(`${casePath}: id "${id}" does not match the folder name`);
      }
      const pdfPath = join(dir, "contract.pdf");
      if (caseFile.kind === "other_document") {
        await renderOtherDocumentPdf(caseFile.spec, pdfPath, { browser });
      } else {
        await renderQiwaPdf(caseFile.spec, pdfPath, { browser });
      }
      console.log(`wrote ${id}/contract.pdf`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
