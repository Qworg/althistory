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

/**
 * Bytes the streaming writer emitted, captured instead of touching disk.
 * `exportToFile` writes through a real `Writable`, so `pipeline` exercises the
 * same backpressure and error paths it would in production.
 */
const written = vi.hoisted(() => ({ chunks: [] as string[] }));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const { Writable } = await vi.importActual<typeof import('stream')>('stream');

  return {
    ...actual,
    createWriteStream: vi.fn(() =>
      new Writable({
        write(chunk: Buffer | string, _encoding, callback) {
          written.chunks.push(chunk.toString());
          callback();
        },
      })
    ),
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
    getLatestVersion: ReturnType<typeof vi.fn>;
    getVersion: ReturnType<typeof vi.fn>;
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
      // The fixture graph is on version 1; that is the committed head the
      // export labels itself with.
      getLatestVersion: vi.fn().mockResolvedValue({ version: 1 }),
      getVersion: vi.fn().mockResolvedValue(null),
    };

    vi.mocked(GraphRepository).mockImplementation(() => mockGraphRepository as unknown as GraphRepository);
    exportService = new ExportService({ dataDir: './test-data', appVersion: '1.0.0-test' });
  });

  afterEach(() => {
    vi.clearAllMocks();
    written.chunks.length = 0;
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
      mockGraphRepository.getVersion.mockResolvedValue({ version: 5 });

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
        version: 5,
      });

      expect(mockGraphRepository.checkout).toHaveBeenCalledWith('graph_123', 5);
      // The label names the version the data came from, not the metadata
      // counter that `createMockGraph` carries (1).
      expect(result.export.metadata.graphVersion).toBe(5);
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

      expect(fs.promises.mkdir).toHaveBeenCalled();
      expect(filePath).toContain('export_graph_123_');
      expect(filePath).toContain('.json');

      // Streamed, not buffered into one write: the document arrives as chunks.
      expect(written.chunks.length).toBeGreaterThan(1);
      const document = JSON.parse(written.chunks.join('')) as AlthistoryExport;
      expect(document.version).toBe('1.0');
      expect(document.data.events).toHaveLength(2);
      expect(document.data.arcs).toHaveLength(1);
    });

    it('should produce the same document the in-memory path returns', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      await exportService.exportToFile({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      const streamed = JSON.parse(written.chunks.join('')) as AlthistoryExport;

      // `exportedAt` is a timestamp, so it is the one field that may differ;
      // everything else, checksum included, must be identical.
      expect(streamed.metadata.checksum).toBe(result.export.metadata.checksum);
      expect({ ...streamed.metadata, exportedAt: '' }).toEqual({
        ...result.export.metadata,
        exportedAt: '',
      });
      expect(streamed.data).toEqual(result.export.data);
    });

    it('should stream a graph that the in-memory path refuses', async () => {
      const small = new ExportService({
        dataDir: './test-data',
        appVersion: '1.0.0-test',
        maxInMemorySize: 1000,
      });
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.checkout.mockResolvedValue(createMockGraphData());

      // The fixture's metadata estimates far above the 1 KB cap.
      await expect(
        small.exportGraph({ graphId: 'graph_123', scope: 'full', includeProvenance: false })
      ).rejects.toThrow('too large for in-memory operation');

      const filePath = await small.exportToFile({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      expect(filePath).toContain('.json');
      const document = JSON.parse(written.chunks.join('')) as AlthistoryExport;
      expect(document.data.events).toHaveLength(2);
    });

    it('should report streaming progress monotonically up to 1', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.checkout.mockResolvedValue(createMockGraphData());

      const fractions: number[] = [];
      await exportService.exportToFile(
        { graphId: 'graph_123', scope: 'full', includeProvenance: false },
        undefined,
        { onProgress: (fraction) => fractions.push(fraction) }
      );

      expect(fractions.length).toBeGreaterThan(0);
      expect(fractions[fractions.length - 1]).toBe(1);
      for (let i = 1; i < fractions.length; i++) {
        expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
      }
    });

    it('should stream a filtered export without the excluded entities', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.checkout.mockResolvedValue(createMockGraphData());

      await exportService.exportToFile({
        graphId: 'graph_123',
        scope: 'filtered',
        filters: { eventIds: ['event1'] },
        includeProvenance: false,
      });

      const document = JSON.parse(written.chunks.join('')) as AlthistoryExport;
      expect(document.data.events).toHaveLength(1);
      expect(document.data.events[0].id).toBe('event1');
      expect(document.metadata.filters).toEqual({ eventIds: ['event1'] });
    });

    it('should include provenance in the streamed document when asked', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.checkout.mockResolvedValue(createMockGraphData());

      await exportService.exportToFile({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: true,
      });

      const document = JSON.parse(written.chunks.join('')) as AlthistoryExport;
      expect(document.provenance).toBeDefined();
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

  describe('estimateExportSize for a pinned version', () => {
    it('uses the pinned tree, not the head metadata', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.getVersion.mockResolvedValue({ version: 0 });
      mockGraphRepository.checkout.mockResolvedValue({
        events: { e1: { id: 'e1' }, e2: { id: 'e2' } },
        arcs: {},
        relationships: {},
        pressures: {},
      });

      const size = await exportService.estimateExportSize({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
        version: 0,
      });

      // Two events at 500 bytes plus the 2000-byte metadata overhead, rather
      // than the fixture metadata's 10 events / 3 arcs / 5 relationships.
      expect(size).toBe(3000);
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

  describe('version labelling', () => {
    it('labels the export with the committed head, not the metadata counter', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.checkout.mockResolvedValue(createMockGraphData());
      mockGraphRepository.getLatestVersion.mockResolvedValue({ version: 7 });

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      expect(result.export.metadata.graphVersion).toBe(7);
    });

    it('rejects a pinned version that does not exist with NotFoundError', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.checkout.mockResolvedValue(createMockGraphData());
      mockGraphRepository.getVersion.mockResolvedValue(null);

      await expect(
        exportService.exportGraph({
          graphId: 'graph_123',
          scope: 'full',
          includeProvenance: false,
          version: 99,
        })
      ).rejects.toMatchObject({ name: 'NotFoundError' });
    });

    it('resolves the version before reading any data', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.getVersion.mockResolvedValue(null);
      mockGraphRepository.checkout.mockRejectedValue(new Error('Version 99 not found for graph'));

      await expect(
        exportService.exportGraph({
          graphId: 'graph_123',
          scope: 'full',
          includeProvenance: false,
          version: 99,
        })
      ).rejects.toMatchObject({ name: 'NotFoundError' });

      // The estimate used to run first and reach the store's plain Error,
      // which surfaced as a 500.
      expect(mockGraphRepository.checkout).not.toHaveBeenCalled();
    });

    it('checks out a pinned tree exactly once and resolves first', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.getVersion.mockResolvedValue({ version: 2 });
      mockGraphRepository.checkout.mockResolvedValue(createMockGraphData());

      await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
        version: 2,
      });

      // Measuring a pinned tree must reuse the read it already did; the
      // estimate used to trigger a second checkout of the same version.
      expect(mockGraphRepository.checkout).toHaveBeenCalledTimes(1);
      expect(mockGraphRepository.getVersion.mock.invocationCallOrder[0]).toBeLessThan(
        mockGraphRepository.checkout.mock.invocationCallOrder[0]
      );
    });

    it('reports a missing pinned version from countEntities too', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.getVersion.mockResolvedValue(null);

      await expect(
        exportService.countEntities({
          graphId: 'graph_123',
          scope: 'full',
          includeProvenance: false,
          version: 99,
        })
      ).rejects.toMatchObject({ name: 'NotFoundError' });
    });
  });

  describe('entity counts and the async threshold (Req 5.4)', () => {
    it('should report the exported entity count in the result', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.checkout.mockResolvedValue(createMockGraphData());

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      // 2 events + 1 arc + 1 relationship + 1 pressure
      expect(result.entityCount).toBe(5);
    });

    it('should count entities from graph metadata for an unfiltered latest export', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());

      const count = await exportService.countEntities({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      // metadata says 10 + 3 + 5 + 2
      expect(count).toBe(20);
      expect(mockGraphRepository.checkout).not.toHaveBeenCalled();
    });

    it('should count filtered entities from the resolved graph, not metadata', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.checkout.mockResolvedValue(createMockGraphData());

      const count = await exportService.countEntities({
        graphId: 'graph_123',
        scope: 'filtered',
        filters: { eventIds: ['event1'] },
        includeProvenance: false,
      });

      // Filtered ids only name events, so the arc and the pressure survive; the
      // relationship is dropped because its effect event did not. The point is
      // that this is the filtered tree (3), not the metadata total (20).
      expect(count).toBe(3);
      expect(mockGraphRepository.checkout).toHaveBeenCalledWith('graph_123', undefined);
    });

    it('should require an async job above the configured threshold', async () => {
      const service = new ExportService({
        dataDir: './test-data',
        appVersion: '1.0.0-test',
        asyncExportThreshold: 4,
      });
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());

      const decision = await service.shouldUseAsyncExport({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      // metadata: 20 entities > 4
      expect(decision).toEqual({ entityCount: 20, useAsync: true });
    });

    it('should stay synchronous at exactly the threshold', async () => {
      const service = new ExportService({
        dataDir: './test-data',
        appVersion: '1.0.0-test',
        asyncExportThreshold: 20,
      });
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());

      const decision = await service.shouldUseAsyncExport({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      expect(decision).toEqual({ entityCount: 20, useAsync: false });
    });

    it('should default the threshold to 10,000 entities', () => {
      expect(exportService.asyncExportThreshold).toBe(10_000);
    });
  });

  describe('cross-graph references (Req 4.4)', () => {
    const ref = {
      referencedGraphId: 'graph_remote',
      referencedEntityId: 'remote-event',
      referencedEntityType: 'event' as const,
    };

    it('should hoist references out of entity metadata into data.crossGraphRefs', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.checkout.mockResolvedValue({
        events: {
          event1: {
            id: 'event1',
            description: 'Imported event',
            actor: 'Actor',
            target: 'Target',
            timestamp: '2024-01-01T00:00:00Z',
            metadata: { customField: 'kept', crossGraphRefs: [ref] },
          },
        },
        arcs: {
          arc1: {
            id: 'arc1',
            name: 'Arc',
            description: 'Imported arc',
            start_time: '2023-01-01',
            end_time: '2024-01-01',
            level: 0,
            parent_arc_id: null,
            metadata: { crossGraphRefs: [{ ...ref, referencedEntityType: 'arc' }] },
          },
        },
        relationships: {},
        pressures: {},
      });

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      expect(result.export.data.crossGraphRefs).toEqual([
        { localEntityId: 'event1', localEntityType: 'event', ...ref },
        {
          localEntityId: 'arc1',
          localEntityType: 'arc',
          ...ref,
          referencedEntityType: 'arc',
        },
      ]);

      // The private storage key is not duplicated into exported metadata.
      expect(result.export.data.events[0].metadata).toEqual({ customField: 'kept' });
      expect(result.export.data.arcs[0].metadata).toBeUndefined();
    });

    it('should keep relationship-local references', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      const mockData = createMockGraphData();
      mockData.relationships.rel1.metadata = { crossGraphRefs: [ref] };
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      expect(result.export.data.crossGraphRefs).toEqual([
        { localEntityId: 'rel1', localEntityType: 'relationship', ...ref },
      ]);
    });

    it('should omit crossGraphRefs when the graph has none', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.checkout.mockResolvedValue(createMockGraphData());

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      expect(result.export.data.crossGraphRefs).toBeUndefined();
      expect('crossGraphRefs' in result.export.data).toBe(false);
    });

    it('should not export references belonging to entities the filters exclude', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.checkout.mockResolvedValue({
        events: {
          event1: {
            id: 'event1',
            description: 'Kept',
            actor: 'A',
            target: 'B',
            timestamp: '2024-01-01T00:00:00Z',
            metadata: { crossGraphRefs: [ref] },
          },
          event2: {
            id: 'event2',
            description: 'Filtered out',
            actor: 'C',
            target: 'D',
            timestamp: '2025-01-01T00:00:00Z',
            metadata: { crossGraphRefs: [ref] },
          },
        },
        arcs: {},
        relationships: {},
        pressures: {},
      });

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'filtered',
        filters: { eventIds: ['event1'] },
        includeProvenance: false,
      });

      expect(result.export.data.crossGraphRefs).toEqual([
        { localEntityId: 'event1', localEntityType: 'event', ...ref },
      ]);
    });

    it('should drop references without a usable target', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.checkout.mockResolvedValue({
        events: {
          event1: {
            id: 'event1',
            description: 'Has junk refs',
            actor: 'Actor',
            target: 'Target',
            timestamp: '2024-01-01T00:00:00Z',
            metadata: {
              crossGraphRefs: [
                { referencedEntityId: 'no-graph' },
                { referencedGraphId: 'g', referencedEntityId: 'e', referencedEntityType: 'pressure' },
                ref,
              ],
            },
          },
        },
        arcs: {},
        relationships: {},
        pressures: {},
      });

      const result = await exportService.exportGraph({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      expect(result.export.data.crossGraphRefs).toHaveLength(1);
    });
  });
});
