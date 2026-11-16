import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ArcRepository, AdvancedArcRepository } from './ArcRepository';
// Type-only exports are not part of the runtime module namespace, so the interface
// checks below import them with `import type` rather than through a dynamic import.
import type { ArcQueryOptions, ArcSearchFilters, ArcHierarchyNode } from './ArcRepository';
import { Arc } from '../models/Arc';
import { LocalDatabaseManager } from '../utils/database';
import { LocalGraphStore } from '../utils/LocalGraphStore';

describe('ArcRepository Unit Tests', () => {
  describe('Class Structure', () => {
    it('should have all required methods', () => {
      expect(ArcRepository.prototype.create).toBeDefined();
      expect(ArcRepository.prototype.findById).toBeDefined();
      expect(ArcRepository.prototype.findAll).toBeDefined();
      expect(ArcRepository.prototype.findByLevel).toBeDefined();
      expect(ArcRepository.prototype.findOverlappingArcs).toBeDefined();
      expect(ArcRepository.prototype.findContainingArcs).toBeDefined();
      expect(ArcRepository.prototype.findNestedArcs).toBeDefined();
      expect(ArcRepository.prototype.findDirectChildren).toBeDefined();
      expect(ArcRepository.prototype.findParentArcs).toBeDefined();
      expect(ArcRepository.prototype.update).toBeDefined();
      expect(ArcRepository.prototype.delete).toBeDefined();
      expect(ArcRepository.prototype.count).toBeDefined();
      expect(ArcRepository.prototype.countByLevel).toBeDefined();
      expect(ArcRepository.prototype.exists).toBeDefined();
      expect(ArcRepository.prototype.close).toBeDefined();
    });

    it('should have AdvancedArcRepository with additional methods', () => {
      expect(AdvancedArcRepository.prototype.search).toBeDefined();
      expect(AdvancedArcRepository.prototype.getHierarchyTree).toBeDefined();
      
      // Should inherit from ArcRepository
      expect(AdvancedArcRepository.prototype.create).toBeDefined();
      expect(AdvancedArcRepository.prototype.findById).toBeDefined();
      expect(AdvancedArcRepository.prototype.findNestedArcs).toBeDefined();
    });
  });

  describe('Interface Definitions', () => {
    it('should have proper query options interface', () => {
      // Test that the interface can be used
      const options: ArcQueryOptions = {};
      expect(options).toBeDefined();
    });

    it('should have proper search filters interface', () => {
      // Test that the interface can be used
      const filters: ArcSearchFilters = {};
      expect(filters).toBeDefined();
    });

    it('should have proper hierarchy node interface', () => {
      // Test that the interface can be used
      const node: ArcHierarchyNode = {
        arc: new Arc({
          name: 'Hierarchy Node Arc',
          start_time: new Date('2023-01-01T00:00:00Z'),
          end_time: new Date('2023-12-31T23:59:59Z'),
          level: 0
        }),
        children: []
      };
      expect(node).toBeDefined();
      expect(node.children).toEqual([]);
    });
  });

  describe('Method Signatures', () => {
    it('should have correct method signatures for hierarchy operations', () => {
      // Test that methods exist with expected signatures
      const repository = ArcRepository.prototype;
      
      expect(typeof repository.findNestedArcs).toBe('function');
      expect(typeof repository.findDirectChildren).toBe('function');
      expect(typeof repository.findParentArcs).toBe('function');
      expect(typeof repository.findOverlappingArcs).toBe('function');
      expect(typeof repository.findContainingArcs).toBe('function');
    });

    it('should have correct method signatures for advanced operations', () => {
      const advancedRepository = AdvancedArcRepository.prototype;
      
      expect(typeof advancedRepository.search).toBe('function');
      expect(typeof advancedRepository.getHierarchyTree).toBe('function');
    });
  });

  describe('Temporal Boundary Validation', () => {
    let tempDir: string;
    let store: LocalGraphStore;
    let repository: ArcRepository;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-boundary-unit-'));
      store = new LocalGraphStore({ dataFile: path.join(tempDir, 'graph.json') });
      await store.load();
      const localDb = new LocalDatabaseManager(store);
      repository = new ArcRepository(localDb);
    });

    afterEach(async () => {
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('allows a child arc within its parent, and arcs of other branches that overlap it at any level', async () => {
      const parent = await repository.create({ name: 'Parent Era', start_time: new Date('2020-01-01T00:00:00Z'), end_time: new Date('2020-12-31T23:59:59Z'), level: 0 });
      const child = await repository.create({ name: 'Child Phase', start_time: new Date('2020-02-01T00:00:00Z'), end_time: new Date('2020-06-30T23:59:59Z'), level: 1, metadata: { parentArcId: parent.id } });
      // Another branch: overlaps the child and the parent without containing either, at the child's level and below it.
      const other = await repository.create({ name: 'Other Root', start_time: new Date('2020-03-01T00:00:00Z'), end_time: new Date('2021-03-01T00:00:00Z'), level: 0 });
      const otherChild = await repository.create({ name: 'Other Child', start_time: new Date('2020-03-01T00:00:00Z'), end_time: new Date('2020-08-01T00:00:00Z'), level: 1, metadata: { parentArcId: other.id } });
      expect([parent.id, child.id, other.id, otherChild.id].every(Boolean)).toBe(true);
    });

    it('rejects a child arc that extends beyond its parent, with a 400', async () => {
      const parent = await repository.create({ name: 'Parent Era', start_time: new Date('2020-01-01T00:00:00Z'), end_time: new Date('2020-06-30T23:59:59Z'), level: 0 });
      await expect(
        repository.create({ name: 'Overflowing Child', start_time: new Date('2020-05-01T00:00:00Z'), end_time: new Date('2020-08-01T00:00:00Z'), level: 1, metadata: { parentArcId: parent.id } })
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/Temporal boundary violation.*Overflowing Child.*Parent Era/) });
    });

    it('lets an arc that names no parent overlap anything', async () => {
      await repository.create({ name: 'Existing', start_time: new Date('2020-03-01T00:00:00Z'), end_time: new Date('2020-09-01T00:00:00Z'), level: 1 });
      await expect(repository.create({ name: 'Partial', start_time: new Date('2020-01-01T00:00:00Z'), end_time: new Date('2020-06-01T00:00:00Z'), level: 0 })).resolves.toBeDefined();
    });

    it('rejects updating a parent arc so that it shrinks inside its child', async () => {
      const parent = await repository.create({ name: 'Shrinking Parent', start_time: new Date('2020-01-01T00:00:00Z'), end_time: new Date('2020-12-31T23:59:59Z'), level: 0 });
      await repository.create({ name: 'Contained Child', start_time: new Date('2020-06-01T00:00:00Z'), end_time: new Date('2020-10-01T00:00:00Z'), level: 1, metadata: { parentArcId: parent.id } });
      await expect(repository.update(parent.id, { end_time: new Date('2020-08-01T00:00:00Z') })).rejects.toThrow(/Temporal boundary violation.*Contained Child/);
    });

    // The parent the CLI, MCP and the generator record in `metadata.parentArcId`
    // (issue 26, third review): cleared when an arc becomes top level, and
    // never because its new level does not fit the parent as the store holds
    // it now, which is only how a subtree moved child first passes through.
    describe('the recorded parent (metadata.parentArcId)', () => {
      async function parentAndChild(): Promise<{ parentId: string; childId: string }> {
        const parent = await repository.create({ name: 'Age', start_time: new Date('2020-01-01T00:00:00Z'), end_time: new Date('2020-12-31T00:00:00Z'), level: 0 });
        const child = await repository.create({ name: 'Reign', start_time: new Date('2020-02-01T00:00:00Z'), end_time: new Date('2020-03-01T00:00:00Z'), level: 1, metadata: { parentArcId: parent.id, note: 'kept' } });
        return { parentId: parent.id, childId: child.id };
      }

      it('is cleared when an edit moves the arc to level 0, and the rest of the metadata stays', async () => {
        const { childId } = await parentAndChild();
        const promoted = await repository.update(childId, { level: 0 });
        expect(promoted?.metadata).toEqual({ note: 'kept' });
        expect((await repository.findById(childId))?.metadata).toEqual({ note: 'kept' });
      });

      it('is kept when the new level does not fit the parent as it stands now', async () => {
        const { parentId, childId } = await parentAndChild();
        // Level 2 under a level-0 parent: the parent's own move may come next.
        expect((await repository.update(childId, { level: 2 }))?.metadata).toEqual({ parentArcId: parentId, note: 'kept' });
      });

      it('is kept when the parent is not in the store (yet)', async () => {
        const { parentId, childId } = await parentAndChild();
        await repository.delete(parentId);
        expect((await repository.update(childId, { level: 3 }))?.metadata).toEqual({ parentArcId: parentId, note: 'kept' });
      });

      it('is left alone by an edit that does not change the level', async () => {
        const { parentId, childId } = await parentAndChild();
        expect((await repository.update(childId, { name: 'Reign, renamed' }))?.metadata).toEqual({ parentArcId: parentId, note: 'kept' });
      });
    });
  });
});