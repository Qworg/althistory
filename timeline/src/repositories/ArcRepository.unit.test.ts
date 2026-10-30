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

    it('allows a child arc fully contained within a parent arc and non-overlapping sibling arcs', async () => {
      const parent = await repository.create({
        name: 'Parent Era',
        start_time: new Date('2020-01-01T00:00:00Z'),
        end_time: new Date('2020-12-31T23:59:59Z'),
        level: 0
      });

      const child1 = await repository.create({
        name: 'Child Phase 1',
        start_time: new Date('2020-01-01T00:00:00Z'),
        end_time: new Date('2020-06-30T23:59:59Z'),
        level: 1
      });

      const child2 = await repository.create({
        name: 'Child Phase 2',
        start_time: new Date('2020-07-01T00:00:00Z'),
        end_time: new Date('2020-12-31T23:59:59Z'),
        level: 1
      });

      const unrelated = await repository.create({
        name: 'Unrelated Later Child',
        start_time: new Date('2022-01-01T00:00:00Z'),
        end_time: new Date('2022-06-01T00:00:00Z'),
        level: 1
      });

      expect(parent.id).toBeDefined();
      expect(child1.id).toBeDefined();
      expect(child2.id).toBeDefined();
      expect(unrelated.id).toBeDefined();
    });

    it('rejects a child arc that overlaps a parent arc and extends beyond its boundaries', async () => {
      await repository.create({
        name: 'Parent Era',
        start_time: new Date('2020-01-01T00:00:00Z'),
        end_time: new Date('2020-06-30T23:59:59Z'),
        level: 0
      });

      await expect(
        repository.create({
          name: 'Overflowing Child',
          start_time: new Date('2020-05-01T00:00:00Z'),
          end_time: new Date('2020-08-01T00:00:00Z'),
          level: 1
        })
      ).rejects.toThrow(/Temporal boundary violation.*Parent Era/);
    });

    it('rejects a parent arc that overlaps an existing child arc without fully containing it', async () => {
      await repository.create({
        name: 'Existing Child',
        start_time: new Date('2020-03-01T00:00:00Z'),
        end_time: new Date('2020-09-01T00:00:00Z'),
        level: 1
      });

      await expect(
        repository.create({
          name: 'Partial Parent',
          start_time: new Date('2020-01-01T00:00:00Z'),
          end_time: new Date('2020-06-01T00:00:00Z'),
          level: 0
        })
      ).rejects.toThrow(/Temporal boundary violation.*Existing Child/);
    });

    it('rejects updating a parent arc so that it shrinks inside a child arc', async () => {
      const parent = await repository.create({
        name: 'Shrinking Parent',
        start_time: new Date('2020-01-01T00:00:00Z'),
        end_time: new Date('2020-12-31T23:59:59Z'),
        level: 0
      });

      await repository.create({
        name: 'Contained Child',
        start_time: new Date('2020-06-01T00:00:00Z'),
        end_time: new Date('2020-10-01T00:00:00Z'),
        level: 1
      });

      await expect(
        repository.update(parent.id, {
          end_time: new Date('2020-08-01T00:00:00Z')
        })
      ).rejects.toThrow(/Temporal boundary violation.*Contained Child/);
    });
  });
});