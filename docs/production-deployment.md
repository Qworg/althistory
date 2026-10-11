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

### Current status — read this before trusting the gate

This runner works, but **three of the four suites it runs do not currently
pass against Neo4j 5.** They were excluded from the default run precisely
because nobody had kept them working; enabling them has surfaced that debt
rather than fixed it:

| Suite | Status |
| :--- | :--- |
| `src/utils/database.test.ts` | **passes** |
| `src/repositories/EventRepository.test.ts` | fails |
| `src/repositories/ArcRepository.test.ts` | fails |
| `src/services/GraphCopyService.test.ts` | fails |

Root causes, in order of blast radius:

1. **Object-valued Neo4j properties.** `EventRepository.create` and
   `ArcRepository.create` pass a JavaScript object (`metadata` on events, an
   equivalent map on arcs) straight into a node property. Neo4j accepts only
   primitives and arrays, so it rejects the write with
   *"Property values can only be of primitive types or arrays thereof.
   Encountered: Map{}"*. The file-backed local store accepts maps, so this only
   shows up against Neo4j. This single defect accounts for ~41 of the 49
   failures and needs the repositories to serialise/deserialise object
   properties (e.g. JSON) on both the write and read paths.
2. **Session/transaction misuse.** A few tests (and the paths they drive) run a
   query on a session that already has an open transaction.
3. **Non-repeatable cleanup.** The suites clean up with
   `MATCH (e:Event) WHERE e.id STARTS WITH "test_" DELETE e`, but `create()`
   auto-generates ids like `event_...`, so the cleanup deletes nothing and data
   accumulates across tests and runs. Fixing (1) will make the resulting counts
   deterministic only once the cleanup actually removes what the suite created.

These are tracked as follow-up work. Until they are fixed, treat
`npm run test:cloud` as a diagnostic that runs the real suites, **not** as a
green regression gate.

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
