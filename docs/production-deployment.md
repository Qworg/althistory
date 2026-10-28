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
docker compose exec api cat /data/keys/admin-key.txt   # the seeded admin key
# Give the browser a key and rebuild only the SPA:
echo "VITE_API_KEY=$(docker compose exec -T api cat /data/keys/admin-key.txt)" >> .env
docker compose build web && docker compose up -d web
open http://localhost:8080
```

The entity routes require a key, and the SPA has no key-entry screen, so the
`VITE_API_KEY` step is what makes the bundled UI work: the value is baked into
the JavaScript at build time. (If `ADMIN_API_KEY` is set in `.env`, that is the
admin key instead of the generated file.) Use the admin key once to create
narrower keys for the UI and for agents — see
[api-integration.md](api-integration.md#getting-a-key-into-the-bundled-ui).

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
- `ADMIN_API_KEY` — a key the API trusts as `admin` on first start. Leave it
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

Graph, export and job repositories are file-backed **even in cloud mode** —
there is no Neo4j-backed implementation of them — so the `api` service mounts
`/data` as a named volume. Deleting that volume loses timelines.

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
