# @rater/api

The Fastify API: accounts (Better Auth), uploads, reports. Slow work runs in the
worker; the API stores the PDF, creates a `queued` rating and sends a pg-boss job.

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/rater pnpm dev:api
curl localhost:3000/api/v1/healthz
```

| Path          | What                                                                            |
| ------------- | ------------------------------------------------------------------------------- |
| `/api/auth/*` | Better Auth: sign-up, sign-in, sign-out, get-session only; anything else is 404 |
| `/api/v1/*`   | The REST API. Session cookie; errors are `application/problem+json`             |
| `/api/docs`   | Swagger UI. The spec, generated from the Zod schemas, is `/api/v1/openapi.json` |

## Configuration

| Variable                      | Default                 | Notes                                                                                           |
| ----------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | required                | Postgres with pgvector; pg-boss uses the same database                                          |
| `PORT`, `HOST`                | `3000`, `0.0.0.0`       |                                                                                                 |
| `BETTER_AUTH_SECRET`          | required in production  | 32+ characters (`openssl rand -base64 32`)                                                      |
| `BETTER_AUTH_URL`             | `http://localhost:3000` | Public URL of the API                                                                           |
| `WEB_ORIGIN`                  | `http://localhost:5173` | Allowed by CORS and Better Auth; outside production so are Vite dev (:5173) and preview (:4173) |
| `STORAGE_DRIVER`              | `local`                 | `local` or `s3`; see `@rater/storage` for its other variables                                   |
| `LOG_LEVEL`                   | `info`                  | pino level                                                                                      |
| `RATE_LIMIT_PER_DAY`          | `20`                    | Accepted uploads per user per 24 hours; deleting a rating gives none back                       |
| `MAX_UPLOAD_BYTES`            | `10485760`              | 10 MB                                                                                           |
| `DB_MIGRATE_ON_START`         | `true`                  | Apply `packages/db/migrations` on start; same name and parser as the worker                     |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset                   | Set it to export traces over OTLP/HTTP                                                          |

## Behaviour worth knowing

- **Access.** Only the user who uploaded a rating can see, download, view or delete it;
  anyone else gets 404, as for an unknown id.
- **Delete my data.** `DELETE /me/data` removes every rating, finding, document row and stored
  PDF of the caller, and audits each deleted rating.
- **Uploads** are checked before anything is stored: a PDF (magic bytes), at most
  `MAX_UPLOAD_BYTES` (413), and a Qiwa "Unified Employment Contract" on page 1 (422). The check
  converts page 1 only, with at most 4 checks at once per process and a 10 s tool timeout. The
  PDF is stored at `users/<userId>/documents/<documentId>.pdf` with `delete_after` = upload
  time + 30 days.
- **Daily limit.** Counts the user's `upload` audit events of the last 24 hours (refused and
  failed uploads do not count; deleted ratings still do), checked under a per-user advisory
  lock in the transaction that records the upload, so parallel uploads cannot pass together.
  Over the limit: 429 `rate_limited` with `Retry-After`.
- **Queue.** Each upload sends one pg-boss job on `rate-contract` with data `{ ratingId }`.
  The API creates the queue if it is missing; it runs no pg-boss maintenance.
- **Reports** render from the stored findings for every status (score `null` until the rating
  is `done` or `needs_review`, `error` when `failed`), in `?view=` or the rating's default view,
  with the disclaimer in the `Accept-Language` language.
- **Events.** `GET /ratings/{id}/events` re-reads the status every second and sends
  `event: status` / `data: {"id","status"}` on each change; it ends after a final status, when
  the client leaves, or when the caller can no longer see the rating. At most 3 open streams
  per user and 200 per process; beyond that 429 `rate_limited`, and the web app polls.
- **Review reasons.** A `needs_review` report carries `reviewReasons` (stored by the worker).
- **Audit.** Uploads, report views (finished ratings only), PDF downloads and deletes go to
  `audit_events`. Logs never contain bodies, file names or contract text.
