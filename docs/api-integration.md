# Integrating with the API

Using Althistory from outside: authenticating, scoping to a graph, reading and
writing entities, handling jobs and webhooks, and moving a graph in and out.

Written from the implementation — `timeline/src/api/middleware.ts`,
`timeline/src/models/ApiKey.ts`, `timeline/src/services/RateLimitService.ts`,
`timeline/src/services/JobService.ts`. The authoritative route list is the
OpenAPI document the server serves at `GET /api/openapi.json`.

## Authenticating

**Which routes require a key.** Not all of them. The entity routes are
currently mounted without authentication — `/api/events`, `/api/arcs`,
`/api/causal`, `/api/temporal` and `/api/inference` answer anonymous callers,
and the server's own OpenAPI document marks those operations `auth: optional`.
Do not put one on a network you do not trust until that changes; the gap is
tracked in [#64](https://github.com/Qworg/althistory/issues/64).

A key **is** required by `/api/export`, `/api/import`, `/api/ingest`,
`/api/keys`, `/api/batch`, `/api/validate`, `/api/suggest` and `/api/stream`.
Where a key is required, send it either way:

```http
X-API-Key: ak_live_...
```
```http
Authorization: Bearer ak_live_...
```

Keys are created by an `admin` key:

```bash
curl -X POST http://localhost:3000/api/keys \
  -H "X-API-Key: $ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"ci","permissions":["read:events","read:arcs","read:relationships","read:graphs","export"]}'
```

The response contains the full key **once**. Only a hash and a prefix are
stored; there is no way to read it again.

`GET /api/keys/me` returns what the current key is and may do.
`GET /api/keys/:id/usage` returns how much of its rate limits it has spent.

## Permissions

| Permission | Grants |
| --- | --- |
| `read:events`, `read:arcs`, `read:relationships`, `read:graphs` | Read that entity type. |
| `write:events`, `write:arcs`, `write:relationships`, `write:graphs` | Create, update and delete it. |
| `export` | Export a graph. |
| `import` | Import a document into a graph. |
| `ingest` | Run web/text/Wikidata ingestion. |
| `admin` | Manage API keys, including other keys' permissions. |

Four groups are predefined: `readOnly`, `readWrite`, `full` and `admin`. You
may also pass an explicit list.

## Scoping to a graph

A key may be restricted to particular graphs (`allowedGraphs`). For most
routes the **request** is scoped by the `X-Graph-Id` header:

```http
X-Graph-Id: 7f3c...
```

For those routes the header is the only thing that scopes a request. A graph
id in a body or a query string is not read as the scope; when a body carries
one it must match the header or the request is rejected. With no header the
request uses the *active* graph; if there is no active graph the request fails
rather than silently operating on the wrong one.

**Import is the exception.** `POST /api/import` does not read `X-Graph-Id`: it
takes its target from the body's `targetGraphId`, and creates a new graph when
that is omitted.

## Responses

Most routes answer in an envelope:

```json
{
  "success": true,
  "data": { "...": "..." },
  "pagination": { "limit": 50, "offset": 0, "total": 1200, "hasMore": true },
  "requestId": "req-..."
}
```

A list route adds `pagination`; a filtered list also echoes `filters` so you
can confirm what was applied. Follow `pagination.hasMore` — do not assume the
first page is the whole result.

**Exports are the exception**: `GET /api/export` returns the export document
itself, with no envelope. That is deliberate, so a file written from the
response is a valid export. See [`docs/export-format.md`](./export-format.md).

## Errors

```json
{
  "error": {
    "message": "Causal paradox: cause event (evt-2) occurs after effect event (evt-1)",
    "details": { "...": "..." },
    "timestamp": "2026-01-01T00:00:00.000Z",
    "path": "/api/causal/link",
    "requestId": "req-..."
  }
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was malformed, or failed validation. `message` says which field. |
| `401` | No key, or an unusable one. |
| `403` | The key is valid but lacks the permission, or may not touch that graph. |
| `404` | The entity, graph or job does not exist. |
| `409` | A conflict the request cannot resolve: a merge refused because of conflicts or anomalies in the result, or an import already running for that graph (or an idempotency key reused). |
| `413` | The body was too large. |
| `429` | Rate limited. Honour `Retry-After`. |
| `500` | The server failed. `requestId` identifies it in the logs. |

Log the `requestId` on any non-2xx: it is the only thing that ties your failed
request to a server log line.

## Rate limits

Every key carries its own limits:

| Limit | Default |
| --- | --- |
| Requests per minute | 60 |
| Requests per hour | 1 000 |
| Requests per day | 10 000 |
| Batch size | 1 000 entities |
| Concurrent streams | 5 |

Responses carry the state:

```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1767225600
Retry-After: 12          # only on 429
```

A window that has already reset reads as unused; the reset timestamps are
per-window, so the minute and the hour can be in different states.

Limits are per key, not per endpoint, and reads and writes count the same.

## Async jobs

Long operations answer `202` with a job instead of doing the work inline. An
export is the common case: above the server's entity threshold (10 000 by
default) it is a job.

```http
GET /api/export/jobs/:id            # status, progress
GET /api/export/jobs/:id/download   # the finished file
DELETE /api/export/jobs/:id         # cancel
```

Poll the status, then download. `status` is one of `pending`, `processing`,
`completed`, `failed`, `cancelled`. **Do not poll faster than about once a
second**: the status route counts against your rate limit like any other, and
a tight loop will be turned away before a large export finishes.

Cancel a job you no longer want; an abandoned job keeps working and keeps its
file.

### Webhooks

`POST /api/export/jobs` accepts an optional `webhook` field — the URL to
notify. (The request field is `webhook`; the job records it as
`webhookUrl`.) The automatic async path of `GET /api/export` does **not** take
one: it creates its job without a webhook. When a job that has one reaches a
terminal state, the server POSTs the result there, in the background:

- up to **4 attempts**, backing off 1 s, then 2 s, then 4 s;
- **30 s** per attempt;
- a `4xx` is permanent and not retried — **except** `408` and `429`, which
  are retried along with `5xx` and network failures.

Delivery is recorded separately from the job's own status (`delivered`,
`failed`, `abandoned`): a webhook that never arrives does not make the job
failed, and a failed job still attempts delivery.

The target is checked before it is POSTed to: a loopback, link-local or
private **address**, and a `localhost`/`.local`/`.internal` name, are refused.
A host *name* that resolves to a private address is not caught — the same
limitation the outbound web fetcher documents, and for the same reason.

**Webhooks are per job, not a subscription.** There is no long-lived
registration, no list of endpoints, and no event stream. To learn about a
change, poll the entity, or create a job with a webhook for the operation you
started.

## Moving a graph in and out

```bash
# out
curl -s "http://localhost:3000/api/export?scope=full" \
  -H "X-Graph-Id: $GRAPH" -H "X-API-Key: $KEY" > graph.json

# in -- the document goes in the body's `data`, and the target graph is
# `targetGraphId` (the header is not read here).
jq -n --slurpfile g graph.json \
  --arg target "$OTHER_GRAPH" \
  '{data: $g[0], targetGraphId: $target, mode: "merge", conflictResolution: "skip"}' \
  | curl -X POST http://localhost:3000/api/import \
      -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d @-
```

Import does not merge: combine two graphs with the merge endpoint, which
validates the anomalies a plain import would not. See
[`docs/branch-merge-resolver.md`](./branch-merge-resolver.md).

## A worked example

```bash
KEY=ak_live_...
GRAPH=7f3c...

# What graphs can I see?
curl -s http://localhost:3000/api/graphs -H "X-API-Key: $KEY"

# Read the events. The list is oldest first.
curl -s "http://localhost:3000/api/events?limit=50&offset=0" \
  -H "X-Graph-Id: $GRAPH"

# Add one
curl -s -X POST http://localhost:3000/api/events \
  -H "X-Graph-Id: $GRAPH" \
  -H 'Content-Type: application/json' \
  -d '{"description":"The Congress adopts the Declaration","actor":"Continental Congress","target":"Kingdom of Great Britain","timestamp":"1776-07-04T00:00:00.000Z"}'

# Link two events. The cause may not follow the effect; the same moment is
# fine. The link carries `type` and `strength` (not `weight`).
curl -s -X POST http://localhost:3000/api/causal/link \
  -H "X-Graph-Id: $GRAPH" -H 'Content-Type: application/json' \
  -d '{"causeEventId":"evt-1","effectEventId":"evt-2","relationship":{"type":"direct","strength":0.9,"confidence":0.8,"evidence":"Contemporary account"}}'
```

## What this API does not offer

- **No long-lived webhook subscriptions** — webhooks are per job (above).
- **No server-sent event stream for graph changes.** There is a streaming
  channel for high-throughput writes; it is not a change feed for readers.
- **No partial metadata update.** `PUT /api/events/:id` replaces `metadata`
  wholesale when you send it — send the whole object, not a patch.
- **No cross-graph query.** One request reads one graph. A reference into
  another graph is a reference, not a join.
