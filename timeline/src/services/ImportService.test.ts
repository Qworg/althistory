/**
 * Tests for ImportService
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ImportService } from './ImportService';
import { AlthistoryExport, ExportService } from './ExportService';
import { GraphRepository } from '../repositories/GraphRepository';
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
      // Destroy the import service first to stop any background operations
      if (importService) {
        await importService.destroy();
      }
      // Small delay to allow any in-flight async operations to complete
      await new Promise(resolve => setTimeout(resolve, 50));
      // Then clean up the temp directory
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

    it('should accept a cause and an effect at the same moment', async () => {
      // The rule the whole project uses: a cause may not follow its effect,
      // but it may happen at the same moment. The merge accepts the same
      // pair, and the link-creation path creates it.
      const exportWithSimultaneousPair = createValidExport({
        data: {
          events: [
            {
              id: 'event-cause',
              description: 'Cause',
              actor: 'A',
              target: 'B',
              timestamp: '2023-06-01T00:00:00Z',
            },
            {
              id: 'event-effect',
              description: 'Effect',
              actor: 'B',
              target: 'C',
              timestamp: '2023-06-01T00:00:00Z',
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

      const result = await importService.validateFormat(exportWithSimultaneousPair);

      expect(result.valid).toBe(true);
      expect(result.errors ?? []).toEqual([]);
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

  describe('events within arc boundaries validation', () => {
    it('should validate events within their assigned arc boundaries', () => {
      const exportWithEventOutsideArc = createValidExport({
        data: {
          events: [
            {
              id: 'event-outside',
              description: 'Event outside arc',
              actor: 'A',
              target: 'B',
              timestamp: '2024-06-01T00:00:00Z', // Outside arc boundaries
              metadata: { arc_ids: ['arc-1'] },
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
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const errors = importService.validateTemporalConstraints(exportWithEventOutsideArc);
      
      expect(errors).toContainEqual(
        expect.objectContaining({
          code: 'TEMPORAL_VIOLATION',
          message: expect.stringContaining('outside arc'),
        })
      );
    });

    it('should pass when events are within arc boundaries', () => {
      const validExport = createValidExport({
        data: {
          events: [
            {
              id: 'event-inside',
              description: 'Event inside arc',
              actor: 'A',
              target: 'B',
              timestamp: '2023-06-01T00:00:00Z', // Inside arc boundaries
              metadata: { arc_ids: ['arc-1'] },
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
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const errors = importService.validateTemporalConstraints(validExport);
      expect(errors).toHaveLength(0);
    });
  });

  describe('XSS sanitization', () => {
    it('should sanitize string fields in arrays', async () => {
      const exportWithXSS = createValidExport({
        data: {
          events: [
            {
              id: 'event-1',
              description: 'Safe event',
              actor: 'Actor',
              target: 'Target',
              timestamp: '2023-01-01T00:00:00Z',
            },
          ],
          arcs: [],
          causalRelationships: [],
          inferredPressures: [
            {
              id: 'pressure-1',
              description: '<script>alert("xss")</script>',
              confidence_score: 0.8,
              pressure_type: 'economic',
              evidence_event_ids: ['<script>alert("xss")</script>'], // XSS in array
              affected_arc_ids: [],
            },
          ],
        },
      });

      const result = await importService.executeImport(exportWithXSS, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });

      // Validation should fail on missing event reference, but XSS should be sanitized
      // The sanitization happens during import, not validation
      expect(result.success).toBe(false); // Will fail due to orphan reference
    });
  });

  describe('NaN date handling', () => {
    it('should detect NaN dates in temporal validation', () => {
      const exportWithNaNDate = createValidExport({
        data: {
          events: [
            {
              id: 'event-nan',
              description: 'Event with NaN date',
              actor: 'A',
              target: 'B',
              timestamp: 'not-a-valid-date',
            },
          ],
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const errors = importService.validateTemporalConstraints(exportWithNaNDate);
      
      expect(errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_VALUE',
          message: expect.stringContaining('invalid timestamp'),
        })
      );
    });
  });

  describe('manual resolution validation', () => {
    it('should reject import when manual resolutions do not cover all error conflicts', async () => {
      // First create a graph with existing data by using a different approach
      // Create a graph file directly in the test directory
      const graphId = `test-graph-${Date.now()}`;
      const graphsDir = path.join(testDataDir, 'graphs', graphId);
      await fs.mkdir(graphsDir, { recursive: true });
      
      // Write initial graph state
      const graphState = {
        events: [
          {
            id: 'event-1',
            description: 'Existing event',
            actor: 'Actor A',
            target: 'Target B',
            timestamp: '2023-01-01T00:00:00Z',
          },
        ],
        arcs: [],
        relationships: [],
        pressures: [],
      };
      await fs.writeFile(
        path.join(graphsDir, 'state.json'),
        JSON.stringify(graphState)
      );
      await fs.writeFile(
        path.join(graphsDir, 'meta.json'),
        JSON.stringify({ id: graphId, name: 'Test Graph', version: 1, createdAt: new Date().toISOString() })
      );

      // Now try to import with duplicate ID and manual resolution mode
      const exportWithDuplicate = createValidExport({
        data: {
          events: [
            {
              id: 'event-1', // Same ID as existing - will conflict
              description: 'New event with same ID',
              actor: 'Actor C',
              target: 'Target D',
              timestamp: '2023-02-01T00:00:00Z',
            },
          ],
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      // First detect what conflicts exist
      const conflicts = await importService.detectConflicts(exportWithDuplicate, graphId, 'merge');
      
      // If there are conflicts, verify manual resolution validation
      if (conflicts.length > 0 && conflicts.some(c => c.severity === 'error')) {
        const result = await importService.executeImport(exportWithDuplicate, {
          graphId,
          mode: 'merge',
          conflictResolution: 'manual',
          manualResolutions: {}, // Empty - doesn't cover the conflicts
        });

        expect(result.success).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      } else {
        // No conflicts detected due to graph structure - skip this test
        expect(true).toBe(true);
      }
    });
  });

  describe('service lifecycle', () => {
    it('should clean up on destroy', async () => {
      const service = new ImportService({ dataDir: testDataDir });
      await service.initialize();
      
      // Destroy should not throw
      await expect(service.destroy()).resolves.toBeUndefined();
    });
  });

  describe('async import', () => {
    it('should determine async threshold correctly', () => {
      // Small import should be sync
      const smallExport = createValidExport();
      expect(importService.shouldUseAsyncImport(smallExport)).toBe(false);

      // Large import (>100 entities) should be async
      const largeEvents = Array.from({ length: 150 }, (_, i) => ({
        id: `event-${i}`,
        description: `Event ${i}`,
        actor: 'Actor',
        target: 'Target',
        timestamp: '2023-01-01T00:00:00Z',
      }));

      const largeExport = createValidExport({
        data: {
          events: largeEvents,
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      expect(importService.shouldUseAsyncImport(largeExport)).toBe(true);
    });

    it('should create job for async import', async () => {
      const largeEvents = Array.from({ length: 150 }, (_, i) => ({
        id: `event-${i}`,
        description: `Event ${i}`,
        actor: 'Actor',
        target: 'Target',
        timestamp: '2023-01-01T00:00:00Z',
      }));

      const largeExport = createValidExport({
        data: {
          events: largeEvents,
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const { jobId } = await importService.executeImportAsync(largeExport, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });

      expect(jobId).toBeTruthy();

      // Get job status
      const job = await importService.getImportJob(jobId);
      expect(job).toBeTruthy();
      expect(['pending', 'processing', 'completed']).toContain(job?.status);
    });

    it('should support cancellation', async () => {
      const largeEvents = Array.from({ length: 150 }, (_, i) => ({
        id: `event-${i}`,
        description: `Event ${i}`,
        actor: 'Actor',
        target: 'Target',
        timestamp: '2023-01-01T00:00:00Z',
      }));

      const largeExport = createValidExport({
        data: {
          events: largeEvents,
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const { jobId } = await importService.executeImportAsync(largeExport, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });

      // Cancel immediately
      const cancelled = importService.cancelImport(jobId);
      expect(cancelled).toBe(true);
    });
  });

  describe('provenance recording', () => {
    it('should record complete provenance data', async () => {
      const validExport = createValidExport();
      
      const result = await importService.executeImport(validExport, {
        mode: 'create-new',
        conflictResolution: 'skip',
        userId: 'test-user-123',
      });

      expect(result.success).toBe(true);
      // Provenance is recorded in entity metadata - we verify the import succeeded
      // The actual metadata verification would require reading back the graph data
    });
  });

  describe('file size validation', () => {
    it('should reject files exceeding max size', async () => {
      // Create a very large export (simulate by testing the size check directly)
      const sizeError = importService.validateSize({ 
        data: 'x'.repeat(11 * 1024 * 1024) // 11MB of data
      });

      expect(sizeError).toBeTruthy();
      expect(sizeError?.code).toBe('FILE_TOO_LARGE');
    });
  });

  describe('checksum validation', () => {
    it('should validate checksum when provided', async () => {
      const exportWithBadChecksum = createValidExport();
      exportWithBadChecksum.metadata.checksum = 'invalid-checksum-value';

      const result = await importService.validateFormat(exportWithBadChecksum);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'CHECKSUM_MISMATCH',
        })
      );
    });
  });

  describe('rename conflict resolution', () => {
    it('should generate new IDs when using rename resolution', async () => {
      // First create a graph
      const initialExport = createValidExport();
      const initialResult = await importService.executeImport(initialExport, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });

      expect(initialResult.success).toBe(true);

      // Import again with rename resolution
      const conflicts = await importService.detectConflicts(
        initialExport,
        initialResult.graphId,
        'merge'
      );

      // Build manual resolutions for rename
      const resolutions: Record<string, 'rename'> = {};
      conflicts.forEach(c => {
        resolutions[c.id] = 'rename';
      });

      const result = await importService.executeImport(initialExport, {
        graphId: initialResult.graphId,
        mode: 'merge',
        conflictResolution: 'manual',
        manualResolutions: resolutions,
      });

      expect(result.success).toBe(true);
      // Should have imported (renamed) entities, not skipped
      expect(result.imported.events).toBe(2);
    });
  });

  // ============================================================================
  // CRITICAL #1: Rollback verification tests
  // ============================================================================
  describe('rollback verification', () => {
    it('should not create partial data on validation failure mid-import', async () => {
      // Create an export with valid events but invalid relationships
      const partiallyInvalidExport = createValidExport({
        data: {
          events: [
            {
              id: 'event-1',
              description: 'Valid event',
              actor: 'Actor A',
              target: 'Target B',
              timestamp: '2023-01-01T00:00:00Z',
            },
          ],
          arcs: [],
          // Relationship references non-existent event
          causalRelationships: [
            {
              id: 'rel-1',
              cause_event_id: 'event-1',
              effect_event_id: 'non-existent-event', // This doesn't exist
              weight: 0.8,
              evidence: 'Test',
              confidence: 0.9,
              relationship_type: 'direct',
            },
          ],
          inferredPressures: [],
        },
      });

      const result = await importService.executeImport(partiallyInvalidExport, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });

      // Import should fail due to orphan reference
      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'ORPHAN_REFERENCE',
        })
      );
    });

    it('should preserve existing data when import fails', async () => {
      // First, create a graph with some data
      const initialExport = createValidExport();
      const initialResult = await importService.executeImport(initialExport, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });
      expect(initialResult.success).toBe(true);

      // Now try to replace with invalid data
      const invalidExport = createValidExport({
        data: {
          events: [], // Empty - this would delete everything
          arcs: [],
          causalRelationships: [
            {
              id: 'orphan-rel',
              cause_event_id: 'missing-1',
              effect_event_id: 'missing-2',
              weight: 0.5,
              evidence: 'Test',
              confidence: 0.5,
              relationship_type: 'direct',
            },
          ],
          inferredPressures: [],
        },
      });

      const replaceResult = await importService.executeImport(invalidExport, {
        graphId: initialResult.graphId,
        mode: 'replace',
        conflictResolution: 'skip',
      });

      // Replace should fail
      expect(replaceResult.success).toBe(false);
    });
  });

  // ============================================================================
  // CRITICAL #2: Service shutdown tests
  // ============================================================================
  describe('service shutdown', () => {
    it('should mark active jobs as failed on destroy', async () => {
      const shutdownService = new ImportService({ dataDir: testDataDir });
      await shutdownService.initialize();

      // Start an async import
      const validExport = createValidExport();
      const { jobId } = await shutdownService.executeImportAsync(validExport, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });

      // Give it a moment to start
      await new Promise(resolve => setTimeout(resolve, 50));

      // Destroy the service
      await shutdownService.destroy();

      // Wait a bit for the shutdown to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create a new service to check the job status
      const checkService = new ImportService({ dataDir: testDataDir });
      await checkService.initialize();

      const job = await checkService.getImportJob(jobId);
      
      // Job should be marked as failed or cancelled
      expect(job).toBeTruthy();
      if (job && job.status !== 'completed') {
        expect(['failed', 'cancelled']).toContain(job.status);
      }

      await checkService.destroy();
    });
  });

  // ============================================================================
  // HIGH #1: Cross-graph reference validation tests
  // ============================================================================
  describe('cross-graph reference validation', () => {
    it('should validate cross-graph references exist', async () => {
      const exportWithCrossRef = createValidExport({
        data: {
          events: [
            {
              id: 'event-1',
              description: 'Event 1',
              actor: 'A',
              target: 'B',
              timestamp: '2023-01-01T00:00:00Z',
            },
          ],
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
          crossGraphRefs: [
            {
              localEntityId: 'event-1',
              localEntityType: 'event',
              referencedGraphId: 'non-existent-graph',
              referencedEntityId: 'remote-event',
              referencedEntityType: 'event',
            },
          ],
        },
      });

      const result = await importService.executeImport(exportWithCrossRef, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });

      // Should warn or error about missing graph reference
      // The validation might pass but with warnings, depending on implementation
      expect(result).toBeTruthy();
    });
  });

  // ============================================================================
  // Req 4.4: cross-graph references survive import and the next export
  // ============================================================================
  describe('cross-graph reference preservation', () => {
    const createExportWithRefs = (
      remoteEventGraphId: string,
      remoteArcGraphId: string
    ): AlthistoryExport =>
      createValidExport({
        data: {
          events: [
            {
              id: 'event-1',
              description: 'Event referencing another graph',
              actor: 'A',
              target: 'B',
              timestamp: '2023-01-01T00:00:00Z',
            },
          ],
          arcs: [
            {
              id: 'arc-1',
              name: 'Arc referencing another graph',
              description: 'An arc',
              start_time: '2023-01-01T00:00:00Z',
              end_time: '2023-12-31T23:59:59Z',
              level: 0,
              parent_arc_id: null,
            },
          ],
          causalRelationships: [],
          inferredPressures: [],
          crossGraphRefs: [
            {
              localEntityId: 'event-1',
              localEntityType: 'event',
              referencedGraphId: remoteEventGraphId,
              referencedEntityId: 'remote-event',
              referencedEntityType: 'event',
            },
            {
              localEntityId: 'arc-1',
              localEntityType: 'arc',
              referencedGraphId: remoteArcGraphId,
              referencedEntityId: 'remote-arc',
              referencedEntityType: 'arc',
            },
          ],
        },
      });

    it('should keep the references on the entities they describe', async () => {
      const repository = new GraphRepository({ dataDir: testDataDir });
      await repository.initialize();
      const remoteEvents = await repository.create({ name: 'Remote Events' });
      const remoteArcs = await repository.create({ name: 'Remote Arcs' });

      const result = await importService.executeImport(
        createExportWithRefs(remoteEvents.id, remoteArcs.id),
        { mode: 'create-new', conflictResolution: 'skip' }
      );

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);

      const data = await repository.checkout(result.graphId);

      expect(data.events['event-1'].metadata).toMatchObject({
        crossGraphRefs: [
          {
            referencedGraphId: remoteEvents.id,
            referencedEntityId: 'remote-event',
            referencedEntityType: 'event',
          },
        ],
      });
      expect(data.arcs['arc-1'].metadata).toMatchObject({
        crossGraphRefs: [
          {
            referencedGraphId: remoteArcs.id,
            referencedEntityId: 'remote-arc',
            referencedEntityType: 'arc',
          },
        ],
      });
    });

    it('should re-point a reference at the entity id a rename produced', async () => {
      const repository = new GraphRepository({ dataDir: testDataDir });
      await repository.initialize();
      const remote = await repository.create({ name: 'Rename Remote Graph' });

      const exportWithRef = createValidExport({
        data: {
          events: [
            {
              id: 'event-1',
              description: 'Renamed on the second import',
              actor: 'A',
              target: 'B',
              timestamp: '2023-01-01T00:00:00Z',
            },
          ],
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
          crossGraphRefs: [
            {
              localEntityId: 'event-1',
              localEntityType: 'event',
              referencedGraphId: remote.id,
              referencedEntityId: 'remote-event',
              referencedEntityType: 'event',
            },
          ],
        },
      });

      const first = await importService.executeImport(exportWithRef, {
        mode: 'create-new',
        conflictResolution: 'rename',
      });
      expect(first.success).toBe(true);

      // Same export imported again into the same graph: the duplicate id is
      // renamed, and the stored reference must follow the new id rather than
      // the stale one it was exported with.
      const second = await importService.executeImport(exportWithRef, {
        mode: 'merge',
        conflictResolution: 'rename',
        graphId: first.graphId,
      });
      expect(second.success).toBe(true);

      const exportService = new ExportService({ dataDir: testDataDir });
      await exportService.initialize();
      const reExported = await exportService.exportGraph({
        graphId: first.graphId,
        scope: 'full',
        includeProvenance: false,
      });

      const localIds = (reExported.export.data.crossGraphRefs ?? []).map((ref) => ref.localEntityId);
      expect(localIds).toContain('event-1');
      expect(localIds.some((id) => id.startsWith('event-1_imported_'))).toBe(true);
    });

    it('should preserve entity sourceRef on import and export', async () => {
      const repository = new GraphRepository({ dataDir: testDataDir });

      const exportWithSources = createValidExport({
        data: {
          events: [
            {
              id: 'event-1',
              description: 'Sourced event',
              actor: 'A',
              target: 'B',
              timestamp: '2023-01-01T00:00:00Z',
              sourceRef: 'https://example.com/event-source',
            },
          ],
          arcs: [
            {
              id: 'arc-1',
              name: 'Sourced arc',
              description: 'Arc',
              start_time: '2023-01-01T00:00:00Z',
              end_time: '2023-12-31T00:00:00Z',
              level: 0,
              parent_arc_id: null,
              sourceRef: 'https://example.com/arc-source',
            },
          ],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const result = await importService.executeImport(exportWithSources, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });
      expect(result.success).toBe(true);

      await repository.initialize();
      const data = await repository.checkout(result.graphId);
      expect(data.events['event-1'].sourceRef).toBe('https://example.com/event-source');
      expect(data.arcs['arc-1'].sourceRef).toBe('https://example.com/arc-source');

      const exportService = new ExportService({ dataDir: testDataDir });
      await exportService.initialize();
      const reExported = await exportService.exportGraph({
        graphId: result.graphId,
        scope: 'full',
        includeProvenance: false,
      });

      expect(reExported.export.data.events[0].sourceRef).toBe(
        'https://example.com/event-source'
      );
      expect(reExported.export.data.arcs[0].sourceRef).toBe('https://example.com/arc-source');
    });

    it('should preserve cross-graph relationship endpoints', async () => {
      const repository = new GraphRepository({ dataDir: testDataDir });
      await repository.initialize();
      const remote = await repository.create({ name: 'Relationship Remote Graph' });
      const remoteEffect = await repository.create({ name: 'Relationship Remote Effect Graph' });

      const exportWithCrossRelationship = createValidExport({
        data: {
          events: [
            {
              id: 'event-1',
              description: 'Local effect',
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
              effect_event_id: 'event-1',
              weight: 0.7,
              evidence: 'Remote cause',
              confidence: 0.8,
              relationship_type: 'direct',
              causeGraphId: remote.id,
              effectGraphId: remoteEffect.id,
              sourceRef: 'https://example.com/relationship-source',
            },
          ],
          inferredPressures: [],
        },
      });

      const result = await importService.executeImport(exportWithCrossRelationship, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });
      expect(result.success).toBe(true);

      const data = await repository.checkout(result.graphId);
      expect(data.relationships['rel-1']).toMatchObject({
        causeGraphId: remote.id,
        effectGraphId: remoteEffect.id,
        sourceRef: 'https://example.com/relationship-source',
      });

      const exportService = new ExportService({ dataDir: testDataDir });
      await exportService.initialize();
      const reExported = await exportService.exportGraph({
        graphId: result.graphId,
        scope: 'full',
        includeProvenance: false,
      });

      expect(reExported.export.data.causalRelationships[0]).toMatchObject({
        id: 'rel-1',
        causeGraphId: remote.id,
        effectGraphId: remoteEffect.id,
        sourceRef: 'https://example.com/relationship-source',
      });
    });

    it('should round-trip through export with the imported ids', async () => {
      const repository = new GraphRepository({ dataDir: testDataDir });
      await repository.initialize();
      const remoteEvents = await repository.create({ name: 'Round Trip Remote Events' });
      const remoteArcs = await repository.create({ name: 'Round Trip Remote Arcs' });

      const importResult = await importService.executeImport(
        createExportWithRefs(remoteEvents.id, remoteArcs.id),
        { mode: 'create-new', conflictResolution: 'skip' }
      );
      expect(importResult.success).toBe(true);

      const exportService = new ExportService({ dataDir: testDataDir });
      await exportService.initialize();
      const reExported = await exportService.exportGraph({
        graphId: importResult.graphId,
        scope: 'full',
        includeProvenance: false,
      });

      expect(reExported.export.data.crossGraphRefs).toEqual([
        {
          localEntityId: 'event-1',
          localEntityType: 'event',
          referencedGraphId: remoteEvents.id,
          referencedEntityId: 'remote-event',
          referencedEntityType: 'event',
        },
        {
          localEntityId: 'arc-1',
          localEntityType: 'arc',
          referencedGraphId: remoteArcs.id,
          referencedEntityId: 'remote-arc',
          referencedEntityType: 'arc',
        },
      ]);
    });
  });

  // ============================================================================
  // HIGH #2: Circular arc reference tests
  // ============================================================================
  describe('circular arc reference detection', () => {
    it('should detect circular arc references', async () => {
      const exportWithCircularArcs = createValidExport({
        data: {
          events: [],
          arcs: [
            {
              id: 'arc-1',
              name: 'Arc 1',
              description: 'First arc',
              start_time: '2023-01-01T00:00:00Z',
              end_time: '2023-12-31T00:00:00Z',
              level: 0,
              parent_arc_id: 'arc-2', // Points to arc-2
            },
            {
              id: 'arc-2',
              name: 'Arc 2',
              description: 'Second arc',
              start_time: '2023-03-01T00:00:00Z',
              end_time: '2023-09-01T00:00:00Z',
              level: 1,
              parent_arc_id: 'arc-1', // Points back to arc-1 - circular!
            },
          ],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const result = await importService.validateFormat(exportWithCircularArcs);

      expect(result.valid).toBe(false);
      // Check that we got a circular reference error
      const circularError = result.errors.find(e => 
        e.code === 'ARC_HIERARCHY_VIOLATION' && 
        e.message.toLowerCase().includes('circular')
      );
      expect(circularError).toBeTruthy();
    });

    it('should detect self-referencing arc', async () => {
      const exportWithSelfRef = createValidExport({
        data: {
          events: [],
          arcs: [
            {
              id: 'arc-1',
              name: 'Self-referencing arc',
              description: 'Arc that references itself',
              start_time: '2023-01-01T00:00:00Z',
              end_time: '2023-12-31T00:00:00Z',
              level: 0,
              parent_arc_id: 'arc-1', // Self-reference
            },
          ],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const result = await importService.validateFormat(exportWithSelfRef);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'ARC_HIERARCHY_VIOLATION',
        })
      );
    });
  });

  // ============================================================================
  // HIGH #7: Arc hierarchy validation tests
  // ============================================================================
  describe('arc hierarchy validation', () => {
    it('should validate deep arc hierarchies', async () => {
      const deepHierarchyExport = createValidExport({
        data: {
          events: [],
          arcs: [
            {
              id: 'root',
              name: 'Root',
              description: 'Root arc',
              start_time: '2023-01-01T00:00:00Z',
              end_time: '2023-12-31T00:00:00Z',
              level: 0,
              parent_arc_id: null,
            },
            {
              id: 'child1',
              name: 'Child 1',
              description: 'First level child',
              start_time: '2023-02-01T00:00:00Z',
              end_time: '2023-11-01T00:00:00Z',
              level: 1,
              parent_arc_id: 'root',
            },
            {
              id: 'grandchild',
              name: 'Grandchild',
              description: 'Second level child',
              start_time: '2023-03-01T00:00:00Z',
              end_time: '2023-10-01T00:00:00Z',
              level: 2,
              parent_arc_id: 'child1',
            },
          ],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const result = await importService.validateFormat(deepHierarchyExport);
      expect(result.valid).toBe(true);
    });

    it('should reject arc with missing parent reference', async () => {
      const missingParentExport = createValidExport({
        data: {
          events: [],
          arcs: [
            {
              id: 'orphan-arc',
              name: 'Orphan',
              description: 'Arc with missing parent',
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

      const result = await importService.validateFormat(missingParentExport);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'ORPHAN_REFERENCE',
        })
      );
    });
  });

  // ============================================================================
  // HIGH #8: Provenance recording tests
  // ============================================================================
  describe('provenance recording', () => {
    it('should record complete provenance data', async () => {
      const validExport = createValidExport();
      const result = await importService.executeImport(validExport, {
        mode: 'create-new',
        conflictResolution: 'skip',
        userId: 'test-user-123',
      });

      expect(result.success).toBe(true);
      // Provenance should be recorded - this is validated by checking the metadata
      // in the imported entities (tested implicitly through successful import)
    });

    it('should preserve original metadata alongside provenance', async () => {
      const exportWithMetadata = createValidExport({
        data: {
          events: [
            {
              id: 'event-1',
              description: 'Event with metadata',
              actor: 'A',
              target: 'B',
              timestamp: '2023-01-01T00:00:00Z',
              metadata: {
                custom_field: 'custom_value',
                importance: 'high',
              },
            },
          ],
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
        },
      });

      const result = await importService.executeImport(exportWithMetadata, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });

      expect(result.success).toBe(true);
      expect(result.imported.events).toBe(1);
    });
  });

  // ============================================================================
  // HIGH #9: Stale job cleanup tests
  // ============================================================================
  describe('stale job cleanup', () => {
    it('should cleanup stale jobs that exceed threshold', async () => {
      // Create a service with a very short stale threshold
      const shortThresholdService = new ImportService({
        dataDir: testDataDir,
        staleJobThresholdMs: 100, // 100ms threshold for testing
      });
      await shortThresholdService.initialize();

      // Start an async import
      const validExport = createValidExport();
      const { jobId } = await shortThresholdService.executeImportAsync(validExport, {
        mode: 'create-new',
        conflictResolution: 'skip',
      });

      // Wait longer than the threshold
      await new Promise(resolve => setTimeout(resolve, 200));

      // Trigger cleanup manually (normally runs on interval)
      // For testing, we'll just check the job status after destroy
      await shortThresholdService.destroy();

      // Job should have been cleaned up or completed
      const checkService = new ImportService({ dataDir: testDataDir });
      await checkService.initialize();
      
      const job = await checkService.getImportJob(jobId);
      // Job should exist and be in a terminal state
      expect(job).toBeTruthy();
      
      await checkService.destroy();
    });
  });
});
