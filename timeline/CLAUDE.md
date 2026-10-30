# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a hierarchical temporal graph system for capturing and analyzing historical events across multiple temporal scales. The system is built with TypeScript, Express, Neo4j (graph database), and Redis (caching), with React components for visualization.

## Development Commands

- **Build**: `npm run build` - Compiles TypeScript to JavaScript in the `dist/` directory
- **Development**: `npm run dev` - Runs development server with hot reload using ts-node-dev
- **Start**: `npm start` - Runs the compiled application from `dist/index.js`
- **Test**: `npm test` - Runs all tests using Vitest
- **Test Watch**: `npm run test:watch` - Runs tests in watch mode
- **Lint**: `npm run lint` - Lints TypeScript files using ESLint
- **Format**: `npm run format` - Formats code using Prettier

## Architecture

### Core System Design
- **Dependency Injection Container**: `src/container.ts` manages all service instances as singletons
- **Layered Architecture**: API → Services → Repositories → Database
- **Path Aliases**: Uses `@/` prefix for imports (e.g., `@/models`, `@/services`)

### Domain Models
- **Event**: Historical occurrences with temporal information (actor, target, timestamp, description)
- **Arc**: Historical phases or periods that can contain events and nested child arcs (`start_time`, `end_time`, `level`, `parent_arc_id`)
- **CausalRelationship**: Weighted cause-and-effect connections between events (`weight`, `confidence`, `evidence`, `relationship_type`)
- **InferredPressure**: System-calculated pressures between temporal entities

### Service Layer
Core services include:
- **TemporalService**: Handles time-based queries and temporal relationships
- **CausalService**: Manages causal relationships and inference chains
- **InferenceService**: Performs graph analysis and pattern detection
- **GraphCopyService**: Handles graph duplication and branching operations
- **ValidationService**: Input validation and data integrity checks
- **CacheInvalidationService**: Redis-based caching strategy
- **DatabaseOptimizationService**: Performance monitoring and optimization

### Database Layer
- **Neo4j**: Primary graph database for storing events, arcs, and relationships
- **Redis**: Caching layer for performance optimization
- **DatabaseManager**: Centralized connection management and health checks

### API Layer
- RESTful API with Express.js
- Comprehensive middleware stack including security (Helmet), CORS, rate limiting
- Health check endpoint at `/health`
- API routes mounted at `/api`

### React Components
Visualization components in `src/components/`:
- **timeline/**: Timeline visualization with D3.js integration
- **causal/**: Causal graph visualization using Cytoscape.js
- **integrated/**: Container components combining multiple visualizations

## Test Structure

Tests are organized by type:
- **Unit tests**: Alongside source files (e.g., `Service.test.ts`)
- **Integration tests**: `src/tests/integration/`
- **E2E tests**: `src/tests/e2e/`
- **Performance tests**: Files ending with `.performance.test.ts`

Test setup uses Vitest with jsdom environment and React Testing Library for component tests.

## Configuration

Environment-based configuration in `src/utils/config.ts`:
- Database connections (Neo4j, Redis)
- Performance settings (timeouts, cache expiration)
- Security and CORS settings

Required environment variables:
- `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`
- Optional: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`

## Key Development Patterns

1. **Service Initialization**: All services are lazy-loaded singletons through the container
2. **Error Handling**: Custom error classes in `src/utils/errors.ts`
3. **Validation**: Centralized validation service for all inputs
4. **Caching**: Redis-based caching with automatic invalidation
5. **Health Monitoring**: Built-in health checks for all external dependencies