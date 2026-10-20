/**
 * Tests for suggestion routes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { Request } from 'express';
import { suggestRoutes } from './suggest';
import { errorHandler } from '@/api/middleware';
import { InferenceService } from '@/services/InferenceService';
import type {
  ArcClusterEvent,
  CausalRelationshipRef,
  CompletenessEvent,
} from '@/services/InferenceService';

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
    authorize: () => (req: any, res: any, next: any) => next(),
    asyncHandler: (fn: any) => (req: any, res: any, next: any) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    },
  };
});

// Setup Express app
let app: express.Application;
let mockEventRepository: any;
let mockCausalService: any;
let mockInferenceService: any;
let mockGraphScopedRepositories: any;

describe('Suggest Routes', () => {
  beforeEach(() => {
    mockEventRepository = {
      findById: vi.fn().mockResolvedValue(null),
      findAll: vi.fn().mockResolvedValue([]),
    };

    mockCausalService = {
      findCausalChain: vi.fn().mockResolvedValue([]),
    };

    // The arc and completeness algorithms live in InferenceService. The route
    // only wires the request to them, so the mock delegates to a real
    // instance and the HTTP assertions exercise the production behaviour.
    const realInferenceService = new InferenceService();

    mockInferenceService = {
      suggestCausalLinks: vi.fn().mockReturnValue([]),
      analyzeEventClusters: vi.fn().mockReturnValue([]),
      clusterEventsIntoArcs: vi.fn(
        (events: ArcClusterEvent[], temporalWindowDays: number, minClusterSize: number) =>
          realInferenceService.clusterEventsIntoArcs(events, temporalWindowDays, minClusterSize)
      ),
      analyzeCompleteness: vi.fn(
        (events: CompletenessEvent[], relationships: CausalRelationshipRef[]) =>
          realInferenceService.analyzeCompleteness(events, relationships)
      ),
    };

    // The route reads `causalService` from here. Without it the call throws
    // inside the route and the empty catch swallows it, so `relationships`
    // would always be empty and the route's relationship building would never
    // be exercised.
    mockGraphScopedRepositories = vi.fn().mockResolvedValue({
      eventRepository: mockEventRepository,
      causalService: mockCausalService,
    });

    // Create fresh app for each test
    app = express();
    app.use(express.json());
    app.use((req: Request, res, next) => {
      req.requestId = 'test-request-id';
      req.startTime = Date.now();
      req.container = {
        eventRepository: mockEventRepository,
        causalService: mockCausalService,
        inferenceService: mockInferenceService,
        graphScopedRepositories: mockGraphScopedRepositories,
      } as any;
      next();
    });
    app.use('/api/suggest', suggestRoutes);
    app.use(errorHandler);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/suggest/relationships', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/api/suggest/relationships')
        .send({})
        .expect(401);

      expect(response.body.error.message).toBe('API key is required');
    });

    it('should return empty for single event', async () => {
      const response = await request(app)
        .post('/api/suggest/relationships')
        .set('X-API-Key', 'valid-read-key')
        .send({
          events: [
            { id: 'e1', description: 'Event 1', actor: 'A', target: 'B', timestamp: '1914-06-28T00:00:00.000Z' },
          ],
        })
        .expect(200);

      expect(response.body.suggestions).toEqual([]);
    });

    it('should return suggestions for multiple events', async () => {
      mockInferenceService.suggestCausalLinks.mockReturnValue([
        {
          cause_event_id: 'e1',
          effect_event_id: 'e2',
          reasoning: 'Temporal proximity',
          suggested_relationship: {
            confidence: 0.7,
            relationship_type: 'direct',
          },
        },
      ]);

      const response = await request(app)
        .post('/api/suggest/relationships')
        .set('X-API-Key', 'valid-read-key')
        .send({
          events: [
            { id: 'e1', description: 'Event 1', actor: 'A', target: 'B', timestamp: '1914-06-28T00:00:00.000Z' },
            { id: 'e2', description: 'Event 2', actor: 'A', target: 'B', timestamp: '1914-07-28T00:00:00.000Z' },
          ],
        })
        .expect(200);

      expect(response.body.suggestions).toBeDefined();
      expect(response.body.suggestions.length).toBe(1);
    });

    it('should filter by minimum confidence', async () => {
      mockInferenceService.suggestCausalLinks.mockReturnValue([
        {
          cause_event_id: 'e1',
          effect_event_id: 'e2',
          reasoning: 'Low confidence',
          suggested_relationship: { confidence: 0.3, relationship_type: 'indirect' },
        },
        {
          cause_event_id: 'e2',
          effect_event_id: 'e3',
          reasoning: 'High confidence',
          suggested_relationship: { confidence: 0.9, relationship_type: 'direct' },
        },
      ]);

      const response = await request(app)
        .post('/api/suggest/relationships')
        .set('X-API-Key', 'valid-read-key')
        .send({
          events: [
            { id: 'e1', description: 'Event 1', actor: 'A', target: 'B', timestamp: '1914-06-28T00:00:00.000Z' },
            { id: 'e2', description: 'Event 2', actor: 'A', target: 'B', timestamp: '1914-07-28T00:00:00.000Z' },
            { id: 'e3', description: 'Event 3', actor: 'A', target: 'B', timestamp: '1914-08-28T00:00:00.000Z' },
          ],
          options: { minConfidence: 0.5 },
        })
        .expect(200);

      // Only the high confidence suggestion should pass
      expect(response.body.suggestions.length).toBe(1);
      expect(response.body.suggestions[0].confidence).toBe(0.9);
    });
  });

  describe('POST /api/suggest/arcs', () => {
    it('should return empty for few events', async () => {
      const response = await request(app)
        .post('/api/suggest/arcs')
        .set('X-API-Key', 'valid-read-key')
        .send({
          events: [
            { id: 'e1', description: 'Event 1', actor: 'A', target: 'B', timestamp: '1914-06-28T00:00:00.000Z' },
          ],
        })
        .expect(200);

      expect(response.body.suggestions).toEqual([]);
    });

    it('should suggest arcs for clustered events', async () => {
      // Create events clustered within 30 days
      const events = [];
      for (let i = 0; i < 5; i++) {
        const date = new Date('1914-06-15');
        date.setDate(date.getDate() + i * 5);
        events.push({
          id: `e${i}`,
          description: `Event ${i}`,
          actor: 'Actor',
          target: 'Target',
          timestamp: date.toISOString(),
        });
      }

      const response = await request(app)
        .post('/api/suggest/arcs')
        .set('X-API-Key', 'valid-read-key')
        .send({ events })
        .expect(200);

      expect(response.body.suggestions).toBeDefined();
      expect(Array.isArray(response.body.suggestions)).toBe(true);
    });

    it('should delegate the clustering to the inference service', async () => {
      const events = [];
      for (let i = 0; i < 5; i++) {
        const date = new Date('1914-06-15');
        date.setDate(date.getDate() + i * 5);
        events.push({
          id: `e${i}`,
          description: `Event ${i}`,
          actor: 'Actor',
          target: 'Target',
          timestamp: date.toISOString(),
        });
      }

      const response = await request(app)
        .post('/api/suggest/arcs')
        .set('X-API-Key', 'valid-read-key')
        // Deliberately not the defaults (30 days, 3 events): with the
        // defaults the assertion would pass even if the route ignored the
        // caller's options entirely.
        .send({ events, options: { minClusterSize: 4, temporalWindow: 'P10D' } })
        .expect(200);

      expect(mockInferenceService.clusterEventsIntoArcs).toHaveBeenCalledWith(
        expect.any(Array),
        10,
        4
      );
      // The HTTP body is the service result, unchanged.
      expect(response.body.suggestions).toHaveLength(1);
      expect(response.body.suggestions[0].eventIds).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
      expect(response.body.suggestions[0].name).toBe('Actor (20 days)');
    });

    it('should respect minimum cluster size', async () => {
      const response = await request(app)
        .post('/api/suggest/arcs')
        .set('X-API-Key', 'valid-read-key')
        .send({
          events: [
            { id: 'e1', description: 'Event 1', actor: 'A', target: 'B', timestamp: '1914-06-28T00:00:00.000Z' },
            { id: 'e2', description: 'Event 2', actor: 'A', target: 'B', timestamp: '1914-06-29T00:00:00.000Z' },
          ],
          options: { minClusterSize: 5 },
        })
        .expect(200);

      expect(response.body.suggestions).toEqual([]);
    });
  });

  describe('POST /api/suggest/completeness', () => {
    it('reads events from the graph resolved by context, not a body graphId', async () => {
      mockEventRepository.findAll.mockResolvedValue([
        { id: 'e1', description: 'Event 1', actor: 'A', target: 'B', timestamp: '1914-06-28T00:00:00.000Z' },
      ]);

      const response = await request(app)
        .post('/api/suggest/completeness')
        .set('X-API-Key', 'valid-read-key')
        .set('X-Graph-Id', 'scoped-graph')
        .send({})
        .expect(200);

      expect(mockGraphScopedRepositories).toHaveBeenCalledWith('scoped-graph');
      expect(response.body.gaps).toBeDefined();
    });

    it('should analyze empty graph', async () => {
      const response = await request(app)
        .post('/api/suggest/completeness')
        .set('X-API-Key', 'valid-read-key')
        .send({})
        .expect(200);

      expect(response.body.gaps).toBeDefined();
      expect(response.body.overallCompleteness).toBeDefined();
      expect(response.body.suggestions).toBeDefined();
      expect(response.body.suggestions[0]).toContain('No events found');
    });

    it('should analyze graph with events', async () => {
      mockEventRepository.findAll.mockResolvedValue([
        { id: 'e1', description: 'Event 1', actor: 'A', target: 'B', timestamp: '1914-06-28T00:00:00.000Z' },
        { id: 'e2', description: 'Event 2', actor: 'A', target: 'B', timestamp: '1914-07-28T00:00:00.000Z' },
      ]);

      const response = await request(app)
        .post('/api/suggest/completeness')
        .set('X-API-Key', 'valid-read-key')
        .send({})
        .expect(200);

      expect(mockGraphScopedRepositories).toHaveBeenCalledWith('test-graph');
      expect(response.body.overallCompleteness).toBeGreaterThan(0);
      expect(response.body.gaps.temporalGaps).toBeDefined();
      expect(response.body.gaps.actorGaps).toBeDefined();
      expect(response.body.gaps.causalGaps).toBeDefined();
    });

    it('should pass the causal relationships it builds to the service', async () => {
      // The route builds `relationships` from the causal chains it finds. A
      // regression there (swapped cause and effect, a dropped push) has to be
      // visible, which it is not when the causal service is missing from the
      // mock and every call throws into the route's empty catch.
      mockCausalService.findCausalChain.mockResolvedValue([
        { events: ['e0', 'e1'] } as never,
      ]);
      mockEventRepository.findAll.mockResolvedValue([
        {
          id: 'e0',
          description: 'First',
          actor: 'A',
          target: 'B',
          timestamp: '2024-01-01T00:00:00Z',
        },
      ]);

      const response = await request(app)
        .post('/api/suggest/completeness')
        .set('X-API-Key', 'valid-read-key')
        .send({})
        .expect(200);

      expect(mockInferenceService.analyzeCompleteness).toHaveBeenCalledWith(
        expect.any(Array),
        [{ cause_event_id: 'e0', effect_event_id: 'e1' }]
      );
      expect(response.body.overallCompleteness).toBeDefined();
    });

    it('should delegate the completeness analysis to the inference service', async () => {
      mockEventRepository.findAll.mockResolvedValue([
        { id: 'e1', description: 'Event 1', actor: 'A', target: 'B', timestamp: '1914-06-28T00:00:00.000Z' },
        { id: 'e2', description: 'Event 2', actor: 'A', target: 'B', timestamp: '1914-07-28T00:00:00.000Z' },
      ]);

      const response = await request(app)
        .post('/api/suggest/completeness')
        .set('X-API-Key', 'valid-read-key')
        .send({})
        .expect(200);

      expect(mockInferenceService.analyzeCompleteness).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array)
      );
      // The HTTP body is the service result, unchanged.
      expect(response.body.gaps).toBeDefined();
      expect(response.body.suggestions).toContain(
        'No causal relationships defined. Add relationships between events to show cause and effect.'
      );
    });
  });

  describe('POST /api/suggest/pressures', () => {
    it('should return empty for few events', async () => {
      const response = await request(app)
        .post('/api/suggest/pressures')
        .set('X-API-Key', 'valid-read-key')
        .send({
          events: [
            { id: 'e1', description: 'Event 1', actor: 'A', target: 'B', timestamp: '1914-06-28T00:00:00.000Z' },
          ],
        })
        .expect(200);

      expect(response.body.pressures).toEqual([]);
    });

    it('should analyze pressures for multiple events', async () => {
      mockInferenceService.analyzeEventClusters.mockReturnValue([
        {
          description: 'Economic pressure',
          confidence_score: 0.8,
          pressure_type: 'economic',
          evidence: ['Trade sanctions', 'Embargo'],
        },
      ]);

      const response = await request(app)
        .post('/api/suggest/pressures')
        .set('X-API-Key', 'valid-read-key')
        .send({
          events: [
            { id: 'e1', description: 'Sanctions', actor: 'A', target: 'B', timestamp: '1914-06-01T00:00:00.000Z' },
            { id: 'e2', description: 'Embargo', actor: 'A', target: 'B', timestamp: '1914-06-15T00:00:00.000Z' },
            { id: 'e3', description: 'Crisis', actor: 'B', target: 'Economy', timestamp: '1914-06-28T00:00:00.000Z' },
          ],
        })
        .expect(200);

      expect(response.body.pressures).toBeDefined();
      expect(response.body.pressures.length).toBe(1);
      expect(response.body.pressures[0].pressure_type).toBe('economic');
    });
  });
});
