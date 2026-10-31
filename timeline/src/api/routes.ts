import { Router } from 'express';
import { eventRoutes } from './routes/events';
import { arcRoutes } from './routes/arcs';
import { causalRoutes } from './routes/causal';
import { temporalRoutes } from './routes/temporal';
import { inferenceRoutes } from './routes/inference';
import { graphRoutes } from './routes/graphs';
import { exportRoutes } from './routes/export';
import { createImportRouter } from './routes/import';
import { keyRoutes } from './routes/keys';
import { batchRoutes } from './routes/batch';
import { validateRoutes } from './routes/validate';
import { suggestRoutes } from './routes/suggest';
import { createIngestRouter } from './routes/ingest';
import { streamRoutes } from './routes/stream';
import { loadConfig } from '../utils/config';
import { getContainer } from '../container';
import { buildOpenApiDocument } from './openapi/document';
import { uniqueRoutes } from './openapi/routeInventory';
import { mountApi } from './openapi/mounts';

/**
 * Main API router
 */
export const apiRouter = Router();

// Get config for data directory
const config = loadConfig();
const dataDir = config.localExecution.dataDirectory;

// An import (and an approved ingestion, which is an import) writes only the
// version tree; bring the graph's live store up to the new head so the entity
// routes and the UI see it. Resolved at call time: the container is built after
// this module loads.
const onHeadReplaced = async (graphId: string): Promise<void> => {
  await getContainer().liveStoreSyncService.materialize(graphId);
};

// Create import router with config
const importRoutes = createImportRouter({ dataDir, onHeadReplaced });

// Create ingestion router with config. Ingestion reuses the import pipeline.
const ingestRoutes = createIngestRouter({ dataDir, onHeadReplaced });

// Root API endpoint
apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'Hierarchical Temporal Graph API',
    version: '1.0.0',
    description: 'API for capturing and analyzing historical events across multiple temporal scales',
    endpoints: {
      info: '/api/info',
      health: '/api/health',
      graphs: '/api/graphs',
      export: '/api/export',
      import: '/api/import',
      ingest: '/api/ingest',
      events: '/api/events',
      arcs: '/api/arcs',
      causal: '/api/causal',
      temporal: '/api/temporal',
      inference: '/api/inference',
      keys: '/api/keys',
      batch: '/api/batch',
      validate: '/api/validate',
      suggest: '/api/suggest',
      stream: '/api/stream'
    },
    timestamp: new Date().toISOString()
  });
});

// Graph management API endpoints
mountApi(apiRouter, '/graphs', graphRoutes);

// Export API endpoints
mountApi(apiRouter, '/export', exportRoutes);

// Import API endpoints
mountApi(apiRouter, '/import', importRoutes);

// Web ingestion API endpoints (Wikipedia, Wikidata, free text, LLM)
mountApi(apiRouter, '/ingest', ingestRoutes);

// Event API endpoints
mountApi(apiRouter, '/events', eventRoutes);

// Arc API endpoints
mountApi(apiRouter, '/arcs', arcRoutes);

// Causal relationship API endpoints
mountApi(apiRouter, '/causal', causalRoutes);

// Temporal analysis API endpoints
mountApi(apiRouter, '/temporal', temporalRoutes);

// Inference and pattern detection API endpoints
mountApi(apiRouter, '/inference', inferenceRoutes);

// Phase 3: Authentication & Batch API endpoints
mountApi(apiRouter, '/keys', keyRoutes);
mountApi(apiRouter, '/batch', batchRoutes);
mountApi(apiRouter, '/validate', validateRoutes);
mountApi(apiRouter, '/suggest', suggestRoutes);

// Phase 5: WebSocket stream token issuance (the socket itself is served by the
// HTTP `upgrade` handler, not by Express).
mountApi(apiRouter, '/stream', streamRoutes);

// The OpenAPI description of the API.
apiRouter.get('/openapi.json', (_req, res) => {
  res.json(getOpenApiDocument());
});

// Health check endpoint
apiRouter.get('/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'hierarchical-temporal-graph'
  });
});

// API info endpoint
apiRouter.get('/info', (_req, res) => {
  res.json({
    name: 'Hierarchical Temporal Graph API',
    version: '1.0.0',
    description: 'API for capturing and analyzing historical events across multiple temporal scales',
    endpoints: {
      graphs: '/api/graphs - Multi-graph management',
      export: '/api/export - Export graphs and manage export jobs',
      import: '/api/import - Import data from export files',
      ingest: '/api/ingest - Extract entities from Wikipedia, Wikidata and text for review',
      events: '/api/events - CRUD operations for historical events',
      arcs: '/api/arcs - CRUD operations for historical arcs/periods',
      causal: '/api/causal - Causal relationship analysis and management',
      temporal: '/api/temporal - Time-based queries and constraints',
      inference: '/api/inference - Pattern detection and graph analysis',
      keys: '/api/keys - API key management',
      batch: '/api/batch - Batch operations',
      validate: '/api/validate - Data validation',
      suggest: '/api/suggest - AI-powered suggestions'
    },
    features: {
      graphs: ['Create', 'Read', 'Update', 'Delete', 'Branch', 'Merge', 'Version history', 'Rollback'],
      export: ['Async export jobs', 'Sync export', 'Filtered export', 'Download', 'Validate'],
      import: ['Validate format', 'Preview changes', 'Conflict detection', 'Import with resolutions'],
      ingest: ['Wikipedia extraction', 'Wikidata SPARQL', 'Text extraction', 'LLM-assisted extraction', 'Review and approve'],
      events: ['Create', 'Read', 'Update', 'Delete', 'Filter by time/actor/target', 'Statistics'],
      arcs: ['Create', 'Read', 'Update', 'Delete', 'Hierarchy validation', 'Child relationships'],
      causal: ['Create links', 'Find chains', 'Detect cycles', 'Get suggestions', 'Validate relationships'],
      temporal: ['Timeline view', 'Constraint validation', 'Overlap detection', 'Gap analysis', 'Density analysis'],
      inference: ['Cluster analysis', 'Pattern detection', 'Pressure inference', 'Actor relationships', 'Anomaly detection', 'Predictions'],
      keys: ['Create', 'Read', 'Update', 'Revoke', 'Delete', 'Rate limiting'],
      batch: ['Batch events', 'Batch arcs', 'Batch relationships', 'Atomic transactions'],
      validate: ['Graph validation', 'Incremental validation', 'Temporal checks', 'Causal checks', 'Referential checks'],
      suggest: ['Relationship suggestions', 'Arc suggestions', 'Completeness analysis', 'Pressure analysis'],
      stream: ['Short-lived stream tokens', 'Persistent WebSocket write session', 'Per-event acknowledgments']
    }
  });
});

/**
 * The OpenAPI description of the API.
 *
 * It is built the first time it is asked for, which is after this module has
 * finished loading -- so every route, including the description route itself,
 * is in it. A route that is mounted and not described makes the build throw,
 * and the request answers 500; the test suite catches that case, so the server
 * never ships a description that is missing a route.
 */
let openApiDocument: Record<string, unknown> | undefined;

function getOpenApiDocument(): Record<string, unknown> {
  if (!openApiDocument) {
    openApiDocument = buildOpenApiDocument(uniqueRoutes(apiRouter, '/api'));
  }
  return openApiDocument;
}
