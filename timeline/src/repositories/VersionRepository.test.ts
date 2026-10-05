/**
 * VersionRepository Unit Tests
 * 
 * Tests for Git-like content-addressable storage and delta-based versioning
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { VersionRepository, EntityChanges } from './VersionRepository';
import { ContentObject, TreeObject, VersionRef, PackFile } from '../models/Graph';

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

describe('VersionRepository Unit Tests', () => {
  let repository: VersionRepository;
  const testDataDir = '/test/data';

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new VersionRepository({ dataDir: testDataDir });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Class Structure', () => {
    it('should have all required methods', () => {
      expect(VersionRepository.prototype.initializeGraph).toBeDefined();
      expect(VersionRepository.prototype.commit).toBeDefined();
      expect(VersionRepository.prototype.checkout).toBeDefined();
      expect(VersionRepository.prototype.getLatestVersion).toBeDefined();
      expect(VersionRepository.prototype.getVersionHistory).toBeDefined();
      expect(VersionRepository.prototype.getVersionRef).toBeDefined();
      expect(VersionRepository.prototype.rollback).toBeDefined();
      expect(VersionRepository.prototype.storeObject).toBeDefined();
      expect(VersionRepository.prototype.getObject).toBeDefined();
      expect(VersionRepository.prototype.storeTree).toBeDefined();
      expect(VersionRepository.prototype.getTree).toBeDefined();
      expect(VersionRepository.prototype.resolveTree).toBeDefined();
      expect(VersionRepository.prototype.packVersions).toBeDefined();
      expect(VersionRepository.prototype.gc).toBeDefined();
      expect(VersionRepository.prototype.deleteGraph).toBeDefined();
    });
  });

  describe('initializeGraph()', () => {
    it('should create required directories for a graph', async () => {
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);

      await repository.initializeGraph('graph-1');

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        path.join(testDataDir, 'graphs', 'graph-1'),
        { recursive: true }
      );
      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        path.join(testDataDir, 'graphs', 'graph-1', 'objects'),
        { recursive: true }
      );
      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        path.join(testDataDir, 'graphs', 'graph-1', 'versions'),
        { recursive: true }
      );
      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        path.join(testDataDir, 'graphs', 'graph-1', 'packs'),
        { recursive: true }
      );
    });

    it('should create empty initial tree', async () => {
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));

      await repository.initializeGraph('graph-1');

      // Should write empty tree object
      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls;
      const treeCall = writeCalls.find(call => {
        try {
          const content = JSON.parse(call[1] as string);
          return content.events !== undefined && content.arcs !== undefined;
        } catch {
          return false;
        }
      });
      expect(treeCall).toBeDefined();
    });

    it('should store current tree pointer', async () => {
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));

      await repository.initializeGraph('graph-1');

      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls;
      const currentCall = writeCalls.find(call =>
        (call[0] as string).includes('current.json')
      );
      expect(currentCall).toBeDefined();
    });
  });

  describe('commit()', () => {
    it('should create a new version with added entities', async () => {
      // Setup: no existing versions
      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('current.json')) {
          return JSON.stringify({ treeHash: 'initial-hash' });
        }
        if (pathStr.includes('objects')) {
          return JSON.stringify({ events: {}, arcs: {}, relationships: {}, pressures: {} });
        }
        throw new Error('ENOENT');
      });
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));

      const changes: EntityChanges = {
        added: [{ type: 'event', id: 'event-1', data: { description: 'Test event' } }],
        modified: [],
        deleted: [],
      };

      const result = await repository.commit('graph-1', changes, 'create', 'Added first event');

      expect(result.version).toBe(0);
      expect(result.operation).toBe('create');
      expect(result.description).toBe('Added first event');
      expect(result.changes.added).toHaveLength(1);
      expect(result.changes.added[0].type).toBe('event');
      expect(result.changes.added[0].id).toBe('event-1');
    });

    it('should increment version number', async () => {
      // Mock readFile to return different values based on the file path
      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('current.json')) {
          return JSON.stringify({ treeHash: 'current-hash' });
        }
        if (pathStr.includes('current-hash') || pathStr.includes('objects')) {
          return JSON.stringify({ events: {}, arcs: {}, relationships: {}, pressures: {} });
        }
        if (pathStr.includes('versions/1.json')) {
          return JSON.stringify({
            graphId: 'graph-1',
            version: 1,
            timestamp: new Date().toISOString(),
            parentVersion: 0,
            operation: 'create',
            changes: { added: [], modified: [], deleted: [] },
            treeHash: 'hash-1',
          });
        }
        throw new Error('ENOENT');
      });
      vi.mocked(fs.promises.readdir).mockResolvedValue(['0.json', '1.json'] as any);
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));

      const changes: EntityChanges = {
        added: [{ type: 'event', id: 'event-2', data: { description: 'Another event' } }],
        modified: [],
        deleted: [],
      };

      const result = await repository.commit('graph-1', changes, 'create', 'Added another event');

      expect(result.version).toBe(2);
      expect(result.parentVersion).toBe(1);
    });

    it('should handle modified entities', async () => {
      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('current.json')) {
          return JSON.stringify({ treeHash: 'current-hash' });
        }
        if (pathStr.includes('objects')) {
          return JSON.stringify({
            events: { 'event-1': 'old-hash' },
            arcs: {},
            relationships: {},
            pressures: {},
          });
        }
        throw new Error('ENOENT');
      });
      vi.mocked(fs.promises.readdir).mockResolvedValue(['0.json'] as any);
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));

      const changes: EntityChanges = {
        added: [],
        modified: [{ type: 'event', id: 'event-1', data: { description: 'Updated event' } }],
        deleted: [],
      };

      const result = await repository.commit('graph-1', changes, 'update', 'Updated event');

      expect(result.changes.modified).toHaveLength(1);
      expect(result.changes.modified[0].id).toBe('event-1');
      expect(result.changes.modified[0].prevHash).toBe('old-hash');
    });

    it('should handle deleted entities', async () => {
      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('current.json')) {
          return JSON.stringify({ treeHash: 'current-hash' });
        }
        if (pathStr.includes('objects')) {
          return JSON.stringify({
            events: { 'event-1': 'existing-hash' },
            arcs: {},
            relationships: {},
            pressures: {},
          });
        }
        throw new Error('ENOENT');
      });
      vi.mocked(fs.promises.readdir).mockResolvedValue(['0.json'] as any);
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));

      const changes: EntityChanges = {
        added: [],
        modified: [],
        deleted: [{ type: 'event', id: 'event-1' }],
      };

      const result = await repository.commit('graph-1', changes, 'delete', 'Deleted event');

      expect(result.changes.deleted).toHaveLength(1);
      expect(result.changes.deleted[0].id).toBe('event-1');
      expect(result.changes.deleted[0].prevHash).toBe('existing-hash');
    });

    it('should store version ref', async () => {
      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('current.json')) {
          return JSON.stringify({ treeHash: 'hash' });
        }
        if (pathStr.includes('objects')) {
          return JSON.stringify({ events: {}, arcs: {}, relationships: {}, pressures: {} });
        }
        throw new Error('ENOENT');
      });
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));

      const changes: EntityChanges = {
        added: [],
        modified: [],
        deleted: [],
      };

      await repository.commit('graph-1', changes, 'create', 'Empty commit');

      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls;
      const versionCall = writeCalls.find(call =>
        (call[0] as string).includes('versions/0.json')
      );
      expect(versionCall).toBeDefined();
    });

    it('should include userId if provided', async () => {
      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('current.json')) {
          return JSON.stringify({ treeHash: 'hash' });
        }
        if (pathStr.includes('objects')) {
          return JSON.stringify({ events: {}, arcs: {}, relationships: {}, pressures: {} });
        }
        throw new Error('ENOENT');
      });
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));

      const changes: EntityChanges = { added: [], modified: [], deleted: [] };
      const result = await repository.commit('graph-1', changes, 'create', 'Test', 'user-123');

      expect(result.userId).toBe('user-123');
    });

    it('should handle all entity types', async () => {
      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('current.json')) {
          return JSON.stringify({ treeHash: 'hash' });
        }
        if (pathStr.includes('objects')) {
          return JSON.stringify({ events: {}, arcs: {}, relationships: {}, pressures: {} });
        }
        throw new Error('ENOENT');
      });
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));

      const changes: EntityChanges = {
        added: [
          { type: 'event', id: 'e1', data: { description: 'Event' } },
          { type: 'arc', id: 'a1', data: { name: 'Arc' } },
          { type: 'relationship', id: 'r1', data: { weight: 1 } },
          { type: 'pressure', id: 'p1', data: { magnitude: 0.5 } },
        ],
        modified: [],
        deleted: [],
      };

      const result = await repository.commit('graph-1', changes, 'import', 'Import data');

      expect(result.changes.added).toHaveLength(4);
    });
  });

  describe('checkout()', () => {
    it('should retrieve data at a specific version', async () => {
      const versionRef: VersionRef = {
        graphId: 'graph-1',
        version: 1,
        timestamp: new Date().toISOString(),
        parentVersion: 0,
        operation: 'create',
        changes: { added: [], modified: [], deleted: [] },
        treeHash: 'tree-hash-1',
      };

      const treeObject: TreeObject = {
        events: { 'e1': 'event-hash-1' },
        arcs: {},
        relationships: {},
        pressures: {},
      };

      const eventObject: ContentObject = {
        type: 'event',
        data: { id: 'e1', description: 'Test event' },
      };

      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('versions/1.json')) {
          return JSON.stringify(versionRef);
        }
        if (pathStr.includes('tree-hash-1')) {
          return JSON.stringify(treeObject);
        }
        if (pathStr.includes('event-hash-1')) {
          return JSON.stringify(eventObject);
        }
        throw new Error('ENOENT');
      });
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);

      const result = await repository.checkout('graph-1', 1);

      expect(result.events).toHaveProperty('e1');
      expect(result.events['e1'].description).toBe('Test event');
    });

    it('should throw error for non-existent version', async () => {
      vi.mocked(fs.promises.readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);

      await expect(repository.checkout('graph-1', 999)).rejects.toThrow('Version 999 not found');
    });

    it('should resolve all entity types in tree', async () => {
      const versionRef: VersionRef = {
        graphId: 'graph-1',
        version: 1,
        timestamp: new Date().toISOString(),
        parentVersion: 0,
        operation: 'import',
        changes: { added: [], modified: [], deleted: [] },
        treeHash: 'tree-hash',
      };

      const treeObject: TreeObject = {
        events: { 'e1': 'eh1' },
        arcs: { 'a1': 'ah1' },
        relationships: { 'r1': 'rh1' },
        pressures: { 'p1': 'ph1' },
      };

      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('versions/1.json')) return JSON.stringify(versionRef);
        if (pathStr.includes('tree-hash')) return JSON.stringify(treeObject);
        if (pathStr.includes('eh1')) return JSON.stringify({ type: 'event', data: { id: 'e1' } });
        if (pathStr.includes('ah1')) return JSON.stringify({ type: 'arc', data: { id: 'a1' } });
        if (pathStr.includes('rh1')) return JSON.stringify({ type: 'relationship', data: { id: 'r1' } });
        if (pathStr.includes('ph1')) return JSON.stringify({ type: 'pressure', data: { id: 'p1' } });
        throw new Error('ENOENT');
      });
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);

      const result = await repository.checkout('graph-1', 1);

      expect(Object.keys(result.events)).toContain('e1');
      expect(Object.keys(result.arcs)).toContain('a1');
      expect(Object.keys(result.relationships)).toContain('r1');
      expect(Object.keys(result.pressures)).toContain('p1');
    });
  });

  describe('getVersionHistory() and getLatestVersion()', () => {
    it('should return version history sorted by version descending', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue(['0.json', '1.json', '2.json'] as any);
      
      const versions = [0, 1, 2].map(v => ({
        graphId: 'graph-1',
        version: v,
        timestamp: new Date().toISOString(),
        parentVersion: v > 0 ? v - 1 : null,
        operation: 'create',
        changes: { added: [], modified: [], deleted: [] },
        treeHash: `hash-${v}`,
      }));

      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        const match = pathStr.match(/versions\/(\d+)\.json/);
        if (match) {
          const v = parseInt(match[1]);
          return JSON.stringify(versions[v]);
        }
        throw new Error('ENOENT');
      });

      const result = await repository.getVersionHistory('graph-1');

      expect(result.total).toBe(3);
      expect(result.versions[0].version).toBe(2); // Descending order
      expect(result.versions[1].version).toBe(1);
      expect(result.versions[2].version).toBe(0);
    });

    it('should paginate version history', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue(
        ['0.json', '1.json', '2.json', '3.json', '4.json'] as any
      );
      
      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        const match = pathStr.match(/versions\/(\d+)\.json/);
        if (match) {
          const v = parseInt(match[1]);
          return JSON.stringify({
            graphId: 'graph-1',
            version: v,
            timestamp: new Date().toISOString(),
            parentVersion: v > 0 ? v - 1 : null,
            operation: 'create',
            changes: { added: [], modified: [], deleted: [] },
            treeHash: `hash-${v}`,
          });
        }
        throw new Error('ENOENT');
      });

      const result = await repository.getVersionHistory('graph-1', 2, 1);

      expect(result.total).toBe(5);
      expect(result.versions).toHaveLength(2);
      expect(result.versions[0].version).toBe(3);
      expect(result.versions[1].version).toBe(2);
    });

    it('should return empty history for graph with no versions', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);

      const result = await repository.getVersionHistory('graph-1');

      expect(result.total).toBe(0);
      expect(result.versions).toHaveLength(0);
    });

    it('should get latest version', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue(['0.json', '1.json', '5.json'] as any);
      
      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('versions/5.json')) {
          return JSON.stringify({
            graphId: 'graph-1',
            version: 5,
            timestamp: new Date().toISOString(),
            parentVersion: 1,
            operation: 'update',
            changes: { added: [], modified: [], deleted: [] },
            treeHash: 'latest-hash',
          });
        }
        throw new Error('ENOENT');
      });

      const result = await repository.getLatestVersion('graph-1');

      expect(result?.version).toBe(5);
    });

    it('should return null for latest version when no versions exist', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);

      const result = await repository.getLatestVersion('graph-1');

      expect(result).toBeNull();
    });
  });

  describe('rollback()', () => {
    it('should create a new version with rollback operation', async () => {
      const targetVersion: VersionRef = {
        graphId: 'graph-1',
        version: 1,
        timestamp: new Date().toISOString(),
        parentVersion: 0,
        operation: 'create',
        changes: { added: [], modified: [], deleted: [] },
        treeHash: 'target-tree-hash',
      };

      const targetTree: TreeObject = {
        events: { 'e1': 'eh1' },
        arcs: {},
        relationships: {},
        pressures: {},
      };

      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('versions/1.json')) return JSON.stringify(targetVersion);
        if (pathStr.includes('current.json')) return JSON.stringify({ treeHash: 'current-hash' });
        if (pathStr.includes('target-tree-hash')) return JSON.stringify(targetTree);
        if (pathStr.includes('current-hash')) return JSON.stringify({ 
          events: { 'e1': 'eh1', 'e2': 'eh2' }, 
          arcs: {}, 
          relationships: {}, 
          pressures: {} 
        });
        if (pathStr.includes('eh1')) return JSON.stringify({ type: 'event', data: { id: 'e1' } });
        if (pathStr.includes('eh2')) return JSON.stringify({ type: 'event', data: { id: 'e2' } });
        throw new Error('ENOENT');
      });
      vi.mocked(fs.promises.readdir).mockResolvedValue(['0.json', '1.json', '2.json'] as any);
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));

      const result = await repository.rollback('graph-1', 1, 'user-123');

      expect(result.operation).toBe('rollback');
      expect(result.description).toBe('Rollback to version 1');
      expect(result.userId).toBe('user-123');
    });

    it('should throw error for non-existent target version', async () => {
      vi.mocked(fs.promises.readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);

      await expect(repository.rollback('graph-1', 999)).rejects.toThrow('Version 999 not found');
    });
  });

  describe('storeObject() and getObject()', () => {
    it('should store object and return hash', async () => {
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));

      const obj: ContentObject = {
        type: 'event',
        data: { id: 'e1', description: 'Test' },
      };

      const hash = await repository.storeObject('graph-1', obj);

      expect(hash).toBeDefined();
      expect(hash).toHaveLength(64); // SHA-256 hex length
      expect(fs.promises.writeFile).toHaveBeenCalled();
    });

    it('should deduplicate identical objects', async () => {
      // First call: object doesn't exist
      vi.mocked(fs.promises.access).mockResolvedValueOnce(undefined);

      const obj: ContentObject = {
        type: 'event',
        data: { id: 'e1', description: 'Test' },
      };

      await repository.storeObject('graph-1', obj);

      // writeFile should not be called since object exists
      expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    it('should retrieve stored object', async () => {
      const storedObj: ContentObject = {
        type: 'event',
        data: { id: 'e1', description: 'Test' },
      };

      vi.mocked(fs.promises.readFile).mockResolvedValueOnce(JSON.stringify(storedObj));

      const result = await repository.getObject('graph-1', 'some-hash');

      expect(result?.type).toBe('event');
      expect(result?.data.id).toBe('e1');
    });

    it('should return null for non-existent object', async () => {
      vi.mocked(fs.promises.readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);

      const result = await repository.getObject('graph-1', 'non-existent-hash');

      expect(result).toBeNull();
    });

    it('should check pack files for missing objects', async () => {
      const packFile: PackFile = {
        id: 'pack-1',
        createdAt: new Date().toISOString(),
        versionRange: { start: 0, end: 10 },
        objects: {
          'packed-hash': { type: 'event', data: { id: 'e1' } },
        },
        trees: {},
        versions: [],
      };

      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('packs/pack-1.json')) {
          return JSON.stringify(packFile);
        }
        throw new Error('ENOENT');
      });
      vi.mocked(fs.promises.readdir).mockResolvedValue(['pack-1.json'] as any);

      const result = await repository.getObject('graph-1', 'packed-hash');

      expect(result?.data.id).toBe('e1');
    });
  });

  describe('storeTree() and getTree()', () => {
    it('should store tree and return hash', async () => {
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));

      const tree: TreeObject = {
        events: { 'e1': 'hash1' },
        arcs: {},
        relationships: {},
        pressures: {},
      };

      const hash = await repository.storeTree('graph-1', tree);

      expect(hash).toBeDefined();
      expect(hash).toHaveLength(64);
    });

    it('should retrieve stored tree', async () => {
      const storedTree: TreeObject = {
        events: { 'e1': 'hash1' },
        arcs: { 'a1': 'hash2' },
        relationships: {},
        pressures: {},
      };

      vi.mocked(fs.promises.readFile).mockResolvedValueOnce(JSON.stringify(storedTree));

      const result = await repository.getTree('graph-1', 'tree-hash');

      expect(result.events['e1']).toBe('hash1');
      expect(result.arcs['a1']).toBe('hash2');
    });

    it('should throw error for non-existent tree', async () => {
      vi.mocked(fs.promises.readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);

      await expect(repository.getTree('graph-1', 'non-existent')).rejects.toThrow('Tree not found');
    });
  });

  describe('packVersions()', () => {
    it('should create pack file for version range', async () => {
      const versions: VersionRef[] = [0, 1, 2].map(v => ({
        graphId: 'graph-1',
        version: v,
        timestamp: new Date().toISOString(),
        parentVersion: v > 0 ? v - 1 : null,
        operation: 'create' as const,
        changes: {
          added: [{ type: 'event' as const, id: `e${v}`, hash: `hash-${v}` }],
          modified: [],
          deleted: [],
        },
        treeHash: `tree-${v}`,
      }));

      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        const versionMatch = pathStr.match(/versions\/(\d+)\.json/);
        if (versionMatch) {
          return JSON.stringify(versions[parseInt(versionMatch[1])]);
        }
        if (pathStr.includes('hash-')) {
          return JSON.stringify({ type: 'event', data: { id: 'e1' } });
        }
        throw new Error('ENOENT');
      });

      await repository.packVersions('graph-1', 0, 2);

      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls;
      const packCall = writeCalls.find(call =>
        (call[0] as string).includes('packs/')
      );
      expect(packCall).toBeDefined();
    });

    it('should remove individual version files after packing', async () => {
      const versions: VersionRef[] = [0, 1].map(v => ({
        graphId: 'graph-1',
        version: v,
        timestamp: new Date().toISOString(),
        parentVersion: v > 0 ? v - 1 : null,
        operation: 'create' as const,
        changes: { added: [], modified: [], deleted: [] },
        treeHash: `tree-${v}`,
      }));

      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        const versionMatch = pathStr.match(/versions\/(\d+)\.json/);
        if (versionMatch) {
          return JSON.stringify(versions[parseInt(versionMatch[1])]);
        }
        throw new Error('ENOENT');
      });

      await repository.packVersions('graph-1', 0, 1);

      expect(fs.promises.unlink).toHaveBeenCalledWith(
        expect.stringContaining('versions/0.json')
      );
      expect(fs.promises.unlink).toHaveBeenCalledWith(
        expect.stringContaining('versions/1.json')
      );
    });

    it('should do nothing for empty version range', async () => {
      vi.mocked(fs.promises.readFile).mockRejectedValue(new Error('ENOENT'));

      await repository.packVersions('graph-1', 0, 0);

      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls;
      const packCall = writeCalls.find(call =>
        (call[0] as string).includes('packs/')
      );
      expect(packCall).toBeUndefined();
    });
  });

  describe('gc()', () => {
    it('should remove unreferenced objects', async () => {
      vi.mocked(fs.promises.readdir).mockImplementation(async (dirPath) => {
        const pathStr = dirPath.toString();
        if (pathStr.includes('versions')) {
          return ['0.json'] as any;
        }
        if (pathStr.includes('packs')) {
          return [] as any;
        }
        if (pathStr.includes('objects')) {
          return ['ref-hash.json', 'orphan-hash.json'] as any;
        }
        return [] as any;
      });

      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('versions/0.json')) {
          return JSON.stringify({
            graphId: 'graph-1',
            version: 0,
            timestamp: new Date().toISOString(),
            parentVersion: null,
            operation: 'create',
            changes: { added: [{ type: 'event', id: 'e1', hash: 'ref-hash' }], modified: [], deleted: [] },
            treeHash: 'tree-hash',
          });
        }
        throw new Error('ENOENT');
      });

      vi.mocked(fs.promises.stat).mockResolvedValue({ size: 100 } as any);

      const result = await repository.gc('graph-1');

      expect(result.removedObjects).toBe(1);
      expect(result.freedBytes).toBe(100);
      expect(fs.promises.unlink).toHaveBeenCalledWith(
        expect.stringContaining('orphan-hash.json')
      );
    });

    it('should not remove referenced objects', async () => {
      vi.mocked(fs.promises.readdir).mockImplementation(async (dirPath) => {
        const pathStr = dirPath.toString();
        if (pathStr.includes('versions')) {
          return ['0.json'] as any;
        }
        if (pathStr.includes('packs')) {
          return [] as any;
        }
        if (pathStr.includes('objects')) {
          return ['ref-hash.json'] as any;
        }
        return [] as any;
      });

      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('versions/0.json')) {
          return JSON.stringify({
            graphId: 'graph-1',
            version: 0,
            timestamp: new Date().toISOString(),
            parentVersion: null,
            operation: 'create',
            changes: { added: [{ type: 'event', id: 'e1', hash: 'ref-hash' }], modified: [], deleted: [] },
            treeHash: 'tree-hash',
          });
        }
        throw new Error('ENOENT');
      });

      const result = await repository.gc('graph-1');

      expect(result.removedObjects).toBe(0);
    });

    it('should include pack file objects in reference check', async () => {
      const packFile: PackFile = {
        id: 'pack-1',
        createdAt: new Date().toISOString(),
        versionRange: { start: 0, end: 5 },
        objects: { 'packed-hash': { type: 'event', data: {} } },
        trees: {},
        versions: [],
      };

      vi.mocked(fs.promises.readdir).mockImplementation(async (dirPath) => {
        const pathStr = dirPath.toString();
        if (pathStr.includes('versions')) return [] as any;
        if (pathStr.includes('packs')) return ['pack-1.json'] as any;
        if (pathStr.includes('objects')) return ['packed-hash.json'] as any;
        return [] as any;
      });

      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('packs/pack-1.json')) {
          return JSON.stringify(packFile);
        }
        throw new Error('ENOENT');
      });

      const result = await repository.gc('graph-1');

      expect(result.removedObjects).toBe(0);
    });
  });

  describe('deleteGraph()', () => {
    it('should remove entire graph directory', async () => {
      await repository.deleteGraph('graph-1');

      expect(fs.promises.rm).toHaveBeenCalledWith(
        path.join(testDataDir, 'graphs', 'graph-1'),
        { recursive: true, force: true }
      );
    });
  });

  describe('Content Addressable Storage', () => {
    it('should produce consistent hashes for same content', async () => {
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));

      const obj: ContentObject = {
        type: 'event',
        data: { id: 'e1', description: 'Test' },
      };

      const hash1 = await repository.storeObject('graph-1', obj);
      const hash2 = await repository.storeObject('graph-1', obj);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different content', async () => {
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));

      const hash1 = await repository.storeObject('graph-1', {
        type: 'event',
        data: { id: 'e1', description: 'Test 1' },
      });

      const hash2 = await repository.storeObject('graph-1', {
        type: 'event',
        data: { id: 'e2', description: 'Test 2' },
      });

      expect(hash1).not.toBe(hash2);
    });
  });
});
