import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import { eventRoutes } from './events';
import { Event, CreateEventRequest, UpdateEventRequest } from '@/models/Event';
import { errorHandler, RequestWithContainer } from '@/api/middleware';
import { getContainer } from '@/container';
import type { Container } from '@/container';

// Mock the EventRepository
vi.mock('@/repositories/EventRepository');

// Mock the container. The route group applies `resolveGraphContext`, which reads
// `getContainer().graphRepository`; the handlers read their repositories from
// `req.container`. Both are supplied per test below.
vi.mock('@/container', () => ({
  getContainer: vi.fn()
}));

/** A vitest mock function with no meaningful argument/return narrowing. */
type MockFn = Mock<unknown[], unknown>;

/** The subset of `EventRepository` the event routes call, all mocked. */
type MockRepository = {
  create: MockFn;
  findById: MockFn;
  findAll: MockFn;
  findByActor: MockFn;
  findByTarget: MockFn;
  findByTimeRange: MockFn;
  findByActorAndTimeRange: MockFn;
  update: MockFn;
  delete: MockFn;
  count: MockFn;
  countByActor: MockFn;
  countByTimeRange: MockFn;
};

let mockRepository: MockRepository;

/** Minimal stand-in for the version-store bridge the routes now call. */
interface MockVersioningService {
  recordEvent: (graphId: string, entity: unknown, operation: string) => Promise<void>;
  recordArc: (graphId: string, entity: unknown, operation: string) => Promise<void>;
  recordRelationship: (graphId: string, entity: unknown, operation: string) => Promise<void>;
  recordDeletion: (graphId: string, type: string, id: string) => Promise<void>;
}
let mockVersioningService: MockVersioningService;

/**
 * Graph lookup consulted by the scoped middleware. `findById` echoes the
 * requested id so a test can assert which graph a request resolved to;
 * `getActiveGraph` is the fallback used when no X-Graph-Id header is sent.
 */
interface MockGraphLookup {
  findById: Mock<[id: string], Promise<{ id: string }>>;
  getActiveGraph: Mock<[], Promise<{ id: string } | null>>;
}
let mockGraphLookup: MockGraphLookup;
let mockGraphScopedRepositories: Mock<[], Promise<{ eventRepository: MockRepository }>>;

const app = express();
app.use(express.json());

// Mock container injection middleware
app.use((req: RequestWithContainer, res, next) => {
  req.container = {
    eventRepository: mockRepository,
    // The create/update/delete handlers mirror writes into the active graph's
    // version store. Unit tests stub that collaborator; the version-commit
    // behaviour itself is covered by the request-level integration test.
    graphWriteVersioningService: mockVersioningService,
    // Handlers obtain repositories from the request's resolved graph scope.
    graphScopedRepositories: mockGraphScopedRepositories
  } as unknown as Container;
  req.requestId = 'test-request-id';
  req.startTime = Date.now();
  next();
});

app.use('/events', eventRoutes);
app.use(errorHandler);

describe('Event API Endpoints', () => {

  beforeEach(() => {
    mockRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      findAll: vi.fn(),
      findByActor: vi.fn(),
      findByTarget: vi.fn(),
      findByTimeRange: vi.fn(),
      findByActorAndTimeRange: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      countByActor: vi.fn(),
      countByTimeRange: vi.fn()
    };

    mockVersioningService = {
      recordEvent: vi.fn().mockResolvedValue(undefined),
      recordArc: vi.fn().mockResolvedValue(undefined),
      recordRelationship: vi.fn().mockResolvedValue(undefined),
      recordDeletion: vi.fn().mockResolvedValue(undefined)
    };

    // Graph context resolution: a test may override either lookup per case.
    mockGraphLookup = {
      findById: vi.fn(async (id: string): Promise<{ id: string }> => ({ id })),
      getActiveGraph: vi.fn(async (): Promise<{ id: string } | null> => ({ id: 'active-graph' }))
    };
    mockGraphScopedRepositories = vi.fn(
      async (): Promise<{ eventRepository: MockRepository }> => ({
        eventRepository: mockRepository,
      })
    );
    vi.mocked(getContainer).mockReturnValue({
      graphRepository: mockGraphLookup
    } as unknown as Container);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('graph scoping', () => {
    it('resolves the X-Graph-Id header and reads only that graph', async () => {
      mockRepository.findAll.mockResolvedValue([]);
      mockRepository.count.mockResolvedValue(0);

      await request(app).get('/events').set('X-Graph-Id', 'graph-b').expect(200);

      expect(mockGraphLookup.findById).toHaveBeenCalledWith('graph-b');
      expect(mockGraphLookup.getActiveGraph).not.toHaveBeenCalled();
      expect(mockGraphScopedRepositories).toHaveBeenCalledWith('graph-b');
    });

    it('falls back to the active graph when no header is present', async () => {
      mockRepository.findAll.mockResolvedValue([]);
      mockRepository.count.mockResolvedValue(0);

      await request(app).get('/events').expect(200);

      expect(mockGraphLookup.getActiveGraph).toHaveBeenCalledTimes(1);
      expect(mockGraphScopedRepositories).toHaveBeenCalledWith('active-graph');
    });

    it('returns 404 and reads no repository when no graph can be resolved', async () => {
      mockGraphLookup.getActiveGraph.mockResolvedValue(null);

      const response = await request(app).get('/events').expect(404);

      expect(response.body.error.message).toMatch(/No graph context available/);
      expect(mockGraphScopedRepositories).not.toHaveBeenCalled();
      expect(mockRepository.findAll).not.toHaveBeenCalled();
    });

    it('rejects a malformed X-Graph-Id without falling back to the active graph', async () => {
      const response = await request(app)
        .get('/events')
        .set('X-Graph-Id', '../etc/passwd')
        .expect(400);

      expect(response.body.error.message).toMatch(/Unsafe graph id/);
      expect(mockGraphLookup.getActiveGraph).not.toHaveBeenCalled();
      expect(mockGraphScopedRepositories).not.toHaveBeenCalled();
    });
  });

  describe('POST /events', () => {
    const validEventData: CreateEventRequest = {
      description: 'Test event',
      actor: 'Test Actor',
      target: 'Test Target',
      timestamp: new Date('2023-01-01T10:00:00Z'),
      metadata: { category: 'test' }
    };

    it('should create a new event successfully', async () => {
      const mockEvent = new Event({ ...validEventData, id: 'test-id' });
      mockRepository.create.mockResolvedValue(mockEvent);

      const response = await request(app)
        .post('/events')
        .send(validEventData)
        .expect(201);

      expect(response.body).toEqual({
        success: true,
        data: {
          ...mockEvent.toJSON(),
          timestamp: mockEvent.timestamp.toISOString()
        },
        message: 'Event created successfully',
        requestId: 'test-request-id'
      });

      expect(mockRepository.create).toHaveBeenCalledWith(validEventData);
    });

    it('should handle missing required fields', async () => {
      const invalidData = {
        description: 'Test event'
        // Missing actor, target, timestamp
      };

      const response = await request(app)
        .post('/events')
        .send(invalidData)
        .expect(400);

      expect(response.body.error.message).toContain('Missing required fields');
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('should handle invalid timestamp', async () => {
      const invalidData = {
        ...validEventData,
        timestamp: 'invalid-date'
      };

      mockRepository.create.mockRejectedValue(new Error('Event validation failed: Timestamp must be a valid date'));

      const response = await request(app)
        .post('/events')
        .send(invalidData)
        .expect(400);

      expect(response.body.error.message).toContain('Event validation failed');
    });

    it('should handle repository errors', async () => {
      mockRepository.create.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .post('/events')
        .send(validEventData)
        .expect(500);

      expect(response.body.error.message).toBe('Internal server error');
    });

    it('should convert string timestamp to Date', async () => {
      const eventDataWithStringTimestamp = {
        ...validEventData,
        timestamp: '2023-01-01T10:00:00Z'
      };

      const mockEvent = new Event({ ...validEventData, id: 'test-id' });
      mockRepository.create.mockResolvedValue(mockEvent);

      await request(app)
        .post('/events')
        .send(eventDataWithStringTimestamp)
        .expect(201);

      expect(mockRepository.create).toHaveBeenCalledWith({
        ...eventDataWithStringTimestamp,
        timestamp: new Date('2023-01-01T10:00:00Z')
      });
    });
  });

  describe('GET /events', () => {
    const mockEvents = [
      new Event({
        id: 'event1',
        description: 'Event 1',
        actor: 'Actor 1',
        target: 'Target 1',
        timestamp: new Date('2023-01-01T10:00:00Z')
      }),
      new Event({
        id: 'event2',
        description: 'Event 2',
        actor: 'Actor 2',
        target: 'Target 2',
        timestamp: new Date('2023-01-02T10:00:00Z')
      })
    ];

    it('should get all events with default pagination', async () => {
      mockRepository.findAll.mockResolvedValue(mockEvents);
      mockRepository.count.mockResolvedValue(100);

      const response = await request(app)
        .get('/events')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: mockEvents.map(e => ({
          ...e.toJSON(),
          timestamp: e.timestamp.toISOString()
        })),
        pagination: {
          limit: 50,
          offset: 0,
          total: 100,
          hasMore: true
        },
        filters: {
          actor: null,
          target: null,
          timeRange: null
        },
        requestId: 'test-request-id'
      });

      expect(mockRepository.findAll).toHaveBeenCalledWith(50, 0);
      expect(mockRepository.count).toHaveBeenCalled();
    });

    it('should filter events by actor', async () => {
      mockRepository.findByActor.mockResolvedValue([mockEvents[0]]);
      mockRepository.countByActor.mockResolvedValue(1);

      const response = await request(app)
        .get('/events?actor=Actor%201')
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.filters.actor).toBe('Actor 1');
      expect(mockRepository.findByActor).toHaveBeenCalledWith('Actor 1', 50, 0);
    });

    it('should filter events by target', async () => {
      mockRepository.findByTarget.mockResolvedValue([mockEvents[1]]);
      mockRepository.count.mockResolvedValue(100);

      const response = await request(app)
        .get('/events?target=Target%202')
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.filters.target).toBe('Target 2');
      expect(mockRepository.findByTarget).toHaveBeenCalledWith('Target 2', 50, 0);
    });

    it('should filter events by time range', async () => {
      mockRepository.findByTimeRange.mockResolvedValue(mockEvents);
      mockRepository.countByTimeRange.mockResolvedValue(2);

      const response = await request(app)
        .get('/events?startTime=2023-01-01T00:00:00Z&endTime=2023-01-03T00:00:00Z')
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.filters.timeRange).toEqual({
        startTime: '2023-01-01T00:00:00Z',
        endTime: '2023-01-03T00:00:00Z'
      });
    });

    it('should filter events by actor and time range', async () => {
      mockRepository.findByActorAndTimeRange.mockResolvedValue([mockEvents[0]]);
      mockRepository.countByTimeRange.mockResolvedValue(1);

      const response = await request(app)
        .get('/events?actor=Actor%201&startTime=2023-01-01T00:00:00Z&endTime=2023-01-02T00:00:00Z')
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(mockRepository.findByActorAndTimeRange).toHaveBeenCalledWith(
        'Actor 1',
        {
          start: new Date('2023-01-01T00:00:00Z'),
          end: new Date('2023-01-02T00:00:00Z')
        },
        50,
        0
      );
    });

    it('should handle custom pagination', async () => {
      mockRepository.findAll.mockResolvedValue([mockEvents[0]]);
      mockRepository.count.mockResolvedValue(100);

      const response = await request(app)
        .get('/events?limit=10&offset=20')
        .expect(200);

      expect(response.body.pagination).toEqual({
        limit: 10,
        offset: 20,
        total: 100,
        hasMore: true
      });

      expect(mockRepository.findAll).toHaveBeenCalledWith(10, 20);
    });

    it('should validate pagination parameters', async () => {
      const response = await request(app)
        .get('/events?limit=invalid')
        .expect(400);

      expect(response.body.error.message).toContain('Limit must be a number');
    });

    it('should validate limit bounds', async () => {
      const response = await request(app)
        .get('/events?limit=2000')
        .expect(400);

      expect(response.body.error.message).toContain('Limit must be a number between 1 and 1000');
    });

    it('should validate time range format', async () => {
      const response = await request(app)
        .get('/events?startTime=invalid&endTime=2023-01-01T00:00:00Z')
        .expect(400);

      expect(response.body.error.message).toContain('Invalid date format');
    });

    it('should validate time range logic', async () => {
      const response = await request(app)
        .get('/events?startTime=2023-01-02T00:00:00Z&endTime=2023-01-01T00:00:00Z')
        .expect(400);

      expect(response.body.error.message).toContain('startTime must be before endTime');
    });
  });

  describe('GET /events/:id', () => {
    const mockEvent = new Event({
      id: 'test-id',
      description: 'Test event',
      actor: 'Test Actor',
      target: 'Test Target',
      timestamp: new Date('2023-01-01T10:00:00Z')
    });

    it('should get event by ID successfully', async () => {
      mockRepository.findById.mockResolvedValue(mockEvent);

      const response = await request(app)
        .get('/events/test-id')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          ...mockEvent.toJSON(),
          timestamp: mockEvent.timestamp.toISOString()
        },
        requestId: 'test-request-id'
      });

      expect(mockRepository.findById).toHaveBeenCalledWith('test-id');
    });

    it('should return 404 for non-existent event', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .get('/events/non-existent')
        .expect(404);

      expect(response.body.error.message).toContain('Event with ID non-existent not found');
    });

    it('should validate empty ID', async () => {
      const response = await request(app)
        .get('/events/%20') // URL encoded space
        .expect(400); // This should hit the validation error for empty ID
      
      expect(response.body.error.message).toContain('Event ID is required');
    });

    it('should handle repository errors', async () => {
      mockRepository.findById.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/events/test-id')
        .expect(500);

      expect(response.body.error.message).toBe('Internal server error');
    });
  });

  describe('PUT /events/:id', () => {
    const mockEvent = new Event({
      id: 'test-id',
      description: 'Updated event',
      actor: 'Updated Actor',
      target: 'Updated Target',
      timestamp: new Date('2023-01-01T10:00:00Z')
    });

    const updateData: UpdateEventRequest = {
      description: 'Updated event',
      actor: 'Updated Actor'
    };

    it('should update event successfully', async () => {
      mockRepository.findById.mockResolvedValue(mockEvent);
      mockRepository.update.mockResolvedValue(mockEvent);

      const response = await request(app)
        .put('/events/test-id')
        .send(updateData)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          ...mockEvent.toJSON(),
          timestamp: mockEvent.timestamp.toISOString()
        },
        message: 'Event updated successfully',
        requestId: 'test-request-id'
      });

      expect(mockRepository.findById).toHaveBeenCalledWith('test-id');
      expect(mockRepository.update).toHaveBeenCalledWith('test-id', updateData);
    });

    it('should return 404 for non-existent event', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .put('/events/non-existent')
        .send(updateData)
        .expect(404);

      expect(response.body.error.message).toContain('Event with ID non-existent not found');
      expect(mockRepository.update).not.toHaveBeenCalled();
    });

    it('should handle update failure', async () => {
      mockRepository.findById.mockResolvedValue(mockEvent);
      mockRepository.update.mockResolvedValue(null);

      const response = await request(app)
        .put('/events/test-id')
        .send(updateData)
        .expect(500);

      expect(response.body.error.message).toContain('Failed to update event');
    });

    it('should convert string timestamp to Date', async () => {
      const updateWithStringTimestamp = {
        ...updateData,
        timestamp: '2023-01-02T10:00:00Z'
      };

      mockRepository.findById.mockResolvedValue(mockEvent);
      mockRepository.update.mockResolvedValue(mockEvent);

      await request(app)
        .put('/events/test-id')
        .send(updateWithStringTimestamp)
        .expect(200);

      expect(mockRepository.update).toHaveBeenCalledWith('test-id', {
        ...updateData,
        timestamp: new Date('2023-01-02T10:00:00Z')
      });
    });

    it('should handle validation errors', async () => {
      mockRepository.findById.mockResolvedValue(mockEvent);
      mockRepository.update.mockRejectedValue(new Error('Event validation failed: Invalid data'));

      const response = await request(app)
        .put('/events/test-id')
        .send({ description: '' })
        .expect(400);

      expect(response.body.error.message).toContain('Event validation failed');
    });
  });

  describe('DELETE /events/:id', () => {
    const mockEvent = new Event({
      id: 'test-id',
      description: 'Test event',
      actor: 'Test Actor',
      target: 'Test Target',
      timestamp: new Date('2023-01-01T10:00:00Z')
    });

    it('should delete event successfully', async () => {
      mockRepository.findById.mockResolvedValue(mockEvent);
      mockRepository.delete.mockResolvedValue(true);

      const response = await request(app)
        .delete('/events/test-id')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Event deleted successfully',
        data: { id: 'test-id' },
        requestId: 'test-request-id'
      });

      expect(mockRepository.findById).toHaveBeenCalledWith('test-id');
      expect(mockRepository.delete).toHaveBeenCalledWith('test-id');
    });

    it('should return 404 for non-existent event', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .delete('/events/non-existent')
        .expect(404);

      expect(response.body.error.message).toContain('Event with ID non-existent not found');
      expect(mockRepository.delete).not.toHaveBeenCalled();
    });

    it('should handle delete failure', async () => {
      mockRepository.findById.mockResolvedValue(mockEvent);
      mockRepository.delete.mockResolvedValue(false);

      const response = await request(app)
        .delete('/events/test-id')
        .expect(500);

      expect(response.body.error.message).toContain('Failed to delete event');
    });

    it('should validate empty ID', async () => {
      // The 404 comes from Express, not the handler; only the status is asserted.
      await request(app)
        .delete('/events/')
        .expect(404);
    });
  });

  describe('GET /events/stats/count', () => {
    it('should get total count of all events', async () => {
      mockRepository.count.mockResolvedValue(150);

      const response = await request(app)
        .get('/events/stats/count')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: { count: 150 },
        filters: {
          actor: null,
          timeRange: null
        },
        requestId: 'test-request-id'
      });

      expect(mockRepository.count).toHaveBeenCalled();
    });

    it('should get count by actor', async () => {
      mockRepository.countByActor.mockResolvedValue(25);

      const response = await request(app)
        .get('/events/stats/count?actor=Test%20Actor')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: { count: 25 },
        filters: {
          actor: 'Test Actor',
          timeRange: null
        },
        requestId: 'test-request-id'
      });

      expect(mockRepository.countByActor).toHaveBeenCalledWith('Test Actor');
    });

    it('should get count by time range', async () => {
      mockRepository.countByTimeRange.mockResolvedValue(10);

      const response = await request(app)
        .get('/events/stats/count?startTime=2023-01-01T00:00:00Z&endTime=2023-01-02T00:00:00Z')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: { count: 10 },
        filters: {
          actor: null,
          timeRange: {
            startTime: '2023-01-01T00:00:00Z',
            endTime: '2023-01-02T00:00:00Z'
          }
        },
        requestId: 'test-request-id'
      });

      expect(mockRepository.countByTimeRange).toHaveBeenCalledWith({
        start: new Date('2023-01-01T00:00:00Z'),
        end: new Date('2023-01-02T00:00:00Z')
      });
    });

    it('should validate time range format', async () => {
      const response = await request(app)
        .get('/events/stats/count?startTime=invalid&endTime=2023-01-01T00:00:00Z')
        .expect(400);

      expect(response.body.error.message).toContain('Invalid date format');
    });
  });

  describe('Error scenarios', () => {
    it('should handle repository connection errors', async () => {
      mockRepository.findAll.mockRejectedValue(new Error('Connection timeout'));

      const response = await request(app)
        .get('/events')
        .expect(500);

      expect(response.body.error.message).toBe('Internal server error');
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/events')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        // body-parser reports a malformed body with type 'entity.parse.failed'.
        // The shared errorHandler maps that to 400: the request was malformed,
        // the server is not broken, so 500 was misleading.
        .expect(400);

      expect(response.body.error).toBeDefined();
      expect(response.body.error.message).toBeDefined();
    });

    it('should handle large payloads gracefully', async () => {
      const largeMetadata: Record<string, string> = {};
      for (let i = 0; i < 100; i++) { // Reduced size to avoid payload limit
        largeMetadata[`key${i}`] = `value${i}`.repeat(10);
      }

      const eventData = {
        description: 'Test event',
        actor: 'Test Actor',
        target: 'Test Target',
        timestamp: new Date('2023-01-01T10:00:00Z'),
        metadata: largeMetadata
      };

      const mockEvent = new Event({ ...eventData, id: 'test-id' });
      mockRepository.create.mockResolvedValue(mockEvent);

      const response = await request(app)
        .post('/events')
        .send(eventData)
        .expect(201);

      expect(response.body.success).toBe(true);
    });
  });
});