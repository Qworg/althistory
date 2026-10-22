# AGENTS.md

Guidelines for AI coding agents working in the Althistory monorepo.

## Project Structure

Monorepo with two packages:
- `timeline/` - Express backend (TypeScript, Neo4j/Redis or local JSON storage)
- `frontend/` - React frontend (Vite, TypeScript, D3.js, Cytoscape.js)

`timeline/src/cli/` is a second front end onto the same services
(`bin/althistory`); it is part of the backend package, not a third one.

Start with [`docs/`](docs/) for what the system does:
[`export-format.md`](docs/export-format.md),
[`ingestion.md`](docs/ingestion.md),
[`api-integration.md`](docs/api-integration.md),
[`branch-merge-resolver.md`](docs/branch-merge-resolver.md),
[`production-deployment.md`](docs/production-deployment.md).
`GET /api/openapi.json` is the authoritative route list.

## Build/Lint/Test Commands

### Backend (`timeline/`)

```bash
npm run dev         # Dev server with hot reload (port 3000)
npm run build       # Compile TypeScript to dist/
npm test            # Run all tests (exits after completion)
npm run test:watch  # Watch mode
npm run lint        # ESLint
npm run format      # Prettier formatting

# Single test file
npm test -- src/services/TemporalService.test.ts

# Single test by name
npm test -- -t "should validate temporal constraints"
```

### Frontend (`frontend/`)

```bash
npm run dev         # Vite dev server (port 5173)
npm run build       # Production build
npm test            # Run all tests
npm run test:watch  # Watch mode
npm run lint        # ESLint
npm run lint:fix    # Auto-fix lint issues
npm run type-check  # TypeScript check (tsc --noEmit)

# Single test file
npm test -- src/components/timeline/Timeline.test.tsx

# Single test by name
npm test -- -t "renders events correctly"
```

### Quick Local Setup (No Neo4j/Redis required)

```bash
./start-local.sh
# Or manually:
cd timeline && echo "LOCAL_EXECUTION_ENABLED=true" > .env.local && npm run dev
cd frontend && npm run dev  # separate terminal
```

## Code Style Guidelines

### Imports

Use `@/` path aliases for all internal imports. Order:
1. External packages (React, libraries)
2. Internal modules (`@/services`, `@/utils`, etc.)
3. Relative imports (only for same-directory files)

```typescript
// Good
import React, { useState, useCallback } from 'react'
import * as d3 from 'd3'
import { Event, Arc } from '@/types'
import { apiClient } from '@/services/api'
import { TimelineEvent } from './TimelineEvent'

// Bad - don't use relative paths for cross-directory imports
import { apiClient } from '../../services/api'
```

### TypeScript

- Strict mode enabled in both projects
- Use interfaces for object shapes, types for unions/aliases
- Always define explicit return types for functions
- Use `readonly` for immutable properties
- Avoid `any` - use `unknown` when type is truly unknown

```typescript
// Interface for domain objects
interface IEvent {
  readonly id: string;
  description: string;
  timestamp: Date;
}

// Type for unions
type ViewMode = 'timeline' | 'causal-graph' | 'actor-perspective';

// Explicit return types
function calculateRange(events: Event[]): TimeRange {
  // ...
}
```

### Naming Conventions

- **Files**: PascalCase for components (`TimelineEvent.tsx`), camelCase for utilities (`d3Calculations.ts`)
- **Interfaces**: Prefix with `I` for domain models (`IEvent`), no prefix for props/options
- **Types**: PascalCase (`TimeRange`, `ViewMode`)
- **Functions**: camelCase, verb prefixes (`getEvents`, `calculateRange`, `validateInput`)
- **Constants**: UPPER_SNAKE_CASE for true constants, camelCase for config objects
- **React hooks**: `use` prefix (`useEvents`, `useTimelineScales`)
- **Test files**: Same name as source with `.test.ts` suffix

### Error Handling

Backend uses custom error classes extending `AppError`:

```typescript
import { ValidationError, NotFoundError } from '@/utils/errors'

// Throw domain-specific errors
if (!event) {
  throw new NotFoundError('Event not found', 'Event', eventId)
}

// Validate input
if (!data.description) {
  throw new ValidationError('Description required', 'description')
}
```

Error classes: `ValidationError`, `NotFoundError`, `DatabaseError`, `TemporalConstraintError`, `CausalParadoxError`, `ConfigurationError`, `LocalStorageError`

### React Components

- Use functional components with TypeScript interfaces for props
- Wrap expensive components in `React.memo()`
- Extract reusable logic into custom hooks
- Use `useCallback`/`useMemo` for event handlers and computed values

```typescript
interface TimelineProps {
  events: Event[]
  onEventSelect?: (event: Event) => void
}

const Timeline = memo(function Timeline({ events, onEventSelect }: TimelineProps) {
  const handleClick = useCallback((e: Event) => {
    onEventSelect?.(e)
  }, [onEventSelect])
  
  return <div>...</div>
})
```

### React Hooks (Frontend)

Use React Query for server state, Zustand for client state:

```typescript
// Data fetching with React Query
export function useEvents(filters?: Record<string, any>) {
  return useQuery({
    queryKey: ['events', filters],
    queryFn: () => apiClient.events.getAll(filters),
  })
}

// Zustand store access
const { selectedEvents, setSelectedEvents } = useGlobalStore()
```

### D3.js + React Integration

CRITICAL: Follow "React owns the DOM" pattern:
- D3 for calculations ONLY (scales, layouts, paths)
- React renders all DOM elements
- Never use D3 `.append()`, `.select()` for DOM manipulation

```typescript
// Good - D3 for calculations only
const xScale = useMemo(() => 
  d3.scaleTime().domain(xDomain).range([0, width]),
  [xDomain, width]
)

return events.map(event => (
  <circle cx={xScale(event.timestamp)} cy={yPos} r={5} />
))
```

### Backend Services

Use dependency injection via container:

```typescript
// Access services through container
import { getContainer } from '@/container'

const container = getContainer()
const events = await container.eventRepository.findAll()
```

Services are lazy-loaded singletons. Key services: `TemporalService`, `CausalService`, `InferenceService`, `ValidationService`

### Testing

- Unit tests alongside source files (`*.test.ts`)
- Integration tests in `src/tests/integration/`
- Use `describe`/`it` blocks with clear descriptions
- Mock external dependencies, not internal logic

```typescript
describe('EventRepository', () => {
  it('should create an event with valid data', async () => {
    const event = await repository.create(validEventData)
    expect(event.id).toBeDefined()
    expect(event.description).toBe(validEventData.description)
  })
})
```

## Important Pitfalls

1. **Vitest watch mode**: Use `npm test` (includes `--run`), not `npx vitest` directly
2. **D3 + React conflicts**: Never let D3 manipulate DOM - causes infinite loops
3. **Missing memoization**: Always memoize D3 scales and event handlers
4. **Zustand selector cascades**: Use granular selectors to prevent re-renders
5. **Integration tests excluded**: Require Neo4j/Redis - excluded by default in vitest config
6. **Test timeouts**: Database tests have 30s timeout configured
7. **No skipped tests**: neither package contains `it.skip`/`describe.skip`. If a change needs to disable one, record the reason and the removing issue in `DEFERREDFIXES.md` instead of leaving it silent.
8. **Graph scoping is a header, with one exception**: most graph-scoped routes read the graph from `X-Graph-Id` and nothing else — a `graphId` in a body or query is not the scope, and must agree with the header when present. `POST /api/import` is different: it takes `targetGraphId` from the body and does not read the header.
9. **Entity routes are anonymous today**: `/api/events`, `/api/arcs`, `/api/causal`, `/api/temporal` and `/api/inference` are mounted without authentication (the OpenAPI document marks them `auth: optional`). Do not copy them as the pattern for a new route; `#64` tracks closing the gap.
10. **One causal-order rule**: `timeline/src/utils/causalOrder.ts`. A cause may happen at the *same moment* as its effect; only a cause strictly after it is an error. Both packages have a drift test that fails if any file compares a cause with its effect on its own.
11. **Dependencies are injected**: reach services through `getContainer()`; a service that constructs its own collaborator cannot be swapped in a test.

## Environment Variables

Precedence, strongest first: the **process environment**, then `.env.local`,
then `.env`. `.env.local` is a developer override and beats `.env`, but it does
not beat the real environment — that is what made a committed `.env.local`
force local mode inside a container that asked for cloud mode.

Local mode (default for development):
```env
LOCAL_EXECUTION_ENABLED=true
LOCAL_DATA_DIR=./data
```

Cloud mode (production):
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
