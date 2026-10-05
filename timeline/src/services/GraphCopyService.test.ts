import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { GraphCopyService, CopyResult, CopyProgress } from './GraphCopyService';
import { Event } from '../models/Event';
import { Arc } from '../models/Arc';
import { getDatabaseManager, initializeDatabaseManager } from '../utils/database';
import { Session } from 'neo4j-driver';

describe('GraphCopyService Integration Tests', () => {
  let graphCopyService: GraphCopyService;
  let session: Session;

  beforeAll(async () => {
    // Initialize database manager for testing
    const config = {
      neo4j: {
        uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
        username: process.env.NEO4J_USERNAME || 'neo4j',
        password: process.env.NEO4J_PASSWORD || 'password',
        database: 'neo4j'
      },
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379')
      }
    };

    initializeDatabaseManager(config);
    await getDatabaseManager().initializeNeo4j();
  });

  beforeEach(async () => {
    session = getDatabaseManager().getNeo4jSession();
    graphCopyService = new GraphCopyService(session);

    // Clean up test data
    await session.run('MATCH (n) WHERE n.graphId IN ["test-source", "test-target"] DETACH DELETE n');
  });

  afterEach(async () => {
    // Clean up test data
    await session.run('MATCH (n) WHERE n.graphId IN ["test-source", "test-target"] DETACH DELETE n');
    await session.close();
  });

  afterAll(async () => {
    await getDatabaseManager().close();
  });

  describe('copyFullGraph', () => {
    it('should copy a simple graph with events and arcs', async () => {
      // Arrange: Create test data in source graph
      const sourceEvents = [
        new Event({
          description: 'Event 1',
          actor: 'Actor A',
          target: 'Target A',
          timestamp: new Date('2023-01-01T10:00:00Z')
        }),
        new Event({
          description: 'Event 2',
          actor: 'Actor B',
          target: 'Target B',
          timestamp: new Date('2023-01-02T10:00:00Z')
        })
      ];

      const sourceArcs = [
        new Arc({
          name: 'Arc 1',
          description: 'Test arc 1',
          start_time: new Date('2023-01-01T00:00:00Z'),
          end_time: new Date('2023-01-03T00:00:00Z'),
          level: 0
        })
      ];

      // Create nodes with source graph ID
      for (const event of sourceEvents) {
        await session.run(`
          CREATE (e:Event {
            id: $id,
            description: $description,
            actor: $actor,
            target: $target,
            timestamp: datetime($timestamp),
            graphId: $graphId
          })
        `, {
          id: event.id,
          description: event.description,
          actor: event.actor,
          target: event.target,
          timestamp: event.timestamp.toISOString(),
          graphId: 'test-source'
        });
      }

      for (const arc of sourceArcs) {
        await session.run(`
          CREATE (a:Arc {
            id: $id,
            name: $name,
            description: $description,
            start_time: datetime($start_time),
            end_time: datetime($end_time),
            level: $level,
            graphId: $graphId
          })
        `, {
          id: arc.id,
          name: arc.name,
          description: arc.description,
          start_time: arc.start_time.toISOString(),
          end_time: arc.end_time.toISOString(),
          level: arc.level,
          graphId: 'test-source'
        });
      }

      // Create a relationship between event and arc
      await session.run(`
        MATCH (e:Event {graphId: 'test-source'}), (a:Arc {graphId: 'test-source'})
        WHERE e.timestamp >= a.start_time AND e.timestamp <= a.end_time
        CREATE (e)-[:PART_OF {temporal_relevance: 0.8}]->(a)
      `);

      // Act: Copy the graph
      const result = await graphCopyService.copyFullGraph('test-source', 'test-target');

      // Assert: Verify copy result
      expect(result.success).toBe(true);
      expect(result.sourceGraphId).toBe('test-source');
      expect(result.targetGraphId).toBe('test-target');
      expect(result.copiedNodes).toBe(3); // 2 events + 1 arc
      expect(result.copiedRelationships).toBe(1); // 1 PART_OF relationship
      expect(result.duration).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);

      // Verify target graph has the copied data
      const targetEventCount = await session.run(`
        MATCH (e:Event {graphId: 'test-target'})
        RETURN count(e) as count
      `);
      expect(targetEventCount.records[0].get('count').toNumber()).toBe(2);

      const targetArcCount = await session.run(`
        MATCH (a:Arc {graphId: 'test-target'})
        RETURN count(a) as count
      `);
      expect(targetArcCount.records[0].get('count').toNumber()).toBe(1);

      const targetRelCount = await session.run(`
        MATCH ()-[r:PART_OF]->()
        WHERE startNode(r).graphId = 'test-target' AND endNode(r).graphId = 'test-target'
        RETURN count(r) as count
      `);
      expect(targetRelCount.records[0].get('count').toNumber()).toBe(1);
    });

    it('should handle progress tracking during copy', async () => {
      // Arrange: Create larger test dataset
      const eventCount = 50;
      const arcCount = 10;

      // Create events
      for (let i = 0; i < eventCount; i++) {
        await session.run(`
          CREATE (e:Event {
            id: $id,
            description: $description,
            actor: $actor,
            target: $target,
            timestamp: datetime($timestamp),
            graphId: 'test-source'
          })
        `, {
          id: `event_${i}`,
          description: `Event ${i}`,
          actor: `Actor ${i % 5}`,
          target: `Target ${i % 3}`,
          timestamp: new Date(2023, 0, i + 1).toISOString()
        });
      }

      // Create arcs
      for (let i = 0; i < arcCount; i++) {
        await session.run(`
          CREATE (a:Arc {
            id: $id,
            name: $name,
            description: $description,
            start_time: datetime($start_time),
            end_time: datetime($end_time),
            level: $level,
            graphId: 'test-source'
          })
        `, {
          id: `arc_${i}`,
          name: `Arc ${i}`,
          description: `Test arc ${i}`,
          start_time: new Date(2023, 0, i * 5 + 1).toISOString(),
          end_time: new Date(2023, 0, i * 5 + 6).toISOString(),
          level: i % 3
        });
      }

      // Track progress updates
      const progressUpdates: CopyProgress[] = [];
      const progressCallback = (progress: CopyProgress) => {
        progressUpdates.push({ ...progress });
      };

      // Act: Copy with progress tracking
      const result = await graphCopyService.copyFullGraph('test-source', 'test-target', {
        batchSize: 10,
        progressCallback
      });

      // Assert: Verify progress was tracked
      expect(result.success).toBe(true);
      expect(progressUpdates.length).toBeGreaterThan(0);
      
      // Check that progress increases
      for (let i = 1; i < progressUpdates.length; i++) {
        expect(progressUpdates[i].percentage).toBeGreaterThanOrEqual(progressUpdates[i - 1].percentage);
      }

      // Final progress should be 100%
      const finalProgress = progressUpdates[progressUpdates.length - 1];
      expect(finalProgress.percentage).toBe(100);
    });

    it('should handle batch processing for large graphs', async () => {
      // Arrange: Create test data that requires multiple batches
      const eventCount = 25;
      
      for (let i = 0; i < eventCount; i++) {
        await session.run(`
          CREATE (e:Event {
            id: $id,
            description: $description,
            actor: $actor,
            target: $target,
            timestamp: datetime($timestamp),
            graphId: 'test-source'
          })
        `, {
          id: `event_${i}`,
          description: `Event ${i}`,
          actor: `Actor ${i}`,
          target: `Target ${i}`,
          timestamp: new Date(2023, 0, i + 1).toISOString()
        });
      }

      // Act: Copy with small batch size to force multiple batches
      const result = await graphCopyService.copyFullGraph('test-source', 'test-target', {
        batchSize: 5 // Small batch size to test batching
      });

      // Assert: Verify all data was copied despite batching
      expect(result.success).toBe(true);
      expect(result.copiedNodes).toBe(eventCount);

      const targetCount = await session.run(`
        MATCH (e:Event {graphId: 'test-target'})
        RETURN count(e) as count
      `);
      expect(targetCount.records[0].get('count').toNumber()).toBe(eventCount);
    });

    it('should preserve referential integrity during copy', async () => {
      // Arrange: Create complex graph with multiple relationship types
      await session.run(`
        CREATE (e1:Event {
          id: 'event1',
          description: 'Cause Event',
          actor: 'Actor A',
          target: 'Target A',
          timestamp: datetime('2023-01-01T10:00:00Z'),
          graphId: 'test-source'
        })
        CREATE (e2:Event {
          id: 'event2',
          description: 'Effect Event',
          actor: 'Actor B',
          target: 'Target B',
          timestamp: datetime('2023-01-02T10:00:00Z'),
          graphId: 'test-source'
        })
        CREATE (a:Arc {
          id: 'arc1',
          name: 'Test Arc',
          description: 'Test arc',
          start_time: datetime('2023-01-01T00:00:00Z'),
          end_time: datetime('2023-01-03T00:00:00Z'),
          level: 0,
          graphId: 'test-source'
        })
        CREATE (p:InferredPressure {
          id: 'pressure1',
          description: 'Economic pressure',
          confidence_score: 0.8,
          pressure_type: 'economic',
          graphId: 'test-source'
        })
        CREATE (e1)-[:CAUSES {weight: 0.9, evidence: 'Direct causation', confidence: 0.8}]->(e2)
        CREATE (e1)-[:PART_OF {temporal_relevance: 0.9}]->(a)
        CREATE (e2)-[:PART_OF {temporal_relevance: 0.7}]->(a)
        CREATE (a)-[:DRIVEN_BY {influence_strength: 0.6}]->(p)
      `);

      // Act: Copy the graph
      const result = await graphCopyService.copyFullGraph('test-source', 'test-target');

      // Assert: Verify all relationships are preserved
      expect(result.success).toBe(true);
      expect(result.copiedNodes).toBe(4); // 2 events + 1 arc + 1 pressure
      expect(result.copiedRelationships).toBe(4); // All relationships

      // Verify specific relationships exist in target
      const causesRel = await session.run(`
        MATCH (e1:Event)-[r:CAUSES]->(e2:Event)
        WHERE e1.graphId = 'test-target' AND e2.graphId = 'test-target'
        RETURN count(r) as count
      `);
      expect(causesRel.records[0].get('count').toNumber()).toBe(1);

      const partOfRels = await session.run(`
        MATCH (e:Event)-[r:PART_OF]->(a:Arc)
        WHERE e.graphId = 'test-target' AND a.graphId = 'test-target'
        RETURN count(r) as count
      `);
      expect(partOfRels.records[0].get('count').toNumber()).toBe(2);

      const drivenByRel = await session.run(`
        MATCH (a:Arc)-[r:DRIVEN_BY]->(p:InferredPressure)
        WHERE a.graphId = 'test-target' AND p.graphId = 'test-target'
        RETURN count(r) as count
      `);
      expect(drivenByRel.records[0].get('count').toNumber()).toBe(1);
    });
  });

  describe('validateCopyIntegrity', () => {
    it('should validate successful copy integrity', async () => {
      // Arrange: Create and copy a simple graph
      await session.run(`
        CREATE (e:Event {
          id: 'event1',
          description: 'Test Event',
          actor: 'Actor A',
          target: 'Target A',
          timestamp: datetime('2023-01-01T10:00:00Z'),
          graphId: 'test-source'
        })
        CREATE (a:Arc {
          id: 'arc1',
          name: 'Test Arc',
          start_time: datetime('2023-01-01T00:00:00Z'),
          end_time: datetime('2023-01-02T00:00:00Z'),
          level: 0,
          graphId: 'test-source'
        })
        CREATE (e)-[:PART_OF {temporal_relevance: 0.8}]->(a)
      `);

      const copyResult = await graphCopyService.copyFullGraph('test-source', 'test-target');

      // Act: Validate integrity
      const integrityReport = await graphCopyService.validateCopyIntegrity(copyResult);

      // Assert: Should be valid
      expect(integrityReport.isValid).toBe(true);
      expect(integrityReport.missingNodes).toHaveLength(0);
      expect(integrityReport.missingRelationships).toHaveLength(0);
      expect(integrityReport.orphanedRelationships).toHaveLength(0);
      expect(integrityReport.violations).toHaveLength(0);
    });

    it('should detect missing nodes in copy', async () => {
      // Arrange: Create source data
      await session.run(`
        CREATE (e1:Event {
          id: 'event1',
          description: 'Event 1',
          actor: 'Actor A',
          target: 'Target A',
          timestamp: datetime('2023-01-01T10:00:00Z'),
          graphId: 'test-source'
        })
        CREATE (e2:Event {
          id: 'event2',
          description: 'Event 2',
          actor: 'Actor B',
          target: 'Target B',
          timestamp: datetime('2023-01-02T10:00:00Z'),
          graphId: 'test-source'
        })
      `);

      // Create incomplete target (missing one event)
      await session.run(`
        CREATE (e1:Event {
          id: 'event1',
          description: 'Event 1',
          actor: 'Actor A',
          target: 'Target A',
          timestamp: datetime('2023-01-01T10:00:00Z'),
          graphId: 'test-target'
        })
      `);

      const copyResult: CopyResult = {
        sourceGraphId: 'test-source',
        targetGraphId: 'test-target',
        copiedNodes: 1,
        copiedRelationships: 0,
        duration: 100,
        success: true
      };

      // Act: Validate integrity
      const integrityReport = await graphCopyService.validateCopyIntegrity(copyResult);

      // Assert: Should detect missing node
      expect(integrityReport.isValid).toBe(false);
      expect(integrityReport.missingNodes.length).toBeGreaterThan(0);
      expect(integrityReport.violations.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should handle copy operation failures gracefully', async () => {
      // Act: Try to copy from non-existent source
      const result = await graphCopyService.copyFullGraph('non-existent-source', 'test-target');

      // Assert: Should handle gracefully
      expect(result.success).toBe(false);
      expect(result.copiedNodes).toBe(0);
      expect(result.copiedRelationships).toBe(0);
      expect(result.errors).toBeDefined();
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should handle integrity validation failures', async () => {
      const invalidCopyResult: CopyResult = {
        sourceGraphId: 'non-existent',
        targetGraphId: 'also-non-existent',
        copiedNodes: 0,
        copiedRelationships: 0,
        duration: 0,
        success: true
      };

      // Act: Validate integrity of invalid copy
      const integrityReport = await graphCopyService.validateCopyIntegrity(invalidCopyResult);

      // Assert: Should handle gracefully
      expect(integrityReport.isValid).toBe(false);
      expect(integrityReport.violations.length).toBeGreaterThan(0);
    });
  });
});