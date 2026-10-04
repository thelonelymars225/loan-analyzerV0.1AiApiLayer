# Contract Rater

Contract Rater checks a Saudi employment contract against the Labor Law. You upload the PDF
of a Qiwa "Unified Employment Contract" (عقد العمل الموحد). You get a score from 0 to 100,
with Legal, Market fairness and Clarity sub-scores. Each finding cites the article it relies
on. Where a formula exists, it shows the effect in SAR. It also lists deadlines, such as the
last day to stop an automatic renewal.

One engine produces the findings. Two views present them:

- **Employee view:** "Is this fair to me before I sign?" It leads with SAR impact and deadlines.
- **HR view:** "Is our contract compliant and defensible?" It leads with void clauses and
  suggested wording.

> **Rating aid, not legal advice.** Contract Rater can be wrong. Check the cited articles, and
> ask a lawyer before you act on a finding.

**Status: v1 demo.** It rates one document type: the Qiwa contract for private-sector jobs.
Other contract models, salary benchmarks by occupation, billing and exported redlines are out
of scope for v1.

## How a rating works

A rating runs as one background job. Each step is a pure function in `packages/core`; the
worker adds the I/O and saves the results.

1. **Detect.** Page 1 must say "Unified Employment Contract" or "عقد العمل الموحد". Other
   PDFs are rejected (`422 unsupported_document`).
2. **Extract.** `pdftotext -bbox-layout` gives word positions. The page splits into an
   English column and an Arabic column. The English column is read by its labels: contract
   type, dates, probation, hours, leave, wage split, overtime premium, renewal notice. Section
   15 ("Additional Terms") becomes a list of clauses. Its Arabic text comes from OCR
   (Tesseract), because the Arabic prevails. If the wage parts do not add up, or a required
   field is missing, the rating ends as `needs_review`.
3. **Redact.** National IDs, IBANs, phone numbers, e-mail addresses and the names of both
   parties become placeholders such as `[ID]` and `[EMPLOYEE]`. Only redacted text goes further.
4. **Check.**
   - Field rules (no LLM): probation up to 180 days, leave at least 21 days (30 after five
     years), at most 48 hours a week, overtime premium at least 50%, allowance ratios, and the
     renewal deadline.
   - Section 15: each clause is matched to rules from the rules table. The rule's articles
     are fetched by reference, with vector search as a backstop. The analyser returns a
     verdict. Its citations must come from the articles it was given, or it retries once. A
     second bad reply becomes a low-confidence finding flagged for review.
   - Cross-check: Section 15 statements that contradict sections 1-14, such as a "project"
     clause in a fixed-term contract.
5. **Impact.** Plain formulas give the SAR effect: the end-of-service gap, Art. 77
   compensation, and the value of missing leave days.
6. **Score.** Each sub-score starts at 100. A problem finding subtracts 20 (high), 8 (medium)
   or 3 (low). A finding better than the law adds 2. The overall score weights the sub-scores
   per view (employee 40/35/25, HR 60/10/30). Bands: 80+ Good, 60-79 Fair, 40-59 Weak,
   under 40 Poor.

The status moves `queued` → `extracting` → `analysing` → `done`, or ends as `needs_review` or
`failed`. The web app follows it over server-sent events.

## Architecture

The source design is in two documents:

- [Tech Stack & Architecture](https://claude.ai/code/artifact/7239b68b-2e75-47c8-80f3-daf429d02b9c)
- [Build Plan & Spec](https://claude.ai/code/artifact/d7f38bf2-b987-413e-a0f7-e833cd39a3c2)

[docs/decisions.md](docs/decisions.md) lists the decisions and open questions from them.

TypeScript on Node 22 end to end, in one pnpm monorepo. Packages export their TypeScript
sources directly and the apps run them with `tsx`, so there is no build step except for the
web app.

| Path                 | What it is                                                                    |
| -------------------- | ----------------------------------------------------------------------------- |
| `apps/api`           | Fastify REST API under `/api/v1`, Better Auth accounts and orgs, uploads, SSE |
| `apps/worker`        | pg-boss consumer: runs the rating pipeline, deletes expired PDFs hourly       |
| `apps/web`           | React + Vite app, both views, English and Arabic (RTL)                        |
| `packages/contracts` | Shared Zod schemas: API types, Finding, Rule, Rating, constants               |
| `packages/core`      | The pipeline as pure functions: detect, extract, redact, rules, impact, score |
| `packages/pdf`       | Wrappers for `pdftotext`, `pdftoppm` and `tesseract`                          |
| `packages/llm`       | `LlmClient`: the Claude adapter, the offline analyser, versioned prompts      |
| `packages/law`       | The rules table, the law corpus, article lookup, the ingest script            |
| `packages/db`        | Drizzle schema and migrations (Postgres 16 + pgvector)                        |
| `packages/storage`   | Encrypted file storage: S3 bucket or local disk                               |
| `evals`              | Synthetic contracts, the Qiwa template, the eval runner                       |
| `infra`              | Docker Compose stack, Dockerfiles, nginx config                               |

Request flow: the web app uploads a PDF. The API checks it, stores it in the bucket, creates
a `queued` rating and sends a job. The worker fetches the PDF, runs the pipeline and writes
fields, clauses and findings to Postgres. The web app renders the report in either view.

Postgres holds the app data, the job queue (pg-boss) and the law vectors (pgvector). The PDFs
live only in the bucket.

## Quick start with Docker

You need Docker with Compose v2.

```sh
pnpm docker:up        # or: docker compose -f infra/docker-compose.yml up --build -d --wait
```

Then open http://localhost:8080, create an account and upload a contract. The synthetic
contracts in `evals/cases/*/contract.pdf` work well for a first try.

The stack runs Postgres + pgvector, MinIO (an S3 stand-in, encrypted at rest), a one-shot job
that migrates the database and loads the law corpus, the API, the worker, and nginx serving
the web app. Everything is published on localhost only. If a port is taken, set `WEB_PORT`,
`API_PORT`, `POSTGRES_PORT`, `MINIO_PORT` or `MINIO_CONSOLE_PORT`.

| What       | Where                                   |
| ---------- | --------------------------------------- |
| Web app    | http://localhost:8080                   |
| API health | http://localhost:3000/api/v1/healthz    |
| API docs   | http://localhost:3000/api/docs          |
| MinIO      | http://localhost:9001 (console)         |
| Postgres   | `localhost:5432`, `postgres`/`postgres` |

Compose reads settings from your shell or from `infra/.env`. Every setting has a local
default. Change the passwords and keys before you upload a real contract (see the Docker
Compose section of [.env.example](.env.example)). Stop with `pnpm docker:down`; add `-v`
(`docker compose -f infra/docker-compose.yml down -v`) to delete the data too.

## Local development

You need Node 22.12+, pnpm 10 (`corepack enable`), Postgres 16 with pgvector, and
`poppler-utils`. Install `tesseract-ocr` and `tesseract-ocr-ara` too for the Arabic OCR; the
worker runs without them and skips OCR.

```sh
pnpm install
pnpm dev:db           # Postgres + pgvector in Docker (or use your own)

export DATABASE_URL=postgres://postgres:postgres@localhost:5432/rater
export LOCAL_STORAGE_DIR="$PWD/.data/storage"   # the API and the worker must share it

pnpm db:migrate       # create the tables
pnpm law:ingest       # load the law corpus into law_articles

pnpm dev:api          # http://localhost:3000
pnpm dev:worker
pnpm dev:web          # http://localhost:5173 (proxies /api to the API)
```

Every setting is listed in [.env.example](.env.example). The apps read real environment
variables only. To use a file: `cp .env.example .env`, edit it, then run
`set -a; . ./.env; set +a` in each terminal before `pnpm dev:*`.

## With or without an API key

Without `ANTHROPIC_API_KEY`, the worker uses the offline analyser (`heuristic-v1`). It
matches Section 15 clauses against known patterns in English and Arabic. It needs no network,
gives the same answer every time, and covers the clause library in the eval set. Unusual
wording can slip past it.

With `ANTHROPIC_API_KEY` set, the worker sends each redacted Section 15 clause to Claude
(`claude-opus-5-5` unless `LLM_MODEL` says otherwise). Claude reads unfamiliar wording better.
Each reply is checked against a schema and against the articles it was given. Identical
clauses are cached per law, ruleset, prompt and model version, so boilerplate is analysed
once.

`LLM_PROVIDER=heuristic` forces the offline analyser even when a key is set.
`LLM_PROVIDER=claude` fails at start-up when the key is missing.

## Tests and evals

```sh
pnpm check            # lint, typecheck and unit tests
pnpm format:check     # prettier
pnpm eval             # rate every synthetic case and compare with expected.json
```

- Tests that need Postgres read `DATABASE_URL`. Each one creates its own temporary database
  and drops it at the end. Without `DATABASE_URL` they are skipped.
- `pnpm eval` rates the cases in `evals/cases` (synthetic Qiwa PDFs with made-up people and
  companies). It checks the Build Plan's pass bars: required fields, high-severity recall,
  precision, `mustNot` rules, score within ±5, and the same findings on 3 runs. Results go to
  `evals/results/`. Options: `--llm heuristic|claude`, `--case <id>`, `--runs <n>`,
  `--no-ocr`, `--json`.
- `pnpm eval --private <dir>` also rates real contracts kept in `<dir>/<id>/contract.pdf`
  with an `expected.json` next to each. **Real contracts never go in git.** Keep them outside
  the repository (or in `private/`, which git ignores). The runner does not print or save
  their field values.
- The case PDFs are generated from `case.json` with Playwright Chromium:
  `pnpm --filter @rater/evals generate`. They are committed, so evals need no browser.

CI (`.github/workflows/ci.yml`) runs the same checks and the web build on every push and pull
request. It runs the eval set when `packages/core`, `packages/law`, `packages/llm` or `evals`
change.

## Privacy and PDPL

A contract carries a national ID, an IBAN, a salary and an address. These measures are built
in:

- **Redaction before any LLM call.** IDs, IBANs, phone numbers, e-mail addresses and party
  names are replaced before Section 15 reaches the analyser. The redaction has its own tests.
- **Encrypted files.** The local driver encrypts each PDF with AES-256-GCM. The S3 driver asks
  for server-side encryption on every object. The Compose stack gives MinIO a KMS key and
  turns on default encryption for the bucket.
- **Little personal data in Postgres.** The database keeps the extracted fields (no names, IDs
  or IBANs), the redacted clauses, the findings and a storage key. PDFs stay in the bucket.
- **Retention.** Each PDF gets a delete date: upload time plus the org's retention days
  (default 30, between 1 and 365). The worker deletes expired PDFs every hour.
- **Delete at any time.** `DELETE /api/v1/ratings/{id}` removes the rating, its findings and
  its PDF.
- **Org scoping and roles.** Every query is scoped by the session's org. Role checks live in
  one place (`apps/api/src/plugins/access.ts`).
- **Audit.** Uploads, report views, downloads and deletes (manual and automatic) are written
  to `audit_events`.
- **Logs.** Logs carry IDs, never request bodies, file names or contract text. Cookies and
  authorization headers are redacted.
- **Consent and disclaimer.** The upload form asks for consent. Every report carries the "not
  legal advice" disclaimer, in English or Arabic.
- **No real data in the repository.** Fixtures and eval cases are synthetic.

Not done yet: hosting in a KSA region (see the open questions).

## Versioning

Every rating records the four versions that produced it, and the report footer shows them:

| Version | Now        | Where it lives                                                     |
| ------- | ---------- | ------------------------------------------------------------------ |
| Law     | `2025-11`  | `packages/law/src/versions.ts` and every corpus entry              |
| Ruleset | `0.1.0`    | `packages/law/rules/rules.json` and `packages/law/src/versions.ts` |
| Prompt  | `s15-v1`   | `packages/llm/prompts/` (a prompt change bumps the version)        |
| Model   | per rating | `heuristic-v1`, or the pinned Claude model id                      |

The clause cache is keyed by the clause text and all four versions. A change to any of them
re-analyses the clause. Old ratings stay explainable: law rows of older versions stay in
`law_articles`.

## Open questions

- **Embedding model.** The corpus is embedded with an offline hashing embedder (256
  dimensions). A real multilingual model is still open: self-hosted (data stays on our
  servers) or a hosted API (less to run).
- **Production region.** A KSA region for production: Google Cloud Dammam, Oracle Riyadh or
  Jeddah, or a local provider.
- **Pricing.** Free employee checks with paid HR seats, or pay per rating.
- **Market data.** v1 has no salary benchmarks. It checks allowance ratios and marks market
  fairness as low confidence. GASTAT national tables, or a licensed salary survey?
- **Law texts.** Some Arabic article texts were rebuilt from secondary sources. They need a
  check against the official HRSD text (`hrsd.gov.sa` was not reachable from the build
  environment).

See [docs/decisions.md](docs/decisions.md) for the decisions made so far.
