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
        // One graph keeps a world calendar: its dates are read with it.
        graphRepository: {
          findById: async (id: string) =>
            id === 'vael'
              ? {
                  id,
                  calendar: {
                    version: 2,
                    dayLength: 86_400,
                    primary: 'reckoning',
                    calendars: [{ id: 'reckoning', name: 'the Reckoning', parts: [{ name: 'Thaw', days: 30 }], epoch: 0, eras: [{ label: 'AR', from: 1 }] }],
                  },
                }
              : { id },
        },
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
      expect(response.body.errors.causal[0].message).toContain('must not occur after');
    });

    it('should accept a cause and an effect at the same moment', async () => {
      // The rule the whole project uses: a cause may not follow its effect,
      // but it may happen at the same moment. The importer and the merge
      // accept such a pair, so this route has to accept it too.
      const response = await request(app)
        .post('/api/validate/graph')
        .set('X-API-Key', 'valid-read-key')
        .send({
          events: [
            { id: 'e1', description: 'Event 1', timestamp: '1914-07-28T00:00:00.000Z', actor: 'A', target: 'B' },
            { id: 'e2', description: 'Event 2', timestamp: '1914-07-28T00:00:00.000Z', actor: 'A', target: 'B' },
          ],
          relationships: [
            { cause_event_id: 'e1', effect_event_id: 'e2' },
          ],
          checks: ['causal'],
        })
        .expect(200);

      expect(response.body.errors.causal).toHaveLength(0);
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

  describe('order a second apart near 200 million years BCE, where a double holds no whole seconds', () => {
    // One double: getTime() calls them the same moment (docs/specs/deep-time.md, Req 3).
    const EARLIER = '-200000001-12-31T23:59:59.500Z';
    const LATER = '-200000000-01-01T00:00:00.500Z';
    const LAST = '-199999999-01-01T00:00:00.000Z';

    it('tells an arc a second long from one a second inside-out, and a child that starts a second before its parent', async () => {
      const arcs = [
        { id: 'parent', name: 'Parent', start_time: LATER, end_time: LAST, level: 0 },
        { id: 'child', name: 'Child', start_time: EARLIER, end_time: LAST, level: 1, parent_arc_id: 'parent' },
        { id: 'short', name: 'Short', start_time: EARLIER, end_time: LATER, level: 0 },
        { id: 'inverted', name: 'Inverted', start_time: LATER, end_time: EARLIER, level: 0 },
      ];
      const response = await request(app)
        .post('/api/validate/graph')
        .set('X-API-Key', 'valid-read-key')
        .send({ events: [], arcs, relationships: [], checks: ['temporal'] })
        .expect(200);
      const about = (id: string) =>
        response.body.errors.temporal.filter((error: { entityId: string }) => error.entityId === id).map((error: { message: string }) => error.message);
      expect(about('short')).toEqual([]);
      expect(about('parent')).toEqual([]);
      expect(about('inverted')).toEqual(['Arc start_time must be before end_time']);
      expect(about('child')).toEqual(['Arc must be contained within parent arc time range']);
    });

    it("checks an addition's arc a second long as in order, and one a second inside-out as not", async () => {
      const response = await request(app)
        .post('/api/validate/incremental')
        .set('X-API-Key', 'valid-read-key')
        .send({
          additions: {
            arcs: [
              { name: 'Short', start_time: EARLIER, end_time: LATER, level: 0 },
              { name: 'Inverted', start_time: LATER, end_time: EARLIER, level: 0 },
            ],
          },
        })
        .expect(200);
      expect(response.body.conflicts.map((conflict: { message: string }) => conflict.message)).toEqual(['start_time must be before end_time']);
    });

    it('does not call an arc with an unreadable end inside-out', async () => {
      const response = await request(app)
        .post('/api/validate/graph')
        .set('X-API-Key', 'valid-read-key')
        .send({ events: [], arcs: [{ id: 'bad', name: 'Bad', start_time: 'garbage', end_time: 'rubbish', level: 0 }], relationships: [], checks: ['temporal'] })
        .expect(200);
      const messages = response.body.errors.temporal.map((error: { message: string }) => error.message);
      expect(messages).not.toContain('Arc start_time must be before end_time');
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

    it("reads an addition's date as the event routes do, with the graph's calendars", async () => {
      const check = (graph: string, timestamp: string) =>
        request(app)
          .post('/api/validate/incremental')
          .set('X-API-Key', 'valid-read-key')
          .set('X-Graph-Id', graph)
          .send({ additions: { events: [{ description: 'x', actor: 'a', target: 'b', timestamp }] } })
          .expect(200);
      expect((await check('vael', 'Thaw 4, 312 AR')).body.conflicts).toEqual([]);
      for (const refused of ['1871', '1871-03', 'March 4, 1871']) {
        const response = await check('vael', refused);
        expect(response.body.conflicts.map((c: { type: string }) => c.type), refused).toContain('invalid_data');
      }
      // Without a world, year-first text is a date and "0" is none.
      expect((await check('plain', '312-03-04 14:30')).body.conflicts).toEqual([]);
      expect((await check('plain', '0')).body.conflicts.map((c: { type: string }) => c.type)).toContain('invalid_data');
    });

    it("checks an addition's arc times and takes dates given as fields, as the storing routes do", async () => {
      const send = (additions: unknown) =>
        request(app)
          .post('/api/validate/incremental')
          .set('X-API-Key', 'valid-read-key')
          .set('X-Graph-Id', 'vael')
          .send({ additions })
          .expect(200);
      const arc = (start_time: unknown, end_time: unknown) => ({ arcs: [{ name: 'A', level: 0, start_time, end_time }] });
      expect((await send(arc('Thaw 1, 312 AR', 'Thaw 312 AR'))).body.conflicts).toEqual([]);
      for (const [start, end] of [['1871-03', '1871-09'], ['garbage', {}], ['Thaw 312 AR', 'Thaw 4, 311 AR']] as const) {
        const response = await send(arc(start, end));
        expect(response.body.conflicts.map((c: { type: string }) => c.type), `${start} – ${JSON.stringify(end)}`).toContain('invalid_data');
      }
      const fields = await send({ events: [{ description: 'x', actor: 'a', target: 'b', timestamp: { year: 312, month: 'Thaw', day: 4 } }] });
      expect(fields.body.conflicts).toEqual([]);
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
