/**
 * Tests for the inference simulation route.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { Request } from 'express';
import { inferenceRoutes } from './inference';
import { errorHandler } from '@/api/middleware';
import { Event } from '@/models';
import type { SimulationResult } from '@/services/SimulationService';

/** The middleware augmentation adds `isAuthenticated`; the test sets it by hand. */
type AuthRequest = Request & { isAuthenticated?: boolean };

vi.mock('@/api/middleware', async () => {
  const actual = await vi.importActual('@/api/middleware');
  return {
    ...actual,
    authenticate: (req: Request, _res: unknown, next: () => void) => {
      (req as AuthRequest).isAuthenticated = req.get('X-API-Key') === 'valid-read-key';
      next();
    },
    requireAuth: (req: Request, res: express.Response, next: () => void) => {
      if (!(req as AuthRequest).isAuthenticated) {
        res.status(401).json({ error: { message: 'API key is required' } });
        return;
      }
      next();
    },
    rateLimit: () => (_req: Request, _res: unknown, next: () => void) => next(),
    resolveGraphContext: () => (req: Request, _res: unknown, next: () => void) => {
      req.graphId = req.get('X-Graph-Id') || 'test-graph';
      next();
    },
    authorizeGraphAccess: () => (_req: Request, _res: unknown, next: () => void) => next(),
    authorizeAny: () => (_req: Request, _res: unknown, next: () => void) => next(),
    asyncHandler: (fn: unknown) =>
      (req: Request, res: express.Response, next: (error?: unknown) => void) => {
        Promise.resolve((fn as (a: Request, b: express.Response, c: unknown) => unknown)(req, res, next)).catch(next);
      },
  };
});

function makeSimulationResult(overrides: Partial<SimulationResult> = {}): SimulationResult {
  const event = new Event({
    id: 'sim-1',
    description: 'A simulated milestone',
    actor: 'Roman Republic',
    target: 'Carthage',
    timestamp: new Date('0201-01-01T00:00:00Z'),
    metadata: { simulated: true },
  });

  return {
    graphId: 'test-graph',
    anchorEventId: 'event-anchor',
    domain: 'political',
    steps: 1,
    stepDurationMs: 365 * 24 * 60 * 60 * 1000,
    aggressiveness: 0.5,
    dryRun: false,
    events: [event],
    relationships: [],
    pressures: [],
    ...overrides,
  };
}

describe('Inference simulation route', () => {
  let app: express.Application;
  let simulationService: {
    simulate: ReturnType<typeof vi.fn>;
    preview: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    simulationService = {
      simulate: vi.fn().mockResolvedValue(makeSimulationResult()),
      preview: vi.fn().mockResolvedValue(makeSimulationResult({ dryRun: true })),
    };

    app = express();
    app.use(express.json());
    // Production applies the auth middleware globally in index.ts, so the route
    // under test inherits it; mirror that gate here.
    app.use((req: Request, res: express.Response, next: () => void) => {
      if (req.get('X-API-Key') !== 'valid-read-key') {
        res.status(401).json({ error: { message: 'API key is required' } });
        return;
      }
      next();
    });
    app.use((req: Request, _res, next) => {
      req.requestId = 'test-request-id';
      req.startTime = Date.now();
      req.container = {
        simulationService,
      } as unknown as Request['container'];
      next();
    });
    app.use('/api/inference', inferenceRoutes);
    app.use(errorHandler);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unauthenticated request', async () => {
    await request(app)
      .post('/api/inference/simulate')
      .send({ steps: 2 })
      .expect(401);
  });

  it('runs a simulation and returns the envelope', async () => {
    const response = await request(app)
      .post('/api/inference/simulate')
      .set('X-API-Key', 'valid-read-key')
      .set('X-Graph-Id', 'graph-42')
      .send({ steps: 2, domain: 'military' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.graphId).toBe('test-graph');
    expect(response.body.data.events[0].timestamp).toBe('0201-01-01T00:00:00.000Z');
    expect(simulationService.simulate).toHaveBeenCalledWith(
      expect.objectContaining({ graphId: 'graph-42', steps: 2, domain: 'military' })
    );
  });

  it('routes a dry run through preview instead of simulate', async () => {
    const response = await request(app)
      .post('/api/inference/simulate')
      .set('X-API-Key', 'valid-read-key')
      .send({ steps: 1, dryRun: true })
      .expect(200);

    expect(response.body.data.dryRun).toBe(true);
    expect(simulationService.preview).toHaveBeenCalledTimes(1);
    expect(simulationService.simulate).not.toHaveBeenCalled();
  });

  it('rejects an unknown domain with a 400', async () => {
    const response = await request(app)
      .post('/api/inference/simulate')
      .set('X-API-Key', 'valid-read-key')
      .send({ domain: 'alchemy' })
      .expect(400);

    expect(response.body.error.message).toContain('domain must be one of');
    expect(simulationService.simulate).not.toHaveBeenCalled();
  });

  it('streams each milestone as an SSE frame when the client asks for it', async () => {
    simulationService.simulate.mockImplementation(
      async (
        _request: unknown,
        onStep?: (step: {
          index: number;
          event: Event;
          pressure: { id: string; description: string; confidence_score: number; pressure_type: string; evidence: string[] };
          causalLink?: { id: string; cause_event_id: string; effect_event_id: string; weight: number; evidence: string; confidence: number; relationship_type: string };
        }) => void
      ) => {
        const result = makeSimulationResult();
        onStep?.({
          index: 0,
          event: result.events[0],
          pressure: {
            id: 'pressure-1',
            description: 'Latent political pressure',
            confidence_score: 0.4,
            pressure_type: 'political',
            evidence: [],
          },
          causalLink: {
            id: 'rel-1',
            cause_event_id: 'event-anchor',
            effect_event_id: 'sim-1',
            weight: 0.8,
            evidence: 'Forward simulation',
            confidence: 0.7,
            relationship_type: 'direct',
          },
        });
        return result;
      }
    );

    const response = await request(app)
      .post('/api/inference/simulate')
      .set('X-API-Key', 'valid-read-key')
      .set('Accept', 'text/event-stream')
      .send({ steps: 1 })
      .expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('event: event_created');
    expect(response.text).toContain('event: causal_link_created');
    expect(response.text).toContain('event: simulation_complete');
    expect(response.text).toContain('"id":"sim-1"');
  });

  it('reports a mid-stream failure as a simulation_error frame', async () => {
    simulationService.simulate.mockRejectedValue(new Error('engine failed'));

    const response = await request(app)
      .post('/api/inference/simulate')
      .set('X-API-Key', 'valid-read-key')
      .set('Accept', 'text/event-stream')
      .send({ steps: 1 })
      .expect(200);

    expect(response.text).toContain('event: simulation_error');
    expect(response.text).toContain('engine failed');
  });
});
