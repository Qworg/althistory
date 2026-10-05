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
    
    arcRepository = new ArcRepository(databaseManager);
    await cleanupTestData(databaseManager, 'test_');
  });

  /**
   * Narrowing accessor for the repository created in beforeEach. Every test in this
   * block is an integration test that needs a live Neo4j connection, so a missing
   * repository means the setup above did not run - report that explicitly instead
   * of failing later with a TypeError on a null receiver.
   */
  function requireArcRepository(): ArcRepository {
    if (!arcRepository) {
      throw new Error('ArcRepository is not initialised: the beforeAll/beforeEach setup did not run');
    }
    return arcRepository;
  }

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

      const arc = await requireArcRepository().create(arcData);
      
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

      await expect(requireArcRepository().create(invalidArcData)).rejects.toThrow();
    });

    it('should find arc by ID', async () => {
      // Create test arc
      const arcData: CreateArcRequest = {
        name: 'Test Find Arc',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 0
      };

      const createdArc = await requireArcRepository().create(arcData);
      
      // Find the arc
      const foundArc = await requireArcRepository().findById(createdArc.id);
      
      expect(foundArc).toBeDefined();
      expect(foundArc!.id).toBe(createdArc.id);
      expect(foundArc!.name).toBe(arcData.name);
    });

    it('should return null for non-existent arc', async () => {
      const foundArc = await requireArcRepository().findById('non-existent-id');
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

      const createdArc = await requireArcRepository().create(arcData);
      
      // Update the arc
      const updates = {
        name: 'Updated Arc',
        description: 'Updated description'
      };

      const updatedArc = await requireArcRepository().update(createdArc.id, updates);
      
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

      const createdArc = await requireArcRepository().create(arcData);
      
      // Delete the arc
      const deleted = await requireArcRepository().delete(createdArc.id);
      expect(deleted).toBe(true);
      
      // Verify it's gone
      const foundArc = await requireArcRepository().findById(createdArc.id);
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
        await requireArcRepository().create(arcData);
      }
    });

    it('should find all arcs', async () => {
      const arcs = await requireArcRepository().findAll();
      expect(arcs.length).toBeGreaterThanOrEqual(4);
    });

    it('should find arcs by level', async () => {
      const level1Arcs = await requireArcRepository().findByLevel(1);
      expect(level1Arcs.length).toBe(2);
      expect(level1Arcs.every(a => a.level === 1)).toBe(true);
    });

    it('should find overlapping arcs', async () => {
      const timeRange: TimeRange = {
        start: new Date('2023-03-01T00:00:00Z'),
        end: new Date('2023-09-01T00:00:00Z')
      };

      const overlappingArcs = await requireArcRepository().findOverlappingArcs(timeRange);
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

      const containingArcs = await requireArcRepository().findContainingArcs(timeRange);
      expect(containingArcs.length).toBeGreaterThan(0);
      
      // Verify all returned arcs actually contain the time range
      containingArcs.forEach(arc => {
        const contains = arc.start_time <= timeRange.start && arc.end_time >= timeRange.end;
        expect(contains).toBe(true);
      });
    });

    it('should support pagination', async () => {
      const page1 = await requireArcRepository().findAll(2, 0);
      const page2 = await requireArcRepository().findAll(2, 2);
      
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
    // The two child arcs and the grandchild are created here to populate the
    // hierarchy; only rootArc and grandchildArc are inspected by the tests below.
    let grandchildArc: Arc;

    beforeEach(async () => {
      // Create hierarchy
      rootArc = await requireArcRepository().create({
        name: 'Hierarchy Root',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 0
      });

      await requireArcRepository().create({
        name: 'Hierarchy Child 1',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 1
      });

      await requireArcRepository().create({
        name: 'Hierarchy Child 2',
        start_time: new Date('2023-07-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 1
      });

      grandchildArc = await requireArcRepository().create({
        name: 'Hierarchy Grandchild',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-03-31T23:59:59Z'),
        level: 2
      });
    });

    it('should find nested arcs', async () => {
      const nestedArcs = await requireArcRepository().findNestedArcs(rootArc.id);
      expect(nestedArcs.length).toBe(3); // 2 children + 1 grandchild
      expect(nestedArcs.every(a => a.level > rootArc.level)).toBe(true);
    });

    it('should find direct children', async () => {
      const directChildren = await requireArcRepository().findDirectChildren(rootArc.id);
      expect(directChildren.length).toBe(2);
      expect(directChildren.every(a => a.level === rootArc.level + 1)).toBe(true);
    });

    it('should find parent arcs', async () => {
      const parents = await requireArcRepository().findParentArcs(grandchildArc.id);
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
        await requireArcRepository().create(arcData);
      }
    });

    it('should count total arcs', async () => {
      const count = await requireArcRepository().count();
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it('should count arcs by level', async () => {
      const level0Count = await requireArcRepository().countByLevel(0);
      expect(level0Count).toBeGreaterThanOrEqual(1);
      
      const level1Count = await requireArcRepository().countByLevel(1);
      expect(level1Count).toBeGreaterThanOrEqual(1);
    });

    it('should check if arc exists', async () => {
      const arcData: CreateArcRequest = {
        name: 'Exists Test Arc',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 0
      };

      const arc = await requireArcRepository().create(arcData);
      
      const exists = await requireArcRepository().exists(arc.id);
      expect(exists).toBe(true);
      
      const notExists = await requireArcRepository().exists('non-existent-id');
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
    
    advancedRepository = new AdvancedArcRepository(databaseManager);
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
      await requireAdvancedRepository().create(arcData);
    }
  });

  /**
   * Narrowing accessor for the repository created in beforeEach; see the note on
   * requireArcRepository() above.
   */
  function requireAdvancedRepository(): AdvancedArcRepository {
    if (!advancedRepository) {
      throw new Error('AdvancedArcRepository is not initialised: the beforeAll/beforeEach setup did not run');
    }
    return advancedRepository;
  }

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
      const arcs = await requireAdvancedRepository().search({
        name: 'Political'
      });

      expect(arcs.length).toBe(1);
      expect(arcs[0].name.toLowerCase()).toContain('political');
    });

    it('should search by level range', async () => {
      const arcs = await requireAdvancedRepository().search({
        minLevel: 1,
        maxLevel: 1
      });

      expect(arcs.length).toBe(2);
      expect(arcs.every(a => a.level === 1)).toBe(true);
    });

    it('should search by description', async () => {
      const arcs = await requireAdvancedRepository().search({
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

      const arcs = await requireAdvancedRepository().search({
        timeRange
      });

      expect(arcs.length).toBeGreaterThan(0);
      arcs.forEach(arc => {
        const overlaps = arc.start_time < timeRange.end && arc.end_time > timeRange.start;
        expect(overlaps).toBe(true);
      });
    });

    it('should support custom ordering', async () => {
      const arcs = await requireAdvancedRepository().search({}, {
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
      const page1 = await requireAdvancedRepository().search({}, { limit: 2, offset: 0 });
      const page2 = await requireAdvancedRepository().search({}, { limit: 2, offset: 2 });

      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Hierarchy Tree Operations', () => {
    let rootArc: Arc;

    beforeEach(async () => {
      // Create a hierarchy for tree testing
      rootArc = await requireAdvancedRepository().create({
        name: 'Tree Root',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 0
      });

      await requireAdvancedRepository().create({
        name: 'Tree Child 1',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 1
      });

      await requireAdvancedRepository().create({
        name: 'Tree Child 2',
        start_time: new Date('2023-07-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 1
      });
    });

    it('should get hierarchy tree', async () => {
      const tree = await requireAdvancedRepository().getHierarchyTree(rootArc.id);
      
      expect(tree.arc.id).toBe(rootArc.id);
      expect(tree.children.length).toBe(2);
      expect(tree.children.every(child => child.arc.level === 1)).toBe(true);
    });

    it('should respect max depth in hierarchy tree', async () => {
      const tree = await requireAdvancedRepository().getHierarchyTree(rootArc.id, 0);
      
      expect(tree.arc.id).toBe(rootArc.id);
      expect(tree.children.length).toBe(0); // Max depth 0 means no children
    });
  });
});