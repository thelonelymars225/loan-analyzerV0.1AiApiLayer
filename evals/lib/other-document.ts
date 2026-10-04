import { chromium } from "playwright";
import { z } from "zod";
import { Bilingual } from "./case-spec";
import { escapeHtml, type RenderOptions } from "./render";

/**
 * A document that is not a Qiwa contract, such as an employer's own employment agreement. The
 * pipeline must reject it. Its case.json says `"kind": "other_document"`.
 */
export const OtherDocumentSpec = z.object({
  kind: z.literal("other_document"),
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: Bilingual,
  paragraphs: z.array(Bilingual).min(1),
});
export type OtherDocumentSpec = z.infer<typeof OtherDocumentSpec>;

/** Renders the document to an A4 PDF: English on the left, Arabic on the right. */
export async function renderOtherDocumentPdf(
  spec: OtherDocumentSpec,
  outPath: string,
  options: RenderOptions = {},
): Promise<void> {
  const browser = options.browser ?? (await chromium.launch());
  try {
    const page = await browser.newPage();
    try {
      await page.setContent(otherDocumentHtml(spec), { waitUntil: "load" });
      await page.pdf({ path: outPath, format: "A4", printBackground: true });
    } finally {
      await page.close();
    }
  } finally {
    if (!options.browser) await browser.close();
  }
}

export function otherDocumentHtml(spec: OtherDocumentSpec): string {
  const rows = [spec.title, ...spec.paragraphs]
    .map(
      (text, index) =>
        `<div class="row${index === 0 ? " title" : ""}"><p class="en">${escapeHtml(text.en)}</p>` +
        `<p class="ar" dir="rtl">${escapeHtml(text.ar)}</p></div>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(spec.title.en)}</title>
<style>
  body { font-family: "Liberation Sans", Arial, sans-serif; font-size: 10.5pt; margin: 40pt; }
  .row { display: flex; gap: 24pt; }
  .row p { flex: 1; margin: 0 0 10pt; }
  .ar { font-family: "DejaVu Sans", sans-serif; text-align: right; }
  .title p { font-size: 15pt; font-weight: bold; margin-bottom: 18pt; }
</style></head>
<body>
${rows}
<p style="font-size: 7pt; color: #555">SYNTHETIC TEST DOCUMENT - NOT A REAL CONTRACT</p>
</body></html>`;
}
