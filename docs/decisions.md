# Decisions and open questions

From the two design documents,
[Tech Stack & Architecture](https://claude.ai/code/artifact/7239b68b-2e75-47c8-80f3-daf429d02b9c)
and [Build Plan & Spec](https://claude.ai/code/artifact/d7f38bf2-b987-413e-a0f7-e833cd39a3c2),
plus the choices made while building v1. Add a row when a decision is made, and move an open
question here once it is answered.

## Decisions

| Date       | Decision                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-03 | Serve both employees and HR: one engine, two views. Any rating can be shown in either view.                                                                                                                   |
| 2026-10-03 | Scope: Saudi private-sector Qiwa "Unified Employment Contract" PDFs. Other contract models are out of scope for v1.                                                                                           |
| 2026-10-03 | Stack: TypeScript on Node 22 (Fastify API, React + Vite web), PostgreSQL 16 + pgvector, pg-boss for jobs, Drizzle for SQL, Better Auth for accounts and orgs. Go stays the fallback if the API ever needs it. |
| 2026-10-03 | Keep pgvector rather than a separate vector database. The corpus is small and most lookups go by rule ID.                                                                                                     |
| 2026-10-03 | Drop court rulings as a data source: about 14 public labor judgments, and the MoJ terms bar republishing.                                                                                                     |
| 2026-10-03 | The law corpus is three official Arabic documents: the Labor Law (2025-11 edition), the Implementing Regulations (2025) and the Qiwa contract models. Arabic is the source of truth; English is unofficial.   |
| 2026-10-03 | Rules are data. Each rule is a JSON entry validated by a Zod schema; code only implements the check named by the rule ID.                                                                                     |
| 2026-10-03 | Field rules are deterministic code. The LLM only handles Section 15 and the cross-check, with citations limited to the articles it was given (temperature 0 where the model accepts it).                      |
| 2026-10-03 | Every rating records the law, ruleset, prompt and model versions. Clause analyses are cached per clause hash and those versions.                                                                              |
| 2026-10-03 | Personal data stays minimal: PDFs only in an encrypted bucket, redaction before any LLM call, automatic deletion after the org's retention period (default 30 days), audit events.                            |
| 2026-10-03 | Organizations from day one: an employee gets a personal org of one, HR teams get a company org with owner, admin and member roles. The org comes from the session, never from the request.                    |
| 2026-10-03 | No real contracts in git. Evals use synthetic Qiwa PDFs rendered from an HTML copy of the layout; real contracts run locally with `pnpm eval --private`.                                                      |
| 2026-10-04 | Without an API key, an offline pattern-based analyser (`heuristic-v1`) replaces Claude, so the product, the tests and the evals run with no network.                                                          |
| 2026-10-04 | Until the embedding model is chosen, the corpus uses an offline hashing embedder with 256 dimensions. Rule-first lookup means search quality matters little for v1.                                           |
| 2026-10-04 | Local stack: Docker Compose with MinIO as the S3 stand-in. The community `minio/minio` image is no longer on Docker Hub, so the stack uses `pgsty/minio` (a community build) and lets you swap it.            |

## Open questions

- **Embedding model.** Self-host a multilingual model (data stays on our servers) or use a
  hosted API (less to run)? The vector dimension follows from this choice.
- **Production region and provider in KSA.** Candidates: Google Cloud Dammam, Oracle Riyadh
  or Jeddah, or a local provider. The pilot can run anywhere while only test data flows.
- **Market-fairness data.** GASTAT national tables only for v1, or license a salary survey?
  v1 checks allowance ratios and leave only, and marks market fairness as low confidence.
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
