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

### Path Aliases

Both projects use `@/` prefix for imports:
- `@/models/*`, `@/services/*`, `@/components/*`, `@/utils/*`, etc.

## Known Issues (from DEFERREDFIXES.md)

**89 deferred tests** across 11 test suites due to:

1. **Timeline Component Infinite Loops (59 tests)** - D3 directly manipulates DOM while React expects declarative updates. Missing `useCallback`/`useMemo` causes re-render cascades.

2. **Cytoscape Mocking Incomplete (15 tests)** - Mock doesn't implement full API (~200+ methods with chaining).

3. **Modal Integration Complexity (15 tests)** - Multi-step user workflows with complex state management.

**Priority:** Timeline component fixes are highest priority since they affect core functionality.

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
```

## API Endpoints

- Health: `GET /health`
- Events: `GET/POST/PUT/DELETE /api/events`
- Arcs: `GET/POST/PUT/DELETE /api/arcs`
- Causal: `GET/POST /api/causal/relationships`, `GET /api/causal/chains/:event_id`
- Temporal: `GET /api/temporal/*`
