/**
 * Tests for batch operation routes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { batchRoutes } from './batch';
import { errorHandler } from '@/api/middleware';
import { Event } from '@/models/Event';
import { Arc } from '@/models/Arc';

// The routes now build a graph-scoped `CausalService` per request from the
// container's live store. Stub the class so these tests assert batch wiring
// without a real Neo4j session or file store behind it.
const { causalServiceMock } = vi.hoisted(() => ({
  causalServiceMock: {
    createCausalLink: vi.fn(),
    deleteCausalLink: vi.fn(),
  },
}));

vi.mock('@/services/CausalService', () => ({
  CausalService: vi.fn().mockImplementation(() => causalServiceMock),
}));

// Mock the middleware module before importing routes
vi.mock('@/api/middleware', async () => {
  const actual = await vi.importActual('@/api/middleware');
  return {
    ...actual,
    authenticate: (req: any, res: any, next: any) => {
      req.isAuthenticated = req.get('X-API-Key') === 'valid-write-key';
      if (req.isAuthenticated) {
        req.apiKey = {
          id: 'test-key-id',
          hasPermission: () => true,
          hasAnyPermission: () => true,
          canAccessGraph: () => true,
          rateLimit: { requestsPerMinute: 60, requestsPerHour: 1000, requestsPerDay: 10000 },
        };
      }
      next();
    },
    requireAuth: (req: any, res: any, next: any) => {
      if (!req.isAuthenticated) {
        return res.status(401).json({ error: { message: 'API key is required' } });
      }
      next();
    },
    authorize: () => (req: any, res: any, next: any) => next(),
    rateLimit: () => (req: any, res: any, next: any) => next(),
    authorizeGraphAccess: () => (req: any, res: any, next: any) => next(),
    // Mirror the real middleware's contract without booting the global
    // container: a request is scoped by X-Graph-Id or rejected (never
    // resolved to the global store). Graph resolution itself is covered by
    // `graph-context.test.ts`.
    resolveGraphContext: () => (req: Request, res: Response, next: NextFunction) => {
      const graphId = req.get('X-Graph-Id');
      if (!graphId) {
        return res.status(404).json({ error: { message: 'No graph context available' } });
      }
      req.graphId = graphId;
      next();
    },
    asyncHandler: (fn: any) => (req: any, res: any, next: any) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    },
  };
});

// Setup Express app
let app: express.Application;
let mockEventRepository: any;
let mockArcRepository: any;
/** Graph ids the routes asked the container to scope to, in call order. */
let scopedGraphIds: string[];

describe('Batch Routes', () => {
  beforeEach(() => {
    scopedGraphIds = [];
    mockEventRepository = {
      create: vi.fn().mockImplementation((data: any) => {
        return Promise.resolve(new Event({ ...data, id: `evt-${Date.now()}` }));
      }),
      findById: vi.fn().mockImplementation((id: string) => {
        if (id.startsWith('evt-')) {
          return Promise.resolve(new Event({
            id,
            description: 'Test Event',
            actor: 'Actor',
            target: 'Target',
            timestamp: new Date('1914-06-28'),
          }));
        }
        return Promise.resolve(null);
      }),
      update: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(true),
    };

    mockArcRepository = {
      create: vi.fn().mockImplementation((data: any) => {
        return Promise.resolve(new Arc({ ...data, id: `arc-${Date.now()}` }));
      }),
      findById: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(true),
    };

    causalServiceMock.createCausalLink.mockReset().mockResolvedValue({});
    causalServiceMock.deleteCausalLink.mockReset().mockResolvedValue('rel-1');

    // Create fresh app for each test
    app = express();
    app.use(express.json());
    app.use((req: Request, res, next) => {
      req.requestId = 'test-request-id';
      req.startTime = Date.now();
      req.container = {
        eventRepository: mockEventRepository,
        arcRepository: mockArcRepository,
        graphContextStore: { getStore: vi.fn().mockResolvedValue({}) },
        graphScopedRepositories: (graphId: string) => {
          scopedGraphIds.push(graphId);
          return Promise.resolve({
            eventRepository: mockEventRepository,
            arcRepository: mockArcRepository,
          });
        },
      } as any;
      next();
    });
    app.use('/api/batch', batchRoutes);
    app.use(errorHandler);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/batch/events', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/api/batch/events')
        .send({ graphId: 'test', events: [] })
        .expect(401);

      expect(response.body.error.message).toBe('API key is required');
    });

    it('should require graphId', async () => {
      const response = await request(app)
        .post('/api/batch/events')
        .set('X-API-Key', 'valid-write-key')
        .set('X-Graph-Id', 'test-graph')
        .send({ events: [{ description: 'Test' }] })
        .expect(400);

      expect(response.body.error.message).toBe('graphId is required');
    });

    it('should require non-empty events array', async () => {
      const response = await request(app)
        .post('/api/batch/events')
        .set('X-API-Key', 'valid-write-key')
        .set('X-Graph-Id', 'test-graph')
        .send({ graphId: 'test', events: [] })
        .expect(400);

      expect(response.body.error.message).toBe('events array cannot be empty');
    });

    it('should batch create events', async () => {
      const response = await request(app)
        .post('/api/batch/events')
        .set('X-API-Key', 'valid-write-key')
        .set('X-Graph-Id', 'test-graph')
        .send({
          graphId: 'test-graph',
          events: [
            { description: 'Event 1', actor: 'Actor', target: 'Target', timestamp: '1914-06-28T00:00:00.000Z' },
            { description: 'Event 2', actor: 'Actor', target: 'Target', timestamp: '1914-07-28T00:00:00.000Z' },
          ],
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.created.length).toBe(2);
      expect(mockEventRepository.create).toHaveBeenCalledTimes(2);
    });

    it('should abort on validation error with strict mode and rollback created events', async () => {
      const response = await request(app)
        .post('/api/batch/events')
        .set('X-API-Key', 'valid-write-key')
        .set('X-Graph-Id', 'test-graph')
        .send({
          graphId: 'test-graph',
          validation: 'strict',
          onError: 'abort',
          events: [
            { description: 'Valid', actor: 'Actor', target: 'Target', timestamp: '1914-06-28T00:00:00.000Z' },
            { description: '', actor: 'Actor', target: 'Target', timestamp: '1914-07-28T00:00:00.000Z' }, // Invalid
          ],
        })
        .expect(400);

      expect(response.body.error.message).toContain('Batch aborted');
      expect(mockEventRepository.create).toHaveBeenCalledTimes(1);
      expect(mockEventRepository.delete).toHaveBeenCalledTimes(1);
    });

    it('should skip invalid entities with warnings in lenient validation mode', async () => {
      const response = await request(app)
        .post('/api/batch/events')
        .set('X-API-Key', 'valid-write-key')
        .set('X-Graph-Id', 'test-graph')
        .send({
          graphId: 'test-graph',
          validation: 'lenient',
          events: [
            { description: 'Valid 1', actor: 'Actor', target: 'Target', timestamp: '1914-06-28T00:00:00.000Z' },
            { description: '', actor: 'Actor', target: 'Target', timestamp: '1914-07-28T00:00:00.000Z' }, // Invalid
            { description: 'Valid 2', actor: 'Actor', target: 'Target', timestamp: '1914-08-28T00:00:00.000Z' },
          ],
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.created).toHaveLength(2);
      expect(response.body.validationWarnings).toEqual([
        { index: 1, warning: 'description is required' },
      ]);
      expect(mockEventRepository.create).toHaveBeenCalledTimes(2);
    });

    it('should distinguish onError skip vs collect when errors occur', async () => {
      const eventsPayload = [
        { description: 'Valid 1', actor: 'Actor', target: 'Target', timestamp: '1914-06-28T00:00:00.000Z' },
        { description: '', actor: 'Actor', target: 'Target', timestamp: '1914-07-28T00:00:00.000Z' }, // Invalid
      ];

      const skipRes = await request(app)
        .post('/api/batch/events')
        .set('X-API-Key', 'valid-write-key')
        .set('X-Graph-Id', 'test-graph')
        .send({
          graphId: 'test-graph',
          validation: 'strict',
          onError: 'skip',
          events: eventsPayload,
        })
        .expect(201);

      expect(skipRes.body.success).toBe(true);
      expect(skipRes.body.created).toHaveLength(1);
      expect(skipRes.body.failed).toHaveLength(0);

      const collectRes = await request(app)
        .post('/api/batch/events')
        .set('X-API-Key', 'valid-write-key')
        .set('X-Graph-Id', 'test-graph')
        .send({
          graphId: 'test-graph',
          validation: 'strict',
          onError: 'collect',
          events: eventsPayload,
        })
        .expect(207);

      expect(collectRes.body.success).toBe(false);
      expect(collectRes.body.created).toHaveLength(1);
      expect(collectRes.body.failed).toHaveLength(1);
      expect(collectRes.body.failed[0].index).toBe(1);
    });
  });

  describe('POST /api/batch/arcs', () => {
    it('should batch create arcs', async () => {
      const response = await request(app)
        .post('/api/batch/arcs')
        .set('X-API-Key', 'valid-write-key')
        .set('X-Graph-Id', 'test-graph')
        .send({
          graphId: 'test-graph',
          arcs: [
            { name: 'Arc 1', start_time: '1914-01-01T00:00:00.000Z', end_time: '1914-12-31T00:00:00.000Z', level: 0 },
            { name: 'Arc 2', start_time: '1915-01-01T00:00:00.000Z', end_time: '1915-12-31T00:00:00.000Z', level: 0 },
          ],
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.created.length).toBe(2);
    });
  });

  describe('POST /api/batch/relationships', () => {
    it('should batch create relationships', async () => {
      // Setup mock to return valid events
      mockEventRepository.findById.mockImplementation((id: string) => {
        return Promise.resolve(new Event({
          id,
          description: 'Test Event',
          actor: 'Actor',
          target: 'Target',
          timestamp: new Date('1914-06-28'),
        }));
      });

      const response = await request(app)
        .post('/api/batch/relationships')
        .set('X-API-Key', 'valid-write-key')
        .set('X-Graph-Id', 'test-graph')
        .send({
          graphId: 'test-graph',
          relationships: [
            { cause_event_id: 'evt-1', effect_event_id: 'evt-2' },
          ],
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(causalServiceMock.createCausalLink).toHaveBeenCalled();
    });

    it('should fail for non-existent events', async () => {
      mockEventRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/batch/relationships')
        .set('X-API-Key', 'valid-write-key')
        .set('X-Graph-Id', 'test-graph')
        .send({
          graphId: 'test-graph',
          relationships: [
            { cause_event_id: 'non-existent', effect_event_id: 'also-missing' },
          ],
        })
        .expect(400);

      expect(response.body.error.message).toContain('not found');
    });
  });

  describe('POST /api/batch/transaction', () => {
    it('should execute transaction with multiple operations', async () => {
      const response = await request(app)
        .post('/api/batch/transaction')
        .set('X-API-Key', 'valid-write-key')
        .set('X-Graph-Id', 'test-graph')
        .send({
          graphId: 'test-graph',
          operations: [
            {
              type: 'create_event',
              data: { description: 'Event', actor: 'A', target: 'B', timestamp: '1914-06-28T00:00:00.000Z' },
            },
            {
              type: 'create_arc',
              data: { name: 'Arc', start_time: '1914-01-01T00:00:00.000Z', end_time: '1914-12-31T00:00:00.000Z', level: 0 },
            },
          ],
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results.length).toBe(2);
    });
  });

  describe('graph context', () => {
    it('scopes writes to the resolved graph id rather than the global store', async () => {
      await request(app)
        .post('/api/batch/events')
        .set('X-API-Key', 'valid-write-key')
        .set('X-Graph-Id', 'graph-a')
        .send({
          graphId: 'graph-a',
          events: [
            { description: 'Event', actor: 'Actor', target: 'Target', timestamp: '1914-06-28T00:00:00.000Z' },
          ],
        })
        .expect(201);

      expect(scopedGraphIds).toEqual(['graph-a']);
      expect(mockEventRepository.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a request with no graph context instead of falling back to global data', async () => {
      const response = await request(app)
        .post('/api/batch/events')
        .set('X-API-Key', 'valid-write-key')
        .send({
          graphId: 'graph-a',
          events: [
            { description: 'Event', actor: 'Actor', target: 'Target', timestamp: '1914-06-28T00:00:00.000Z' },
          ],
        })
        .expect(404);

      expect(response.body.error.message).toBe('No graph context available');
      expect(scopedGraphIds).toEqual([]);
      expect(mockEventRepository.create).not.toHaveBeenCalled();
    });
  });
});
