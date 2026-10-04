# @rater/api

The Fastify API: accounts (Better Auth), uploads, reports, workspaces. Slow work runs in the
worker; the API stores the PDF, creates a `queued` rating and sends a pg-boss job.

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/rater pnpm dev:api
curl localhost:3000/api/v1/healthz
```

| Path          | What                                                                            |
| ------------- | ------------------------------------------------------------------------------- |
| `/api/auth/*` | Better Auth: sign-up/in/out, sessions, organization API (`set-active`, …)       |
| `/api/v1/*`   | The REST API. Session cookie; errors are `application/problem+json`             |
| `/api/docs`   | Swagger UI. The spec, generated from the Zod schemas, is `/api/v1/openapi.json` |

## Configuration

| Variable                      | Default                 | Notes                                                                                  |
| ----------------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | required                | Postgres with pgvector; pg-boss uses the same database                                 |
| `PORT`, `HOST`                | `3000`, `0.0.0.0`       |                                                                                        |
| `BETTER_AUTH_SECRET`          | required in production  | 32+ characters (`openssl rand -base64 32`)                                             |
| `BETTER_AUTH_URL`             | `http://localhost:3000` | Public URL of the API                                                                  |
| `WEB_ORIGIN`                  | `http://localhost:5173` | Allowed by CORS and Better Auth (Vite's dev origin is also allowed outside production) |
| `STORAGE_DRIVER`              | `local`                 | `local` or `s3`; see `@rater/storage` for its other variables                          |
| `LOG_LEVEL`                   | `info`                  | pino level                                                                             |
| `RATE_LIMIT_PER_DAY`          | `20`                    | New ratings per user per 24 hours                                                      |
| `MAX_UPLOAD_BYTES`            | `10485760`              | 10 MB                                                                                  |
| `MIGRATE_ON_START`            | `true`                  | Apply `packages/db/migrations` on start                                                |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset                   | Set it to export traces over OTLP/HTTP                                                 |

## Behaviour worth knowing

- **Workspaces.** Sign-up creates a personal workspace ("<name>'s workspace", kind `personal`)
  and every new session starts in it. `POST /orgs` creates company workspaces. The API always
  works in the session's active org (Better Auth `organization.setActive`); org routes answer
  404 when `{id}` is not that org.
- **Roles** (all checks in `src/plugins/access.ts`): owners and admins see and delete every
  rating in the org and manage members; members see their own uploads only; only owners change
  settings. Admins cannot change or remove owners. The last owner can be neither demoted nor
  removed (409).
- **Uploads** are checked before anything is stored: a PDF (magic bytes), at most
  `MAX_UPLOAD_BYTES` (413), and a Qiwa "Unified Employment Contract" on page 1 (422). The PDF is
  stored at `orgs/<orgId>/documents/<documentId>.pdf` with `delete_after` = upload time + the
  org's `retentionDays`. Changing `retentionDays` applies to new uploads only.
- **Queue.** Each upload sends one pg-boss job on `rate-contract` with data `{ ratingId }`.
  The API creates the queue if it is missing; it runs no pg-boss maintenance.
- **Reports** render from the stored findings for every status (score `null` until the rating
  is `done` or `needs_review`, `error` when `failed`), in `?view=` or the rating's default view,
  with the disclaimer in the `Accept-Language` language.
- **Events.** `GET /ratings/{id}/events` re-reads the status every second and sends
  `event: status` / `data: {"id","status"}` on each change; it ends after a final status.
- **Audit.** Uploads, report views (finished ratings only), PDF downloads and deletes go to
  `audit_events`. Logs never contain bodies, file names or contract text.
