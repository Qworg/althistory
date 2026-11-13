# Integrating with the API

Using Althistory from outside: authenticating, scoping to a graph, reading and
writing entities, handling jobs and webhooks, and moving a graph in and out.

Written from the implementation — `timeline/src/api/middleware.ts`,
`timeline/src/models/ApiKey.ts`, `timeline/src/services/RateLimitService.ts`,
`timeline/src/services/JobService.ts`. The authoritative route list is the
OpenAPI document the server serves at `GET /api/openapi.json`.

## Authenticating

**Which routes require a key.** `/api/export`, `/api/import`, `/api/ingest`,
`/api/keys`, `/api/batch`, `/api/validate`, `/api/suggest`, `/api/stream`,
`/api/generate`, the `/api/graphs` endpoints, **and** the five entity groups — `/api/events`,
`/api/arcs`, `/api/causal`, `/api/temporal` and `/api/inference`. The entity
groups used to be the exception: they mounted only graph resolution, so anyone
who could reach the port could read a timeline, rewrite it and run inference.
They now mount `authenticate` + `requireAuth` + `rateLimit()` and, on each
route, `authorize(...)` with the permission listed under [Permissions](#permissions).
The OpenAPI document marks those operations `auth: 'required'` when that guard
is mounted, and `timeline/src/api/entity-auth.test.ts` fails if the marker and
what the router actually answers ever disagree.

**The one exception is local execution.** `API_AUTH_REQUIRED` decides, and it
defaults to `true`. The only alternative default is local execution
(`LOCAL_EXECUTION_ENABLED=true`), where it defaults to `false` so `npm run dev`
and the bundled UI work on a developer's machine without a key. Set
`API_AUTH_REQUIRED=true` to enforce keys there too, or `false` in any
deployment that deliberately wants anonymous entity access (a test rig, a
single-user box behind a firewall). A value that is not a boolean is a startup
error rather than a guess.

The exception covers **only the five entity groups**. Every other authenticated
group -- `/api/graphs`, `/api/keys`, `/api/export`, `/api/import`, `/api/batch`,
`/api/ingest`, `/api/stream` -- requires a key in every mode. So a local
deployment with no key can read events but not list the graphs it might name in
`X-Graph-Id`; give the UI a key if it needs the graph list.

Always open: `GET /api`, `GET /api/health`, `GET /api/info` and
`GET /api/openapi.json`. The document reports the mode the process is actually
in — the entity operations carry `security` when a key is required and an empty
`security` when it is not — so `GET /api/openapi.json` is how you check a
deployment rather than assuming.

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

### Getting a key into the bundled UI

The SPA sends a key when it has one. It reads `localStorage` (`api_key` or
`auth_token`) and otherwise `VITE_API_KEY`, which Vite bakes into the bundle at
build time (`frontend/src/services/api.ts`). There is no key-entry screen, so a
deployment that requires a key has to supply it one of those two ways:

- **Bake it in at build time.** Set `VITE_API_KEY` for the web build; the
  compose stack passes it as a build argument (`VITE_API_KEY=... docker compose
  build web`). The value ends up in the JavaScript every visitor downloads, so
  treat it as public: give it the narrowest permissions the UI needs
  (`read:events`, `read:arcs`, `read:relationships`, `read:graphs`, the
  matching `write:*` if the UI should edit, `export`), and rotate it by
  rebuilding. Use an `admin` key there only if the UI is genuinely trusted with
  key management.
- **Set `localStorage` yourself.** A page, an extension or the browser console
  can run `localStorage.setItem('api_key', 'ak_...')`; the client picks it up
  on the next request. `./start-local.sh` uses the other half of the same
  mechanism: it writes `VITE_API_KEY` into `frontend/.env.local`, which Vite
  bakes into the dev bundle.

With neither, the UI talks to the API without a key: every entity request
answers `401`, the client's response interceptor drops any stored key and logs
the failure, and the views show their usual error/empty state. Nothing prompts
for a key, because there is no login flow.

## Permissions

| Permission | Grants |
| --- | --- |
| `read:events` | Read events: `GET /api/events*`, `GET /api/arcs/:id/events`, `GET /api/causal/chain/:eventId`, the temporal views, and the inference analyses. |
| `write:events` | Create, update and delete events (`POST`/`PUT`/`DELETE /api/events`), and run `POST /api/inference/simulate`, which persists the events it infers. |
| `read:arcs` | Read arcs: `GET /api/arcs*`, and the temporal views. |
| `write:arcs` | Create, update and delete arcs. |
| `read:relationships` | Read causal links and suggestions. |
| `write:relationships` | Create, update and delete causal links; `POST /api/inference/simulate` also writes them. |
| `read:graphs`, `write:graphs` | Read, and create/update/delete, graphs. |
| `export` | Export a graph. |
| `import` | Import a document into a graph. |
| `ingest` | Run web/text/Wikidata ingestion. |
| `generate` | Start generation jobs (`POST /api/generate/*`): a timeline, a branch or an expansion drafted by the app. A key without it may still generate if it holds every write permission the run uses (see [Generating a history](#generating-a-history)). |
| `admin` | Manage API keys, including other keys' permissions. |

A route that reads two kinds of entity asks for both permissions: the temporal
timeline, overlap, gap, density, constraint and `validate-event` routes need
`read:events` **and** `read:arcs`; `GET /api/causal/chain/:eventId` needs
`read:relationships` **and** `read:events` (it answers the starting event as
well as the links); `POST /api/causal/validate` needs `read:events` **and**
`read:relationships`; `GET /api/arcs/:id/events` needs `read:arcs` **and**
`read:events`, because it answers events. `authorize` requires all of the
permissions a route lists, so one read permission never stands in for another.

A key may also be restricted to particular graphs (`allowedGraphs`); that is
checked on the entity routes too, so a key issued for one graph answers `403`
for any other, whatever its permissions.

Four groups are predefined: `readOnly`, `readWrite`, `full` and `admin`. You
may also pass an explicit list. `generate` is in `full` and `admin`, not in
`readWrite`: a key made from `readWrite` can still generate through its writes,
but it is the `generate` permission that says a key may start jobs that spend the
app's model key. Those jobs write graphs, events, arcs and links, so give it as you
would a write permission.

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
that is omitted. A key restricted to some graphs gets `403` for a
`targetGraphId` (or, on `validate-incremental`, a `graphId`) outside them, and
an import job is visible to, and cancellable by, only the key that started it.

**Text extraction reads a graph only when named.** `POST /api/ingest/text`
reads `X-Graph-Id` to find the graph the text is for (its world calendars tell
the model how the world writes a date), but has no active-graph fallback:
with no header, no graph is read. A graph that does not exist is a `404`, and
one the key may not access a `403`.

**Merge reads two graphs.** `POST /api/graphs/:id/merge` checks the key against
both the target `:id` and the body's `sourceGraphId`.

**Listings are scoped too.** A key restricted to some graphs sees only those in
`GET /api/graphs` (and the `total` counts only those) and in
`GET /api/graphs/:id/branches`. `GET /api/graphs/active`, and
`POST /api/graphs/copy` without a `sourceGraphId`, answer `403` when the
active graph is outside the key's list.

## Dates

Send historical dates and times as ISO 8601: `1843-11-20`, `1843-11-20T14:30:00Z`,
`1066-10-14T09:30+05:00`. A time with no zone (`1843-11-20T14:30`) is UTC, never
the server's local time. The event, arc and batch routes read a date the way
the CLI, the MCP tools, ingestion and the app do (`readWorldTimestamp` in
[`calendar/`](../calendar/README.md)): a date and time is that instant; a
date, a month or a year alone (`1843-11-20`, `1871-03`, `1066`) names that UTC
period, is stored at its first moment with a month's or year's
`metadata.datePrecision` recorded, and as an arc's `end_time` is the period's
last moment. The query-string filters (and the time ranges of the temporal,
inference and export routes) read ISO 8601 as instants; text that starts
with a digit and is not ISO 8601 (`312`) is refused there. Dates a body sends
to be checked rather than stored (`/api/validate/*`, `/api/suggest/*`, a
`time_range` copy's `timeRange`) are read as the event routes read them, with
the graph's calendars. An import reads a document's dates with the calendars
of the graph it goes into: `POST /api/import/validate` does too when given
`?targetGraphId=…&mode=merge` (or `replace`), and otherwise reads them as a
new graph would, with the document's own.

A date that does not exist (`2019-02-31`, `1870-13-01`) is refused. In a graph
without world calendars, year-first text is read as the app's forms and the
CLI read it (`312`, `44 BCE`, `1843-11-20 9:30`, in UTC), at the precision it
states. Other text is refused with the reason, whether it starts with a digit
(`0`) or is prose (`January 1, 2023`): no date a request gives is read in the
server's zone. (An import still reads prose a graph stored before, so an old
export imports.) Responses always
write dates as `toISOString` does (`1843-11-20T14:30:00.000Z`).

**In a graph with world calendars** ([the spec](specs/world-calendars.md)),
the event and arc routes, and `POST /api/batch/*`, also take a date as the
world writes it (`"Thaw 4, 312 AR"`, `"Thaw 312 AR"` for a month, `"312 AR"`
for a year, a time after a comma), in any of its calendars, or as fields:
`{ "calendar": "reckoning", "era": "AR", "year": 312, "month": "Thaw",
"day": 4 }`. A month or a year is stored at its first moment with
`metadata.datePrecision` and `metadata.dateCalendar` (the calendar it was
given in, so "Flooding 312 TC" stays the Tide-count's half-year) recorded; as
an arc's `end_time`, a day, month or year written without a time is its last
moment. An ISO date or date and time is read as anywhere else, but an ISO
month or year is refused there (a Gregorian month is no period of the world's),
and so is text that is neither ISO 8601 nor the world's notation (`400`),
never read as a Gregorian date. A new date on `PUT /api/events/:id` or a batch
`update_event` replaces the old one's precision and calendar, and keeps the
rest of the metadata; a new event (`POST /api/events`, a batch `create_event`)
records its date's precision the same way. Only an ISO day keeps a
`metadata.datePrecision` the request states (the app sends ISO with the
precision its form read); a month, a year or a date in the world's notation
states its own. Responses give each date's place on the
timeline as ISO 8601; the query-string filters (`startTime`, `endTime`) and
the temporal and inference routes take those ISO instants.

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

The target is checked before it is POSTed to. A loopback, link-local or
private address, or a `localhost` name, is refused when the job is created. At
delivery the host name is resolved too, and the webhook is refused (and not
retried) when any address it resolves to is private, so a name such as
`metadata.google.internal` or `127.0.0.1.nip.io` cannot reach an internal
service. A name that fails to resolve is retried like a network failure. What
this does not close is DNS rebinding — a name that answers publicly for the
check and privately when the connection is made — which, like the outbound
web fetcher, needs an egress policy at the network level.

**Webhooks are per job, not a subscription.** There is no long-lived
registration, no list of endpoints, and no event stream. To learn about a
change, poll the entity, or create a job with a webhook for the operation you
started.

## Generating a history

The app drafts timelines itself, with the same generator as `althistory
generate`, so a client (the CLI, the MCP server, your own) needs no model key and
the app stays the one writer of its graphs. A request starts a **job**: a model
call takes seconds to minutes.

```bash
# An alternate history, or an invented world ("world", never both)
curl -s -X POST http://localhost:3000/api/generate/timeline \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"premise":"What if the tide never turned?","divergencePoint":"The wall holds in 1200","eventCount":8}'
# 202 -> { "id": "gen_…", "status": "running", "progress": 5, "phase": "drafting", … }

curl -s -H "X-API-Key: $KEY" http://localhost:3000/api/generate/jobs/gen_…
curl -s -X POST -H "X-API-Key: $KEY" http://localhost:3000/api/generate/jobs/gen_…/cancel
```

| Route | Starts | Graph |
| --- | --- | --- |
| `POST /api/generate/timeline` | A new graph from `premise` and `divergencePoint`, or from a `world` (with its `calendar`). Also `startDate`, `endDate`, `eventCount`, `depth`, `style`, `graphName`. | none: it makes one |
| `POST /api/generate/branch` | A branch of a graph at `divergeAtEventId`, drafted from `counterfactualPrompt`, named `branchName`. | `X-Graph-Id`: the source graph |
| `POST /api/generate/expand` | Interpolated events in a graph, an `arcId` or a `timeWindow`, recorded as an arc of their own. | `X-Graph-Id` |
| `GET /api/generate/jobs[/:id]` | The key's jobs, or one. | |
| `POST /api/generate/jobs/:id/cancel` | | |

Every start also takes `provider` (`openai` | `anthropic`), `model` and
`dryRun`. The model **key** is the app's (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`); a request can choose the provider and model, never supply a
key.

**A job** reports `status` (`running`, `completed`, `failed`, `cancelled`),
`progress` (0 to 100), `phase` (`planning`, `drafting`, `graph`, `arcs`,
`events`, `links`, `done`), a `message`, the `graphId` once the graph exists, what
it has `written`, and, once completed, its `result`: the graph, arcs, events and
links, as the CLI prints them. The result's `source` says who wrote the events:
`"model"`, or `"template"` when the app has no model key or the model's answer
could not be used, which is a skeleton to rewrite, not a history. A
request that cannot run (a premise without a point of divergence, a branch point
that does not exist, a graph the key may not access) is refused at once with
`400`, `404` or `403` and makes no job.

**It writes as it goes**: the graph and its calendar, then the arcs, then the
events, then the causal links, each announced on the [live change
feed](#watching-a-graph-live), so a person with the graph open sees it fill in.
A job is not a transaction. **Cancelling** stops it before its next write (a
model call already in flight finishes first, and its answer is not written), and
what it had written **stays**: the job's `written` and message say how much, and
the half-written graph is an ordinary graph to finish, edit or delete.

**Who may.** `generate`, or every write permission the run uses: `write:graphs`,
`write:events`, `write:arcs` and `write:relationships` for a timeline or branch;
`write:events` and `write:arcs` for an expansion. A branch or expansion also needs
access to its graph (`allowedGraphs`). A timeline or branch makes a new graph, as
`POST /api/graphs` does.

**Cost.** A job spends the app's model key, so on top of the key's request rate
limit a start is refused with `429` and `Retry-After` when the key already has 2
jobs running, has started 30 in the last hour, or the app is running 4 jobs
(`GENERATION_MAX_RUNNING_PER_KEY`, `GENERATION_MAX_PER_KEY_PER_HOUR` and
`GENERATION_MAX_RUNNING_TOTAL` change them). The generator also clamps the number
of events a job may ask for (3 to 30 for a timeline). Whether to confirm before
starting is the client's call; `dryRun` is the cheap preview, though it still
calls the model. Reading and cancelling a job are not charged to the request rate
limit, so polling once a second is fine.

**A job belongs to the key that started it**: another key's job is a `404`. Jobs
are kept in memory for 24 hours (200 at most); a restart forgets them, and
whatever a running job had written stays.

## Writing over a WebSocket

For a high-volume writer there is one socket per session instead of a request
per entity. `POST /api/stream/token` (with `X-Graph-Id`; needs `write:events`)
answers a single-use token good for five minutes, and `ws://…/api/ws/stream?token=`
opens the session. Send `{"type":"event" | "arc" | "relationship","requestId","data":{…}}`
(the same fields as the HTTP routes, dates read by the same rule) and each is
answered with an `ack` carrying the new id, or `success: false` and a `code`. Each
message is charged to the key's request rate limit, at most 4 are in flight, and
the key is re-checked on every message. The same socket carries the live change
feed below.

## Watching a graph live

Anything that changes a graph -- the app, the CLI, an agent through MCP, a batch,
an import, a generation job -- is announced to every client watching it, over the
same WebSocket as the [write stream](#writing-over-a-websocket). The bundled UI
watches the open graph and shows the changes within about a second, without a
reload.

```bash
# 1. A token for a read-only socket. `mode: "feed"` needs read:events only.
curl -s -X POST http://localhost:3000/api/stream/token \
  -H "X-API-Key: $KEY" -H "X-Graph-Id: $GRAPH" -H "Content-Type: application/json" \
  -d '{"mode":"feed"}'
# 2. Connect:  ws://localhost:3000/api/ws/stream?token=<token>   (single use, 5 minutes)
# 3. Watch a graph (or "*" for the graph list):
#      -> {"type":"subscribe","graphId":"<graph>"}
#      <- {"type":"subscribed","graphId":"<graph>","epoch":"…","seq":41,"replayed":0}
#      <- {"type":"change","graphId":"<graph>","seq":42,"kind":"entities",…}
```

A subscription needs `read:events` and access to the graph (`*`, the graph list,
needs `read:graphs`; it hears only graphs the key may access). A socket may watch
10 graphs at once and counts against the key's concurrent streams. The key is
**checked again every 30 seconds**: a key that is revoked or loses `read:events`
has its socket closed (`KEY_INVALID`), and one that loses a graph is sent
`{"type":"unsubscribed","reason":"access_revoked"}` and hears no more of it. Send
`{"type":"ping"}` at least every few minutes (answered with `pong`): a session
idle for 5 minutes is closed, and every session ends after 30 minutes, which is
what the reconnect below is for.

Watching needs `read:events` alone, but a change is told only as far as the key
could read it over HTTP: entities the key may not read (arcs without
`read:arcs`, links without `read:relationships`) are left out of an `entities`
change, its `summary` becomes a count, and a change with nothing left to show is
not sent. Replays are redacted the same way. Jobs a key started are stopped when
the key is revoked or deleted.

**A `change` message** carries `graphId`, `seq`, `at`, the `actor` and a `kind`:

| `kind` | When | Fields |
| --- | --- | --- |
| `entities` | Events, arcs or links were created, updated or deleted. | `operation`, `entities: [{type, id}]`, `summary` ("Added event “Census of 1851”"). A deleted event's links are listed with it. |
| `replaced` | A branch, rollback, merge or import replaced the graph as a whole, once the app serves the new head. | `reason`, `counts`, `summary`. Refetch everything. |
| `graph` | A graph was made, renamed, given or stripped of a calendar, or deleted. | `operation`, `fields`, `name`, `summary`. |
| `generation` | A generation job moved. | `jobId`, `status`, `phase`, `progress`, `message`, `source`, `written`. |

Pressures are not stored: the app infers them from the events on every read, so a
pressure's change is the change of the events, arcs and links behind it, and a
reader refetches the pressures when it hears one of those.

**Who.** `actor` is `{kind, name, keyId}`: `person` (the web app), `agent` (an MCP
server), `cli`, `api`, `generation` (a job, named after the key that started it)
or `system`; `name` is the API key's name. A client says what it is with the
`X-Althistory-Client` request header (`web`, `mcp` or `cli`; anything else is
`api`), and a browser tab sends its own id in `X-Client-Id`, which comes back as
`origin`, so a tab can tell its own edits from other writers'. Both are claims
used only to label changes for people who may already read the graph. `origin`
is sent only to sockets of the key that made the change, so another key cannot
learn a tab's id and pose as it; in local mode every client shares the admin
key, so there it is advisory.

**A message is sent after the change is in the app's store**, so a client that
refetches on it sees the change.

**Catching up.** Each message has a `seq`, counted across all graphs, and the
`subscribed` reply carries the server's `epoch` (one per process) and the `seq`
the feed was at. Keep both, and the last `seq` you saw per graph. After a dropped
connection, get a new token, connect, and subscribe again with `epoch` and
`since`: the server replays what you missed, in order, straight after `subscribed`
(`replayed` says how many), or sets `resync` (`gap`: more than the last 500
changes to that graph happened, or the graph was deleted; `epoch`: the server
restarted) and you refetch the graph. The graph list is never replayed: refetch it
after a reconnect. A sequence number is used rather than a version number because
not every change makes a version (a graph's name, a batch, a generation's
progress).

**Decisions behind it**

- *Where it lives.* `GraphService`'s `onHeadReplaced` hook (typed in
  `LiveStoreSyncService`) fires only for the four operations that replace a head,
  so it cannot announce an agent adding one event. The feed is a write-level bus
  (`ChangeFeedService`) that the versioning bridge, the live-store sync (which
  `onHeadReplaced` triggers, and which now says why the head was replaced), the
  graph service, the batch routes and the generation jobs publish to.
- *Conflicts.* A generation job never rewrites an existing item: a timeline or
  branch writes a new graph, an expansion adds new events and an arc. So there is
  nothing to skip or lock. When a person and an agent edit the same item, the last
  write wins, both are in the graph's history, and the person is told the item
  changed (the notice and the highlight) rather than having it replaced silently.
- *Single process.* The feed, its catch-up rings, the stream tokens and the
  generation jobs are in memory: one replica, as `CLOUD_SINGLE_REPLICA_STATE`
  already requires. Scaling out would need `ChangeFeedService.publish`,
  `subscribe` and `replay` moved onto a shared channel (Redis pub/sub for the
  fan-out, a Redis stream for the ring and the counter), the stream tokens in a
  shared store, and the generation jobs in the job repository; the socket handler
  and the routes would not change.

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
- **No change feed over plain HTTP.** Changes are pushed over the WebSocket
  ([above](#watching-a-graph-live)); there is no server-sent-events endpoint and
  no webhook per graph. A client that cannot hold a socket polls the entity.
- **No partial metadata update.** `PUT /api/events/:id` replaces `metadata`
  wholesale when you send it — send the whole object, not a patch.
- **No cross-graph query.** One request reads one graph. A reference into
  another graph is a reference, not a join.
