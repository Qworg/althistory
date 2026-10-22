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
open http://localhost:8080
```

The browser talks only to Caddy. Because the SPA is built with
`VITE_API_BASE_URL=/api`, its requests are same-origin and no CORS setup is
needed for the bundled UI.

## 2. Services

| Service | Image | Role |
| :--- | :--- | :--- |
| `web` | `caddy:2-alpine` | Serves `frontend/dist`, proxies `/api/*` and `/health` to `api` |
| `api` | `node:20-bookworm-slim` | Compiled Express backend, WebSocket stream, and the `althistory` CLI |
| `neo4j` | `neo4j:5-community` | Graph database with APOC enabled |
| `redis` | `redis:7-alpine` | Rate limiting, pub/sub and query cache |
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

## 4. State and persistence

| State | Where | Volume |
| :--- | :--- | :--- |
| Graph nodes/relationships (Neo4j-backed paths) | Neo4j | `neo4j-data` |
| Graph/export/job/API-key state | `LOCAL_DATA_DIR` (default `/data`) | `timeline-data` |

Graph, export and job repositories are file-backed **even in cloud mode** —
there is no Neo4j-backed implementation of them — so the `api` service mounts
`/data` as a named volume. Deleting that volume loses timelines.

### Single replica, persistent volume — enforced

Because that state is on disk, cloud mode is **one replica with a volume that
outlives the container**. Two replicas would each keep their own graph
metadata, job records and graph versions: a job created on one would be
invisible to the other, and a version written on one would be missing from the
other. (Entities live in Neo4j and rate-limit counters in Redis, so those *are*
shared; the three file-backed stores are not.)

The server refuses to start in cloud mode unless the deployment says it is the
one it must be:

```env
LOCAL_EXECUTION_ENABLED=false
CLOUD_SINGLE_REPLICA_STATE=true
LOCAL_DATA_DIR=/data
```

Without `CLOUD_SINGLE_REPLICA_STATE=true` the process exits with a
`ConfigurationError` that names the variable and the reason. That check is the
guard: it is not possible to scale the deployment out by accident and end up
with silently per-process state.

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
the production build uses. `vitest.cloud.config.ts` runs the four suites
sequentially (`fileParallelism: false`) because they share one database.

### Current status — green regression gate

All four integration test suites pass against Neo4j 5 and Redis (68/68 tests passing):

| Suite | Status |
| :--- | :--- |
| `src/utils/database.test.ts` | **passes** |
| `src/repositories/EventRepository.test.ts` | **passes** |
| `src/repositories/ArcRepository.test.ts` | **passes** |
| `src/services/GraphCopyService.test.ts` | **passes** |

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
  three uniqueness constraints Community edition supports, and
  `Application.initialize()` creates the schema in cloud mode before accepting
  requests. The 0..1 bounds stay enforced by `ValidationService` on the domain
  objects.

Production builds also no longer ship test files: `npm run build` uses
`timeline/tsconfig.build.json`, which excludes `*.test.ts`, `src/tests/**` and
the test setup from `dist/`.
