/**
 * Tests for Import API Routes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createImportRouter } from './import';
import { AlthistoryExport } from '../../services/ExportService';

describe('Import API Routes', () => {
  let app: Express;
  let testDataDir: string;

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

    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use('/api/import', createImportRouter({ dataDir: testDataDir, disableRateLimit: true, disableAuth: true }));

    // Error handler
    app.use((err: any, req: any, res: any, next: any) => {
      const status = err.statusCode || 500;
      res.status(status).json({
        error: err.message,
        code: err.code,
      });
    });
  });

  afterEach(async () => {
    try {
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
});
