import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  ExportService,
  AlthistoryExport,
} from './ExportService';
import { GraphRepository } from '../repositories/GraphRepository';
import { Graph, IGraph } from '../models/Graph';
import { ResolvedGraphData } from '../repositories/VersionRepository';
import * as fs from 'fs';

// Mock the GraphRepository
vi.mock('../repositories/GraphRepository');

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn(),
    },
  };
});

describe('ExportService', () => {
  let exportService: ExportService;
  let mockGraphRepository: {
    initialize: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    checkout: ReturnType<typeof vi.fn>;
    getVersionHistory: ReturnType<typeof vi.fn>;
  };

  const createMockGraph = (overrides: Partial<IGraph> = {}): Graph => {
    const graphData: IGraph = {
      id: 'graph_123',
      name: 'Test Graph',
      description: 'A test graph',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      version: 1,
      status: 'active',
      metadata: {
        eventCount: 10,
        arcCount: 3,
        relationshipCount: 5,
        pressureCount: 2,
      },
      ...overrides,
    };
    return new Graph(graphData);
  };

  const createMockGraphData = (): ResolvedGraphData => ({
    events: {
      event1: {
        id: 'event1',
        description: 'Battle of Austerlitz',
        actor: 'Napoleon',
        target: 'Coalition Forces',
        timestamp: '1805-12-02T00:00:00Z',
      },
      event2: {
        id: 'event2',
        description: 'Treaty of Tilsit',
        actor: 'Napoleon',
        target: 'Prussia',
        timestamp: '1807-07-07T00:00:00Z',
      },
    },
    arcs: {
      arc1: {
        id: 'arc1',
        name: 'Napoleonic Wars',
        description: 'European conflicts involving Napoleon',
        start_time: '1803-05-18',
        end_time: '1815-11-20',
        level: 0,
        parent_arc_id: null,
      },
    },
    relationships: {
      rel1: {
        id: 'rel1',
        cause_event_id: 'event1',
        effect_event_id: 'event2',
        weight: 0.8,
        evidence: 'Military victory led to diplomatic advantage',
        confidence: 0.9,
        relationship_type: 'direct',
      },
    },
    pressures: {
      pressure1: {
        id: 'pressure1',
        description: 'Nationalist sentiment',
        confidence_score: 0.85,
        pressure_type: 'political',
        evidence_event_ids: ['event1'],
        affected_arc_ids: ['arc1'],
      },
    },
  });

  beforeEach(() => {
    mockGraphRepository = {
      initialize: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn(),
      checkout: vi.fn(),
      getVersionHistory: vi.fn().mockResolvedValue({ versions: [], total: 0 }),
    };

    vi.mocked(GraphRepository).mockImplementation(() => mockGraphRepository as unknown as GraphRepository);
    exportService = new ExportService({ dataDir: './test-data', appVersion: '1.0.0-test' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize the graph repository and create exports directory', async () => {
      await exportService.initialize();

      expect(mockGraphRepository.initialize).toHaveBeenCalled();
      expect(fs.promises.mkdir).toHaveBeenCalled();
    });
  });

  describe('exportGraph', () => {
    it('should export a full graph successfully', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      expect(result.export.version).toBe('1.0');
      expect(result.export.metadata.graphId).toBe('graph_123');
      expect(result.export.metadata.graphName).toBe('Test Graph');
      expect(result.export.data.events).toHaveLength(2);
      expect(result.export.data.arcs).toHaveLength(1);
      expect(result.export.data.causalRelationships).toHaveLength(1);
      expect(result.export.data.inferredPressures).toHaveLength(1);
    });

    it('should throw error when graph not found', async () => {
      mockGraphRepository.findById.mockResolvedValue(null);

      await expect(exportService.exportGraph({
        graphId: 'nonexistent',
        scope: 'full',
        includeProvenance: false,
      })).rejects.toThrow('Graph not found: nonexistent');
    });

    it('should include provenance when requested', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: true,
      });

      expect(result.export.provenance).toBeDefined();
      expect(result.export.provenance?.sources).toBeDefined();
      expect(result.export.provenance?.importHistory).toBeDefined();
    });

    it('should export for specific version', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
        version: 5,
      });

      expect(mockGraphRepository.checkout).toHaveBeenCalledWith('graph_123', 5);
    });

    it('should calculate checksum of data', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      expect(result.export.metadata.checksum).toBeDefined();
      expect(result.export.metadata.checksum).toHaveLength(64); // SHA-256 hex
    });

    it('should include size in result', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      expect(result.size).toBeGreaterThan(0);
    });
  });

  describe('exportToFile', () => {
    it('should write export to file', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const filePath = await exportService.exportToFile({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      expect(fs.promises.writeFile).toHaveBeenCalled();
      expect(filePath).toContain('export_graph_123_');
      expect(filePath).toContain('.json');
    });

    it('should use provided output path', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const customPath = '/custom/path/export.json';
      const filePath = await exportService.exportToFile({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      }, customPath);

      expect(filePath).toBe(customPath);
    });
  });

  describe('estimateExportSize', () => {
    it('should estimate export size based on metadata', async () => {
      const mockGraph = createMockGraph({
        metadata: {
          eventCount: 100,
          arcCount: 20,
          relationshipCount: 50,
          pressureCount: 10,
        },
      });
      mockGraphRepository.findById.mockResolvedValue(mockGraph);

      const estimate = await exportService.estimateExportSize({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      // 100*500 + 20*300 + 50*200 + 10*400 + 2000 = 50000 + 6000 + 10000 + 4000 + 2000 = 72000
      expect(estimate).toBe(72000);
    });

    it('should throw error when graph not found', async () => {
      mockGraphRepository.findById.mockResolvedValue(null);

      await expect(exportService.estimateExportSize({
        graphId: 'nonexistent',
        scope: 'full',
        includeProvenance: false,
      })).rejects.toThrow('Graph not found: nonexistent');
    });
  });

  describe('validateExport', () => {
    it('should validate a correct export', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const { export: exportData } = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      const result = exportService.validateExport(exportData);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing metadata', () => {
      const invalidExport = {
        version: '1.0',
        data: {
          events: [],
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
        },
      } as unknown as AlthistoryExport;

      const result = exportService.validateExport(invalidExport);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing metadata');
    });

    it('should detect missing graphId in metadata', () => {
      const invalidExport: AlthistoryExport = {
        version: '1.0',
        metadata: {
          graphId: '',
          graphName: 'Test',
          exportedAt: new Date().toISOString(),
          sourceVersion: '1.0.0',
          graphVersion: 1,
          checksum: 'abc123',
        },
        data: {
          events: [],
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
        },
      };

      const result = exportService.validateExport(invalidExport);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing graphId in metadata');
    });

    it('should detect missing data section', () => {
      const invalidExport = {
        version: '1.0',
        metadata: {
          graphId: 'graph_123',
          graphName: 'Test',
          exportedAt: new Date().toISOString(),
          sourceVersion: '1.0.0',
          graphVersion: 1,
          checksum: 'abc123',
        },
      } as unknown as AlthistoryExport;

      const result = exportService.validateExport(invalidExport);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing data');
    });

    it('should warn about unknown version', () => {
      const exportData: AlthistoryExport = {
        version: '2.0' as '1.0',
        metadata: {
          graphId: 'graph_123',
          graphName: 'Test',
          exportedAt: new Date().toISOString(),
          sourceVersion: '1.0.0',
          graphVersion: 1,
          checksum: 'abc123',
        },
        data: {
          events: [],
          arcs: [],
          causalRelationships: [],
          inferredPressures: [],
        },
      };

      const result = exportService.validateExport(exportData);

      expect(result.warnings).toContain('Unknown version: 2.0');
    });

    it('should detect checksum mismatch', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const { export: exportData } = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      // Modify data to break checksum
      exportData.data.events.push({
        id: 'tampered',
        description: 'Tampered event',
        actor: 'Unknown',
        target: 'Unknown',
        timestamp: '2024-01-01T00:00:00Z',
      });

      const result = exportService.validateExport(exportData);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Checksum mismatch - data may be corrupted');
    });

    it('should warn about missing event references in relationships', () => {
      const exportData: AlthistoryExport = {
        version: '1.0',
        metadata: {
          graphId: 'graph_123',
          graphName: 'Test',
          exportedAt: new Date().toISOString(),
          sourceVersion: '1.0.0',
          graphVersion: 1,
          checksum: '',
        },
        data: {
          events: [{ id: 'event1', description: 'Test', actor: 'Actor', target: 'Target', timestamp: '2024-01-01' }],
          arcs: [],
          causalRelationships: [
            {
              id: 'rel1',
              cause_event_id: 'event1',
              effect_event_id: 'missing_event',
              weight: 0.8,
              evidence: 'Test',
              confidence: 0.9,
              relationship_type: 'direct',
            },
          ],
          inferredPressures: [],
        },
      };

      const result = exportService.validateExport(exportData);

      expect(result.warnings.some(w => w.includes('missing effect event missing_event'))).toBe(true);
    });

    it('should not warn about cross-graph references', () => {
      const exportData: AlthistoryExport = {
        version: '1.0',
        metadata: {
          graphId: 'graph_123',
          graphName: 'Test',
          exportedAt: new Date().toISOString(),
          sourceVersion: '1.0.0',
          graphVersion: 1,
          checksum: '',
        },
        data: {
          events: [{ id: 'event1', description: 'Test', actor: 'Actor', target: 'Target', timestamp: '2024-01-01' }],
          arcs: [],
          causalRelationships: [
            {
              id: 'rel1',
              cause_event_id: 'event1',
              effect_event_id: 'external_event',
              effectGraphId: 'other_graph',
              weight: 0.8,
              evidence: 'Test',
              confidence: 0.9,
              relationship_type: 'direct',
            },
          ],
          inferredPressures: [],
        },
      };

      const result = exportService.validateExport(exportData);

      // Should not warn about external_event since it's a cross-graph reference
      expect(result.warnings.filter(w => w.includes('external_event'))).toHaveLength(0);
    });
  });

  describe('applyFilters - via exportGraph with filtered scope', () => {
    it('should filter events by time range', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'filtered',
        filters: {
          timeRange: {
            start: '1800-01-01',
            end: '1806-01-01',
          },
        },
        includeProvenance: false,
      });

      // Only event1 (1805) should be included, not event2 (1807)
      expect(result.export.data.events).toHaveLength(1);
      expect(result.export.data.events[0].id).toBe('event1');
    });

    it('should filter events by actor', async () => {
      const mockGraph = createMockGraph();
      const mockData: ResolvedGraphData = {
        events: {
          event1: { id: 'event1', description: 'Event 1', actor: 'Napoleon', target: 'Target', timestamp: '2024-01-01T00:00:00Z' },
          event2: { id: 'event2', description: 'Event 2', actor: 'Wellington', target: 'Target', timestamp: '2024-01-02T00:00:00Z' },
        },
        arcs: {},
        relationships: {},
        pressures: {},
      };
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'filtered',
        filters: {
          actors: ['Napoleon'],
        },
        includeProvenance: false,
      });

      expect(result.export.data.events).toHaveLength(1);
      expect(result.export.data.events[0].actor).toBe('Napoleon');
    });

    it('should filter events by target', async () => {
      const mockGraph = createMockGraph();
      const mockData: ResolvedGraphData = {
        events: {
          event1: { id: 'event1', description: 'Event 1', actor: 'Actor', target: 'France', timestamp: '2024-01-01T00:00:00Z' },
          event2: { id: 'event2', description: 'Event 2', actor: 'Actor', target: 'Prussia', timestamp: '2024-01-02T00:00:00Z' },
        },
        arcs: {},
        relationships: {},
        pressures: {},
      };
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'filtered',
        filters: {
          targets: ['France'],
        },
        includeProvenance: false,
      });

      expect(result.export.data.events).toHaveLength(1);
      expect(result.export.data.events[0].target).toBe('France');
    });

    it('should filter events by specific event IDs', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'filtered',
        filters: {
          eventIds: ['event1'],
        },
        includeProvenance: false,
      });

      expect(result.export.data.events).toHaveLength(1);
      expect(result.export.data.events[0].id).toBe('event1');
    });

    it('should filter arcs by arc IDs', async () => {
      const mockGraph = createMockGraph();
      const mockData: ResolvedGraphData = {
        events: {},
        arcs: {
          arc1: { id: 'arc1', name: 'Arc 1', description: 'Desc', start_time: '2024-01-01', end_time: '2024-12-31', level: 0, parent_arc_id: null },
          arc2: { id: 'arc2', name: 'Arc 2', description: 'Desc', start_time: '2024-01-01', end_time: '2024-12-31', level: 0, parent_arc_id: null },
        },
        relationships: {},
        pressures: {},
      };
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'filtered',
        filters: {
          arcIds: ['arc1'],
        },
        includeProvenance: false,
      });

      expect(result.export.data.arcs).toHaveLength(1);
      expect(result.export.data.arcs[0].id).toBe('arc1');
    });

    it('should filter arcs by time range overlap', async () => {
      const mockGraph = createMockGraph();
      const mockData: ResolvedGraphData = {
        events: {},
        arcs: {
          arc1: { id: 'arc1', name: 'Arc 1', description: 'Desc', start_time: '2024-01-01', end_time: '2024-06-30', level: 0, parent_arc_id: null },
          arc2: { id: 'arc2', name: 'Arc 2', description: 'Desc', start_time: '2024-07-01', end_time: '2024-12-31', level: 0, parent_arc_id: null },
        },
        relationships: {},
        pressures: {},
      };
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'filtered',
        filters: {
          timeRange: {
            start: '2024-01-01',
            end: '2024-03-31',
          },
        },
        includeProvenance: false,
      });

      // Only arc1 overlaps with the filter range
      expect(result.export.data.arcs).toHaveLength(1);
      expect(result.export.data.arcs[0].id).toBe('arc1');
    });

    it('should filter relationships based on included events', async () => {
      const mockGraph = createMockGraph();
      const mockData: ResolvedGraphData = {
        events: {
          event1: { id: 'event1', description: 'Event 1', actor: 'Napoleon', target: 'Target', timestamp: '2024-01-01T00:00:00Z' },
          event2: { id: 'event2', description: 'Event 2', actor: 'Wellington', target: 'Target', timestamp: '2024-01-02T00:00:00Z' },
        },
        arcs: {},
        relationships: {
          rel1: { id: 'rel1', cause_event_id: 'event1', effect_event_id: 'event2', weight: 0.8, evidence: 'Test', confidence: 0.9, relationship_type: 'direct' },
        },
        pressures: {},
      };
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'filtered',
        filters: {
          actors: ['Napoleon'], // Only event1 matches
        },
        includeProvenance: false,
      });

      // Relationship should be excluded because event2 is not included
      expect(result.export.data.causalRelationships).toHaveLength(0);
    });

    it('should filter pressures based on included arcs', async () => {
      const mockGraph = createMockGraph();
      const mockData: ResolvedGraphData = {
        events: {},
        arcs: {
          arc1: { id: 'arc1', name: 'Arc 1', description: 'Desc', start_time: '2024-01-01', end_time: '2024-12-31', level: 0, parent_arc_id: null },
          arc2: { id: 'arc2', name: 'Arc 2', description: 'Desc', start_time: '2024-01-01', end_time: '2024-12-31', level: 0, parent_arc_id: null },
        },
        relationships: {},
        pressures: {
          pressure1: { id: 'pressure1', description: 'P1', confidence_score: 0.8, pressure_type: 'political', evidence_event_ids: [], affected_arc_ids: ['arc1'] },
          pressure2: { id: 'pressure2', description: 'P2', confidence_score: 0.8, pressure_type: 'economic', evidence_event_ids: [], affected_arc_ids: ['arc2'] },
        },
      };
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'filtered',
        filters: {
          arcIds: ['arc1'],
        },
        includeProvenance: false,
      });

      expect(result.export.data.inferredPressures).toHaveLength(1);
      expect(result.export.data.inferredPressures[0].id).toBe('pressure1');
    });

    it('should include filters in metadata when filtered', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const filters = {
        timeRange: { start: '2024-01-01', end: '2024-12-31' },
        actors: ['Napoleon'],
      };

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'filtered',
        filters,
        includeProvenance: false,
      });

      expect(result.export.metadata.filters).toEqual(filters);
    });

    it('should not include filters in metadata when full scope', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      expect(result.export.metadata.filters).toBeUndefined();
    });
  });

  describe('calculateChecksum', () => {
    it('should produce consistent checksums for same data', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result1 = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      const result2 = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      // Data should be the same, so checksums should match
      // Note: The timestamp in exportedAt will differ, but checksum is only on data
      expect(result1.export.metadata.checksum).toBe(result2.export.metadata.checksum);
    });
  });

  describe('getProvenance', () => {
    it('should return provenance structure', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: true,
      });

      expect(result.export.provenance).toBeDefined();
      expect(Array.isArray(result.export.provenance?.sources)).toBe(true);
      expect(Array.isArray(result.export.provenance?.importHistory)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty graph data', async () => {
      const mockGraph = createMockGraph({
        metadata: {
          eventCount: 0,
          arcCount: 0,
          relationshipCount: 0,
          pressureCount: 0,
        },
      });
      const emptyData: ResolvedGraphData = {
        events: {},
        arcs: {},
        relationships: {},
        pressures: {},
      };
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(emptyData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      expect(result.export.data.events).toHaveLength(0);
      expect(result.export.data.arcs).toHaveLength(0);
      expect(result.export.data.causalRelationships).toHaveLength(0);
      expect(result.export.data.inferredPressures).toHaveLength(0);
    });

    it('should handle events with metadata', async () => {
      const mockGraph = createMockGraph();
      const mockData: ResolvedGraphData = {
        events: {
          event1: {
            id: 'event1',
            description: 'Event with metadata',
            actor: 'Actor',
            target: 'Target',
            timestamp: '2024-01-01T00:00:00Z',
            metadata: { customField: 'customValue' },
            sourceRef: 'https://example.com',
          },
        },
        arcs: {},
        relationships: {},
        pressures: {},
      };
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      expect(result.export.data.events[0].metadata).toEqual({ customField: 'customValue' });
      expect(result.export.data.events[0].sourceRef).toBe('https://example.com');
    });
  });
});
