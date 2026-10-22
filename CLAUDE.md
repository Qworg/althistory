# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Althistory is a hierarchical temporal graph system for generating and analyzing historical/fictional timelines. The repository is a **monorepo** with two main directories:

- **`timeline/`** - Backend API server (Express + TypeScript + Neo4j/Redis or local file storage)
- **`frontend/`** - React web application (Vite + TypeScript + D3.js + Cytoscape.js)

## Development Commands

### Backend (`timeline/`)
```bash
npm run dev         # Development server with hot reload (ts-node-dev, port 3000)
npm run build       # Compile TypeScript to dist/
npm start           # Run compiled production build
npm test            # Run Vitest test suite
npm run test:watch  # Watch mode testing
npm run lint        # ESLint
npm run format      # Prettier formatting
```

### Frontend (`frontend/`)
```bash
npm run dev         # Vite dev server (port 5173)
npm run build       # Production build (tsc + vite build)
npm test            # Run Vitest test suite
npm run test:watch  # Watch mode testing
npm run lint        # ESLint
npm run lint:fix    # Auto-fix linting issues
npm run type-check  # TypeScript type checking (tsc --noEmit)
```

### Running a Single Test
```bash
# Backend
npm test -- src/services/TemporalService.test.ts

# Frontend
npm test -- src/components/timeline/Timeline.test.tsx
```

## Quick Local Development

No Neo4j/Redis required for local development:

```bash
# Option 1: Use the start script (recommended)
./start-local.sh

# Option 2: Manual startup
# Backend
cd timeline
npm install
echo "LOCAL_EXECUTION_ENABLED=true" > .env.local
npm run dev

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

**Configuration precedence**, strongest first: the process environment, then
`.env.local`, then `.env`. `.env.local` is a developer override and beats
`.env` — but it does **not** beat the real environment, so a committed
`.env.local` cannot silently force local mode inside a container that asked
for cloud mode.

## Architecture

### Backend Architecture

**Layered pattern:** API Routes → Middleware → Services → Repositories → Database

**Dependency Injection Container** (`src/container.ts`): Manages all service singletons with lazy-loading.

**Key Services:**
- `TemporalService` - Time-based queries and temporal relationships
- `CausalService` - Cause-and-effect relationships and inference chains
- `InferenceService` - Graph analysis and pattern detection
- `GraphCopyService` - Graph duplication and branching
- `ValidationService` - Input validation and data integrity
- `CacheInvalidationService` - Redis-based caching strategy

**Database Layer:**
- `DatabaseManager` - Neo4j connection management (cloud mode)
- `LocalDatabaseManager` / `LocalGraphStore` - File-based JSON storage (local mode)

**Domain Models** (`src/models/`):
- `Event` - Historical occurrences with actor, target, timestamp, description
- `Arc` - Historical periods/phases containing events (hierarchical)
- `InferredPressure` - System-calculated influences between entities

### Frontend Architecture

**State Management:** Zustand stores for global state + React Query for server state caching

**Visualization:**
- `D3.js` - Timeline visualization (`src/components/timeline/`)
- `Cytoscape.js` - Causal graph visualization (`src/components/causal-graph/`)

**Routing:** React Router v7 with routes defined in `src/components/routing/AppRoutes.tsx`

**Layout:** Main layout wrapper in `src/components/layout/MainLayout.tsx`

### The CLI

`timeline/src/cli/` is a second front end onto the same services
(`bin/althistory`). It has a direct engine (in-process) and a remote engine
(over HTTP); every remote call sends `X-Graph-Id`, because that header is the
only thing that scopes a request. Its command surface is documented in
`timeline/src/cli/README.md`, and `althistory schema` emits the JSON Schema of
every command.

### Documentation map

| Document | Covers |
| --- | --- |
| `GET /api/openapi.json` | The HTTP API (routes, auth, shapes). |
| [`docs/export-format.md`](docs/export-format.md) | The export document, field by field, and its checksum. |
| [`docs/ingestion.md`](docs/ingestion.md) | Getting history in: CLI, API, review step, LLM modes and cost. |
| [`docs/api-integration.md`](docs/api-integration.md) | Using the API from outside: keys, permissions, graph scoping, rate limits, jobs, webhooks. |
| [`docs/branch-merge-resolver.md`](docs/branch-merge-resolver.md) | Combining two graphs, and the anomalies the merge checks. |
| [`docs/production-deployment.md`](docs/production-deployment.md) | Running it. |
| [`docs/mcp-agent-guide.md`](docs/mcp-agent-guide.md) | The MCP surface. |

### Path Aliases

Both projects use `@/` prefix for imports:
- `@/models/*`, `@/services/*`, `@/components/*`, `@/utils/*`, etc.

## Known Issues

`DEFERREDFIXES.md` has the current state, including the measured counts. The
D3-infinite-loop and Cytoscape-mock suites it used to describe were fixed — by
hoisting the D3 work into memoised calculations and by completing the mock —
and neither package contains a skipped or disabled test. Re-measure with
`npm test` in each package rather than trusting a count written in a file.

## Key Development Patterns

1. **Dual Execution Modes** - Abstract database layer supports both Neo4j/Redis (cloud) and JSON files (local)
2. **Service Singletons** - All services lazy-loaded via container
3. **Custom Error Classes** - Domain-specific errors in `src/utils/errors.ts`
4. **Strict TypeScript** - Both projects use strict mode

## Test Structure

- Unit tests: Alongside source files (`*.test.ts`)
- Integration tests: `src/tests/integration/`
- E2E tests: `src/tests/e2e/`
- Performance tests: `*.performance.test.ts`

Test setup files:
- Backend: `src/test-setup.ts`
- Frontend: `src/test/setup.ts`

## Important Pitfalls

1. **D3 + React Conflicts** - Use "React owns the DOM" pattern; don't let D3 manipulate DOM directly
2. **Missing Memoization** - Always use `useCallback`/`useMemo` for D3 scales and event handlers
3. **Zustand Store Cascades** - Ensure store selectors are properly memoized
4. **Test Timeouts** - Database tests have 30s timeout configured
5. **Integration Tests** - Excluded by default in vitest config (require infrastructure)
6. **Vitest Watch Mode** - Running `npx vitest` directly stays open in watch mode. Always use `npm test` (includes `--run` flag) or `./run-tests.sh` to exit after completion

## Environment Configuration

**Local Mode:**
```env
LOCAL_EXECUTION_ENABLED=true
LOCAL_DATA_DIR=./data
LOCAL_MAX_MEMORY_MB=512
```

**Cloud Mode:**
```env
LOCAL_EXECUTION_ENABLED=false
NEO4J_URI=bolt://host:7687
NEO4J_USERNAME=user
NEO4J_PASSWORD=password
REDIS_HOST=localhost
REDIS_PORT=6379
# Required in cloud mode: graph metadata, jobs, versions and API keys are files
# and the rate-limit counters are per process, so the deployment must be one
# replica with a persistent volume. The flag asserts that; it cannot verify it.
CLOUD_SINGLE_REPLICA_STATE=true
LOCAL_DATA_DIR=/data
```

## API Endpoints

`GET /api/openapi.json` is the authoritative list — it is checked against the
live routers by a test, so it cannot drift. The shape of it:

| Area | Prefix |
| --- | --- |
| Health | `GET /health` |
| Events, arcs, relationships | `/api/events`, `/api/arcs`, `/api/causal` |
| Graphs, branching, merging | `/api/graphs` |
| Temporal queries, validation | `/api/temporal`, `/api/validate` |
| Inference, pressures, simulation | `/api/inference` |
| Ingest, import, export | `/api/ingest`, `/api/import`, `/api/export` |
| Keys and usage | `/api/keys` |

Most graph-scoped routes read the graph from the `X-Graph-Id` header;
`POST /api/import` takes `targetGraphId` in the body instead. The entity
routes are currently mounted without authentication.
