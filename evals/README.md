# Eval harness

The eval set is the product's real test suite (Build Plan, "Eval harness"). It rates synthetic
Qiwa contracts end to end, from the PDF to the score, and compares the result with what a
reviewer expects. It runs offline with the heuristic analyser, and with Claude when an API key
is set.

```sh
pnpm eval                                   # all committed cases, 3 runs each
pnpm eval --case 04-fixed-term-overtime-clauses --runs 1
pnpm eval --llm claude                      # needs ANTHROPIC_API_KEY
pnpm eval --private ~/contracts             # also rate real contracts kept outside git
pnpm --filter @rater/evals generate         # re-render every case PDF from its case.json
```

| Option            | What it does                                                                     |
| ----------------- | -------------------------------------------------------------------------------- |
| `--private <dir>` | Also run `<dir>/<id>/contract.pdf` + `<dir>/<id>/expected.json`.                 |
| `--case <id>`     | Run only this case. Repeatable.                                                  |
| `--runs <N>`      | Runs per case for the stability check (default 3).                               |
| `--llm <name>`    | `heuristic` or `claude`. Default: `createLlmClient(process.env)`.                |
| `--no-ocr`        | Skip Arabic OCR of Section 15 (OCR runs when tesseract with `ara` is installed). |
| `--json`          | Print the results as JSON on stdout (progress goes to stderr).                   |

The runner prints one line per case with a diff under it, then the summary table, and saves
everything to `evals/results/<timestamp>.json` (git-ignored) so drift shows up between versions.
It exits with 1 when any bar fails and 2 on a usage error.

## What one case run does

For each case: `pdftotextBbox` → `parseBboxXhtml` → `runPipeline` with the rules table
(`loadRules`), the bundled law corpus (`MemoryArticleLookup(loadCorpus())`), a fresh
`MemoryClauseCache` per run (so every run really asks the analyser), Arabic OCR when available
(once per case, reused by the repeated runs), and `today` from `expected.json`. The first run is
compared with `expected.json`; all runs are compared with each other.

## Pass bars (v1)

| Bar                         | Pass                              | Measured over                        |
| --------------------------- | --------------------------------- | ------------------------------------ |
| Field accuracy              | 100%                              | every field listed in `fields`       |
| Recall, high severity       | 100%                              | expected high-severity problems      |
| Precision, problem findings | ≥ 90%                             | all problem findings, all cases      |
| mustNot violations          | 0                                 | problem findings for `mustNot` IDs   |
| Score within range          | every case                        | both views                           |
| Stable across runs          | every case                        | identical findings in all `--runs`   |
| Status                      | every case                        | `done` / `needs_review` / `rejected` |
| Deadlines                   | every case that lists `deadlines` | exact rule ID and date               |

A **problem finding** is one whose verdict is not `compliant` or `better_than_law` and whose
source is not `info`. A finding matches an expected one only when rule ID, clause, verdict and
severity are all equal. `REVIEW-00` (the analyser failed twice) never matches, so it always
counts against precision. Compliant and info findings the case does not list are ignored.
Missing lower-severity findings show in the diff and in "Recall, all expected findings", which
is reported but is not a v1 bar. The comparison logic is in `lib/compare.ts`.

## Files

| Path                       | What it is                                                                      |
| -------------------------- | ------------------------------------------------------------------------------- |
| `cases/<id>/case.json`     | The contract: a `CaseSpec` (`lib/case-spec.ts`), or a non-Qiwa document.        |
| `cases/<id>/contract.pdf`  | Rendered from `case.json` and committed, so CI needs poppler, not Chromium.     |
| `cases/<id>/expected.json` | What the pipeline must produce (format below).                                  |
| `clause-library.json`      | Section 15 clauses with the answer each must get, plus paraphrases.             |
| `run.ts`, `generate.ts`    | The runner and the PDF generator.                                               |
| `lib/`                     | Case loading, comparison, report formatting, rendering.                         |
| `template/`                | The synthetic Qiwa template (see `template/README.md`).                         |
| `test/`                    | Unit tests, case-file checks, and the whole eval set with the offline analyser. |

## How the cases are built

Every case is a made-up contract rendered from the Qiwa template, with made-up names, IDs that
start with `1`, `2` or `7` followed by five zeros, `example.com` e-mails and the IBAN
`SA0000000000000000000000`. Section 15 is taken word for word from `clause-library.json`, either
a clause's own text or one of its paraphrases, so every clause has a known answer.
`test/cases.test.ts` checks that, and that the expected findings agree with the library.

| Case | Contract                 | What it tests                                                                                                                                                      |
| ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01   | fixed-term, Saudi        | Test #1 shape: project term vs fixed term, EOS on basic, Art. 77 at two months' basic, transfer, no carry-over, unlimited confidentiality ("not allowed to share") |
| 02   | indefinite, non-Saudi    | Void three-year non-compete, unlimited confidentiality, housing below the norm, end of probation ahead                                                             |
| 03   | fixed-term, no renewal   | Field rules failing: 270 days' probation, extra probation pauses, 15 days' leave, 54-hour week, 25% overtime                                                       |
| 04   | fixed-term, non-Saudi    | Overtime clauses (25%, time off in lieu, extra hours on demand), leave forfeited, allowances above the norm, renewal deadline rolled to next year                  |
| 05   | indefinite, Saudi        | EOS on basic with SAR impact, relocation, a lawful non-compete                                                                                                     |
| 06   | fixed-term 18 months     | Section 15 overriding lawful template values (probation, leave), Art. 77 escalated to high                                                                         |
| 07   | indefinite, no probation | Project term vs indefinite type, time off in lieu, transport below the norm                                                                                        |
| 08   | fixed-term 24 months     | Every field exactly at the legal limit, other allowances, three void Section 15 clauses, two deadlines                                                             |
| 09   | indefinite               | Better than the law in sections 1-14, only medium and low Section 15 issues                                                                                        |
| 10   | fixed-term, no renewal   | Allowances below the norm, 25% overtime clause, nine months' probation clause                                                                                      |
| 11   | fixed-term               | Clean: must score ≥ 85 in both views                                                                                                                               |
| 12   | indefinite               | Clean apart from a low housing note: must score ≥ 85 in both views                                                                                                 |
| 13   | fixed-term               | Wage parts that don't add up to the total: `needs_review`                                                                                                          |
| 14   | not a Qiwa contract      | An employer's own agreement: `rejected`, no findings, no score                                                                                                     |

Together the first ten cover all 19 seed rules, each field rule both failing and passing, every
info rule, an allowance below the market norm, and both kinds of deadline.

Expected scores were set by applying the scoring rubric (high −20, medium −8, low −3,
better-than-law +2, per-view weights) by hand to the expected findings, ±5.

## expected.json

```jsonc
{
  "id": "01-fixed-term-project-conflict", // same as the folder name
  "description": "What the case is about.",
  "today": "2026-10-04", // the rating date: deadlines depend on it
  "status": "done", // done | needs_review | rejected
  "fields": {
    "annualLeaveDays": 22,
    "wage": {
      "basic": 12000,
      "housing": 3000,
      "transport": 1200,
      "other": 0,
      "total": 16200,
    },
  },
  "findings": [
    {
      "ruleId": "EOS-BASE-01",
      "clause": "15.6",
      "verdict": "likely_void",
      "severity": "high",
    },
    {
      "ruleId": "LEAVE-MIN-01",
      "clause": "8.1",
      "verdict": "better_than_law",
      "severity": "none",
    },
    {
      "ruleId": "SETTLE-TIME-01",
      "clause": null,
      "verdict": "compliant",
      "severity": "none",
    },
  ],
  "mustNot": ["NONCOMPETE-01"], // may appear as compliant, never as a problem
  "deadlines": [{ "ruleId": "RENEW-DEADLINE-01", "date": "2026-10-16" }], // optional; exact when given
  "score": { "employee": [59, 69], "hr": [56, 66] }, // inclusive; omit for a rejected document
}
```

- `fields` is any subset of `ContractFields`; values must match exactly (unknown names are an
  error). List the required fields at least: contract type, commencement date, probation,
  annual leave, wage, and daily or weekly hours.
- `findings` lists the problems to find and any compliant, better-than-law or info findings
  worth pinning. Field findings use the template clause (`6.1`, `7`, `8.1`, `9.1.1`, `11.2`,
  `5.1`, `6.2`); info rules without a clause use `null`. Severities are final, after the impact
  step (COMP-ART77-01 is raised to high when it undercuts the legal default by six months' wage
  or more).

## Adding a case

1. Create `cases/<nn>-<short-name>/case.json`. Only `id` is required; everything else has a
   synthetic default (see `lib/case-spec.ts`). Take Section 15 text from `clause-library.json`,
   or add a new library clause first (with its expected answer and one or two paraphrases).
2. Run `pnpm --filter @rater/evals generate --case <id>` to render `contract.pdf`.
3. Write `expected.json` from your own reading of the contract, not from the engine's output.
   Work the score out by hand from your expected findings.
4. Run `pnpm eval --case <id>`. If the engine disagrees, decide which side is wrong. Change the
   expectation only for a reason you can state, and say so in the description.
5. Run `pnpm exec vitest run evals` (case files, library and the full set) and commit the case
   folder, PDF included.

A document that is not a Qiwa contract uses
`{ "kind": "other_document", "id", "title": { "en", "ar" }, "paragraphs": [{ "en", "ar" }] }`
in `case.json` (see `lib/other-document.ts`).

## Real contracts (`--private`)

Real contracts never go in git. Keep each one in a folder outside the repo:

```
~/contracts/
  test-01/
    contract.pdf
    expected.json   # same format; id = folder name
```

and run `pnpm eval --private ~/contracts`. The files are only read. For these cases the
console and `evals/results/*.json` show field names and rule IDs but never field values or
deadline dates. Do not paste their values into the repo, an issue or a commit message.
