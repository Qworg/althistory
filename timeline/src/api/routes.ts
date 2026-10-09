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

/**
 * Main API router
 */
export const apiRouter = Router();

// Get config for data directory
const config = loadConfig();
const dataDir = config.localExecution.dataDirectory;

// Create import router with config
const importRoutes = createImportRouter({ dataDir });

// Create ingestion router with config. Ingestion reuses the import pipeline.
const ingestRoutes = createIngestRouter({ dataDir });

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
apiRouter.use('/graphs', graphRoutes);

// Export API endpoints
apiRouter.use('/export', exportRoutes);

// Import API endpoints
apiRouter.use('/import', importRoutes);

// Web ingestion API endpoints (Wikipedia, Wikidata, free text, LLM)
apiRouter.use('/ingest', ingestRoutes);

// Event API endpoints
apiRouter.use('/events', eventRoutes);

// Arc API endpoints
apiRouter.use('/arcs', arcRoutes);

// Causal relationship API endpoints
apiRouter.use('/causal', causalRoutes);

// Temporal analysis API endpoints
apiRouter.use('/temporal', temporalRoutes);

// Inference and pattern detection API endpoints
apiRouter.use('/inference', inferenceRoutes);

// Phase 3: Authentication & Batch API endpoints
apiRouter.use('/keys', keyRoutes);
apiRouter.use('/batch', batchRoutes);
apiRouter.use('/validate', validateRoutes);
apiRouter.use('/suggest', suggestRoutes);

// Phase 5: WebSocket stream token issuance (the socket itself is served by the
// HTTP `upgrade` handler, not by Express).
apiRouter.use('/stream', streamRoutes);

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