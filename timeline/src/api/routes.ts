import { Router } from 'express';
import { eventRoutes } from './routes/events';

/**
 * Main API router
 */
export const apiRouter = Router();

// Event API endpoints (Task 8.1)
apiRouter.use('/events', eventRoutes);

// TODO: Implement in task 8.2 - Arc API endpoints  
// apiRouter.use('/arcs', arcRoutes);

// TODO: Implement in task 8.3 - Causal relationship API endpoints
// apiRouter.use('/causal', causalRoutes);

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
      events: '/api/events (TODO: Implement in task 8.1)',
      arcs: '/api/arcs (TODO: Implement in task 8.2)', 
      causal: '/api/causal (TODO: Implement in task 8.3)'
    }
  });
});