/**
 * Tests for ImportService
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ImportService, ImportValidationResult, ImportConflict } from './ImportService';
import { AlthistoryExport } from './ExportService';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('ImportService', () => {
  let importService: ImportService;
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
      checksum: '', // Empty checksum means no validation
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
    testDataDir = path.join(os.tmpdir(), `import-test-${Date.now()}`);
    await fs.mkdir(testDataDir, { recursive: true });
    await fs.mkdir(path.join(testDataDir, 'graphs'), { recursive: true });

    importService = new ImportService({ dataDir: testDataDir });
    await importService.initialize();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('validateFormat', () => {
    it('should validate a correct export format', async () => {
      const validExport = createValidExport();
      const result = await importService.validateFormat(validExport);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.summary.eventCount).toBe(2);
      expect(result.summary.arcCount).toBe(1);
      expect(result.summary.relationshipCount).toBe(1);
    });

    it('should reject non-object data', async () => {
      const result = await importService.validateFormat('not an object');

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_FORMAT',
          message: 'Import data must be an object',
        })
      );
    });

    it('should reject invalid version', async () => {
      const invalidExport = { ...createValidExport(), version: '2.0' };
      const result = await importService.validateFormat(invalidExport);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'VERSION_MISMATCH',
        })
      );
    });

    it('should require metadata fields', async () => {
      const exportWithoutMetadata = createValidExport();
      delete (exportWithoutMetadata as any).metadata;

      const result = await importService.validateFormat(exportWithoutMetadata);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: '$.metadata',
          code: 'MISSING_FIELD',
        })
      );
    });

    it('should require data section', async () => {
      const exportWithoutData = createValidExport();
      delete (exportWithoutData as any).data;

      const result = await importService.validateFormat(exportWithoutData);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: '$.data',
          code: 'MISSING_FIELD',
        })
      );
    });

    it('should detect duplicate event IDs', async () => {
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
              id: 'event-1', // Duplicate!
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

      const result = await importService.validateFormat(exportWithDupes);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'DUPLICATE_ID',
          message: expect.stringContaining('event-1'),
        })
      );
    });

    it('should validate event required fields', async () => {
      const exportWithInvalidEvent = createValidExport({
        data: {
          events: [
            {
              id: 'event-1',
              description: '', // Empty description
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

      const result = await importService.validateFormat(exportWithInvalidEvent);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: '$.data.events[0].description',
          code: 'MISSING_FIELD',
        })
      );
    });

    it('should validate timestamp format', async () => {
      const exportWithInvalidTimestamp = createValidExport({
        data: {
          events: [
            {
              id: 'event-1',
              description: 'Test',
              actor: 'A',
              target: 'B',
              timestamp: 'not-a-date',
            },
          ],
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const result = await importService.validateFormat(exportWithInvalidTimestamp);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: '$.data.events[0].timestamp',
          code: 'INVALID_VALUE',
        })
      );
    });

    it('should warn about future dates', async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const exportWithFutureDate = createValidExport({
        data: {
          events: [
            {
              id: 'event-1',
              description: 'Future event',
              actor: 'A',
              target: 'B',
              timestamp: futureDate.toISOString(),
            },
          ],
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const result = await importService.validateFormat(exportWithFutureDate);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'FUTURE_DATE',
        })
      );
    });

    it('should validate arc temporal consistency', async () => {
      const exportWithInvalidArc = createValidExport({
        data: {
          events: [],
          arcs: [
            {
              id: 'arc-1',
              name: 'Invalid Arc',
              description: 'Start after end',
              start_time: '2023-12-31T00:00:00Z',
              end_time: '2023-01-01T00:00:00Z', // Before start!
              level: 0,
              parent_arc_id: null,
            },
          ],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const result = await importService.validateFormat(exportWithInvalidArc);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'TEMPORAL_VIOLATION',
        })
      );
    });

    it('should validate orphan arc references', async () => {
      const exportWithOrphanRef = createValidExport({
        data: {
          events: [],
          arcs: [
            {
              id: 'arc-1',
              name: 'Child Arc',
              description: 'References non-existent parent',
              start_time: '2023-01-01T00:00:00Z',
              end_time: '2023-12-31T00:00:00Z',
              level: 1,
              parent_arc_id: 'non-existent-parent',
            },
          ],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const result = await importService.validateFormat(exportWithOrphanRef);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'ORPHAN_REFERENCE',
          message: expect.stringContaining('non-existent-parent'),
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
              timestamp: '2023-06-01T00:00:00Z', // After effect!
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

      const result = await importService.validateFormat(exportWithParadox);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'CAUSAL_PARADOX',
        })
      );
    });

    it('should validate orphan relationship references', async () => {
      const exportWithOrphanRel = createValidExport({
        data: {
          events: [
            {
              id: 'event-1',
              description: 'Only event',
              actor: 'A',
              target: 'B',
              timestamp: '2023-01-01T00:00:00Z',
            },
          ],
          arcs: [],
          causalRelationships: [
            {
              id: 'rel-1',
              cause_event_id: 'event-1',
              effect_event_id: 'non-existent-event',
              weight: 0.8,
              evidence: 'Test',
              confidence: 0.9,
              relationship_type: 'direct',
            },
          ],
          inferredPressures: [],
        },
      });

      const result = await importService.validateFormat(exportWithOrphanRel);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'ORPHAN_REFERENCE',
          message: expect.stringContaining('non-existent-event'),
        })
      );
    });

    it('should validate relationship weight bounds', async () => {
      const exportWithInvalidWeight = createValidExport({
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
              id: 'event-2',
              description: 'Event 2',
              actor: 'B',
              target: 'C',
              timestamp: '2023-01-02T00:00:00Z',
            },
          ],
          arcs: [],
          causalRelationships: [
            {
              id: 'rel-1',
              cause_event_id: 'event-1',
              effect_event_id: 'event-2',
              weight: 1.5, // Invalid!
              evidence: 'Test',
              confidence: 0.9,
              relationship_type: 'direct',
            },
          ],
          inferredPressures: [],
        },
      });

      const result = await importService.validateFormat(exportWithInvalidWeight);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: '$.data.causalRelationships[0].weight',
          code: 'INVALID_VALUE',
        })
      );
    });

    it('should warn about low confidence relationships', async () => {
      const exportWithLowConfidence = createValidExport({
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
              id: 'event-2',
              description: 'Event 2',
              actor: 'B',
              target: 'C',
              timestamp: '2023-01-02T00:00:00Z',
            },
          ],
          arcs: [],
          causalRelationships: [
            {
              id: 'rel-1',
              cause_event_id: 'event-1',
              effect_event_id: 'event-2',
              weight: 0.5,
              evidence: 'Test',
              confidence: 0.3, // Low confidence
              relationship_type: 'direct',
            },
          ],
          inferredPressures: [],
        },
      });

      const result = await importService.validateFormat(exportWithLowConfidence);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'LOW_CONFIDENCE',
        })
      );
    });

    it('should warn about missing provenance', async () => {
      const exportWithoutProvenance = createValidExport();
      delete exportWithoutProvenance.provenance;

      const result = await importService.validateFormat(exportWithoutProvenance);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_PROVENANCE',
        })
      );
    });

    it('should calculate summary correctly', async () => {
      const validExport = createValidExport();
      const result = await importService.validateFormat(validExport);

      expect(result.summary).toEqual({
        eventCount: 2,
        arcCount: 1,
        relationshipCount: 1,
        pressureCount: 0,
        crossRefCount: 0,
        temporalRange: {
          start: '2023-01-01T00:00:00.000Z',
          end: '2023-12-31T23:59:59.000Z',
        },
        actors: ['Actor A', 'Actor B'],
      });
    });
  });

  describe('validateTemporalConstraints', () => {
    it('should validate arc hierarchy temporal bounds', () => {
      const exportWithInvalidHierarchy = createValidExport({
        data: {
          events: [],
          arcs: [
            {
              id: 'parent-arc',
              name: 'Parent Arc',
              description: 'Parent',
              start_time: '2023-03-01T00:00:00Z',
              end_time: '2023-09-01T00:00:00Z',
              level: 0,
              parent_arc_id: null,
            },
            {
              id: 'child-arc',
              name: 'Child Arc',
              description: 'Extends beyond parent',
              start_time: '2023-01-01T00:00:00Z', // Before parent start!
              end_time: '2023-06-01T00:00:00Z',
              level: 1,
              parent_arc_id: 'parent-arc',
            },
          ],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const errors = importService.validateTemporalConstraints(exportWithInvalidHierarchy);

      expect(errors).toContainEqual(
        expect.objectContaining({
          code: 'TEMPORAL_VIOLATION',
          message: expect.stringContaining('extends outside parent'),
        })
      );
    });

    it('should pass valid arc hierarchies', () => {
      const validExport = createValidExport({
        data: {
          events: [],
          arcs: [
            {
              id: 'parent-arc',
              name: 'Parent Arc',
              description: 'Parent',
              start_time: '2023-01-01T00:00:00Z',
              end_time: '2023-12-31T00:00:00Z',
              level: 0,
              parent_arc_id: null,
            },
            {
              id: 'child-arc',
              name: 'Child Arc',
              description: 'Within parent bounds',
              start_time: '2023-03-01T00:00:00Z',
              end_time: '2023-06-01T00:00:00Z',
              level: 1,
              parent_arc_id: 'parent-arc',
            },
          ],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const errors = importService.validateTemporalConstraints(validExport);
      expect(errors).toHaveLength(0);
    });
  });

  describe('preview', () => {
    it('should calculate entity counts for create-new mode', async () => {
      const validExport = createValidExport();
      const preview = await importService.preview(validExport, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });

      expect(preview.toCreate).toEqual({
        events: 2,
        arcs: 1,
        relationships: 1,
        pressures: 0,
      });
      expect(preview.toUpdate).toEqual({
        events: 0,
        arcs: 0,
        relationships: 0,
        pressures: 0,
      });
      expect(preview.toDelete).toEqual({
        events: 0,
        arcs: 0,
        relationships: 0,
        pressures: 0,
      });
      expect(preview.conflicts).toHaveLength(0);
    });

    it('should include validation warnings in preview', async () => {
      const exportWithoutProvenance = createValidExport();
      delete exportWithoutProvenance.provenance;

      const preview = await importService.preview(exportWithoutProvenance, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });

      expect(preview.warnings).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_PROVENANCE',
        })
      );
    });
  });

  describe('executeImport', () => {
    it('should fail with validation errors', async () => {
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

      const result = await importService.executeImport(invalidExport, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });

      expect(result.success).toBe(false);
      expect(result.errors).not.toHaveLength(0);
    });

    it('should successfully import valid data to new graph', async () => {
      const validExport = createValidExport();

      const result = await importService.executeImport(validExport, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });

      expect(result.success).toBe(true);
      expect(result.graphId).toBeTruthy();
      expect(result.imported).toEqual({
        events: 2,
        arcs: 1,
        relationships: 1,
        pressures: 0,
      });
      expect(result.errors).toHaveLength(0);
    });

    it('should include warnings in successful result', async () => {
      const exportWithoutProvenance = createValidExport();
      delete exportWithoutProvenance.provenance;

      const result = await importService.executeImport(exportWithoutProvenance, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });

      expect(result.success).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_PROVENANCE',
        })
      );
    });
  });

  describe('detectConflicts', () => {
    it('should return empty for create-new mode', async () => {
      const validExport = createValidExport();
      const conflicts = await importService.detectConflicts(
        validExport,
        'any-graph',
        'create-new'
      );

      expect(conflicts).toHaveLength(0);
    });

    it('should return empty when graph does not exist', async () => {
      const validExport = createValidExport();
      const conflicts = await importService.detectConflicts(
        validExport,
        'non-existent-graph',
        'merge'
      );

      expect(conflicts).toHaveLength(0);
    });
  });
});
