# althistory

Generating historical-ish timelines and events for real and fictional places:
a versioned, multi-graph timeline backend with a React interface and an
agent-first CLI / MCP server for exploring events, arcs, causal chains, and
counterfactual branches.

## Layout

| Path | What it is |
| --- | --- |
| `timeline/` | Express + TypeScript API and CLI (`bin/althistory`). Versioned graph storage (Git-like trees), export/import, inference, ingestion, WebSocket streaming, MCP server. |
| `frontend/` | React + Vite UI. Timeline, causal graph, actor and pressure views, graph/version/import/export panels. |
| `e2e/` | Playwright end-to-end and visual-regression tests against a production build with the API stubbed. |
| `docs/` | Architecture, API integration, export format, ingestion, branch/merge, production deployment, and operational runbooks. |
| `impl/` | Design records: `gap-remediation/` (verified gap analysis and fixes) and `deferredplans/` (how the test suite was repaired). |
| `.kiro/specs/` | Feature specifications, design records, and audited implementation checklists (`tasks.md`). |
| `docker/`, `docker-compose.yml`, `Dockerfile` | Container images and the production stack. |

## Prerequisites & Installation

- **Node.js** >= 20 (Node 22/24 recommended) and `npm`

Install workspace dependencies from the repository root:

```bash
npm install
```

## Quick start (no Neo4j or Redis)

```bash
./start-local.sh
```

Or run `--tailscale` to bind to `0.0.0.0` and print your Tailscale URLs:

```bash
./start-local.sh --tailscale
```

Or run the two packages by hand:

```bash
cd timeline && echo "LOCAL_EXECUTION_ENABLED=true" > .env.local && npm run dev   # port 3000
cd frontend && npm run dev                                                      # port 5173
```

Local mode stores graphs, versions and jobs as JSON under `LOCAL_DATA_DIR`
(default `./data`). Cloud mode (`LOCAL_EXECUTION_ENABLED=false`) puts the
entities in Neo4j and uses Redis, but graph metadata, jobs, versions and API
keys are still files, and the rate-limit counters are per process — so cloud
mode is **one replica with a persistent volume** and refuses to start without
`CLOUD_SINGLE_REPLICA_STATE=true`. See
[`docs/production-deployment.md`](docs/production-deployment.md#4-state-and-persistence).

## Agent CLI & MCP Server

`./bin/althistory` provides a scriptable CLI and a stdio Model Context Protocol
(MCP) server (`./bin/althistory mcp`). It automatically connects to a running
local server on `http://localhost:3000` (so changes appear live in the Web UI)
or falls back to direct in-process storage (`--direct`) when no server is
running.

```bash
# Inspect JSON Schema for all CLI commands or MCP tools
./bin/althistory schema
./bin/althistory schema --mcp

# Manage graphs, events, arcs, ingestion, simulation, and validation
./bin/althistory graph list
./bin/althistory graph create "Roman Steam Engine" -d "Aeolipile industrialized in 100 CE"
./bin/althistory ingest wikipedia "https://en.wikipedia.org/wiki/Battle_of_Hastings" -g <graphId>
./bin/althistory generate --premise "Byzantium wins at Manzikert" --divergence "1071-08-26"
./bin/althistory simulate <graphId> --steps 3 --months 12
./bin/althistory validate <graphId> --auto-repair
./bin/althistory export <graphId> --format markdown
```

To register the MCP server in Claude Desktop, Cursor, or Antigravity (see
[`.mcp/`](.mcp/)):

```json
{
  "mcpServers": {
    "althistory": {
      "command": "/absolute/path/to/althistory/bin/althistory",
      "args": ["mcp"]
    }
  }
}
```

## Tests

```bash
./run-tests.sh            # backend + frontend unit/integration suites
```

```bash
cd timeline && npm test   # 104 files (2,101 tests)
cd frontend && npm test   # 116 files (1,746 tests)
```

End-to-end, against a real browser and a production build (API stubbed):

```bash
cd e2e
npm ci
npx playwright install chromium
npx playwright test
```

CI (`.github/workflows/ci.yml`) gates both packages on typecheck, ESLint, the
test suites with coverage, the frontend production build, and the non-visual
Playwright specs.

## Configuration

Frequently used variables; the full set with defaults and validation lives in
`timeline/src/utils/config.ts`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOCAL_EXECUTION_ENABLED` | `false` | Use the local JSON store instead of Neo4j/Redis |
| `LOCAL_DATA_DIR` | `./data` | Where local graphs, versions, jobs and exports live |
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` | — | Cloud-mode graph store |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | `localhost:6379` | Cloud-mode cache and rate-limit snapshot |
| `CLOUD_SINGLE_REPLICA_STATE` | — | **Required in cloud mode.** Confirms the deployment is one replica with a persistent volume; the API refuses to start without it |
| `LOCAL_MAX_MEMORY_MB` | `512` | Local store memory ceiling (minimum 64) |
| `LOCAL_EXPORT_ASYNC_ENTITY_THRESHOLD` | `10000` | Entity count above which an export becomes an async job |

## API description

The HTTP API is described by an OpenAPI 3 document, generated from the route
table so it cannot describe a route that is not mounted:

```bash
curl http://localhost:3000/api/openapi.json
```

A route that is added without a description fails the backend test suite
(`src/api/openapi/openapi.test.ts`) — the description of each operation is
hand-written in `timeline/src/api/openapi/operations.ts`, and the document
builder refuses to describe a route that has no entry there.

## Documentation

- [`AGENTS.md`](AGENTS.md) — code style, architecture rules and build commands.
- [`CLAUDE.md`](CLAUDE.md) — developer and agent quick reference.
- [`docs/api-integration.md`](docs/api-integration.md) — using the API from outside: keys, permissions, graph scoping, rate limits, jobs and webhooks.
- [`docs/export-format.md`](docs/export-format.md) — the export document field by field, and how to verify its checksum.
- [`docs/ingestion.md`](docs/ingestion.md) — getting history in: CLI, API, the review step, and what the LLM modes cost.
- [`docs/branch-merge-resolver.md`](docs/branch-merge-resolver.md) — combining two graphs and the anomalies the merge checks.
- [`docs/mcp-agent-guide.md`](docs/mcp-agent-guide.md) — MCP server tools and agent workflow guide.
- [`docs/autonomous-simulation-engine.md`](docs/autonomous-simulation-engine.md) — autonomous multi-step timeline simulation engine.
- [`docs/production-deployment.md`](docs/production-deployment.md) — container, cloud stack, and operational procedures.
- [`impl/gap-remediation/README.md`](impl/gap-remediation/README.md) — verified gap analysis and remediation plan.
- [`impl/gap-remediation/phase6-results.md`](impl/gap-remediation/phase6-results.md) — coverage baseline and its caveats.
- [`DEFERREDFIXES.md`](DEFERREDFIXES.md) — current test status.
- `GET /api/openapi.json` — the authoritative HTTP route list.
- [`e2e/README.md`](e2e/README.md) — end-to-end and visual-regression workflow.

## License

Released under the [MIT License](LICENSE).
