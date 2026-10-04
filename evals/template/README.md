# Synthetic Qiwa contract template

An HTML copy of the Qiwa "Unified Employment Contract" (عقد العمل الموحد) layout. It is
rendered to PDF with Playwright Chromium, the same engine (Skia/PDF) that produces the real Qiwa
export. Evals and core tests use it so that no real contract is ever needed in the repo.

| File                   | What it is                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `qiwa.html`            | The contract, sections 1-16, English left / Arabic right. `{{key}}` = value, `{{{slot}}}` = pre-built rows. |
| `qiwa.css`             | Layout in pt, matching the real PDF geometry (see the comment at the top).                                  |
| `../lib/case-spec.ts`  | `CaseSpec`: the zod schema for one case. Every field has a synthetic default.                               |
| `../lib/render.ts`     | `renderQiwaPdf(spec, outPath)` and `renderQiwaHtml(spec)`.                                                  |
| `fixture-cases.ts`     | The cases rendered into `packages/core/test/fixtures/`.                                                     |
| `generate-fixtures.ts` | Script that renders them and saves the `pdftotext -bbox-layout` output next to each PDF.                    |

## Rendering a case

```ts
import { renderQiwaPdf } from "../lib/render";

await renderQiwaPdf(
  {
    id: "leave-15",
    annualLeaveDays: 15,
    section15: [
      { en: "The probationary period is 270 days.", ar: "مدة التجربة 270 يومًا." },
    ],
  },
  "evals/cases/leave-15/contract.pdf",
);
```

Only `id` is required. Section 15 items are numbered 15.1, 15.2, ... in order. Set `wage.total`
to print a total that does not match the parts, and `probationExtraExclusions` to add days that
pause probation beyond the ones the regulations allow. Every PDF carries a small "SYNTHETIC TEST
CONTRACT" line in the page footer (the extractor ignores footers).

## Regenerating the core fixtures

```sh
pnpm --filter @rater/evals exec tsx template/generate-fixtures.ts
```

This writes `<id>.pdf` and `<id>.bbox.html` for each case in `fixture-cases.ts`, plus
`not-qiwa.pdf` / `not-qiwa.bbox.html` (an offer letter, for the detection test), into
`packages/core/test/fixtures/`. The core tests read only the `.bbox.html` files, so they run
without poppler. The tests in `packages/core/test/extract/` assert exact values from
`fixture-cases.ts`: change both together.

## Rules

- Synthetic data only: made-up names, IDs that start `1000000000` / `2000000000`, IBAN
  `SA0000000000000000000000`, `example.com` e-mails. Never copy anything from a real contract.
- The boilerplate (sections 1-14, 16) follows the public Qiwa template wording, because the
  extractor reads fields by those labels and phrases. The Arabic text is our own translation.
- Fonts: the real export uses Inter and Noto Kufi Arabic. Where they are not installed the
  template falls back to Liberation Sans and DejaVu Sans; line breaks differ slightly, positions
  of labels and columns do not.
