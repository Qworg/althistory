import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GraphService } from './GraphService';
import { GraphRepository } from '../repositories/GraphRepository';
import { Graph, IGraph, MergeConflict } from '../models/Graph';
import { ValidationError, NotFoundError } from '../utils/errors';
import { ResolvedGraphData, EntityChanges } from '../repositories/VersionRepository';

// Mock the GraphRepository
vi.mock('../repositories/GraphRepository');

describe('GraphService', () => {
  let graphService: GraphService;
  let mockGraphRepository: {
    initialize: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    getActiveGraph: ReturnType<typeof vi.fn>;
    setActiveGraph: ReturnType<typeof vi.fn>;
    getVersionHistory: ReturnType<typeof vi.fn>;
    getVersion: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
    branch: ReturnType<typeof vi.fn>;
    checkout: ReturnType<typeof vi.fn>;
    commitChanges: ReturnType<typeof vi.fn>;
    gc: ReturnType<typeof vi.fn>;
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
      event1: { id: 'event1', description: 'Event 1', actor: 'Actor 1', target: 'Target 1', timestamp: '2024-01-01T00:00:00Z' },
      event2: { id: 'event2', description: 'Event 2', actor: 'Actor 2', target: 'Target 2', timestamp: '2024-01-02T00:00:00Z' },
    },
    arcs: {
      arc1: { id: 'arc1', name: 'Arc 1', description: 'Arc 1 description', start_time: '2024-01-01', end_time: '2024-12-31', level: 0, parent_arc_id: null },
    },
    relationships: {
      rel1: { id: 'rel1', cause_event_id: 'event1', effect_event_id: 'event2', weight: 0.8, evidence: 'Evidence', confidence: 0.9, relationship_type: 'direct' },
    },
    pressures: {},
  });

  beforeEach(() => {
    mockGraphRepository = {
      initialize: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(),
      findById: vi.fn(),
      findAll: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getActiveGraph: vi.fn(),
      setActiveGraph: vi.fn(),
      getVersionHistory: vi.fn(),
      getVersion: vi.fn(),
      rollback: vi.fn(),
      branch: vi.fn(),
      checkout: vi.fn(),
      commitChanges: vi.fn(),
      gc: vi.fn(),
    };

    vi.mocked(GraphRepository).mockImplementation(() => mockGraphRepository as unknown as GraphRepository);
    graphService = new GraphService({ dataDir: './test-data' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize the graph repository', async () => {
      await graphService.initialize();
      expect(mockGraphRepository.initialize).toHaveBeenCalled();
    });
  });

  describe('createGraph', () => {
    it('should create a graph with valid data', async () => {
      const mockGraph = createMockGraph();
      mockGraphRepository.create.mockResolvedValue(mockGraph);

      const result = await graphService.createGraph({
        name: 'Test Graph',
        description: 'A test graph',
      });

      expect(result).toEqual(mockGraph.toJSON());
      expect(mockGraphRepository.create).toHaveBeenCalledWith({
        name: 'Test Graph',
        description: 'A test graph',
      });
    });

    it('should trim whitespace from name and description', async () => {
      const mockGraph = createMockGraph();
      mockGraphRepository.create.mockResolvedValue(mockGraph);

      await graphService.createGraph({
        name: '  Test Graph  ',
        description: '  A test graph  ',
      });

      expect(mockGraphRepository.create).toHaveBeenCalledWith({
        name: 'Test Graph',
        description: 'A test graph',
      });
    });

    it('should throw ValidationError when name is empty', async () => {
      await expect(graphService.createGraph({ name: '' }))
        .rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when name is only whitespace', async () => {
      await expect(graphService.createGraph({ name: '   ' }))
        .rejects.toThrow(ValidationError);
    });

    it('should allow creation without description', async () => {
      const mockGraph = createMockGraph({ description: undefined });
      mockGraphRepository.create.mockResolvedValue(mockGraph);

      const result = await graphService.createGraph({ name: 'Test Graph' });

      expect(result.name).toBe('Test Graph');
    });
  });

  describe('getGraph', () => {
    it('should return a graph when found', async () => {
      const mockGraph = createMockGraph();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);

      const result = await graphService.getGraph('graph_123');

      expect(result).toEqual(mockGraph.toJSON());
      expect(mockGraphRepository.findById).toHaveBeenCalledWith('graph_123');
    });

    it('should throw NotFoundError when graph does not exist', async () => {
      mockGraphRepository.findById.mockResolvedValue(null);

      await expect(graphService.getGraph('nonexistent'))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('listGraphs', () => {
    it('should return all graphs with default options', async () => {
      const mockGraphs = [createMockGraph(), createMockGraph({ id: 'graph_456', name: 'Another Graph' })];
      mockGraphRepository.findAll.mockResolvedValue({
        graphs: mockGraphs.map(g => g.toJSON()),
        total: 2,
      });

      const result = await graphService.listGraphs();

      expect(result.graphs).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should pass options to repository', async () => {
      mockGraphRepository.findAll.mockResolvedValue({ graphs: [], total: 0 });

      await graphService.listGraphs({ status: 'active', limit: 10, offset: 5 });

      expect(mockGraphRepository.findAll).toHaveBeenCalledWith({
        status: 'active',
        limit: 10,
        offset: 5,
      });
    });
  });

  describe('updateGraph', () => {
    it('should update a graph with valid data', async () => {
      const mockGraph = createMockGraph();
      mockGraphRepository.update.mockResolvedValue(mockGraph);

      const result = await graphService.updateGraph('graph_123', {
        name: 'Updated Name',
        description: 'Updated description',
      });

      expect(result).toEqual(mockGraph.toJSON());
    });

    it('should trim whitespace from updates', async () => {
      const mockGraph = createMockGraph();
      mockGraphRepository.update.mockResolvedValue(mockGraph);

      await graphService.updateGraph('graph_123', {
        name: '  Updated Name  ',
        description: '  Updated description  ',
      });

      expect(mockGraphRepository.update).toHaveBeenCalledWith('graph_123', {
        name: 'Updated Name',
        description: 'Updated description',
        status: undefined,
      });
    });

    it('should throw NotFoundError when graph does not exist', async () => {
      mockGraphRepository.update.mockResolvedValue(null);

      await expect(graphService.updateGraph('nonexistent', { name: 'New Name' }))
        .rejects.toThrow(NotFoundError);
    });

    it('should allow updating status', async () => {
      const mockGraph = createMockGraph({ status: 'archived' });
      mockGraphRepository.update.mockResolvedValue(mockGraph);

      const result = await graphService.updateGraph('graph_123', { status: 'archived' });

      expect(result.status).toBe('archived');
    });
  });

  describe('deleteGraph', () => {
    it('should delete an existing graph', async () => {
      mockGraphRepository.delete.mockResolvedValue(true);

      await expect(graphService.deleteGraph('graph_123')).resolves.not.toThrow();
      expect(mockGraphRepository.delete).toHaveBeenCalledWith('graph_123');
    });

    it('should throw NotFoundError when graph does not exist', async () => {
      mockGraphRepository.delete.mockResolvedValue(false);

      await expect(graphService.deleteGraph('nonexistent'))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('getActiveGraph', () => {
    it('should return the active graph', async () => {
      const mockGraph = createMockGraph();
      mockGraphRepository.getActiveGraph.mockResolvedValue(mockGraph);

      const result = await graphService.getActiveGraph();

      expect(result).toEqual(mockGraph.toJSON());
    });

    it('should return null when no active graph', async () => {
      mockGraphRepository.getActiveGraph.mockResolvedValue(null);

      const result = await graphService.getActiveGraph();

      expect(result).toBeNull();
    });
  });

  describe('setActiveGraph', () => {
    it('should set the active graph successfully', async () => {
      mockGraphRepository.setActiveGraph.mockResolvedValue(true);

      await expect(graphService.setActiveGraph('graph_123')).resolves.not.toThrow();
      expect(mockGraphRepository.setActiveGraph).toHaveBeenCalledWith('graph_123');
    });

    it('should throw ValidationError when graph cannot be activated', async () => {
      mockGraphRepository.setActiveGraph.mockResolvedValue(false);

      await expect(graphService.setActiveGraph('invalid'))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('getVersionHistory', () => {
    it('should return version history for a graph', async () => {
      const mockGraph = createMockGraph();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.getVersionHistory.mockResolvedValue({
        versions: [
          { graphId: 'graph_123', version: 2, timestamp: '2024-01-02T00:00:00Z', parentVersion: 1, operation: 'update', changes: { added: [], modified: [], deleted: [] }, treeHash: 'hash2' },
          { graphId: 'graph_123', version: 1, timestamp: '2024-01-01T00:00:00Z', parentVersion: null, operation: 'create', changes: { added: [], modified: [], deleted: [] }, treeHash: 'hash1' },
        ],
        total: 2,
      });

      const result = await graphService.getVersionHistory('graph_123');

      expect(result.versions).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should throw NotFoundError when graph does not exist', async () => {
      mockGraphRepository.findById.mockResolvedValue(null);

      await expect(graphService.getVersionHistory('nonexistent'))
        .rejects.toThrow(NotFoundError);
    });

    it('should pass limit and offset to repository', async () => {
      const mockGraph = createMockGraph();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.getVersionHistory.mockResolvedValue({ versions: [], total: 0 });

      await graphService.getVersionHistory('graph_123', 20, 10);

      expect(mockGraphRepository.getVersionHistory).toHaveBeenCalledWith('graph_123', 20, 10);
    });
  });

  describe('rollbackGraph', () => {
    it('should rollback to a specific version', async () => {
      const mockGraph = createMockGraph();
      const versionRef = {
        graphId: 'graph_123',
        version: 3,
        timestamp: '2024-01-03T00:00:00Z',
        parentVersion: 2,
        operation: 'rollback' as const,
        changes: { added: [], modified: [], deleted: [] },
        treeHash: 'hash3',
      };
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.getVersion.mockResolvedValue(versionRef);
      mockGraphRepository.rollback.mockResolvedValue(versionRef);

      const result = await graphService.rollbackGraph('graph_123', 1);

      expect(result.operation).toBe('rollback');
    });

    it('should throw NotFoundError when graph does not exist', async () => {
      mockGraphRepository.findById.mockResolvedValue(null);

      await expect(graphService.rollbackGraph('nonexistent', 1))
        .rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when version does not exist', async () => {
      const mockGraph = createMockGraph();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.getVersion.mockResolvedValue(null);

      await expect(graphService.rollbackGraph('graph_123', 999))
        .rejects.toThrow(NotFoundError);
    });

    it('should pass userId when provided', async () => {
      const mockGraph = createMockGraph();
      const versionRef = {
        graphId: 'graph_123',
        version: 3,
        timestamp: '2024-01-03T00:00:00Z',
        parentVersion: 2,
        operation: 'rollback' as const,
        userId: 'user123',
        changes: { added: [], modified: [], deleted: [] },
        treeHash: 'hash3',
      };
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.getVersion.mockResolvedValue(versionRef);
      mockGraphRepository.rollback.mockResolvedValue(versionRef);

      await graphService.rollbackGraph('graph_123', 1, 'user123');

      expect(mockGraphRepository.rollback).toHaveBeenCalledWith('graph_123', 1, 'user123');
    });
  });

  describe('branchGraph', () => {
    it('should create a branch from existing graph', async () => {
      const sourceGraph = createMockGraph();
      const branchGraph = createMockGraph({
        id: 'graph_456',
        name: 'Branch Graph',
        parentGraphId: 'graph_123',
        branchPoint: 1,
      });
      mockGraphRepository.findById.mockResolvedValue(sourceGraph);
      mockGraphRepository.branch.mockResolvedValue(branchGraph);

      const result = await graphService.branchGraph('graph_123', {
        name: 'Branch Graph',
        description: 'A branch',
      });

      expect(result.parentGraphId).toBe('graph_123');
      expect(result.name).toBe('Branch Graph');
    });

    it('should throw ValidationError when name is empty', async () => {
      await expect(graphService.branchGraph('graph_123', { name: '' }))
        .rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when name is only whitespace', async () => {
      await expect(graphService.branchGraph('graph_123', { name: '   ' }))
        .rejects.toThrow(ValidationError);
    });

    it('should throw NotFoundError when source graph does not exist', async () => {
      mockGraphRepository.findById.mockResolvedValue(null);

      await expect(graphService.branchGraph('nonexistent', { name: 'Branch' }))
        .rejects.toThrow(NotFoundError);
    });

    it('should trim whitespace from branch name and description', async () => {
      const sourceGraph = createMockGraph();
      const branchGraph = createMockGraph({ name: 'Branch Graph', parentGraphId: 'graph_123' });
      mockGraphRepository.findById.mockResolvedValue(sourceGraph);
      mockGraphRepository.branch.mockResolvedValue(branchGraph);

      await graphService.branchGraph('graph_123', {
        name: '  Branch Graph  ',
        description: '  A branch  ',
      });

      expect(mockGraphRepository.branch).toHaveBeenCalledWith(
        'graph_123',
        'Branch Graph',
        'A branch'
      );
    });
  });

  describe('mergeGraph', () => {
    it('should merge graphs without conflicts', async () => {
      const targetGraph = createMockGraph({ id: 'target_graph' });
      const sourceGraph = createMockGraph({ id: 'source_graph', name: 'Source' });
      const targetData = createMockGraphData();
      const sourceData: ResolvedGraphData = {
        events: {
          event3: { id: 'event3', description: 'Event 3', actor: 'Actor 3', target: 'Target 3', timestamp: '2024-01-03T00:00:00Z' },
        },
        arcs: {},
        relationships: {},
        pressures: {},
      };

      mockGraphRepository.findById
        .mockResolvedValueOnce(targetGraph)
        .mockResolvedValueOnce(sourceGraph)
        .mockResolvedValue(targetGraph);
      mockGraphRepository.checkout
        .mockResolvedValueOnce(targetData)
        .mockResolvedValueOnce(sourceData);
      mockGraphRepository.commitChanges.mockResolvedValue({
        graphId: 'target_graph',
        version: 2,
        timestamp: new Date().toISOString(),
        parentVersion: 1,
        operation: 'import',
        changes: { added: [], modified: [], deleted: [] },
        treeHash: 'newhash',
      });

      const result = await graphService.mergeGraph('target_graph', {
        sourceGraphId: 'source_graph',
        conflictResolution: 'keep-target',
      });

      expect(result.success).toBe(true);
      expect(result.newVersion).toBe(2);
    });

    it('should detect merge conflicts when same entity modified in both graphs', async () => {
      const targetGraph = createMockGraph({ id: 'target_graph' });
      const sourceGraph = createMockGraph({ id: 'source_graph' });
      const targetData: ResolvedGraphData = {
        events: {
          event1: { id: 'event1', description: 'Target version', actor: 'Actor 1', target: 'Target 1', timestamp: '2024-01-01T00:00:00Z' },
        },
        arcs: {},
        relationships: {},
        pressures: {},
      };
      const sourceData: ResolvedGraphData = {
        events: {
          event1: { id: 'event1', description: 'Source version', actor: 'Actor 1', target: 'Target 1', timestamp: '2024-01-01T00:00:00Z' },
        },
        arcs: {},
        relationships: {},
        pressures: {},
      };

      mockGraphRepository.findById
        .mockResolvedValueOnce(targetGraph)
        .mockResolvedValueOnce(sourceGraph);
      mockGraphRepository.checkout
        .mockResolvedValueOnce(targetData)
        .mockResolvedValueOnce(sourceData);

      // Note: Current implementation requires manualResolutions even for non-manual strategies
      // when there are conflicts. Testing with 'keep-target' which also triggers conflict detection.
      const result = await graphService.mergeGraph('target_graph', {
        sourceGraphId: 'source_graph',
        conflictResolution: 'keep-target',
      });

      expect(result.success).toBe(false);
      expect(result.conflicts).toBeDefined();
      expect(result.conflicts?.length).toBeGreaterThan(0);
    });

    it('should throw NotFoundError when target graph does not exist', async () => {
      mockGraphRepository.findById.mockResolvedValue(null);

      await expect(graphService.mergeGraph('nonexistent', {
        sourceGraphId: 'source_graph',
        conflictResolution: 'keep-target',
      })).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when source graph does not exist', async () => {
      const targetGraph = createMockGraph();
      mockGraphRepository.findById
        .mockResolvedValueOnce(targetGraph)
        .mockResolvedValueOnce(null);

      await expect(graphService.mergeGraph('target_graph', {
        sourceGraphId: 'nonexistent',
        conflictResolution: 'keep-target',
      })).rejects.toThrow(NotFoundError);
    });

    it('should resolve conflicts with keep-source strategy when manual resolutions provided', async () => {
      const targetGraph = createMockGraph({ id: 'target_graph' });
      const sourceGraph = createMockGraph({ id: 'source_graph' });
      const targetData: ResolvedGraphData = {
        events: {
          event1: { id: 'event1', description: 'Target version', actor: 'Actor 1', target: 'Target 1', timestamp: '2024-01-01T00:00:00Z' },
        },
        arcs: {},
        relationships: {},
        pressures: {},
      };
      const sourceData: ResolvedGraphData = {
        events: {
          event1: { id: 'event1', description: 'Source version', actor: 'Actor 1', target: 'Target 1', timestamp: '2024-01-01T00:00:00Z' },
        },
        arcs: {},
        relationships: {},
        pressures: {},
      };

      mockGraphRepository.findById
        .mockResolvedValueOnce(targetGraph)
        .mockResolvedValueOnce(sourceGraph)
        .mockResolvedValue(targetGraph);
      mockGraphRepository.checkout
        .mockResolvedValueOnce(targetData)
        .mockResolvedValueOnce(sourceData);
      mockGraphRepository.commitChanges.mockResolvedValue({
        graphId: 'target_graph',
        version: 2,
        timestamp: new Date().toISOString(),
        parentVersion: 1,
        operation: 'import',
        changes: { added: [], modified: [{ type: 'event', id: 'event1', hash: 'newhash' }], deleted: [] },
        treeHash: 'newhash',
      });

      // Note: Current implementation requires manual resolutions to match number of conflicts
      const result = await graphService.mergeGraph('target_graph', {
        sourceGraphId: 'source_graph',
        conflictResolution: 'keep-source',
        manualResolutions: { 'event:event1': 'keep-source' },
      });

      expect(result.success).toBe(true);
    });

    it('should return conflicts when keep-source strategy has unresolved conflicts', async () => {
      const targetGraph = createMockGraph({ id: 'target_graph' });
      const sourceGraph = createMockGraph({ id: 'source_graph' });
      const targetData: ResolvedGraphData = {
        events: {
          event1: { id: 'event1', description: 'Target version', actor: 'Actor 1', target: 'Target 1', timestamp: '2024-01-01T00:00:00Z' },
        },
        arcs: {},
        relationships: {},
        pressures: {},
      };
      const sourceData: ResolvedGraphData = {
        events: {
          event1: { id: 'event1', description: 'Source version', actor: 'Actor 1', target: 'Target 1', timestamp: '2024-01-01T00:00:00Z' },
        },
        arcs: {},
        relationships: {},
        pressures: {},
      };

      mockGraphRepository.findById
        .mockResolvedValueOnce(targetGraph)
        .mockResolvedValueOnce(sourceGraph);
      mockGraphRepository.checkout
        .mockResolvedValueOnce(targetData)
        .mockResolvedValueOnce(sourceData);

      // Current implementation returns conflicts even for keep-source without manual resolutions
      const result = await graphService.mergeGraph('target_graph', {
        sourceGraphId: 'source_graph',
        conflictResolution: 'keep-source',
      });

      expect(result.success).toBe(false);
      expect(result.conflicts).toBeDefined();
    });
  });

  describe('getGraphData', () => {
    it('should return graph data for latest version', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await graphService.getGraphData('graph_123');

      expect(result.events).toBeDefined();
      expect(result.arcs).toBeDefined();
      expect(result.relationships).toBeDefined();
    });

    it('should return graph data for specific version', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      await graphService.getGraphData('graph_123', 1);

      expect(mockGraphRepository.checkout).toHaveBeenCalledWith('graph_123', 1);
    });

    it('should throw NotFoundError when graph does not exist', async () => {
      mockGraphRepository.findById.mockResolvedValue(null);

      await expect(graphService.getGraphData('nonexistent'))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('commitChanges', () => {
    it('should commit changes successfully', async () => {
      const mockGraph = createMockGraph();
      const changes: EntityChanges = {
        added: [{ type: 'event', id: 'event_new', data: { description: 'New event' } }],
        modified: [],
        deleted: [],
      };
      const versionRef = {
        graphId: 'graph_123',
        version: 2,
        timestamp: new Date().toISOString(),
        parentVersion: 1,
        operation: 'create' as const,
        changes: { added: [{ type: 'event' as const, id: 'event_new', hash: 'hash123' }], modified: [], deleted: [] },
        treeHash: 'treehash',
      };
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.commitChanges.mockResolvedValue(versionRef);

      const result = await graphService.commitChanges('graph_123', changes, 'create', 'Added new event');

      expect(result.version).toBe(2);
      expect(mockGraphRepository.commitChanges).toHaveBeenCalledWith(
        'graph_123',
        changes,
        'create',
        'Added new event',
        undefined
      );
    });

    it('should throw NotFoundError when graph does not exist', async () => {
      mockGraphRepository.findById.mockResolvedValue(null);

      await expect(graphService.commitChanges('nonexistent', { added: [], modified: [], deleted: [] }, 'update'))
        .rejects.toThrow(NotFoundError);
    });

    it('should pass userId to repository', async () => {
      const mockGraph = createMockGraph();
      const changes: EntityChanges = { added: [], modified: [], deleted: [] };
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.commitChanges.mockResolvedValue({
        graphId: 'graph_123',
        version: 2,
        timestamp: new Date().toISOString(),
        parentVersion: 1,
        operation: 'update',
        changes: { added: [], modified: [], deleted: [] },
        treeHash: 'hash',
      });

      await graphService.commitChanges('graph_123', changes, 'update', 'desc', 'user123');

      expect(mockGraphRepository.commitChanges).toHaveBeenCalledWith(
        'graph_123',
        changes,
        'update',
        'desc',
        'user123'
      );
    });
  });

  describe('validateCrossGraphReference', () => {
    it('should return true for valid reference', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await graphService.validateCrossGraphReference({
        graphId: 'graph_123',
        entityType: 'event',
        entityId: 'event1',
      });

      expect(result).toBe(true);
    });

    it('should return false when graph does not exist', async () => {
      mockGraphRepository.findById.mockResolvedValue(null);

      const result = await graphService.validateCrossGraphReference({
        graphId: 'nonexistent',
        entityType: 'event',
        entityId: 'event1',
      });

      expect(result).toBe(false);
    });

    it('should return false when graph is not active', async () => {
      const mockGraph = createMockGraph({ status: 'deleted' });
      mockGraphRepository.findById.mockResolvedValue(mockGraph);

      const result = await graphService.validateCrossGraphReference({
        graphId: 'graph_123',
        entityType: 'event',
        entityId: 'event1',
      });

      expect(result).toBe(false);
    });

    it('should return false when entity does not exist', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await graphService.validateCrossGraphReference({
        graphId: 'graph_123',
        entityType: 'event',
        entityId: 'nonexistent_event',
      });

      expect(result).toBe(false);
    });

    it('should validate arc references', async () => {
      const mockGraph = createMockGraph();
      const mockData = createMockGraphData();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.checkout.mockResolvedValue(mockData);

      const result = await graphService.validateCrossGraphReference({
        graphId: 'graph_123',
        entityType: 'arc',
        entityId: 'arc1',
      });

      expect(result).toBe(true);
    });
  });

  describe('gcGraph', () => {
    it('should run garbage collection successfully', async () => {
      const mockGraph = createMockGraph();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockGraphRepository.gc.mockResolvedValue({ removedObjects: 10, freedBytes: 5000 });

      const result = await graphService.gcGraph('graph_123');

      expect(result.removedObjects).toBe(10);
      expect(result.freedBytes).toBe(5000);
    });

    it('should throw NotFoundError when graph does not exist', async () => {
      mockGraphRepository.findById.mockResolvedValue(null);

      await expect(graphService.gcGraph('nonexistent'))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('getReferenceNotifications', () => {
    it('should return empty array when no notifications', async () => {
      const result = await graphService.getReferenceNotifications('graph_123');
      expect(result).toEqual([]);
    });
  });

  describe('acknowledgeNotification', () => {
    it('should not throw when notification does not exist', async () => {
      await expect(graphService.acknowledgeNotification('nonexistent'))
        .resolves.not.toThrow();
    });
  });
});
