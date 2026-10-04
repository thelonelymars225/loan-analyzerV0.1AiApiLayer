/**
 * Regenerates the synthetic PDF fixtures used by the core extraction tests:
 *
 *   pnpm --filter @rater/evals exec tsx template/generate-fixtures.ts
 *
 * Writes <id>.pdf and <id>.bbox.html (pdftotext -bbox-layout output) for every case in
 * fixture-cases.ts, plus not-qiwa.pdf / not-qiwa.bbox.html, into packages/core/test/fixtures/.
 * Needs Playwright Chromium and poppler (pdftotext).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { pdftotextBbox } from "@rater/pdf";
import { renderQiwaPdf } from "../lib/render";
import { FIXTURE_CASES, NOT_QIWA_HTML } from "./fixture-cases";

const OUT_DIR = fileURLToPath(
  new URL("../../packages/core/test/fixtures/", import.meta.url),
);

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const spec of FIXTURE_CASES) {
      const pdfPath = `${OUT_DIR}${spec.id}.pdf`;
      await renderQiwaPdf(spec, pdfPath, { browser });
      await writeBbox(pdfPath, `${OUT_DIR}${spec.id}.bbox.html`);
      console.log(`wrote ${spec.id}`);
    }

    const page = await browser.newPage();
    await page.setContent(NOT_QIWA_HTML, { waitUntil: "load" });
    await page.pdf({
      path: `${OUT_DIR}not-qiwa.pdf`,
      format: "A4",
      printBackground: true,
    });
    await page.close();
    await writeBbox(`${OUT_DIR}not-qiwa.pdf`, `${OUT_DIR}not-qiwa.bbox.html`);
    console.log("wrote not-qiwa");
  } finally {
    await browser.close();
  }
}

async function writeBbox(pdfPath: string, outPath: string): Promise<void> {
  const xhtml = await pdftotextBbox(readFileSync(pdfPath));
  // The creation date changes on every run; drop it so regenerating gives a clean diff.
  writeFileSync(
    outPath,
    xhtml.replace(/<meta name="(CreationDate|ModDate)"[^>]*>\n?/g, ""),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
