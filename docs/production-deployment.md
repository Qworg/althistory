# Production Deployment & Cloud Stack

Althistory ships as a two-image Docker stack: a Node API and a Caddy web
container that serves the compiled SPA and reverse-proxies the API on the same
origin. Neo4j (with APOC) and Redis run alongside as managed services.

```text
                    ┌──────────────────────────────┐
   :8080 ──►  web   │ Caddy: /srv SPA, /api→api     │
                    └───────────────┬──────────────┘
                                    │
                            ┌───────▼────────┐
                            │      api       │  Express + CLI
                            └───┬────────┬───┘
                                │        │
                    ┌───────────▼──┐  ┌──▼────────┐
                    │ neo4j (APOC) │  │   redis   │
                    └──────────────┘  └───────────┘
```

---

## 1. Quick start

```bash
cp .env.production.example .env   # then set NEO4J_PASSWORD
docker compose up -d --build

# 1. Take the seeded admin key (server-side only -- never ship it to a browser).
docker compose exec -T api cat /data/keys/admin-key.txt

# 2. With it, create a narrow key for the UI: read the entity API, nothing more.
curl -s -X POST http://localhost:3000/api/keys \
  -H "X-API-Key: <the admin key>" -H 'Content-Type: application/json' \
  -d '{"name":"browser","permissions":["read:events","read:arcs","read:relationships","read:graphs"]}'

# 3. Bake *that* key into the SPA and rebuild only the web image.
#    Set VITE_API_KEY in .env (replace the placeholder line, do not append).
docker compose build web && docker compose up -d web
open http://localhost:8080
```

The entity routes require a key, and the SPA has no key-entry screen, so the
`VITE_API_KEY` step is what makes the bundled UI work: the value is baked into
the JavaScript at build time and is **visible to every visitor of the UI**. It
is public by construction.

That is why step 2 exists: bake a **read-only** key, not the admin key. The
admin key manages other keys, so shipping it in the bundle would give every
visitor key-management rights over the deployment. The UI only needs to read;
anything that writes should use a key held by the client, not the bundle.

The browser key is a minted key, so it is **not** exempt from rate limits (only
the key configured as `ADMIN_API_KEY` is; see
[api-integration.md](api-integration.md#rate-limits)). And it is **one key shared
by every visitor**: the same `VITE_API_KEY` is in everyone's bundle, so its
budgets are shared too. With the defaults (60 requests a minute, 1 000 an hour,
10 000 a day, 5 live streams) about six visitors loading the page at once, at
about 10 requests per load, use up the minute; sustained use by a few people
reaches the hourly cap within minutes. The UI then shows a message saying what
was refused and when to retry. Raise **all three** request limits, and the
streams, when you create it, for the number of visitors you expect, e.g.
`"rateLimit":{"requestsPerMinute":600,"requestsPerHour":20000,"requestsPerDay":200000,"concurrentStreams":20}`.

If no key is configured the UI still loads, but every entity request answers
`401`, the interceptor discards the stored key, and each view shows its own
error or empty state — there is no prompt asking for one.

(Putting a key in the bundle is a stopgap, not authentication of the user: it
tells the server "this is the UI", not who is looking at it. A deployment that
needs per-user access should put an authenticating proxy in front and keep
`VITE_API_KEY` unset.)

The browser talks only to Caddy. Because the SPA is built with
`VITE_API_BASE_URL=/api`, its requests are same-origin and no CORS setup is
needed for the bundled UI.

## 2. Services

| Service | Image | Role |
| :--- | :--- | :--- |
| `web` | `caddy:2-alpine` | Serves `frontend/dist`, proxies `/api/*` and `/health` to `api` |
| `api` | `node:20-bookworm-slim` | Compiled Express backend, WebSocket stream, and the `althistory` CLI |
| `neo4j` | `neo4j:5-community` | Graph database with APOC enabled |
| `redis` | `redis:7-alpine` | Rate-limit snapshot and query cache (the counters themselves are per process) |
| `cloud-tests` | build stage | Opt-in gate that runs the Neo4j/Redis-only suites (see §6) |

Only `web` is published (`WEB_PORT`, default 8080). The API is reachable only
through the proxy; use `docker compose exec api althistory …` for direct CLI
access.

## 3. Configuration

All configuration is environment-driven; see `.env.production.example` for the
full list. The values that matter most:

- `NEO4J_PASSWORD` — required; compose refuses to start without it.
- `REDIS_PASSWORD` — optional; blank means no auth (private networks only).
- `WEB_PORT` — host port for the SPA.
- `CADDY_SITE_ADDRESS` — `:80` for plain HTTP, or a hostname to have Caddy
  provision TLS automatically. Point it at a Tailscale name (e.g.
  `althistory.example.ts.net`) to expose the stack over a tailnet with TLS.
- `CORS_ORIGIN` — only consulted by non-browser clients; the bundled UI is
  same-origin.
- `API_AUTH_REQUIRED` — whether `/api/events`, `/api/arcs`, `/api/causal`,
  `/api/temporal` and `/api/inference` require an API key. Defaults to `true`;
  the compose file sets it explicitly. Do not turn it off on a reachable host.
- `ADMIN_API_KEY` — a key the API trusts as `admin`, registered on any start
  where the key store does not already hold it (a revoked one stays revoked). Leave it
  blank and the API generates one, printing it in the log and writing it to
  `/data/keys/admin-key.txt` (mode 0600) inside the `api` container:
  `docker compose exec api cat /data/keys/admin-key.txt`. Either way, use that
  key to create the narrower keys the app and agents should use.
- `VITE_API_KEY` — the key the bundled SPA sends. It is a **build argument**:
  it is baked into the JavaScript, so it is public to anyone who can load the
  page. There is no key-entry screen (see
  [api-integration.md](api-integration.md#getting-a-key-into-the-bundled-ui)).
  Leave it blank and the UI gets `401` from every entity route.

## 4. State and persistence

| State | Where | Shared between replicas? |
| :--- | :--- | :--- |
| Entities (events, arcs, relationships, pressures) | Neo4j | yes |
| Graph metadata, export/import jobs, graph versions | `LOCAL_DATA_DIR` (`/data`) | **no** — files on the node |
| Rate-limit counters | in-memory, snapshotted to Redis every 30 s | **no** — each process counts separately |
| API keys | `LOCAL_DATA_DIR` (`/data`) | **no** — files on the node |
| Streaming tokens (`/api/stream`) | in-memory | **no** — a token issued on one replica is unknown to another |
| Live change feed (the sockets' `change` messages and their catch-up history) | in-memory | **no** — a change made through one replica is never heard by a socket on another |
| Generation jobs (`/api/generate`) | in-memory | **no** — a replica cannot see, or cancel, another's job |

Graph, export and job repositories are file-backed **even in cloud mode** —
there is no Neo4j-backed implementation of them — so the `api` service mounts
`/data` as a named volume. Deleting that volume loses timelines.

### Container hardening

The `api` container runs as the unprivileged `node` user, with a read-only
root filesystem (only `/data` and a `/tmp` tmpfs are writable), every Linux
capability dropped and `no-new-privileges`. `web` (Caddy) keeps only
`NET_BIND_SERVICE`, to bind ports 80 and 443, and sends `nosniff`,
`X-Frame-Options: DENY`, a referrer policy and HSTS (which browsers apply once
the site is served over TLS); it refuses request bodies over 16 MB.

A `/data` volume created by an earlier image, which ran as root, is owned by
root, and the server can no longer write to it. Fix the ownership once:

```bash
docker compose run --rm --no-deps --user root api chown -R node:node /data
```

### Upgrading a database written before graph scoping

In cloud mode every stored `:Event`, `:Arc` and `:CAUSES` relationship carries
the graph it belongs to, and every query is filtered by it. Rows written before
that was true have no graph id, so they are invisible to a scoped read.

On startup, if **exactly one** graph is registered, the process adopts those
rows into it and says so loudly, with the counts and the way to change the
decision:

```
Attributing pre-graph-identity cloud data to graph "…" (the only registered graph):
before, 1 204 event(s), 86 arc(s), 2 100 causal relationship(s) carried no graph id.
```

With zero or several graphs registered it does not guess: it prints the counts
and leaves the rows unattributed, and the graphs look smaller than they are
until you resolve it. To attribute them explicitly — always to a graph you name:

```bash
npm run migrate:attribute-graph -- --graph <graphId> --dry-run   # report only
npm run migrate:attribute-graph -- --graph <graphId>             # write
```

The command refuses a graph id that is not registered (a typo would move the
data somewhere no graph owns, which is indistinguishable from deleting it) and
exits non-zero. A causal relationship whose two endpoints disagree about their
graph is left untouched and reported, rather than moved: that row needs a
person to look at it.

Reverting is not supported — once rows are attributed, they stay. Take a Neo4j
backup before the first start on an upgraded database.

### Event and arc ids are unique within a graph

Until this change `Event.id` and `Arc.id` were unique across the whole Neo4j
database. A branch holds its parent's ids, so in cloud mode every event, arc and
link of a branch was refused ("Node(…) already exists with label `Event`") and the
branch looked empty in the live store. The constraints are now `(graphId, id)`
(`event_graph_id`, `arc_graph_id`), and a query that names an event or arc by id
also names its graph.

The upgrade runs at startup, as part of creating the schema and before any request. It is
`timeline/src/utils/GraphScopedIdConstraintMigration.ts`, and it is the only code
that creates these two constraints, so the checks below always come first:

- **Fresh database:** the composite constraints are created; there is nothing to drop.
- **Database created by an older release** (`event_id` and `arc_id`, unique on `id`):
  the composite constraints are created first, then the old ones are dropped,
  found by what they constrain rather than by name, so a label is never without a
  constraint.
- **Stopped part-way, or already migrated:** each step checks first, so the
  remaining step is done and a repeat does nothing.
- **Nodes with no `graphId`:** a uniqueness constraint ignores them, and no graph
  reads them. The migration does not touch them. The startup that attributes
  pre-graph rows (see above) reports how many there are and the command that
  attributes them (`npm run migrate:attribute-graph`); the migration only warns
  when it is run on its own. Attributing
  such a node to a graph that already holds its id fails on the constraint, and
  names it.
- **The same `(graphId, id)` twice:** impossible under the old constraint, but if
  a database has it the migration stops with the pair named and leaves the old
  constraints in place.

An index you made yourself on `(graphId, id)` of `Event` or `Arc` (for example
`CREATE INDEX … FOR (e:Event) ON (e.graphId, e.id)`) stops the startup with
`IndexAlreadyExists`, because the constraint needs that index for itself. Drop your
index before upgrading; the constraint is the better one.

A graph copy (`POST /api/graphs/copy`) keeps the ids of what it copies. Its first
version is the source's version head (a time-range or filtered copy: the head limited
to the ids copied, and a link only when both its events were), recorded before the
live store is written, exactly as a branch records its version. So the copy can be
edited, rolled back, exported, branched and merged by those ids, and it carries every
field the source's history does (`sourceRef`, `parent_arc_id`, a link at weight 0, a
link to another graph's event). Two cases differ:

- A source that has live nodes and no head (data that predates versions) is versioned
  from its selected live nodes, so a later edit and rollback of the copy keep them. A
  live store that has drifted from a head it does have is the source's own
  inconsistency: the copy follows the head, as a branch does.
- A source whose head holds entities its live store does not (the live store was never
  rebuilt) is copied by building the copy's live store from the copy's version, as a
  branch's is.
- A partial copy may leave an arc without its parent. Such an arc becomes a top-level
  arc (no parent, level 0, and the arcs copied beneath it follow), in the version and
  in the live copy, so the copy's own export imports. Selection is by label and id
  together, so an event and an arc that share an id are two entities.

A copy is checked when it ends: a full copy against the whole source, a partial one
against the nodes and relationships it selected. An empty source is a successful empty
copy. A copy that fails the check, or fails, or cannot be versioned, is removed (its
graph and its live nodes) and the request answers `500` with a plain reason and no graph
id (the store's own message goes to the server log); no empty graph is left. An `InferredPressure` is the one entity given a new id (its
constraint is still database-wide); the inference recomputes pressures.

A copy walks every node and relationship, so `/api/graphs/copy` has its own request
budget, `COPY_TIMEOUT_MS` (default `120000`), where the rest of the API keeps
`QUERY_TIMEOUT_MS` (2 s).

Rolling back to an older release needs the old constraints again, which fail if
any branch now holds an id its parent holds; take a Neo4j backup before upgrading.

### Single replica, persistent volume — enforced

Because that state is per process, cloud mode is **one replica with a volume
that outlives the container**. Two replicas would each keep their own graph
metadata, job records and graph versions: a job created on one would be
invisible to the other, and a version written on one would be missing from the
other. Rate limiting is per process too: Redis holds a snapshot that each
replica overwrites (the whole map, at most every 30 seconds while it is
changing), not the count each request increments, so two replicas allow roughly
twice the configured rate.

Only the entities are genuinely shared, through Neo4j.

The server refuses to start in cloud mode unless the deployment says it is the
one it must be:

```env
LOCAL_EXECUTION_ENABLED=false
CLOUD_SINGLE_REPLICA_STATE=true
LOCAL_DATA_DIR=/data
```

Without `CLOUD_SINGLE_REPLICA_STATE=true` the process exits with a
`ConfigurationError` that names the variable and the reason. The one exemption
is `NODE_ENV=test`, which is how the cloud test suite runs; do not copy that
environment into a deployment — it also skips the Neo4j credential checks.

**The flag is an assertion, not a detection.** It cannot count replicas or
inspect a volume; it records that the operator confirmed the deployment. Setting
it on a two-replica deployment silences the refusal and changes nothing about
the divergence — which is why the section above lists exactly what is not
shared.

If you need more than one replica, the file-backed stores have to move to
shared storage first — that is [issue
#31](https://github.com/Qworg/althistory/issues/31)'s other half, not a
configuration flag.

There is no Kubernetes manifest in this repository. If you write one, the
Deployment must not set `replicas` above `1`, and its volume must be
`ReadWriteOnce` (or a filesystem volume) — `ReadWriteMany` on a
`Deployment` with `replicas: 2` is exactly the configuration this guard exists
to prevent, and it will pass the startup check if you set the variable.

## 5. Health checks

- Container liveness probes `GET /` and expects `200`.
- `GET /health` reports *readiness*: it answers `503` until every lazy container
  singleton has been resolved, and `200` once they all are. It is a diagnostic
  endpoint, not a liveness signal, which is why the compose healthcheck uses
  `/`.

**The first start after upgrading from a version without link ids.** The server
names every causal link that predates link ids (a one-off) before it starts
listening, so neither `/` nor `/health` answers until it has finished, and it
logs `Causal link ids: ...` progress lines (per graph, every 5,000 links) while
it works. It reads the version history of the graphs that have such links and
writes it only where it differs. Allow for it in the start period of the
liveness probe: measured against Neo4j on a 1 GB heap, naming 300,000 links
takes between 1 and 2 minutes (64 s on one machine, 125 s on a loaded one; most of it is reading the version history, so it depends on the machine and on the size of the head) and 10,000 pairs of two links about
9 seconds. Every later start finds nothing to name and costs one read.
If the process is stopped part-way it resumes (the plan is deterministic and the
version history is written before the links are named). Startup does not fail
for a graph whose history cannot be written: that graph is reported and tried
again at the next start.

## 6. Cloud integration tests

The default test run excludes the suites that need a real Neo4j and Redis, so
the fast gate needs no services. `npm run test:cloud` runs **only** those
suites, against a real stack:

```bash
./scripts/run-cloud-tests.sh          # starts deps, runs the suites, tears down
./scripts/run-cloud-tests.sh --keep   # leave Neo4j/Redis running afterwards
```

It brings up `neo4j` and `redis` with their healthchecks, then runs
`vitest --run --config vitest.cloud.config.ts` inside the same toolchain image
the production build uses. `vitest.cloud.config.ts` lists the suites and runs
them one file at a time (`fileParallelism: false`) because they share one
database.

### Current status — green regression gate

These suites pass against Neo4j 5 and Redis (run `npm run test:cloud` for the
count rather than trusting one written here):

| Suite | What it checks |
| :--- | :--- |
| `src/utils/database.test.ts` | The driver, the schema and Redis. |
| `src/repositories/EventRepository.test.ts` | Events in Neo4j. |
| `src/repositories/ArcRepository.test.ts` | Arcs in Neo4j. |
| `src/services/GraphCopyService.test.ts` | Copying a graph with APOC. |
| `src/tests/integration/graph-scoped-storage.test.ts` | No graph can read or change another's rows. |
| `src/repositories/DeepTime.neo4j.test.ts` | Moments beyond a `Date` through `datetime({epochMillis})`. |
| `src/tests/integration/cloud-live-feed.test.ts` | The real app in cloud mode: a write (and a batch) announced on the live feed and versioned, stream tokens minted, used once and bound to their graph, and a generation job that completes and whose graph reads back from Neo4j. |

Previously identified failure modes have been resolved:

1. **Object-valued Neo4j properties**: `EventRepository` and `ArcRepository` now serialize object properties (such as `metadata`) via `JSON.stringify` on write and parse them back to objects on read paths.
2. **Missing Cypher field handling**: Added safe property access via `record.has(key)` to prevent driver errors when projected aliases differ.
3. **Session concurrency & count safety**: In `GraphCopyService`, concurrent `session.run` calls were replaced with sequential calls, count conversions safely handle Neo4j Integer objects/BigInts/numbers, and relationship copying handles graphs with 0 relationships without hanging.
4. **Referential integrity**: Relationships between copied nodes are linked using original node identifiers tagged during the copy pass.
5. **Deterministic test cleanup**: Test fixtures perform deterministic cleanup between test runs using clean teardown queries.

`npm run test:cloud` is now a fully functional green regression gate.

## 7. Production-correctness fixes in this stack

Building and running the images surfaced three defects that would have broken a
real deployment; they are fixed here:

- **The compiled backend could not start.** `tsc` emits the `@/…` path aliases
  unchanged, and the old `npm start` resolved them against `src/`, so
  `node dist/index.js` failed with `Cannot find module '@/utils'`.
  `timeline/tsconfig.runtime.json` rebases the aliases on `dist/`, and `start`
  / the container set `TS_NODE_PROJECT` to it.
- **Environment overrides leaked into images.** `config.ts` loads `.env.local`
  with `override: true`, so a baked-in `timeline/.env.local`
  (`LOCAL_EXECUTION_ENABLED=true`) silently forced local mode inside the
  containers. `.dockerignore` now excludes every `.env*` file at any depth.
- **The cloud schema was invalid and never created.** The constraint list used
  property-range constraints (`REQUIRE x >= 0 AND x <= 1`) that are not valid
  Cypher on Neo4j 5, and nothing called `initializeSchema()` outside tests, so
  cloud mode ran without its constraints or indexes. The list now holds the
  uniqueness constraints Community edition supports (an `InferredPressure` id,
  and the `(graphId, id)` pair of an event and of an arc, see above), and
  `Application.initialize()` creates the schema in cloud mode before accepting
  requests. The 0..1 bounds stay enforced by `ValidationService` on the domain
  objects.

Production builds also no longer ship test files: `npm run build` uses
`timeline/tsconfig.build.json`, which excludes `*.test.ts`, `src/tests/**` and
the test setup from `dist/`.
