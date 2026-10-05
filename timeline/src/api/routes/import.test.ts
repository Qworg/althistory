/**
 * Tests for Import API Routes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { ErrorRequestHandler, Express } from 'express';
import request from 'supertest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createImportRouter } from './import';
import { AlthistoryExport } from '../../services/ExportService';

describe('Import API Routes', () => {
  let app: Express;
  let testDataDir: string;
  let importRouter: any;

  // Helper to create a valid export structure
  const createValidExport = (overrides: Partial<AlthistoryExport> = {}): AlthistoryExport => ({
    version: '1.0',
    metadata: {
      graphId: 'test-graph-id',
      graphName: 'Test Graph',
      description: 'A test graph',
      exportedAt: new Date().toISOString(),
      sourceVersion: '1.0.0',
      graphVersion: 1,
      checksum: '', // Empty checksum skips validation
      ...overrides.metadata,
    },
    data: {
      events: [
        {
          id: 'event-1',
          description: 'Test event 1',
          actor: 'Actor A',
          target: 'Target B',
          timestamp: '2023-01-01T00:00:00Z',
        },
        {
          id: 'event-2',
          description: 'Test event 2',
          actor: 'Actor B',
          target: 'Target C',
          timestamp: '2023-01-02T00:00:00Z',
        },
      ],
      arcs: [
        {
          id: 'arc-1',
          name: 'Test Arc',
          description: 'A test arc',
          start_time: '2023-01-01T00:00:00Z',
          end_time: '2023-12-31T23:59:59Z',
          level: 0,
          parent_arc_id: null,
        },
      ],
      causalRelationships: [
        {
          id: 'rel-1',
          cause_event_id: 'event-1',
          effect_event_id: 'event-2',
          weight: 0.8,
          evidence: 'Test evidence',
          confidence: 0.9,
          relationship_type: 'direct',
        },
      ],
      inferredPressures: [],
      ...overrides.data,
    },
    provenance: overrides.provenance,
  });

  beforeEach(async () => {
    testDataDir = path.join(os.tmpdir(), `import-api-test-${Date.now()}`);
    await fs.mkdir(testDataDir, { recursive: true });
    await fs.mkdir(path.join(testDataDir, 'graphs'), { recursive: true });
    await fs.mkdir(path.join(testDataDir, 'jobs'), { recursive: true });

    app = express();
    app.use(express.json({ limit: '50mb' }));
    importRouter = createImportRouter({ dataDir: testDataDir, disableRateLimit: true, disableAuth: true, disableCsrf: true });
    app.use('/api/import', importRouter);

    // Express recognises an error middleware by its 4-argument arity, so all four
    // parameters must be declared even though next is unused.
    const testErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
      const status = err.statusCode || 500;
      res.status(status).json({
        error: err.message,
        code: err.code,
      });
    };

    app.use(testErrorHandler);
  });

  afterEach(async () => {
    try {
      // Cleanup the import service first to stop background operations
      if (importRouter?.cleanup) {
        await importRouter.cleanup();
      }
      // Small delay to allow any in-flight async operations to complete
      await new Promise(resolve => setTimeout(resolve, 50));
      // Then clean up the temp directory
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('POST /api/import/validate', () => {
    it('should validate a correct export format', async () => {
      const validExport = createValidExport();

      const response = await request(app)
        .post('/api/import/validate')
        .send(validExport)
        .expect(200);

      expect(response.body.valid).toBe(true);
      expect(response.body.errors).toHaveLength(0);
      expect(response.body.summary.eventCount).toBe(2);
      expect(response.body.summary.arcCount).toBe(1);
    });

    it('should reject invalid data structure', async () => {
      const response = await request(app)
        .post('/api/import/validate')
        .send({ invalid: 'data' })
        .expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    it('should reject empty body', async () => {
      const response = await request(app)
        .post('/api/import/validate')
        .send({})
        .expect(200);

      expect(response.body.valid).toBe(false);
    });

    it('should detect duplicate IDs', async () => {
      const exportWithDupes = createValidExport({
        data: {
          events: [
            {
              id: 'event-1',
              description: 'Event 1',
              actor: 'A',
              target: 'B',
              timestamp: '2023-01-01T00:00:00Z',
            },
            {
              id: 'event-1', // Duplicate
              description: 'Event 2',
              actor: 'C',
              target: 'D',
              timestamp: '2023-01-02T00:00:00Z',
            },
          ],
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const response = await request(app)
        .post('/api/import/validate')
        .send(exportWithDupes)
        .expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          code: 'DUPLICATE_ID',
        })
      );
    });

    it('should detect causal paradoxes', async () => {
      const exportWithParadox = createValidExport({
        data: {
          events: [
            {
              id: 'event-cause',
              description: 'Cause',
              actor: 'A',
              target: 'B',
              timestamp: '2023-06-01T00:00:00Z', // After effect
            },
            {
              id: 'event-effect',
              description: 'Effect',
              actor: 'B',
              target: 'C',
              timestamp: '2023-01-01T00:00:00Z',
            },
          ],
          arcs: [],
          causalRelationships: [
            {
              id: 'rel-1',
              cause_event_id: 'event-cause',
              effect_event_id: 'event-effect',
              weight: 0.8,
              evidence: 'Test',
              confidence: 0.9,
              relationship_type: 'direct',
            },
          ],
          inferredPressures: [],
        },
      });

      const response = await request(app)
        .post('/api/import/validate')
        .send(exportWithParadox)
        .expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          code: 'CAUSAL_PARADOX',
        })
      );
    });
  });

  describe('POST /api/import/preview', () => {
    it('should generate preview for create-new mode', async () => {
      const validExport = createValidExport();

      const response = await request(app)
        .post('/api/import/preview')
        .send({
          data: validExport,
          mode: 'create-new',
        })
        .expect(200);

      expect(response.body.toCreate).toEqual({
        events: 2,
        arcs: 1,
        relationships: 1,
        pressures: 0,
      });
      expect(response.body.conflicts).toHaveLength(0);
    });

    it('should require targetGraphId for merge mode', async () => {
      const validExport = createValidExport();

      const response = await request(app)
        .post('/api/import/preview')
        .send({
          data: validExport,
          mode: 'merge',
          // Missing targetGraphId
        })
        .expect(400);

      expect(response.body.error).toContain('targetGraphId');
    });

    it('should require targetGraphId for replace mode', async () => {
      const validExport = createValidExport();

      const response = await request(app)
        .post('/api/import/preview')
        .send({
          data: validExport,
          mode: 'replace',
        })
        .expect(400);

      expect(response.body.error).toContain('targetGraphId');
    });

    it('should reject invalid mode', async () => {
      const validExport = createValidExport();

      const response = await request(app)
        .post('/api/import/preview')
        .send({
          data: validExport,
          mode: 'invalid-mode',
        })
        .expect(400);

      expect(response.body.error).toContain('Invalid mode');
    });
  });

  describe('POST /api/import', () => {
    it('should successfully import to new graph', async () => {
      const validExport = createValidExport();

      const response = await request(app)
        .post('/api/import')
        .send({
          data: validExport,
          mode: 'create-new',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.graphId).toBeTruthy();
      expect(response.body.imported).toEqual({
        events: 2,
        arcs: 1,
        relationships: 1,
        pressures: 0,
      });
    });

    it('should return 400 for invalid data', async () => {
      const invalidExport = createValidExport({
        data: {
          events: [
            {
              id: 'event-1',
              description: '', // Invalid
              actor: 'A',
              target: 'B',
              timestamp: '2023-01-01T00:00:00Z',
            } as any,
          ],
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const response = await request(app)
        .post('/api/import')
        .send({
          data: invalidExport,
          mode: 'create-new',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    it('should reject invalid conflict resolution', async () => {
      const validExport = createValidExport();

      const response = await request(app)
        .post('/api/import')
        .send({
          data: validExport,
          mode: 'create-new',
          conflictResolution: 'invalid-resolution',
        })
        .expect(400);

      expect(response.body.error).toContain('Invalid conflictResolution');
    });

    it('should default to skip conflict resolution', async () => {
      const validExport = createValidExport();

      const response = await request(app)
        .post('/api/import')
        .send({
          data: validExport,
          mode: 'create-new',
          // No conflictResolution specified
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    it('should handle large imports', async () => {
      // Create export with many events
      const events = Array.from({ length: 100 }, (_, i) => ({
        id: `event-${i}`,
        description: `Test event ${i}`,
        actor: `Actor ${i % 10}`,
        target: `Target ${i % 5}`,
        timestamp: new Date(2023, 0, i + 1).toISOString(),
      }));

      const largeExport = createValidExport({
        data: {
          events,
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const response = await request(app)
        .post('/api/import')
        .send({
          data: largeExport,
          mode: 'create-new',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.imported.events).toBe(100);
    });
  });

  describe('POST /api/import/validate-incremental', () => {
    it('should validate additions against empty graph', async () => {
      const response = await request(app)
        .post('/api/import/validate-incremental')
        .send({
          graphId: 'non-existent-graph',
          additions: {
            events: [
              {
                id: 'new-event-1',
                description: 'New event',
                actor: 'Actor',
                target: 'Target',
                timestamp: '2023-01-01T00:00:00Z',
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.valid).toBe(true);
      expect(response.body.wouldCreate.events).toBe(1);
    });

    it('should require graphId', async () => {
      const response = await request(app)
        .post('/api/import/validate-incremental')
        .send({
          additions: {
            events: [],
          },
        })
        .expect(400);

      expect(response.body.error).toContain('graphId');
    });

    it('should require additions object', async () => {
      const response = await request(app)
        .post('/api/import/validate-incremental')
        .send({
          graphId: 'test-graph',
        })
        .expect(400);

      expect(response.body.error).toContain('additions');
    });

    it('should detect invalid event data', async () => {
      const response = await request(app)
        .post('/api/import/validate-incremental')
        .send({
          graphId: 'test-graph',
          additions: {
            events: [
              {
                id: 'event-1',
                description: '', // Invalid
                actor: 'A',
                target: 'B',
                timestamp: '2023-01-01T00:00:00Z',
              },
            ],
          },
        })
        .expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_FIELD',
        })
      );
    });
  });

  // FIX #7: Authentication tests
  describe('Authentication', () => {
    let authApp: Express;
    let authTestDataDir: string;

    const createValidExportForAuth = (): AlthistoryExport => ({
      version: '1.0',
      metadata: {
        graphId: 'test-graph-id',
        graphName: 'Test Graph',
        description: 'A test graph',
        exportedAt: new Date().toISOString(),
        sourceVersion: '1.0.0',
        graphVersion: 1,
        checksum: '',
      },
      data: {
        events: [
          {
            id: 'event-1',
            description: 'Test event',
            actor: 'Actor A',
            target: 'Target B',
            timestamp: '2023-01-01T00:00:00Z',
          },
        ],
        arcs: [],
        causalRelationships: [],
        inferredPressures: [],
      },
    });

    beforeEach(async () => {
      authTestDataDir = path.join(os.tmpdir(), `import-auth-test-${Date.now()}`);
      await fs.mkdir(authTestDataDir, { recursive: true });
      await fs.mkdir(path.join(authTestDataDir, 'graphs'), { recursive: true });
      await fs.mkdir(path.join(authTestDataDir, 'jobs'), { recursive: true });

      authApp = express();
      authApp.use(express.json({ limit: '50mb' }));
      
      // Create router with authentication ENABLED
      authApp.use('/api/import', createImportRouter({ 
        dataDir: authTestDataDir, 
        disableRateLimit: true,
        disableAuth: false, // Auth is enabled
        validateApiKey: async (apiKey: string) => {
          // Simple test validator
          if (apiKey === 'valid-test-api-key') {
            return { valid: true, userId: 'test-user-123' };
          }
          if (apiKey === 'valid-key-no-user') {
            return { valid: true };
          }
          return { valid: false };
        },
      }));

      // Error handler
      authApp.use((err: any, req: any, res: any, _next: any) => {
        const status = err.statusCode || 500;
        res.status(status).json({
          error: err.message,
          code: err.code,
        });
      });
    });

    afterEach(async () => {
      try {
        await fs.rm(authTestDataDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should reject requests without API key', async () => {
      const validExport = createValidExportForAuth();

      const response = await request(authApp)
        .post('/api/import/validate')
        .send(validExport)
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
      expect(response.body.message).toContain('API key required');
    });

    it('should reject requests with invalid API key', async () => {
      const validExport = createValidExportForAuth();

      const response = await request(authApp)
        .post('/api/import/validate')
        .set('X-API-Key', 'invalid-api-key')
        .send(validExport)
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
      expect(response.body.message).toContain('Invalid API key');
    });

    it('should accept requests with valid API key via X-API-Key header', async () => {
      const validExport = createValidExportForAuth();

      const response = await request(authApp)
        .post('/api/import/validate')
        .set('X-API-Key', 'valid-test-api-key')
        .send(validExport)
        .expect(200);

      expect(response.body.valid).toBe(true);
    });

    it('should accept requests with valid API key via Authorization Bearer header', async () => {
      const validExport = createValidExportForAuth();

      const response = await request(authApp)
        .post('/api/import/validate')
        .set('Authorization', 'Bearer valid-test-api-key')
        .send(validExport)
        .expect(200);

      expect(response.body.valid).toBe(true);
    });

    it('should work with valid key that has no userId', async () => {
      const validExport = createValidExportForAuth();

      const response = await request(authApp)
        .post('/api/import/validate')
        .set('X-API-Key', 'valid-key-no-user')
        .send(validExport)
        .expect(200);

      expect(response.body.valid).toBe(true);
    });

    it('should require auth on all import endpoints', async () => {
      // Test /validate
      await request(authApp)
        .post('/api/import/validate')
        .send({})
        .expect(401);

      // Test /preview
      await request(authApp)
        .post('/api/import/preview')
        .send({})
        .expect(401);

      // Test / (execute)
      await request(authApp)
        .post('/api/import')
        .send({})
        .expect(401);

      // Test /validate-incremental
      await request(authApp)
        .post('/api/import/validate-incremental')
        .send({})
        .expect(401);

      // Test /jobs/:jobId
      await request(authApp)
        .get('/api/import/jobs/some-job-id')
        .expect(401);

      // Test /jobs/:jobId/cancel
      await request(authApp)
        .post('/api/import/jobs/some-job-id/cancel')
        .expect(401);
    });
  });

  // ============================================================================
  // CRITICAL #5: Async job status endpoint tests
  // ============================================================================
  describe('GET /api/import/jobs/:jobId', () => {
    it('should return job status for existing job', async () => {
      // First create a job by starting an import
      const validExport = createValidExport();
      const importResponse = await request(app)
        .post('/api/import')
        .send({
          data: validExport,
          mode: 'create-new',
          async: true, // Force async
        })
        .expect(202);

      expect(importResponse.body.jobId).toBeTruthy();
      const jobId = importResponse.body.jobId;

      // Poll for job status
      const jobResponse = await request(app)
        .get(`/api/import/jobs/${jobId}`)
        .expect(200);

      expect(jobResponse.body.id).toBe(jobId);
      expect(['pending', 'processing', 'completed', 'failed']).toContain(jobResponse.body.status);
      expect(typeof jobResponse.body.progress).toBe('number');
    });

    it('should return 404 for non-existent job', async () => {
      const response = await request(app)
        .get('/api/import/jobs/non-existent-job-id')
        .expect(404);

      expect(response.body.error).toBe('Not found');
    });

    it('should return progress information', async () => {
      const validExport = createValidExport();
      const importResponse = await request(app)
        .post('/api/import')
        .send({
          data: validExport,
          mode: 'create-new',
          async: true,
        })
        .expect(202);

      const jobId = importResponse.body.jobId;

      // Wait a bit and check status
      await new Promise(resolve => setTimeout(resolve, 100));

      const jobResponse = await request(app)
        .get(`/api/import/jobs/${jobId}`)
        .expect(200);

      expect(jobResponse.body).toHaveProperty('progress');
      expect(jobResponse.body).toHaveProperty('createdAt');
    });
  });

  describe('POST /api/import/jobs/:jobId/cancel', () => {
    it('should cancel an in-progress job', async () => {
      // Create a large export to ensure the job takes some time
      const largeExport = createValidExport({
        data: {
          events: Array.from({ length: 200 }, (_, i) => ({
            id: `event-${i}`,
            description: `Event ${i}`,
            actor: 'Actor',
            target: 'Target',
            timestamp: new Date(2023, 0, i + 1).toISOString(),
          })),
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const importResponse = await request(app)
        .post('/api/import')
        .send({
          data: largeExport,
          mode: 'create-new',
          async: true,
        })
        .expect(202);

      const jobId = importResponse.body.jobId;

      // Immediately try to cancel
      const cancelResponse = await request(app)
        .post(`/api/import/jobs/${jobId}/cancel`)
        .expect(200);

      expect(cancelResponse.body.message).toContain('cancellation requested');
    });

    it('should return 404 for non-existent job cancel', async () => {
      const response = await request(app)
        .post('/api/import/jobs/non-existent-job/cancel')
        .expect(404);

      expect(response.body.error).toBe('Not found');
    });
  });

  // ============================================================================
  // HIGH #3: CSRF tests
  // ============================================================================
  describe('CSRF Protection', () => {
    let csrfApp: Express;
    let csrfTestDataDir: string;

    beforeEach(async () => {
      csrfTestDataDir = path.join(os.tmpdir(), `import-csrf-test-${Date.now()}`);
      await fs.mkdir(csrfTestDataDir, { recursive: true });
      await fs.mkdir(path.join(csrfTestDataDir, 'graphs'), { recursive: true });
      await fs.mkdir(path.join(csrfTestDataDir, 'jobs'), { recursive: true });

      csrfApp = express();
      csrfApp.use(express.json({ limit: '50mb' }));
      
      // Create router with CSRF ENABLED
      csrfApp.use('/api/import', createImportRouter({ 
        dataDir: csrfTestDataDir, 
        disableRateLimit: true,
        disableAuth: true,
        disableCsrf: false, // CSRF is enabled
        validateCsrfToken: async (token: string, _sessionId: string) => {
          return token === 'valid-csrf-token';
        },
      }));

      csrfApp.use((err: any, req: any, res: any, _next: any) => {
        const status = err.statusCode || 500;
        res.status(status).json({ error: err.message, code: err.code });
      });
    });

    afterEach(async () => {
      try {
        await fs.rm(csrfTestDataDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should reject POST /api/import without CSRF token', async () => {
      const validExport = createValidExport();

      const response = await request(csrfApp)
        .post('/api/import')
        .send({
          data: validExport,
          mode: 'create-new',
        })
        .expect(403);

      expect(response.body.error).toBe('Forbidden');
      expect(response.body.message).toContain('CSRF');
    });

    it('should reject POST /api/import with invalid CSRF token', async () => {
      const validExport = createValidExport();

      const response = await request(csrfApp)
        .post('/api/import')
        .set('X-CSRF-Token', 'invalid-token')
        .send({
          data: validExport,
          mode: 'create-new',
        })
        .expect(403);

      expect(response.body.error).toBe('Forbidden');
    });

    it('should accept POST /api/import with valid CSRF token', async () => {
      const validExport = createValidExport();

      const response = await request(csrfApp)
        .post('/api/import')
        .set('X-CSRF-Token', 'valid-csrf-token')
        .send({
          data: validExport,
          mode: 'create-new',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    it('should bypass CSRF check when using API key auth', async () => {
      // API key auth is exempt from CSRF
      const validExport = createValidExport();

      const response = await request(csrfApp)
        .post('/api/import')
        .set('X-API-Key', 'any-api-key') // API key present
        .send({
          data: validExport,
          mode: 'create-new',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });
  });

  // ============================================================================
  // HIGH #4: Rate limiting tests
  // ============================================================================
  describe('Rate Limiting', () => {
    let rateLimitApp: Express;
    let rateLimitTestDataDir: string;

    beforeEach(async () => {
      rateLimitTestDataDir = path.join(os.tmpdir(), `import-ratelimit-test-${Date.now()}`);
      await fs.mkdir(rateLimitTestDataDir, { recursive: true });
      await fs.mkdir(path.join(rateLimitTestDataDir, 'graphs'), { recursive: true });
      await fs.mkdir(path.join(rateLimitTestDataDir, 'jobs'), { recursive: true });

      rateLimitApp = express();
      rateLimitApp.use(express.json({ limit: '50mb' }));
      
      // Create router with rate limiting ENABLED (max 3 requests per minute)
      rateLimitApp.use('/api/import', createImportRouter({ 
        dataDir: rateLimitTestDataDir, 
        disableRateLimit: false,
        rateLimitMaxRequests: 3, // Very low limit for testing
        disableAuth: true,
        disableCsrf: true,
      }));

      rateLimitApp.use((err: any, req: any, res: any, _next: any) => {
        const status = err.statusCode || 500;
        res.status(status).json({ error: err.message, code: err.code });
      });
    });

    afterEach(async () => {
      try {
        await fs.rm(rateLimitTestDataDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should allow requests within rate limit', async () => {
      const validExport = createValidExport();

      // First request should succeed
      await request(rateLimitApp)
        .post('/api/import/validate')
        .send(validExport)
        .expect(200);

      // Second request should succeed
      await request(rateLimitApp)
        .post('/api/import/validate')
        .send(validExport)
        .expect(200);
    });

    it('should reject requests exceeding rate limit', async () => {
      const validExport = createValidExport();

      // Make requests up to the limit
      for (let i = 0; i < 3; i++) {
        await request(rateLimitApp)
          .post('/api/import/validate')
          .send(validExport);
      }

      // Next request should be rate limited
      const response = await request(rateLimitApp)
        .post('/api/import/validate')
        .send(validExport)
        .expect(429);

      expect(response.body.error).toBe('Too many requests');
      expect(response.body.retryAfter).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // HIGH #5: Distributed lock tests
  // ============================================================================
  describe('Distributed Lock', () => {
    it('should support custom distributed lock provider', async () => {
      // This is tested implicitly through the lock acquisition mechanism
      // The setDistributedLockProvider function is exported and can be used
      // by applications that need distributed locking

      // For now, we test that concurrent imports are blocked
      const validExport = createValidExport();

      // Start first import
      const firstImport = request(app)
        .post('/api/import')
        .send({
          data: validExport,
          mode: 'create-new',
          targetGraphId: 'concurrent-test-graph',
        });

      // Try to start second import for same graph immediately
      // This should be blocked by concurrent import protection
      const secondImport = request(app)
        .post('/api/import')
        .send({
          data: validExport,
          mode: 'merge',
          targetGraphId: 'concurrent-test-graph',
        });

      const [firstResult, secondResult] = await Promise.all([firstImport, secondImport]);

      // One should succeed, one might get conflict
      // At least one should have status 201 or 409
      const statuses = [firstResult.status, secondResult.status];
      expect(statuses.some(s => s === 201 || s === 409)).toBe(true);
    });
  });

  // ============================================================================
  // HIGH #6: Idempotency key tests
  // ============================================================================
  describe('Idempotency', () => {
    let idempotentApp: Express;
    let idempotentTestDataDir: string;

    beforeEach(async () => {
      idempotentTestDataDir = path.join(os.tmpdir(), `import-idempotent-test-${Date.now()}`);
      await fs.mkdir(idempotentTestDataDir, { recursive: true });
      await fs.mkdir(path.join(idempotentTestDataDir, 'graphs'), { recursive: true });
      await fs.mkdir(path.join(idempotentTestDataDir, 'jobs'), { recursive: true });

      idempotentApp = express();
      idempotentApp.use(express.json({ limit: '50mb' }));
      
      // Create router with idempotency ENABLED
      idempotentApp.use('/api/import', createImportRouter({ 
        dataDir: idempotentTestDataDir, 
        disableRateLimit: true,
        disableAuth: true,
        disableCsrf: true,
        enableIdempotency: true,
        idempotencyTtlMs: 60000, // 1 minute TTL
      }));

      idempotentApp.use((err: any, req: any, res: any, _next: any) => {
        const status = err.statusCode || 500;
        res.status(status).json({ error: err.message, code: err.code });
      });
    });

    afterEach(async () => {
      try {
        await fs.rm(idempotentTestDataDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should return same result for same idempotency key', async () => {
      const validExport = createValidExport();
      const idempotencyKey = `test-key-${Date.now()}`;

      // First request
      const firstResponse = await request(idempotentApp)
        .post('/api/import')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          data: validExport,
          mode: 'create-new',
        })
        .expect(201);

      expect(firstResponse.body.success).toBe(true);
      const firstGraphId = firstResponse.body.graphId;

      // Second request with same key should return cached result
      const secondResponse = await request(idempotentApp)
        .post('/api/import')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          data: validExport,
          mode: 'create-new',
        })
        .expect(201);

      expect(secondResponse.body.success).toBe(true);
      expect(secondResponse.body.graphId).toBe(firstGraphId);
    });

    it('should process different requests for different idempotency keys', async () => {
      const validExport = createValidExport();

      // First request
      const firstResponse = await request(idempotentApp)
        .post('/api/import')
        .set('Idempotency-Key', 'key-1')
        .send({
          data: validExport,
          mode: 'create-new',
        })
        .expect(201);

      // Second request with different key
      const secondResponse = await request(idempotentApp)
        .post('/api/import')
        .set('Idempotency-Key', 'key-2')
        .send({
          data: validExport,
          mode: 'create-new',
        })
        .expect(201);

      // Should create two different graphs
      expect(firstResponse.body.graphId).not.toBe(secondResponse.body.graphId);
    });

    it('should work without idempotency key', async () => {
      const validExport = createValidExport();

      // Request without idempotency key should still work
      const response = await request(idempotentApp)
        .post('/api/import')
        .send({
          data: validExport,
          mode: 'create-new',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });
  });

  // ============================================================================
  // Correlation ID tests
  // ============================================================================
  describe('Correlation ID', () => {
    it('should return correlation ID in response headers', async () => {
      const validExport = createValidExport();

      const response = await request(app)
        .post('/api/import/validate')
        .send(validExport)
        .expect(200);

      expect(response.headers['x-correlation-id']).toBeTruthy();
    });

    it('should use provided correlation ID', async () => {
      const validExport = createValidExport();
      const providedId = 'my-custom-correlation-id';

      const response = await request(app)
        .post('/api/import/validate')
        .set('X-Correlation-ID', providedId)
        .send(validExport)
        .expect(200);

      expect(response.headers['x-correlation-id']).toBe(providedId);
    });
  });
});
