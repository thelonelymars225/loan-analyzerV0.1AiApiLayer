# Decisions and open questions

From the two design documents,
[Tech Stack & Architecture](https://claude.ai/code/artifact/7239b68b-2e75-47c8-80f3-daf429d02b9c)
and [Build Plan & Spec](https://claude.ai/code/artifact/d7f38bf2-b987-413e-a0f7-e833cd39a3c2),
plus the choices made while building v1. Add a row when a decision is made, and move an open
question here once it is answered.

## Decisions

| Date       | Decision                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-03 | Serve both employees and HR: one engine, two views. Any rating can be shown in either view.                                                                                                                                                                                                                              |
| 2026-10-03 | Scope: Saudi private-sector Qiwa "Unified Employment Contract" PDFs. Other contract models are out of scope for v1.                                                                                                                                                                                                      |
| 2026-10-03 | Stack: TypeScript on Node 22 (Fastify API, React + Vite web), PostgreSQL 16 + pgvector, pg-boss for jobs, Drizzle for SQL, Better Auth for accounts and orgs. Go stays the fallback if the API ever needs it.                                                                                                            |
| 2026-10-03 | Keep pgvector rather than a separate vector database. The corpus is small and most lookups go by rule ID.                                                                                                                                                                                                                |
| 2026-10-03 | Drop court rulings as a data source: about 14 public labor judgments, and the MoJ terms bar republishing.                                                                                                                                                                                                                |
| 2026-10-03 | The law corpus is three official Arabic documents: the Labor Law (2025-11 edition), the Implementing Regulations (2025) and the Qiwa contract models. Arabic is the source of truth; English is unofficial.                                                                                                              |
| 2026-10-03 | Rules are data. Each rule is a JSON entry validated by a Zod schema; code only implements the check named by the rule ID.                                                                                                                                                                                                |
| 2026-10-03 | Field rules are deterministic code. The LLM only handles Section 15 and the cross-check, with citations limited to the articles it was given (temperature 0 where the model accepts it).                                                                                                                                 |
| 2026-10-03 | Every rating records the law, ruleset, prompt and model versions. Clause analyses are cached per clause hash and those versions.                                                                                                                                                                                         |
| 2026-10-03 | Personal data stays minimal: PDFs only in an encrypted bucket, redaction before any LLM call, automatic deletion after the org's retention period (default 30 days), audit events.                                                                                                                                       |
| 2026-10-03 | Organizations from day one: an employee gets a personal org of one, HR teams get a company org with owner, admin and member roles. The org comes from the session, never from the request.                                                                                                                               |
| 2026-10-03 | No real contracts in git. Evals use synthetic Qiwa PDFs rendered from an HTML copy of the layout; real contracts run locally with `pnpm eval --private`.                                                                                                                                                                 |
| 2026-10-04 | Without an API key, an offline pattern-based analyser (`heuristic-v2`) replaces Claude, so the product, the tests and the evals run with no network.                                                                                                                                                                     |
| 2026-10-04 | Until the embedding model is chosen, the corpus uses an offline hashing embedder with 256 dimensions. Rule-first lookup means search quality matters little for v1.                                                                                                                                                      |
| 2026-10-04 | Local stack: Docker Compose with MinIO as the S3 stand-in. The community `minio/minio` image is no longer on Docker Hub, so the stack uses `pgsty/minio` (a community build) and lets you swap it.                                                                                                                       |
| 2026-10-04 | Workspace changes go through `/api/v1` only, where our role checks live. Over HTTP, Better Auth serves sign-up, sign-in, sign-out and the session; its organization endpoints answer 404.                                                                                                                                |
| 2026-10-04 | Invitations are shareable links in v1, with no email sent. Only a user signed in with the invited address can open or accept one (anyone else gets 404). A link expires after 48 hours.                                                                                                                                  |
| 2026-10-04 | The active workspace lives in the session, so it is the same in every tab. Each change carries the workspace the tab shows (`x-org-id`); when it no longer matches, the API answers 409 and saves nothing.                                                                                                               |
| 2026-10-04 | "Delete my data" removes every rating, finding, document record and PDF in the user's personal workspace, then signs them out. Company workspaces keep their ratings: they belong to the company.                                                                                                                        |
| 2026-10-04 | A `needs_review` rating stores and shows its reasons in plain English: the extraction problems, plus one line when a Section 15 clause could not be analysed.                                                                                                                                                            |
| 2026-10-04 | In both views, one or two high-severity likely-void or conflict findings cap the overall score at 79 (never "Good"), three or more at 59. An Art. 77 clause paying the default or more is compliant.                                                                                                                     |
| 2026-10-04 | The daily limit counts accepted uploads per user in any 24 hours (from the audit log, so deleting a rating gives none back), checked under a per-user lock so parallel uploads cannot pass it together.                                                                                                                  |
| 2026-10-04 | One flag, `DB_MIGRATE_ON_START` (true or false, default true), decides whether the API and the worker apply migrations on start. The Compose stack migrates in a one-shot job and sets it to false.                                                                                                                      |
| 2026-10-04 | An hourly sweep marks lost jobs `failed` (`timeout`): extracting or analysing for over an hour, or queued for over a day. The user is asked to upload again.                                                                                                                                                             |
| 2026-10-04 | The local storage folder defaults to `.data/storage` in the repository root, not the working directory, so the API and the worker always share it.                                                                                                                                                                       |
| 2026-10-04 | nginx replaces the client's `X-Forwarded-For` with the address it sees, so a forged header cannot pool sign-in rate limits. Behind a load balancer, configure nginx's real-IP module first.                                                                                                                              |
| 2026-10-04 | CI runs on pull requests and on pushes to `main`, so each push to a pull request runs once. CI also fails when a PDF other than the synthetic ones is committed.                                                                                                                                                         |
| 2026-10-07 | Each finding points at its passage. The extractor stores one box per page for every numbered clause (no text); the API cuts the image from the PDF on request and stores nothing, so deleting the PDF deletes the previews.                                                                                              |
| 2026-10-07 | Opening the PDF in the contract viewer (`disposition=inline`) is audited as `view_document`, apart from a download. Passage images are not audited one by one: viewing the report already is.                                                                                                                            |
| 2026-10-07 | The contract viewer shows server-rendered page images (same no-store rule as the passages) rather than running a PDF renderer in the browser: less code to keep, nothing of the PDF cached on the client, and the same highlight maths as the previews. The original PDF opens inline for anything else (print, search). |
| 2026-10-07 | In the viewer, findings are numbered in contract order (the same number on the pin and in the list) while the Issues list is sorted by severity, then by place; a finding placed only as a whole section gets no number. What's good is a second tab, and its green marks show only while it is open.                    |

## Open questions

- **Embedding model.** Self-host a multilingual model (data stays on our servers) or use a
  hosted API (less to run)? The vector dimension follows from this choice.
- **Production region and provider in KSA.** Candidates: Google Cloud Dammam, Oracle Riyadh
  or Jeddah, or a local provider. The pilot can run anywhere while only test data flows.
- **Market-fairness data.** GASTAT national tables only for v1, or license a salary survey?
  v1 checks allowance ratios, Art. 77 compensation and transfer clauses, and marks market
  fairness as low confidence.
- **Pricing.** Free employee checks with paid HR seats, or pay per rating?
- **Network access to hrsd.gov.sa.** Allow it in the build environment so the law PDFs can be
  downloaded and the Arabic texts checked against the official source, or upload the PDFs
  once by hand.

## Risks being watched (from the Build Plan)

| Risk                            | Fallback                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Arabic OCR misreads Section 15  | Analyse the English text as primary; flag clauses where the two languages disagree. |
| Qiwa changes its PDF layout     | Label-based parsing, a layout check, and `needs_review` instead of a wrong answer.  |
| LLM verdicts drift between runs | Temperature 0, a pinned model, the clause cache, and evals on every change.         |
| The law is amended              | Versioned corpus; re-run the evals when HRSD publishes a new edition.               |
| A user relies on a rating       | "Rating aid, not legal advice" on every report; every claim cites its article.      |
