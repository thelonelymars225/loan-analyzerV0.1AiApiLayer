Rate Saudi Qiwa employment contracts from your own systems. Upload a contract PDF and get back a score out of 100, the clauses to fix, and the deadlines that apply.

The ratings are a rating aid, not legal advice.

## Getting started

You need an account with **API access**. An admin turns it on for you on the Admin page.

**1. Create an API key.** While signed in, call:

```http
POST /api/auth/api-key/create
Content-Type: application/json

{ "name": "payroll-sync" }
```

Keep the `key` from the answer. It is shown only once.

**2. Upload a contract.**

```bash
curl https://rater.example.sa/api/v1/ratings \
  -H "x-api-key: $KEY" \
  -F file=@contract.pdf
```

```json
{ "id": "rt_01k9f3v8wq7m2c4x0d5e6g7h8j", "status": "queued" }
```

**3. Wait, then read the report.** Follow the status with [server-sent events](#rating-lifecycle), then fetch the report:

```bash
curl "https://rater.example.sa/api/v1/ratings/rt_01k9f3v8wq7m2c4x0d5e6g7h8j?view=hr" \
  -H "x-api-key: $KEY"
```

## Authentication

Every call under `/api/v1` is authenticated one of two ways.

| Caller             | Send                                                  |
| ------------------ | ----------------------------------------------------- |
| A server or script | The header `x-api-key: <key>`                         |
| A browser app      | The session cookie set when signing in at `/api/auth` |

An admin can revoke API access at any time. Revoking it deletes the user's keys.

## Rating lifecycle

A rating is worked on in the background, so uploading answers `202` straight away.

| Status         | Meaning                                                |
| -------------- | ------------------------------------------------------ |
| `queued`       | Waiting for a worker                                   |
| `extracting`   | Reading the PDF                                        |
| `analysing`    | Checking the clauses                                   |
| `done`         | The report is ready                                    |
| `needs_review` | The report is ready, but some fields need a human look |
| `failed`       | Rating stopped. See `error` on the rating              |

`GET /api/v1/ratings/{id}/events` streams each change as `event: status` and closes on a final status. If you would rather poll, call `GET /api/v1/ratings/{id}`.

## Report views

The same findings are framed two ways. Pick one with `?view=`.

- `employee` explains what the contract means for the person signing it.
- `hr` weighs findings by compliance risk for the employer.

## Errors

Errors use [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json`. Branch on `code`, which never changes. The `detail` text may.

```json
{
  "type": "urn:contract-rater:error:unsupported_document",
  "title": "Unsupported document",
  "status": 422,
  "code": "unsupported_document",
  "detail": "Not a Qiwa employment contract."
}
```

| Status | Code                   | When                                            |
| ------ | ---------------------- | ----------------------------------------------- |
| 400    | `validation_error`     | The request has the wrong shape                 |
| 401    | `unauthorized`         | No session or key                               |
| 403    | `forbidden`            | Signed in, but not allowed                      |
| 404    | `not_found`            | No such rating, or not yours                    |
| 413    | `file_too_large`       | The PDF is over 10 MB                           |
| 422    | `unsupported_document` | Not a Qiwa employment contract                  |
| 429    | `rate_limited`         | Over a limit. Retry after `Retry-After` seconds |

## Rate limits

| What               | Limit                  |
| ------------------ | ---------------------- |
| Contract ratings   | 20 per user per day    |
| Wage checks        | 60 requests per minute |
| Open event streams | 3 per user             |
