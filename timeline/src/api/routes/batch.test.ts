/**
 * Tests for batch operation routes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { batchRoutes } from './batch';
import { errorHandler, AuthenticatedRequest } from '@/api/middleware';
import { ApiKey, Permission, PERMISSION_GROUPS } from '@/models/ApiKey';
import { Event } from '@/models/Event';
import { Arc } from '@/models/Arc';

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
    asyncHandler: (fn: any) => (req: any, res: any, next: any) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    },
  };
});

// Setup Express app
let app: express.Application;
let mockEventRepository: any;
let mockArcRepository: any;
let mockCausalService: any;

describe('Batch Routes', () => {
  beforeEach(() => {
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

    mockCausalService = {
      createCausalLink: vi.fn().mockResolvedValue({}),
    };

    // Create fresh app for each test
    app = express();
    app.use(express.json());
    app.use((req: AuthenticatedRequest, res, next) => {
      req.requestId = 'test-request-id';
      req.startTime = Date.now();
      req.container = {
        eventRepository: mockEventRepository,
        arcRepository: mockArcRepository,
        causalService: mockCausalService,
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
        .send({ events: [{ description: 'Test' }] })
        .expect(400);

      expect(response.body.error.message).toBe('graphId is required');
    });

    it('should require non-empty events array', async () => {
      const response = await request(app)
        .post('/api/batch/events')
        .set('X-API-Key', 'valid-write-key')
        .send({ graphId: 'test', events: [] })
        .expect(400);

      expect(response.body.error.message).toBe('events array cannot be empty');
    });

    it('should batch create events', async () => {
      const response = await request(app)
        .post('/api/batch/events')
        .set('X-API-Key', 'valid-write-key')
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

    it('should abort on validation error with strict mode', async () => {
      const response = await request(app)
        .post('/api/batch/events')
        .set('X-API-Key', 'valid-write-key')
        .send({
          graphId: 'test-graph',
          validation: 'strict',
          events: [
            { description: 'Valid', actor: 'Actor', target: 'Target', timestamp: '1914-06-28T00:00:00.000Z' },
            { description: '', actor: 'Actor', target: 'Target', timestamp: '1914-07-28T00:00:00.000Z' }, // Invalid
          ],
        })
        .expect(400);

      expect(response.body.error.message).toContain('Batch aborted');
    });
  });

  describe('POST /api/batch/arcs', () => {
    it('should batch create arcs', async () => {
      const response = await request(app)
        .post('/api/batch/arcs')
        .set('X-API-Key', 'valid-write-key')
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
        .send({
          graphId: 'test-graph',
          relationships: [
            { cause_event_id: 'evt-1', effect_event_id: 'evt-2' },
          ],
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(mockCausalService.createCausalLink).toHaveBeenCalled();
    });

    it('should fail for non-existent events', async () => {
      mockEventRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/batch/relationships')
        .set('X-API-Key', 'valid-write-key')
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
});
