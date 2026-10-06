/**
 * Tests for validation routes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { Request } from 'express';
import { validateRoutes } from './validate';
import { errorHandler } from '@/api/middleware';

// Mock the middleware module before importing routes
vi.mock('@/api/middleware', async () => {
  const actual = await vi.importActual('@/api/middleware');
  return {
    ...actual,
    authenticate: (req: any, res: any, next: any) => {
      req.isAuthenticated = req.get('X-API-Key') === 'valid-read-key';
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
    rateLimit: () => (req: any, res: any, next: any) => next(),
    resolveGraphContext: () => (req: any, _res: any, next: any) => {
      req.graphId = req.get('X-Graph-Id') || 'test-graph';
      next();
    },
    authorizeGraphAccess: () => (req: any, res: any, next: any) => next(),
    authorizeAny: () => (req: any, res: any, next: any) => next(),
    asyncHandler: (fn: any) => (req: any, res: any, next: any) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    },
  };
});

// Setup Express app
let app: express.Application;
let mockEventRepository: any;
let mockArcRepository: any;
let mockGraphScopedRepositories: any;

describe('Validate Routes', () => {
  beforeEach(() => {
    mockEventRepository = {
      findById: vi.fn().mockResolvedValue(null),
      findAll: vi.fn().mockResolvedValue([]),
    };

    mockArcRepository = {
      findById: vi.fn().mockResolvedValue(null),
      findAll: vi.fn().mockResolvedValue([]),
    };

    mockGraphScopedRepositories = vi.fn().mockResolvedValue({
      eventRepository: mockEventRepository,
      arcRepository: mockArcRepository,
    });

    // Create fresh app for each test
    app = express();
    app.use(express.json());
    app.use((req: Request, res, next) => {
      req.requestId = 'test-request-id';
      req.startTime = Date.now();
      req.container = {
        eventRepository: mockEventRepository,
        arcRepository: mockArcRepository,
        graphScopedRepositories: mockGraphScopedRepositories,
      } as any;
      next();
    });
    app.use('/api/validate', validateRoutes);
    app.use(errorHandler);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/validate/graph', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/api/validate/graph')
        .send({})
        .expect(401);

      expect(response.body.error.message).toBe('API key is required');
    });

    it('should validate empty graph as valid', async () => {
      const response = await request(app)
        .post('/api/validate/graph')
        .set('X-API-Key', 'valid-read-key')
        .send({})
        .expect(200);

      expect(response.body.valid).toBe(true);
      expect(response.body.errors.temporal).toEqual([]);
      expect(response.body.errors.causal).toEqual([]);
      expect(response.body.errors.referential).toEqual([]);
    });

    it('should validate events with valid timestamps', async () => {
      const response = await request(app)
        .post('/api/validate/graph')
        .set('X-API-Key', 'valid-read-key')
        .send({
          events: [
            { id: 'e1', description: 'Event 1', timestamp: '1914-06-28T00:00:00.000Z', actor: 'A', target: 'B' },
            { id: 'e2', description: 'Event 2', timestamp: '1914-07-28T00:00:00.000Z', actor: 'A', target: 'B' },
          ],
          checks: ['temporal'],
        })
        .expect(200);

      expect(response.body.valid).toBe(true);
    });

    it('should detect missing timestamp', async () => {
      const response = await request(app)
        .post('/api/validate/graph')
        .set('X-API-Key', 'valid-read-key')
        .send({
          events: [
            { id: 'e1', description: 'Event 1', actor: 'A', target: 'B' }, // Missing timestamp
          ],
          checks: ['temporal'],
        })
        .expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body.errors.temporal.length).toBeGreaterThan(0);
      expect(response.body.errors.temporal[0].message).toContain('missing timestamp');
    });

    it('should detect invalid timestamp format', async () => {
      const response = await request(app)
        .post('/api/validate/graph')
        .set('X-API-Key', 'valid-read-key')
        .send({
          events: [
            { id: 'e1', description: 'Event 1', timestamp: 'not-a-date', actor: 'A', target: 'B' },
          ],
          checks: ['temporal'],
        })
        .expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body.errors.temporal[0].message).toContain('Invalid timestamp');
    });

    it('should detect arc with end before start', async () => {
      const response = await request(app)
        .post('/api/validate/graph')
        .set('X-API-Key', 'valid-read-key')
        .send({
          arcs: [
            { 
              id: 'a1', 
              name: 'Arc 1', 
              start_time: '1914-12-31T00:00:00.000Z', 
              end_time: '1914-01-01T00:00:00.000Z', // End before start
              level: 0 
            },
          ],
          checks: ['temporal'],
        })
        .expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body.errors.temporal[0].message).toContain('start_time must be before end_time');
    });

    it('should detect causal self-reference', async () => {
      const response = await request(app)
        .post('/api/validate/graph')
        .set('X-API-Key', 'valid-read-key')
        .send({
          events: [
            { id: 'e1', description: 'Event 1', timestamp: '1914-06-28T00:00:00.000Z', actor: 'A', target: 'B' },
          ],
          relationships: [
            { cause_event_id: 'e1', effect_event_id: 'e1' },
          ],
          checks: ['causal'],
        })
        .expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body.errors.causal[0].message).toContain('cannot cause itself');
    });

    it('should detect cause after effect', async () => {
      const response = await request(app)
        .post('/api/validate/graph')
        .set('X-API-Key', 'valid-read-key')
        .send({
          events: [
            { id: 'e1', description: 'Event 1', timestamp: '1914-07-28T00:00:00.000Z', actor: 'A', target: 'B' },
            { id: 'e2', description: 'Event 2', timestamp: '1914-06-28T00:00:00.000Z', actor: 'A', target: 'B' },
          ],
          relationships: [
            { cause_event_id: 'e1', effect_event_id: 'e2' }, // Cause after effect
          ],
          checks: ['causal'],
        })
        .expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body.errors.causal[0].message).toContain('must occur before');
    });

    it('should detect missing referenced events', async () => {
      const response = await request(app)
        .post('/api/validate/graph')
        .set('X-API-Key', 'valid-read-key')
        .send({
          events: [],
          relationships: [
            { cause_event_id: 'missing1', effect_event_id: 'missing2' },
          ],
          checks: ['referential'],
        })
        .expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body.errors.referential.length).toBe(2);
    });

    it('should add warnings for missing structure', async () => {
      const response = await request(app)
        .post('/api/validate/graph')
        .set('X-API-Key', 'valid-read-key')
        .send({
          events: [
            { id: 'e1', description: 'Event 1', timestamp: '1914-06-28T00:00:00.000Z', actor: 'A', target: 'B' },
          ],
          arcs: [],
        })
        .expect(200);

      expect(response.body.warnings.length).toBeGreaterThan(0);
      expect(response.body.warnings[0].message).toContain('No arcs defined');
    });
  });

  describe('POST /api/validate/incremental', () => {
    it('reads existing entities from the graph resolved by context', async () => {
      const response = await request(app)
        .post('/api/validate/incremental')
        .set('X-API-Key', 'valid-read-key')
        .set('X-Graph-Id', 'scoped-graph')
        .send({ additions: {} })
        .expect(200);

      expect(mockGraphScopedRepositories).toHaveBeenCalledWith('scoped-graph');
      expect(response.body.valid).toBe(true);
    });

    it('should validate empty additions', async () => {
      const response = await request(app)
        .post('/api/validate/incremental')
        .set('X-API-Key', 'valid-read-key')
        .send({})
        .expect(200);

      expect(response.body.valid).toBe(true);
      expect(response.body.wouldCreate.events).toBe(0);
    });

    it('should count additions', async () => {
      const response = await request(app)
        .post('/api/validate/incremental')
        .set('X-API-Key', 'valid-read-key')
        .send({
          additions: {
            events: [
              { id: 'new-evt', description: 'New Event', timestamp: '1914-06-28T00:00:00.000Z', actor: 'A', target: 'B' },
            ],
            arcs: [
              { id: 'new-arc', name: 'New Arc', start_time: '1914-01-01T00:00:00.000Z', end_time: '1914-12-31T00:00:00.000Z', level: 0 },
            ],
          },
        })
        .expect(200);

      expect(mockGraphScopedRepositories).toHaveBeenCalledWith('test-graph');
      expect(response.body.wouldCreate.events).toBe(1);
      expect(response.body.wouldCreate.arcs).toBe(1);
    });

    it('should detect invalid timestamp in additions', async () => {
      const response = await request(app)
        .post('/api/validate/incremental')
        .set('X-API-Key', 'valid-read-key')
        .send({
          additions: {
            events: [
              { id: 'bad-evt', description: 'Bad Event', timestamp: 'invalid-date', actor: 'A', target: 'B' },
            ],
          },
        })
        .expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body.conflicts[0].type).toBe('invalid_data');
    });
  });
});
