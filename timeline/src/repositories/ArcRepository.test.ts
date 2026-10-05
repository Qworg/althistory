import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ArcRepository, AdvancedArcRepository } from './ArcRepository';
import { Arc, CreateArcRequest } from '../models/Arc';
import { TimeRange } from '../models/Event';
import { DatabaseManager } from '../utils/database';
import { initializeSchema } from '../utils/schema';
import { createTestDatabaseManager, isNeo4jAvailable, cleanupTestData } from '../utils/test-utils';

describe('ArcRepository Integration Tests', () => {
  let databaseManager: DatabaseManager | null = null;
  let arcRepository: ArcRepository | null = null;

  beforeAll(async () => {
    const neo4jAvailable = await isNeo4jAvailable();
    if (!neo4jAvailable) {
      console.warn('Neo4j not available, skipping ArcRepository integration tests');
      return;
    }
    
    databaseManager = await createTestDatabaseManager();
    if (databaseManager) {
      try {
        await initializeSchema();
      } catch (error) {
        console.warn('Could not initialize schema:', (error as Error).message);
      }
    }
  }, 30000);

  beforeEach(async () => {
    if (!databaseManager) {
      return;
    }
    
    arcRepository = new ArcRepository();
    await cleanupTestData(databaseManager, 'test_');
  });

  afterAll(async () => {
    if (arcRepository) {
      try {
        await arcRepository.close();
      } catch (error) {
        console.warn('Error closing arc repository:', (error as Error).message);
      }
    }
    if (databaseManager) {
      await databaseManager.close();
    }
  });

  describe('CRUD Operations', () => {
    it('should create a new arc', async () => {
      if (!databaseManager || !arcRepository) {
        console.warn('Database not available, skipping test');
        return;
      }
      const arcData: CreateArcRequest = {
        name: 'Test Arc',
        description: 'Test arc creation',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 0
      };

      const arc = await arcRepository.create(arcData);
      
      expect(arc).toBeDefined();
      expect(arc.id).toBeDefined();
      expect(arc.name).toBe(arcData.name);
      expect(arc.description).toBe(arcData.description);
      expect(arc.start_time).toEqual(arcData.start_time);
      expect(arc.end_time).toEqual(arcData.end_time);
      expect(arc.level).toBe(arcData.level);
    });

    it('should validate temporal boundaries on creation', async () => {
      const invalidArcData: CreateArcRequest = {
        name: 'Invalid Arc',
        start_time: new Date('2023-12-31T23:59:59Z'),
        end_time: new Date('2023-01-01T00:00:00Z'), // End before start
        level: 0
      };

      await expect(arcRepository.create(invalidArcData)).rejects.toThrow();
    });

    it('should find arc by ID', async () => {
      // Create test arc
      const arcData: CreateArcRequest = {
        name: 'Test Find Arc',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 0
      };

      const createdArc = await arcRepository.create(arcData);
      
      // Find the arc
      const foundArc = await arcRepository.findById(createdArc.id);
      
      expect(foundArc).toBeDefined();
      expect(foundArc!.id).toBe(createdArc.id);
      expect(foundArc!.name).toBe(arcData.name);
    });

    it('should return null for non-existent arc', async () => {
      const foundArc = await arcRepository.findById('non-existent-id');
      expect(foundArc).toBeNull();
    });

    it('should update an existing arc', async () => {
      // Create test arc
      const arcData: CreateArcRequest = {
        name: 'Original Arc',
        description: 'Original description',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 0
      };

      const createdArc = await arcRepository.create(arcData);
      
      // Update the arc
      const updates = {
        name: 'Updated Arc',
        description: 'Updated description'
      };

      const updatedArc = await arcRepository.update(createdArc.id, updates);
      
      expect(updatedArc).toBeDefined();
      expect(updatedArc!.name).toBe(updates.name);
      expect(updatedArc!.description).toBe(updates.description);
      expect(updatedArc!.start_time).toEqual(arcData.start_time); // Unchanged
    });

    it('should delete an arc', async () => {
      // Create test arc
      const arcData: CreateArcRequest = {
        name: 'Test Delete Arc',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 0
      };

      const createdArc = await arcRepository.create(arcData);
      
      // Delete the arc
      const deleted = await arcRepository.delete(createdArc.id);
      expect(deleted).toBe(true);
      
      // Verify it's gone
      const foundArc = await arcRepository.findById(createdArc.id);
      expect(foundArc).toBeNull();
    });
  });

  describe('Query Operations', () => {
    beforeEach(async () => {
      // Create test arcs with hierarchy
      const testArcs: CreateArcRequest[] = [
        {
          name: 'Root Arc',
          start_time: new Date('2023-01-01T00:00:00Z'),
          end_time: new Date('2023-12-31T23:59:59Z'),
          level: 0
        },
        {
          name: 'Child Arc 1',
          start_time: new Date('2023-01-01T00:00:00Z'),
          end_time: new Date('2023-06-30T23:59:59Z'),
          level: 1
        },
        {
          name: 'Child Arc 2',
          start_time: new Date('2023-07-01T00:00:00Z'),
          end_time: new Date('2023-12-31T23:59:59Z'),
          level: 1
        },
        {
          name: 'Grandchild Arc',
          start_time: new Date('2023-01-01T00:00:00Z'),
          end_time: new Date('2023-03-31T23:59:59Z'),
          level: 2
        }
      ];

      for (const arcData of testArcs) {
        await arcRepository.create(arcData);
      }
    });

    it('should find all arcs', async () => {
      const arcs = await arcRepository.findAll();
      expect(arcs.length).toBeGreaterThanOrEqual(4);
    });

    it('should find arcs by level', async () => {
      const level1Arcs = await arcRepository.findByLevel(1);
      expect(level1Arcs.length).toBe(2);
      expect(level1Arcs.every(a => a.level === 1)).toBe(true);
    });

    it('should find overlapping arcs', async () => {
      const timeRange: TimeRange = {
        start: new Date('2023-03-01T00:00:00Z'),
        end: new Date('2023-09-01T00:00:00Z')
      };

      const overlappingArcs = await arcRepository.findOverlappingArcs(timeRange);
      expect(overlappingArcs.length).toBeGreaterThan(0);
      
      // Verify all returned arcs actually overlap
      overlappingArcs.forEach(arc => {
        const overlaps = arc.start_time < timeRange.end && arc.end_time > timeRange.start;
        expect(overlaps).toBe(true);
      });
    });

    it('should find containing arcs', async () => {
      const timeRange: TimeRange = {
        start: new Date('2023-02-01T00:00:00Z'),
        end: new Date('2023-03-01T00:00:00Z')
      };

      const containingArcs = await arcRepository.findContainingArcs(timeRange);
      expect(containingArcs.length).toBeGreaterThan(0);
      
      // Verify all returned arcs actually contain the time range
      containingArcs.forEach(arc => {
        const contains = arc.start_time <= timeRange.start && arc.end_time >= timeRange.end;
        expect(contains).toBe(true);
      });
    });

    it('should support pagination', async () => {
      const page1 = await arcRepository.findAll(2, 0);
      const page2 = await arcRepository.findAll(2, 2);
      
      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);
      
      // Ensure no overlap
      const page1Ids = page1.map(a => a.id);
      const page2Ids = page2.map(a => a.id);
      const overlap = page1Ids.filter(id => page2Ids.includes(id));
      expect(overlap.length).toBe(0);
    });
  });

  describe('Hierarchy Operations', () => {
    let rootArc: Arc;
    let childArc1: Arc;
    let childArc2: Arc;
    let grandchildArc: Arc;

    beforeEach(async () => {
      // Create hierarchy
      rootArc = await arcRepository.create({
        name: 'Hierarchy Root',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 0
      });

      childArc1 = await arcRepository.create({
        name: 'Hierarchy Child 1',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 1
      });

      childArc2 = await arcRepository.create({
        name: 'Hierarchy Child 2',
        start_time: new Date('2023-07-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 1
      });

      grandchildArc = await arcRepository.create({
        name: 'Hierarchy Grandchild',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-03-31T23:59:59Z'),
        level: 2
      });
    });

    it('should find nested arcs', async () => {
      const nestedArcs = await arcRepository.findNestedArcs(rootArc.id);
      expect(nestedArcs.length).toBe(3); // 2 children + 1 grandchild
      expect(nestedArcs.every(a => a.level > rootArc.level)).toBe(true);
    });

    it('should find direct children', async () => {
      const directChildren = await arcRepository.findDirectChildren(rootArc.id);
      expect(directChildren.length).toBe(2);
      expect(directChildren.every(a => a.level === rootArc.level + 1)).toBe(true);
    });

    it('should find parent arcs', async () => {
      const parents = await arcRepository.findParentArcs(grandchildArc.id);
      expect(parents.length).toBe(2); // Root and child
      expect(parents.every(a => a.level < grandchildArc.level)).toBe(true);
    });
  });

  describe('Count Operations', () => {
    beforeEach(async () => {
      // Create test arcs
      const testArcs: CreateArcRequest[] = [
        {
          name: 'Count Arc 1',
          start_time: new Date('2023-01-01T00:00:00Z'),
          end_time: new Date('2023-12-31T23:59:59Z'),
          level: 0
        },
        {
          name: 'Count Arc 2',
          start_time: new Date('2023-01-01T00:00:00Z'),
          end_time: new Date('2023-06-30T23:59:59Z'),
          level: 1
        }
      ];

      for (const arcData of testArcs) {
        await arcRepository.create(arcData);
      }
    });

    it('should count total arcs', async () => {
      const count = await arcRepository.count();
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it('should count arcs by level', async () => {
      const level0Count = await arcRepository.countByLevel(0);
      expect(level0Count).toBeGreaterThanOrEqual(1);
      
      const level1Count = await arcRepository.countByLevel(1);
      expect(level1Count).toBeGreaterThanOrEqual(1);
    });

    it('should check if arc exists', async () => {
      const arcData: CreateArcRequest = {
        name: 'Exists Test Arc',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 0
      };

      const arc = await arcRepository.create(arcData);
      
      const exists = await arcRepository.exists(arc.id);
      expect(exists).toBe(true);
      
      const notExists = await arcRepository.exists('non-existent-id');
      expect(notExists).toBe(false);
    });
  });
});

describe('AdvancedArcRepository Integration Tests', () => {
  let databaseManager: DatabaseManager | null = null;
  let advancedRepository: AdvancedArcRepository | null = null;

  beforeAll(async () => {
    const neo4jAvailable = await isNeo4jAvailable();
    if (!neo4jAvailable) {
      console.warn('Neo4j not available, skipping AdvancedArcRepository integration tests');
      return;
    }
    
    databaseManager = await createTestDatabaseManager();
  }, 30000);

  beforeEach(async () => {
    if (!databaseManager) {
      return;
    }
    
    advancedRepository = new AdvancedArcRepository();
    await cleanupTestData(databaseManager, 'advanced_');

    // Create test arcs for advanced search
    const testArcs: CreateArcRequest[] = [
      {
        name: 'Advanced Political Era',
        description: 'A period of political change',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 0
      },
      {
        name: 'Advanced Economic Period',
        description: 'A time of economic growth',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 1
      },
      {
        name: 'Advanced Social Movement',
        description: 'A period of social reform',
        start_time: new Date('2023-07-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 1
      }
    ];

    for (const arcData of testArcs) {
      const arc = new Arc({ ...arcData, id: `advanced_${Date.now()}_${Math.random()}` });
      await advancedRepository.create(arcData);
    }
  });

  afterAll(async () => {
    if (advancedRepository) {
      try {
        await advancedRepository.close();
      } catch (error) {
        console.warn('Error closing advanced repository:', (error as Error).message);
      }
    }
    if (databaseManager) {
      await databaseManager.close();
    }
  });

  describe('Advanced Search', () => {
    it('should search by name', async () => {
      const arcs = await advancedRepository.search({
        name: 'Political'
      });

      expect(arcs.length).toBe(1);
      expect(arcs[0].name.toLowerCase()).toContain('political');
    });

    it('should search by level range', async () => {
      const arcs = await advancedRepository.search({
        minLevel: 1,
        maxLevel: 1
      });

      expect(arcs.length).toBe(2);
      expect(arcs.every(a => a.level === 1)).toBe(true);
    });

    it('should search by description', async () => {
      const arcs = await advancedRepository.search({
        description: 'economic'
      });

      expect(arcs.length).toBe(1);
      expect(arcs[0].description?.toLowerCase()).toContain('economic');
    });

    it('should search with time range filter', async () => {
      const timeRange: TimeRange = {
        start: new Date('2023-06-01T00:00:00Z'),
        end: new Date('2023-08-01T00:00:00Z')
      };

      const arcs = await advancedRepository.search({
        timeRange
      });

      expect(arcs.length).toBeGreaterThan(0);
      arcs.forEach(arc => {
        const overlaps = arc.start_time < timeRange.end && arc.end_time > timeRange.start;
        expect(overlaps).toBe(true);
      });
    });

    it('should support custom ordering', async () => {
      const arcs = await advancedRepository.search({}, {
        orderBy: 'level',
        orderDirection: 'DESC'
      });

      expect(arcs.length).toBeGreaterThan(0);
      
      // Check descending order by level
      for (let i = 1; i < arcs.length; i++) {
        expect(arcs[i].level).toBeLessThanOrEqual(arcs[i-1].level);
      }
    });

    it('should support pagination in search', async () => {
      const page1 = await advancedRepository.search({}, { limit: 2, offset: 0 });
      const page2 = await advancedRepository.search({}, { limit: 2, offset: 2 });

      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Hierarchy Tree Operations', () => {
    let rootArc: Arc;

    beforeEach(async () => {
      // Create a hierarchy for tree testing
      rootArc = await advancedRepository.create({
        name: 'Tree Root',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 0
      });

      await advancedRepository.create({
        name: 'Tree Child 1',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 1
      });

      await advancedRepository.create({
        name: 'Tree Child 2',
        start_time: new Date('2023-07-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 1
      });
    });

    it('should get hierarchy tree', async () => {
      const tree = await advancedRepository.getHierarchyTree(rootArc.id);
      
      expect(tree.arc.id).toBe(rootArc.id);
      expect(tree.children.length).toBe(2);
      expect(tree.children.every(child => child.arc.level === 1)).toBe(true);
    });

    it('should respect max depth in hierarchy tree', async () => {
      const tree = await advancedRepository.getHierarchyTree(rootArc.id, 0);
      
      expect(tree.arc.id).toBe(rootArc.id);
      expect(tree.children.length).toBe(0); // Max depth 0 means no children
    });
  });
});