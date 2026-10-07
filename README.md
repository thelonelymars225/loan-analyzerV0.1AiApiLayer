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
   (Tesseract), because the Arabic prevails. If the wage parts do not add up, a required
   field is missing, or a Section 15 item has Arabic text but no English (or the Section 15
   heading is missing between sections that were found), the rating ends as `needs_review`.
   The extractor also records where every numbered clause and section is printed (one box
   per page, no text), so the report can point each finding at its passage.
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
   compensation, and the value of missing leave days. An Art. 77 clause that pays at least
   what the law's default would is marked compliant, not a problem.
6. **Score.** Each sub-score starts at 100. A problem finding subtracts 20 (high), 8 (medium)
   or 3 (low). A finding better than the law adds 2. The overall score weights the sub-scores
   per view (employee 40/35/25, HR 60/10/30). Bands: 80+ Good, 60-79 Fair, 40-59 Weak,
   under 40 Poor. In both views the overall score is capped: one or two high-severity findings
   that are likely void or conflict with the contract cap it at 79 (never "Good"), and three
   or more cap it at 59 ("Weak" at best).

The status moves `queued` → `extracting` → `analysing` → `done`, or ends as `needs_review` or
`failed`. The web app follows it over server-sent events.

A `needs_review` report still shows its findings, and lists in plain English why a person
should check it: each extraction problem (such as a missing field, or wage parts that do not
add up), plus one line when a Section 15 clause could not be analysed automatically.

Each finding in a report carries its passages: the clause's box on the page, the crop to
show, and the clause text as it was rated. The image itself is cut from the stored PDF when
asked for (`GET /api/v1/ratings/{id}/passages/{clause}/{page}`) and sent with `no-store`; it
is never written anywhere, so once the PDF is deleted the previews are gone too and the
report shows the clause text only. The PDF can be opened in the browser with
`GET /api/v1/ratings/{id}/document?disposition=inline`, which is audited as `view_document`,
separately from a download.

"Open in contract" on a finding card opens the contract viewer (`/ratings/{id}/contract`):
every page of the PDF, as images the API cuts on request
(`GET /api/v1/ratings/{id}/pages/{page}`, same no-store rule as the passages), with each
finding marked where it is and numbered in contract order. Its side panel is the table of
contents for the findings: an Issues tab sorted by severity, a What's good tab (whose green
marks only show while it is open), a severity filter and a previous/next stepper. The URL
carries the view, the tab and the focused passage, so a link lands on the right lines. Once
the PDF is deleted the viewer shows the clause text as it was rated instead.

A rating whose job was lost (the worker was killed mid-job, or the queue gave up on it) would
show "in progress" forever. An hourly sweep in the worker marks it `failed` with the error
code `timeout` once it has been extracting or analysing for over an hour, or queued for over
a day. The user is asked to upload the contract again.

## Architecture

The source design is in two documents:

- [Tech Stack & Architecture](https://claude.ai/code/artifact/7239b68b-2e75-47c8-80f3-daf429d02b9c)
- [Build Plan & Spec](https://claude.ai/code/artifact/d7f38bf2-b987-413e-a0f7-e833cd39a3c2)

[docs/decisions.md](docs/decisions.md) lists the decisions and open questions from them.

TypeScript on Node 22 end to end, in one pnpm monorepo. Packages export their TypeScript
sources directly and the apps run them with `tsx`, so there is no build step except for the
web app.

| Path                 | What it is                                                                     |
| -------------------- | ------------------------------------------------------------------------------ |
| `apps/api`           | Fastify REST API under `/api/v1`: accounts, workspaces, uploads, reports, SSE  |
| `apps/worker`        | pg-boss consumer: runs the pipeline, deletes expired PDFs, fails stuck ratings |
| `apps/web`           | React + Vite app, both views, the contract viewer, English and Arabic (RTL)    |
| `packages/contracts` | Shared Zod schemas: API types, Finding, Rule, Rating, constants                |
| `packages/core`      | The pipeline as pure functions: detect, extract, redact, rules, impact, score  |
| `packages/pdf`       | Wrappers for `pdftotext`, `pdftoppm` and `tesseract`                           |
| `packages/llm`       | `LlmClient`: the Claude adapter, the offline analyser, versioned prompts       |
| `packages/law`       | The rules table, the law corpus, article lookup, the ingest script             |
| `packages/db`        | Drizzle schema and migrations (Postgres 16 + pgvector)                         |
| `packages/storage`   | Encrypted file storage: S3 bucket or local disk                                |
| `evals/cases`        | 14 synthetic Qiwa contracts, each with the rating it must get                  |
| `infra`              | Docker Compose stack, Dockerfiles, nginx config                                |

Request flow: the web app uploads a PDF. The API checks it, stores it in the bucket, creates
a `queued` rating and sends a job. The worker fetches the PDF, runs the pipeline and writes
fields, clauses and findings to Postgres. The web app renders the report in either view.

Postgres holds the app data, the job queue (pg-boss) and the law vectors (pgvector). The PDFs
live only in the bucket.

## Accounts and workspaces

- **Workspaces.** Every account gets a personal workspace of one. An HR team creates a company
  workspace, whose members are owners, admins or members. Ratings belong to a workspace.
- **Switching.** The header menu switches the active workspace (`PUT /api/v1/me/active-org`).
  The active workspace is kept in the session, so it changes in every open tab. Each tab sends
  the workspace it shows in the `x-org-id` header with every change. If another tab has
  switched in the meantime, the API refuses the change (`409`) and nothing is saved; the tab
  then moves to the new workspace and says why.
- **Invitations by link.** No email is sent in v1. An owner or admin of a company workspace
  invites an email address and gets a link (`/invite/<id>`) to share however they like. Only
  someone signed in with that email address (in any letter case) can open the link and
  accept; anyone else gets "not found". Accepting adds them with the invited role and switches them to the workspace.
  A link expires after 48 hours, and owners and admins can list and cancel pending ones.
- **One place for workspace rules.** Over HTTP, Better Auth only serves sign-up, sign-in,
  sign-out and the session. Its own organization endpoints answer `404`, so every workspace
  change goes through `/api/v1`, where the role checks live.

## Quick start with Docker

You need Docker with Compose v2.

```sh
pnpm docker:up        # or: docker compose -f infra/docker-compose.yml up --build -d --wait
```

Then open http://localhost:8080, create an account and upload a contract. The synthetic
contracts in `evals/cases/*/contract.pdf` work well for a first try.

The stack runs Postgres + pgvector, MinIO (an S3 stand-in, encrypted at rest), a one-shot job
that migrates the database and loads the law corpus, the API, the worker, and nginx serving
the web app. Because that job migrates, the API and the worker start with
`DB_MIGRATE_ON_START=false`. Everything is published on localhost only. If a port is taken,
set `WEB_PORT`, `API_PORT`, `POSTGRES_PORT`, `MINIO_PORT` or `MINIO_CONSOLE_PORT`.

nginx passes the client's address to the API in `X-Forwarded-For`, replacing any value the
client sent, so sign-in rate limiting works per client. That assumes nginx faces the clients.
Behind a load balancer, set nginx's real-IP settings first (see `infra/nginx.conf`).

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

pnpm db:migrate       # create the tables (the API and the worker also do it when they start)
pnpm law:ingest       # load the law corpus into law_articles

pnpm dev:api          # http://localhost:3000
pnpm dev:worker
pnpm dev:web          # http://localhost:5173 (proxies /api to the API)
```

Uploaded PDFs go to `.data/storage` in the repository root (encrypted, ignored by git). The
API and the worker find the same folder whichever directory they run from; set
`LOCAL_STORAGE_DIR` to put it elsewhere. `DB_MIGRATE_ON_START=false` stops the API and the
worker from applying migrations when they start.

Every setting is listed in [.env.example](.env.example). The apps read real environment
variables only. To use a file: `cp .env.example .env`, edit it, then run
`set -a; . ./.env; set +a` in each terminal before `pnpm dev:*`.

## With or without an API key

Without `ANTHROPIC_API_KEY`, the worker uses the offline analyser (`heuristic-v2`). It
matches Section 15 clauses against known patterns in English and Arabic. It needs no network,
gives the same answer every time, and covers the Section 15 clauses in the eval set. Unusual
wording can slip past it.

With `ANTHROPIC_API_KEY` set, the worker sends each redacted Section 15 clause to Claude
(`claude-opus-5-5` unless `LLM_MODEL` says otherwise). Claude reads unfamiliar wording better.
Each reply is checked against a schema and against the articles it was given. A reply is
cached per clause text (English and Arabic), contract terms, law, ruleset, prompt and model
version, so rating the same contract again does not ask twice, and one contract's answer is
never reused for another contract's terms.

`LLM_PROVIDER=heuristic` forces the offline analyser even when a key is set.
`LLM_PROVIDER=claude` fails at start-up when the key is missing.

## Tests and evals

```sh
pnpm check            # lint, typecheck and unit tests
pnpm format:check     # prettier
```

- Tests that need Postgres read `DATABASE_URL`. Each one creates its own temporary database
  and drops it at the end. Without `DATABASE_URL` they are skipped.
- `apps/worker/test/eval-cases.test.ts` rates the cases in `evals/cases` (synthetic Qiwa PDFs
  with made-up people and companies) with the offline analyser and checks each against its
  `expected.json`: status, fields, findings, deadlines and score range.

CI (`.github/workflows/ci.yml`) runs the same checks and the web build on pull requests and
on pushes to `main` (a push to a pull request's branch runs once, as the pull request). It
fails if a PDF other than the synthetic ones is committed.

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
- **Retention.** Each PDF gets a delete date: upload time plus the workspace's retention days
  (default 30, between 1 and 365). The worker deletes expired PDFs every hour.
- **Delete at any time.** `DELETE /api/v1/ratings/{id}` removes the rating, its findings and
  its PDF.
- **Delete my data.** The account page's "Delete my data" (`DELETE /api/v1/me/data`) removes
  every rating, finding, document record and stored PDF in the user's personal workspace,
  whichever workspace is active, and then signs them out. Ratings in a company workspace
  belong to that company and stay. Each deletion is audited.
- **Workspace scoping and roles.** Every query is scoped by the session's active workspace.
  Role checks live in one place (`apps/api/src/plugins/access.ts`).
- **Daily upload limit.** Each user can upload `RATE_LIMIT_PER_DAY` contracts (default 20)
  in any 24 hours, across all their workspaces. Uploads are counted from the audit log, so
  deleting a rating does not give one back, while a rejected upload does not count. The
  count and the new upload happen under a per-user lock, so parallel uploads cannot slip past
  the limit. Over it, the API answers `429` with `Retry-After`.
- **Audit.** Uploads, report views, PDF opens and downloads, and deletes (manual and
  automatic) are written to `audit_events`. Passage images are not audited one by one: they
  are part of viewing the report, which is.
- **Logs.** Logs carry IDs, never request bodies, file names or contract text. Cookies and
  authorization headers are redacted.
- **Consent and disclaimer.** The upload form asks for consent. Every report carries the "not
  legal advice" disclaimer, in English or Arabic.
- **No real data in the repository.** Fixtures and eval cases are synthetic. Git ignores
  every PDF except those, and the Docker build leaves out all PDFs and every `private/` and
  `.data/` folder.

Not done yet: hosting in a KSA region (see the open questions).

## Versioning

Every rating records the four versions that produced it, and the report footer shows them:

| Version | Now        | Where it lives                                                     |
| ------- | ---------- | ------------------------------------------------------------------ |
| Law     | `2025-11`  | `packages/law/src/versions.ts` and every corpus entry              |
| Ruleset | `0.1.0`    | `packages/law/rules/rules.json` and `packages/law/src/versions.ts` |
| Prompt  | `s15-v1`   | `packages/llm/prompts/` (a prompt change bumps the version)        |
| Model   | per rating | `heuristic-v2`, or the pinned Claude model id                      |

The clause cache is keyed by a hash of the redacted clause text (English and Arabic, since the
Arabic prevails) and the field summary the analyser is given, plus all four versions. A change
to any of them re-analyses the clause. Old ratings stay explainable: law rows of older
versions stay in `law_articles`.

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
