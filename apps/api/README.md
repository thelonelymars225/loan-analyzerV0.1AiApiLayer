# @rater/api

The Fastify API: accounts (Better Auth), uploads, reports, workspaces. Slow work runs in the
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

- **Workspaces.** Sign-up creates a personal workspace ("<name>'s workspace", kind `personal`)
  and every new session starts in it. `POST /orgs` creates company workspaces. The API always
  works in the session's active org, switched with `PUT /me/active-org` (404 unless a
  member); org routes answer 404 when `{id}` is not that org. Better Auth's own organization
  endpoints are closed: they apply Better Auth's role rules, not ours.
- **x-org-id.** The active org lives in the session, which every tab shares. The web app sends
  the org it shows in `x-org-id` on every change; when it differs from the session's active
  org the API answers 409 `conflict` (not checked on reads, `PUT /me/active-org`,
  `POST /invites/{id}/accept` or `DELETE /me/data`).
- **Invitations** (company workspaces, owner or admin): `POST /orgs/{id}/invites` returns an
  `acceptPath` (`/invite/<id>`) to share, as no email is sent in v1. `GET` lists pending ones,
  `DELETE /orgs/{id}/invites/{inviteId}` cancels. The invitee, signed in with the invited
  address, opens `GET /invites/{id}` and `POST /invites/{id}/accept`, which joins with the
  invited role and makes the workspace active. Anyone else gets 404, as for an unknown id.
- **Delete my data.** `DELETE /me/data` removes every rating, finding, document row and stored
  PDF of the caller's personal workspace, whichever workspace is active, and audits each
  deleted rating.
- **Roles** (all checks in `src/plugins/access.ts`): owners and admins see and delete every
  rating in the org and manage members; members see their own uploads only; only owners change
  settings. Admins cannot change or remove owners. The last owner can be neither demoted nor
  removed (409).
- **Uploads** are checked before anything is stored: a PDF (magic bytes), at most
  `MAX_UPLOAD_BYTES` (413), and a Qiwa "Unified Employment Contract" on page 1 (422). The check
  converts page 1 only, with at most 4 checks at once per process and a 10 s tool timeout. The
  PDF is stored at `orgs/<orgId>/documents/<documentId>.pdf` with `delete_after` = upload time
  - the org's `retentionDays`. Changing `retentionDays` applies to new uploads only.
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
