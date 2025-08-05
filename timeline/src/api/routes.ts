import { Router } from 'express';
import { eventRoutes } from './routes/events';
import { arcRoutes } from './routes/arcs';
import { causalRoutes } from './routes/causal';
import { temporalRoutes } from './routes/temporal';
import { inferenceRoutes } from './routes/inference';

/**
 * Main API router
 */
export const apiRouter = Router();

// Root API endpoint
apiRouter.get('/', (req, res) => {
  res.json({
    name: 'Hierarchical Temporal Graph API',
    version: '1.0.0',
    description: 'API for capturing and analyzing historical events across multiple temporal scales',
    endpoints: {
      info: '/api/info',
      health: '/api/health',
      events: '/api/events',
      arcs: '/api/arcs',
      causal: '/api/causal',
      temporal: '/api/temporal',
      inference: '/api/inference'
    },
    timestamp: new Date().toISOString()
  });
});

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

// Health check endpoint
apiRouter.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'hierarchical-temporal-graph'
  });
});

// API info endpoint
apiRouter.get('/info', (req, res) => {
  res.json({
    name: 'Hierarchical Temporal Graph API',
    version: '1.0.0',
    description: 'API for capturing and analyzing historical events across multiple temporal scales',
    endpoints: {
      events: '/api/events - CRUD operations for historical events',
      arcs: '/api/arcs - CRUD operations for historical arcs/periods',
      causal: '/api/causal - Causal relationship analysis and management',
      temporal: '/api/temporal - Time-based queries and constraints',
      inference: '/api/inference - Pattern detection and graph analysis'
    },
    features: {
      events: ['Create', 'Read', 'Update', 'Delete', 'Filter by time/actor/target', 'Statistics'],
      arcs: ['Create', 'Read', 'Update', 'Delete', 'Hierarchy validation', 'Child relationships'],
      causal: ['Create links', 'Find chains', 'Detect cycles', 'Get suggestions', 'Validate relationships'],
      temporal: ['Timeline view', 'Constraint validation', 'Overlap detection', 'Gap analysis', 'Density analysis'],
      inference: ['Cluster analysis', 'Pattern detection', 'Pressure inference', 'Actor relationships', 'Anomaly detection', 'Predictions']
    }
  });
});