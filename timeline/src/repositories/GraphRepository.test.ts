/**
 * GraphRepository Unit Tests
 * 
 * Tests for multi-graph management with Git-like versioning
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GraphRepository, GraphListOptions } from './GraphRepository';
import { VersionRepository, EntityChanges } from './VersionRepository';
import { Graph, IGraph, GraphMetadata, VersionRef } from '../models/Graph';

// Mock the fs module
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn(),
    stat: vi.fn(),
  },
}));

// Create mock functions for version repository
const mockInitializeGraph = vi.fn().mockResolvedValue(undefined);
const mockDeleteGraph = vi.fn().mockResolvedValue(undefined);
const mockGetVersionHistory = vi.fn().mockResolvedValue({ versions: [], total: 0 });
const mockGetVersionRef = vi.fn().mockResolvedValue(null);
const mockGetLatestVersion = vi.fn().mockResolvedValue(null);
const mockRollback = vi.fn();
const mockCommit = vi.fn();
const mockCheckout = vi.fn().mockResolvedValue({
  events: {},
  arcs: {},
  relationships: {},
  pressures: {},
});
const mockGc = vi.fn().mockResolvedValue({ removedObjects: 0, freedBytes: 0 });

// Mock VersionRepository
vi.mock('./VersionRepository', () => ({
  VersionRepository: vi.fn().mockImplementation(() => ({
    initializeGraph: mockInitializeGraph,
    deleteGraph: mockDeleteGraph,
    getVersionHistory: mockGetVersionHistory,
    getVersionRef: mockGetVersionRef,
    getLatestVersion: mockGetLatestVersion,
    rollback: mockRollback,
    commit: mockCommit,
    checkout: mockCheckout,
    gc: mockGc,
  })),
}));

describe('GraphRepository Unit Tests', () => {
  let repository: GraphRepository;
  const testDataDir = '/test/data';

  beforeEach(() => {
    // Reset fs mocks
    vi.mocked(fs.promises.mkdir).mockClear().mockResolvedValue(undefined);
    vi.mocked(fs.promises.access).mockClear();
    vi.mocked(fs.promises.readFile).mockClear();
    vi.mocked(fs.promises.writeFile).mockClear().mockResolvedValue(undefined);
    vi.mocked(fs.promises.unlink).mockClear().mockResolvedValue(undefined);
    vi.mocked(fs.promises.rm).mockClear().mockResolvedValue(undefined);
    vi.mocked(fs.promises.readdir).mockClear();
    vi.mocked(fs.promises.stat).mockClear();
    
    // Reset version repository mocks with default implementations
    mockInitializeGraph.mockClear().mockResolvedValue(undefined);
    mockDeleteGraph.mockClear().mockResolvedValue(undefined);
    mockGetVersionHistory.mockClear().mockResolvedValue({ versions: [], total: 0 });
    mockGetVersionRef.mockClear().mockResolvedValue(null);
    mockGetLatestVersion.mockClear().mockResolvedValue(null);
    mockRollback.mockClear();
    mockCommit.mockClear();
    mockCheckout.mockClear().mockResolvedValue({
      events: {},
      arcs: {},
      relationships: {},
      pressures: {},
    });
    mockGc.mockClear().mockResolvedValue({ removedObjects: 0, freedBytes: 0 });
    
    repository = new GraphRepository({ dataDir: testDataDir });
  });

  describe('Class Structure', () => {
    it('should have all required methods', () => {
      expect(GraphRepository.prototype.initialize).toBeDefined();
      expect(GraphRepository.prototype.create).toBeDefined();
      expect(GraphRepository.prototype.findById).toBeDefined();
      expect(GraphRepository.prototype.findAll).toBeDefined();
      expect(GraphRepository.prototype.update).toBeDefined();
      expect(GraphRepository.prototype.delete).toBeDefined();
      expect(GraphRepository.prototype.hardDelete).toBeDefined();
      expect(GraphRepository.prototype.setActiveGraph).toBeDefined();
      expect(GraphRepository.prototype.getActiveGraph).toBeDefined();
      expect(GraphRepository.prototype.getVersionHistory).toBeDefined();
      expect(GraphRepository.prototype.getVersion).toBeDefined();
      expect(GraphRepository.prototype.rollback).toBeDefined();
      expect(GraphRepository.prototype.commitChanges).toBeDefined();
      expect(GraphRepository.prototype.checkout).toBeDefined();
      expect(GraphRepository.prototype.branch).toBeDefined();
      expect(GraphRepository.prototype.calculateMetadata).toBeDefined();
      expect(GraphRepository.prototype.gc).toBeDefined();
    });
  });

  describe('initialize()', () => {
    it('should create graphs directory if it does not exist', async () => {
      vi.mocked(fs.promises.access).mockRejectedValueOnce(new Error('ENOENT'));
      vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);

      await repository.initialize();

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        path.join(testDataDir, 'graphs'),
        { recursive: true }
      );
    });

    it('should create index file if it does not exist', async () => {
      vi.mocked(fs.promises.access).mockRejectedValueOnce(new Error('ENOENT'));

      await repository.initialize();

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        path.join(testDataDir, 'graphs', 'index.json'),
        JSON.stringify({ graphs: [], activeGraphId: null }, null, 2),
        'utf-8'
      );
    });

    it('should not overwrite existing index file', async () => {
      vi.mocked(fs.promises.access).mockResolvedValueOnce(undefined);

      await repository.initialize();

      // writeFile should not be called for index
      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls;
      const indexWriteCall = writeCalls.find(call => 
        (call[0] as string).includes('index.json')
      );
      expect(indexWriteCall).toBeUndefined();
    });
  });

  describe('create()', () => {
    it('should create a new graph with valid data', async () => {
      const indexData = { graphs: [], activeGraphId: null };
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(indexData));
      vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);

      const graph = await repository.create({ name: 'Test Graph' });

      expect(graph).toBeInstanceOf(Graph);
      expect(graph.name).toBe('Test Graph');
      expect(graph.status).toBe('active');
      expect(graph.version).toBe(0);
    });

    it('should initialize version storage for new graph', async () => {
      const indexData = { graphs: [], activeGraphId: null };
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(indexData));

      const graph = await repository.create({ name: 'Test Graph' });

      expect(mockInitializeGraph).toHaveBeenCalledWith(graph.id);
    });

    it('should add graph to index', async () => {
      const indexData = { graphs: [], activeGraphId: null };
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(indexData));

      const graph = await repository.create({ name: 'Test Graph' });

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        path.join(testDataDir, 'graphs', 'index.json'),
        expect.stringContaining(graph.id),
        'utf-8'
      );
    });

    it('should set first graph as active', async () => {
      const indexData = { graphs: [], activeGraphId: null };
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(indexData));

      const graph = await repository.create({ name: 'First Graph' });

      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls;
      const indexCall = writeCalls.find(call =>
        (call[0] as string).includes('index.json')
      );
      expect(indexCall).toBeDefined();
      const indexContent = JSON.parse(indexCall![1] as string);
      expect(indexContent.activeGraphId).toBe(graph.id);
    });

    it('should not change active graph if one exists', async () => {
      const existingGraphId = 'existing-graph-id';
      const indexData = { graphs: [existingGraphId], activeGraphId: existingGraphId };
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(indexData));

      await repository.create({ name: 'Second Graph' });

      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls;
      const indexCall = writeCalls.find(call =>
        (call[0] as string).includes('index.json')
      );
      const indexContent = JSON.parse(indexCall![1] as string);
      expect(indexContent.activeGraphId).toBe(existingGraphId);
    });

    it('should create graph with description', async () => {
      const indexData = { graphs: [], activeGraphId: null };
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(indexData));

      const graph = await repository.create({
        name: 'Test Graph',
        description: 'A test description',
      });

      expect(graph.description).toBe('A test description');
    });

    it('should throw error for invalid graph data', async () => {
      await expect(repository.create({ name: '' })).rejects.toThrow();
    });
  });

  describe('findById()', () => {
    it('should return graph when found', async () => {
      const graphData: IGraph = {
        id: 'test-id',
        name: 'Test Graph',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        status: 'active',
        metadata: {
          eventCount: 0,
          arcCount: 0,
          relationshipCount: 0,
          pressureCount: 0,
        },
      };
      vi.mocked(fs.promises.readFile).mockResolvedValueOnce(JSON.stringify(graphData));

      const result = await repository.findById('test-id');

      expect(result).toBeInstanceOf(Graph);
      expect(result?.id).toBe('test-id');
      expect(result?.name).toBe('Test Graph');
    });

    it('should return null when graph not found', async () => {
      vi.mocked(fs.promises.readFile).mockRejectedValueOnce(new Error('ENOENT'));

      const result = await repository.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findAll()', () => {
    it('should return all graphs', async () => {
      const indexData = { graphs: ['graph1', 'graph2'], activeGraphId: 'graph1' };
      const graph1Data: IGraph = {
        id: 'graph1',
        name: 'Graph 1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        version: 1,
        status: 'active',
        metadata: { eventCount: 5, arcCount: 2, relationshipCount: 1, pressureCount: 0 },
      };
      const graph2Data: IGraph = {
        id: 'graph2',
        name: 'Graph 2',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 0,
        status: 'active',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };

      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(indexData))
        .mockResolvedValueOnce(JSON.stringify(graph1Data))
        .mockResolvedValueOnce(JSON.stringify(graph2Data));

      const result = await repository.findAll();

      expect(result.total).toBe(2);
      expect(result.graphs).toHaveLength(2);
      // Should be sorted by updatedAt descending
      expect(result.graphs[0].id).toBe('graph1');
    });

    it('should filter by status', async () => {
      const indexData = { graphs: ['graph1', 'graph2'], activeGraphId: 'graph1' };
      const graph1Data: IGraph = {
        id: 'graph1',
        name: 'Active Graph',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 1,
        status: 'active',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };
      const graph2Data: IGraph = {
        id: 'graph2',
        name: 'Archived Graph',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 0,
        status: 'archived',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };

      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(indexData))
        .mockResolvedValueOnce(JSON.stringify(graph1Data))
        .mockResolvedValueOnce(JSON.stringify(graph2Data));

      const result = await repository.findAll({ status: 'active' });

      expect(result.total).toBe(1);
      expect(result.graphs[0].id).toBe('graph1');
    });

    it('should paginate results', async () => {
      const indexData = { graphs: ['g1', 'g2', 'g3'], activeGraphId: 'g1' };
      const baseGraph = (id: string, updatedAt: string): IGraph => ({
        id,
        name: `Graph ${id}`,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt,
        version: 0,
        status: 'active',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      });

      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(indexData))
        .mockResolvedValueOnce(JSON.stringify(baseGraph('g1', '2024-01-03T00:00:00Z')))
        .mockResolvedValueOnce(JSON.stringify(baseGraph('g2', '2024-01-02T00:00:00Z')))
        .mockResolvedValueOnce(JSON.stringify(baseGraph('g3', '2024-01-01T00:00:00Z')));

      const result = await repository.findAll({ limit: 2, offset: 1 });

      expect(result.total).toBe(3);
      expect(result.graphs).toHaveLength(2);
      expect(result.graphs[0].id).toBe('g2');
      expect(result.graphs[1].id).toBe('g3');
    });

    it('should skip graphs that fail to load', async () => {
      const indexData = { graphs: ['graph1', 'graph2'], activeGraphId: 'graph1' };
      const graph2Data: IGraph = {
        id: 'graph2',
        name: 'Graph 2',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 0,
        status: 'active',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };

      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(indexData))
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce(JSON.stringify(graph2Data));

      const result = await repository.findAll();

      expect(result.total).toBe(1);
      expect(result.graphs[0].id).toBe('graph2');
    });
  });

  describe('update()', () => {
    it('should update graph with valid changes', async () => {
      const graphData: IGraph = {
        id: 'test-id',
        name: 'Original Name',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 1,
        status: 'active',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };
      vi.mocked(fs.promises.readFile).mockResolvedValueOnce(JSON.stringify(graphData));

      const result = await repository.update('test-id', { name: 'Updated Name' });

      expect(result?.name).toBe('Updated Name');
      expect(result?.version).toBe(2); // Version should increment
    });

    it('should return null if graph not found', async () => {
      vi.mocked(fs.promises.readFile).mockRejectedValueOnce(new Error('ENOENT'));

      const result = await repository.update('non-existent', { name: 'New Name' });

      expect(result).toBeNull();
    });

    it('should update graph description', async () => {
      const graphData: IGraph = {
        id: 'test-id',
        name: 'Test Graph',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 0,
        status: 'active',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };
      vi.mocked(fs.promises.readFile).mockResolvedValueOnce(JSON.stringify(graphData));

      const result = await repository.update('test-id', { description: 'New description' });

      expect(result?.description).toBe('New description');
    });

    it('should update graph status', async () => {
      const graphData: IGraph = {
        id: 'test-id',
        name: 'Test Graph',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 0,
        status: 'active',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };
      vi.mocked(fs.promises.readFile).mockResolvedValueOnce(JSON.stringify(graphData));

      const result = await repository.update('test-id', { status: 'archived' });

      expect(result?.status).toBe('archived');
    });
  });

  describe('delete()', () => {
    it('should soft delete a graph', async () => {
      const graphData: IGraph = {
        id: 'test-id',
        name: 'Test Graph',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 0,
        status: 'active',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };
      const indexData = { graphs: ['test-id', 'other-id'], activeGraphId: 'other-id' };
      
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(graphData))
        .mockResolvedValueOnce(JSON.stringify(indexData));

      const result = await repository.delete('test-id');

      expect(result).toBe(true);
      // Graph metadata should be updated with 'deleted' status
      expect(fs.promises.writeFile).toHaveBeenCalled();
    });

    it('should return false if graph not found', async () => {
      vi.mocked(fs.promises.readFile).mockRejectedValueOnce(new Error('ENOENT'));

      const result = await repository.delete('non-existent');

      expect(result).toBe(false);
    });

    it('should select new active graph if deleted graph was active', async () => {
      const graphData: IGraph = {
        id: 'test-id',
        name: 'Test Graph',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 0,
        status: 'active',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };
      const indexData = { graphs: ['test-id', 'other-id'], activeGraphId: 'test-id' };
      
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(graphData))
        .mockResolvedValueOnce(JSON.stringify(indexData));

      await repository.delete('test-id');

      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls;
      const indexCall = writeCalls.find(call =>
        (call[0] as string).includes('index.json')
      );
      expect(indexCall).toBeDefined();
      const indexContent = JSON.parse(indexCall![1] as string);
      expect(indexContent.activeGraphId).toBe('other-id');
    });
  });

  describe('hardDelete()', () => {
    it('should permanently delete graph and version data', async () => {
      const graphData: IGraph = {
        id: 'test-id',
        name: 'Test Graph',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 0,
        status: 'deleted',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };
      const indexData = { graphs: ['test-id', 'other-id'], activeGraphId: 'other-id' };
      
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(graphData))
        .mockResolvedValueOnce(JSON.stringify(indexData));

      const result = await repository.hardDelete('test-id');

      expect(result).toBe(true);
      expect(mockDeleteGraph).toHaveBeenCalledWith('test-id');
      expect(fs.promises.unlink).toHaveBeenCalled();
    });

    it('should return false if graph not found', async () => {
      vi.mocked(fs.promises.readFile).mockRejectedValueOnce(new Error('ENOENT'));

      const result = await repository.hardDelete('non-existent');

      expect(result).toBe(false);
    });

    it('should remove graph from index', async () => {
      const graphData: IGraph = {
        id: 'test-id',
        name: 'Test Graph',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 0,
        status: 'deleted',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };
      const indexData = { graphs: ['test-id', 'other-id'], activeGraphId: 'other-id' };
      
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(graphData))
        .mockResolvedValueOnce(JSON.stringify(indexData));

      await repository.hardDelete('test-id');

      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls;
      const indexCall = writeCalls.find(call =>
        (call[0] as string).includes('index.json')
      );
      const indexContent = JSON.parse(indexCall![1] as string);
      expect(indexContent.graphs).not.toContain('test-id');
    });
  });

  describe('setActiveGraph() / getActiveGraph()', () => {
    it('should set active graph for valid graph', async () => {
      const graphData: IGraph = {
        id: 'test-id',
        name: 'Test Graph',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 0,
        status: 'active',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };
      const indexData = { graphs: ['test-id', 'other-id'], activeGraphId: 'other-id' };
      
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(graphData))
        .mockResolvedValueOnce(JSON.stringify(indexData));

      const result = await repository.setActiveGraph('test-id');

      expect(result).toBe(true);
      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls;
      const indexCall = writeCalls.find(call =>
        (call[0] as string).includes('index.json')
      );
      const indexContent = JSON.parse(indexCall![1] as string);
      expect(indexContent.activeGraphId).toBe('test-id');
    });

    it('should not set active graph for non-existent graph', async () => {
      vi.mocked(fs.promises.readFile).mockRejectedValueOnce(new Error('ENOENT'));

      const result = await repository.setActiveGraph('non-existent');

      expect(result).toBe(false);
    });

    it('should not set active graph for non-active status', async () => {
      const graphData: IGraph = {
        id: 'test-id',
        name: 'Test Graph',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 0,
        status: 'archived',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };
      vi.mocked(fs.promises.readFile).mockResolvedValueOnce(JSON.stringify(graphData));

      const result = await repository.setActiveGraph('test-id');

      expect(result).toBe(false);
    });

    it('should get active graph', async () => {
      const indexData = { graphs: ['test-id'], activeGraphId: 'test-id' };
      const graphData: IGraph = {
        id: 'test-id',
        name: 'Test Graph',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 0,
        status: 'active',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };
      
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(indexData))
        .mockResolvedValueOnce(JSON.stringify(graphData));

      const result = await repository.getActiveGraph();

      expect(result?.id).toBe('test-id');
    });

    it('should return null when no active graph', async () => {
      const indexData = { graphs: [], activeGraphId: null };
      vi.mocked(fs.promises.readFile).mockResolvedValueOnce(JSON.stringify(indexData));

      const result = await repository.getActiveGraph();

      expect(result).toBeNull();
    });
  });

  describe('branch()', () => {
    it('should create a branch from existing graph', async () => {
      const sourceGraphData: IGraph = {
        id: 'source-id',
        name: 'Source Graph',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 5,
        status: 'active',
        metadata: { eventCount: 10, arcCount: 5, relationshipCount: 2, pressureCount: 1 },
      };
      const indexData = { graphs: ['source-id'], activeGraphId: 'source-id' };
      
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(sourceGraphData))
        .mockResolvedValueOnce(JSON.stringify(indexData))
        .mockResolvedValueOnce(JSON.stringify(indexData));

      mockCommit.mockResolvedValue({
        graphId: 'new-branch-id',
        version: 0,
        timestamp: new Date().toISOString(),
        parentVersion: null,
        operation: 'branch',
        changes: { added: [], modified: [], deleted: [] },
        treeHash: 'abc123',
      } as VersionRef);

      const branch = await repository.branch('source-id', 'Branch Name', 'Branch description');

      expect(branch.name).toBe('Branch Name');
      expect(branch.description).toBe('Branch description');
      expect(branch.parentGraphId).toBe('source-id');
      expect(branch.branchPoint).toBe(5);
    });

    it('should throw error if source graph not found', async () => {
      vi.mocked(fs.promises.readFile).mockRejectedValueOnce(new Error('ENOENT'));

      await expect(
        repository.branch('non-existent', 'Branch Name')
      ).rejects.toThrow('Source graph not found');
    });

    it('should copy current state from source', async () => {
      const sourceGraphData: IGraph = {
        id: 'source-id',
        name: 'Source Graph',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 1,
        status: 'active',
        metadata: { eventCount: 1, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };
      const indexData = { graphs: ['source-id'], activeGraphId: 'source-id' };
      
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(sourceGraphData))
        .mockResolvedValueOnce(JSON.stringify(indexData))
        .mockResolvedValueOnce(JSON.stringify(indexData));

      // Note: branch() calls checkout() on the source which uses getLatestVersion first
      mockGetLatestVersion.mockResolvedValue({
        graphId: 'source-id',
        version: 1,
        timestamp: new Date().toISOString(),
        parentVersion: 0,
        operation: 'create',
        changes: { added: [], modified: [], deleted: [] },
        treeHash: 'source-tree-hash',
      } as VersionRef);

      mockCheckout.mockResolvedValue({
        events: { 'event1': { id: 'event1', description: 'Test' } },
        arcs: {},
        relationships: {},
        pressures: {},
      });
      mockCommit.mockResolvedValue({
        graphId: 'new-branch-id',
        version: 0,
        timestamp: new Date().toISOString(),
        parentVersion: null,
        operation: 'branch',
        changes: { added: [], modified: [], deleted: [] },
        treeHash: 'abc123',
      } as VersionRef);

      await repository.branch('source-id', 'Branch Name');

      expect(mockCommit).toHaveBeenCalled();
      const commitCall = mockCommit.mock.calls[0];
      expect(commitCall[1].added).toHaveLength(1);
      expect(commitCall[1].added[0].type).toBe('event');
    });
  });

  describe('commitChanges() and checkout()', () => {
    it('should commit changes to a graph', async () => {
      const graphData: IGraph = {
        id: 'test-id',
        name: 'Test Graph',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 0,
        status: 'active',
        metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
      };
      
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(graphData));

      mockCommit.mockResolvedValue({
        graphId: 'test-id',
        version: 1,
        timestamp: new Date().toISOString(),
        parentVersion: 0,
        operation: 'create',
        changes: { added: [{ type: 'event', id: 'e1', hash: 'hash1' }], modified: [], deleted: [] },
        treeHash: 'tree-hash',
      } as VersionRef);

      const changes: EntityChanges = {
        added: [{ type: 'event', id: 'e1', data: { description: 'Test event' } }],
        modified: [],
        deleted: [],
      };

      const result = await repository.commitChanges('test-id', changes, 'create', 'Added event');

      expect(result.version).toBe(1);
      expect(mockCommit).toHaveBeenCalledWith(
        'test-id',
        changes,
        'create',
        'Added event',
        undefined
      );
    });

    it('should checkout latest version by default', async () => {
      mockGetLatestVersion.mockResolvedValueOnce({
        graphId: 'test-id',
        version: 2,
        timestamp: new Date().toISOString(),
        parentVersion: 1,
        operation: 'update',
        changes: { added: [], modified: [], deleted: [] },
        treeHash: 'latest-hash',
      } as VersionRef);
      mockCheckout.mockResolvedValueOnce({
        events: { e1: { id: 'e1', description: 'Event 1' } },
        arcs: {},
        relationships: {},
        pressures: {},
      });

      const result = await repository.checkout('test-id');

      expect(mockCheckout).toHaveBeenCalledWith('test-id', 2);
      expect(result.events).toHaveProperty('e1');
    });

    it('should checkout specific version when provided', async () => {
      mockCheckout.mockResolvedValue({
        events: { e1: { id: 'e1' } },
        arcs: {},
        relationships: {},
        pressures: {},
      });

      await repository.checkout('test-id', 5);

      expect(mockCheckout).toHaveBeenCalledWith('test-id', 5);
    });

    it('should return empty data when no versions exist', async () => {
      mockGetLatestVersion.mockResolvedValue(null);

      const result = await repository.checkout('test-id');

      expect(result).toEqual({
        events: {},
        arcs: {},
        relationships: {},
        pressures: {},
      });
    });
  });

  describe('getVersionHistory()', () => {
    it('should delegate to version repository', async () => {
      mockGetVersionHistory.mockResolvedValue({
        versions: [
          {
            graphId: 'test-id',
            version: 1,
            timestamp: new Date().toISOString(),
            parentVersion: 0,
            operation: 'create',
            changes: { added: [], modified: [], deleted: [] },
            treeHash: 'hash1',
          },
        ],
        total: 1,
      });

      const result = await repository.getVersionHistory('test-id', 50, 0);

      expect(mockGetVersionHistory).toHaveBeenCalledWith('test-id', 50, 0);
      expect(result.total).toBe(1);
    });
  });

  describe('rollback()', () => {
    it('should delegate to version repository', async () => {
      const expectedResult: VersionRef = {
        graphId: 'test-id',
        version: 3,
        timestamp: new Date().toISOString(),
        parentVersion: 2,
        operation: 'rollback',
        description: 'Rollback to version 1',
        changes: { added: [], modified: [], deleted: [] },
        treeHash: 'rollback-hash',
      };
      mockRollback.mockResolvedValue(expectedResult);

      const result = await repository.rollback('test-id', 1, 'user-123');

      expect(mockRollback).toHaveBeenCalledWith('test-id', 1, 'user-123');
      expect(result.operation).toBe('rollback');
    });
  });

  describe('gc()', () => {
    it('should delegate garbage collection to version repository', async () => {
      mockGc.mockResolvedValue({ removedObjects: 10, freedBytes: 5000 });

      const result = await repository.gc('test-id');

      expect(mockGc).toHaveBeenCalledWith('test-id');
      expect(result.removedObjects).toBe(10);
      expect(result.freedBytes).toBe(5000);
    });
  });

  describe('calculateMetadata()', () => {
    it('should calculate metadata from graph data', async () => {
      mockGetLatestVersion.mockResolvedValue({
        graphId: 'test-id',
        version: 1,
        timestamp: new Date().toISOString(),
        parentVersion: 0,
        operation: 'update',
        changes: { added: [], modified: [], deleted: [] },
        treeHash: 'hash',
      } as VersionRef);
      mockCheckout.mockResolvedValue({
        events: {
          e1: { id: 'e1', timestamp: '2024-01-01T00:00:00Z', actor: 'Actor1' },
          e2: { id: 'e2', timestamp: '2024-06-15T00:00:00Z', actor: 'Actor2' },
          e3: { id: 'e3', timestamp: '2024-12-31T00:00:00Z', actor: 'Actor1' },
        },
        arcs: { a1: { id: 'a1' }, a2: { id: 'a2' } },
        relationships: { r1: { id: 'r1' } },
        pressures: {},
      });

      const result = await repository.calculateMetadata('test-id');

      expect(result.eventCount).toBe(3);
      expect(result.arcCount).toBe(2);
      expect(result.relationshipCount).toBe(1);
      expect(result.pressureCount).toBe(0);
      expect(result.temporalRange?.start).toBe('2024-01-01T00:00:00.000Z');
      expect(result.temporalRange?.end).toBe('2024-12-31T00:00:00.000Z');
      expect(result.actors).toContain('Actor1');
      expect(result.actors).toContain('Actor2');
      expect(result.actors).toHaveLength(2);
    });

    it('should handle empty graph', async () => {
      mockGetLatestVersion.mockResolvedValue(null);

      const result = await repository.calculateMetadata('test-id');

      expect(result.eventCount).toBe(0);
      expect(result.arcCount).toBe(0);
      expect(result.temporalRange).toBeUndefined();
      expect(result.actors).toEqual([]);
    });
  });
});
