import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalGraphStore, CypherQueryParser } from './LocalGraphStore';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('LocalGraphStore', () => {
  let graphStore: LocalGraphStore;
  const testDataDir = './test-graph-data';

  beforeEach(async () => {
    // Mock config to use test directory
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'test-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false'; // Disable backups for tests
    
    graphStore = new LocalGraphStore();
    
    // Ensure test directory exists
    try {
      await fs.mkdir(testDataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  });

  afterEach(async () => {
    await graphStore.shutdown();
    
    // Clean up test directory
    try {
      await fs.rmdir(testDataDir, { recursive: true });
    } catch (error) {
      // Directory might not exist or be empty
    }
  });

  describe('Node Operations', () => {
    it('should create nodes with labels and properties', async () => {
      const node = await graphStore.createNode(['Event'], {
        id: 'test-event-1',
        description: 'Test event',
        timestamp: '2023-01-01T00:00:00Z'
      });

      expect(node.id).toBe('test-event-1');
      expect(node.labels).toEqual(['Event']);
      expect(node.properties.description).toBe('Test event');
    });

    it('should generate ID if not provided', async () => {
      const node = await graphStore.createNode(['Event'], {
        description: 'Test event without ID'
      });

      expect(node.id).toMatch(/^local_\d+_[a-z0-9]+$/);
      expect(node.properties.id).toBe(node.id);
    });

    it('should retrieve nodes by ID', async () => {
      const created = await graphStore.createNode(['Event'], {
        id: 'retrieve-test',
        description: 'Retrieve test'
      });

      const retrieved = await graphStore.getNode('retrieve-test');
      expect(retrieved).toEqual(created);
    });

    it('should return null for non-existent nodes', async () => {
      const result = await graphStore.getNode('non-existent');
      expect(result).toBeNull();
    });

    it('should update node properties', async () => {
      await graphStore.createNode(['Event'], {
        id: 'update-test',
        description: 'Original description'
      });

      const updated = await graphStore.updateNode('update-test', {
        description: 'Updated description',
        newProperty: 'new value'
      });

      expect(updated?.properties.description).toBe('Updated description');
      expect(updated?.properties.newProperty).toBe('new value');
    });

    it('should delete nodes and their relationships', async () => {
      // Create two nodes
      await graphStore.createNode(['Event'], { id: 'node1' });
      await graphStore.createNode(['Event'], { id: 'node2' });
      
      // Create relationship between them
      await graphStore.createRelationship('node1', 'node2', 'CAUSES');

      // Delete first node
      const deleted = await graphStore.deleteNode('node1');
      expect(deleted).toBe(true);

      // Node should be gone
      expect(await graphStore.getNode('node1')).toBeNull();
      
      // Relationship should be gone too
      const relationships = await graphStore.getRelationships('node2');
      expect(relationships).toHaveLength(0);
    });

    it('should get nodes by label', async () => {
      await graphStore.createNode(['Event'], { id: 'event1', description: 'Event 1' });
      await graphStore.createNode(['Event'], { id: 'event2', description: 'Event 2' });
      await graphStore.createNode(['Arc'], { id: 'arc1', name: 'Arc 1' });

      const events = await graphStore.getNodesByLabel('Event');
      expect(events).toHaveLength(2);
      expect(events.map(e => e.id)).toContain('event1');
      expect(events.map(e => e.id)).toContain('event2');

      const arcs = await graphStore.getNodesByLabel('Arc');
      expect(arcs).toHaveLength(1);
      expect(arcs[0].id).toBe('arc1');
    });
  });

  describe('Relationship Operations', () => {
    beforeEach(async () => {
      // Create test nodes for relationships
      await graphStore.createNode(['Event'], { id: 'event1', description: 'Event 1' });
      await graphStore.createNode(['Event'], { id: 'event2', description: 'Event 2' });
    });

    it('should create relationships between nodes', async () => {
      const relationship = await graphStore.createRelationship(
        'event1',
        'event2',
        'CAUSES',
        { weight: 0.8, confidence: 0.9 }
      );

      expect(relationship).not.toBeNull();
      expect(relationship?.type).toBe('CAUSES');
      expect(relationship?.startNodeId).toBe('event1');
      expect(relationship?.endNodeId).toBe('event2');
      expect(relationship?.properties.weight).toBe(0.8);
    });

    it('should not create relationships to non-existent nodes', async () => {
      const relationship = await graphStore.createRelationship(
        'event1',
        'non-existent',
        'CAUSES'
      );

      expect(relationship).toBeNull();
    });

    it('should get relationships for a node', async () => {
      await graphStore.createRelationship('event1', 'event2', 'CAUSES');
      
      const outgoing = await graphStore.getRelationships('event1', 'outgoing');
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].type).toBe('CAUSES');

      const incoming = await graphStore.getRelationships('event2', 'incoming');
      expect(incoming).toHaveLength(1);
      expect(incoming[0].type).toBe('CAUSES');

      const both = await graphStore.getRelationships('event1', 'both');
      expect(both).toHaveLength(1);
    });

    it('should delete relationships', async () => {
      const rel = await graphStore.createRelationship('event1', 'event2', 'CAUSES');
      expect(rel).not.toBeNull();

      const deleted = await graphStore.deleteRelationship(rel!.id);
      expect(deleted).toBe(true);

      const relationships = await graphStore.getRelationships('event1');
      expect(relationships).toHaveLength(0);
    });

    it('should get relationships by type', async () => {
      await graphStore.createRelationship('event1', 'event2', 'CAUSES');
      await graphStore.createRelationship('event2', 'event1', 'INFLUENCES');

      const causesRels = await graphStore.getRelationshipsByType('CAUSES');
      expect(causesRels).toHaveLength(1);
      expect(causesRels[0].type).toBe('CAUSES');

      const influencesRels = await graphStore.getRelationshipsByType('INFLUENCES');
      expect(influencesRels).toHaveLength(1);
      expect(influencesRels[0].type).toBe('INFLUENCES');
    });
  });

  describe('Query Execution', () => {
    beforeEach(async () => {
      // Set up test data
      await graphStore.createNode(['Event'], {
        id: 'event1',
        description: 'Test Event 1',
        actor: 'Actor1',
        timestamp: '2023-01-01T00:00:00Z'
      });
      await graphStore.createNode(['Event'], {
        id: 'event2',
        description: 'Test Event 2',
        actor: 'Actor2',
        timestamp: '2023-01-02T00:00:00Z'
      });
    });

    it('should execute CREATE queries', async () => {
      const query = `
        CREATE (e:Event {
          id: $id,
          description: $description,
          actor: $actor
        })
        RETURN e
      `;

      const result = await graphStore.executeQuery(query, {
        id: 'created-event',
        description: 'Created via query',
        actor: 'Query Actor'
      });

      expect(result.records).toHaveLength(1);
      expect(result.summary.counters.nodesCreated).toBe(1);

      // Verify the node was created
      const node = await graphStore.getNode('created-event');
      expect(node?.properties.description).toBe('Created via query');
    });

    it('should execute MATCH queries', async () => {
      const query = `
        MATCH (e:Event)
        WHERE e.actor = $actor
        RETURN e
      `;

      const result = await graphStore.executeQuery(query, {
        actor: 'Actor1'
      });

      expect(result.records).toHaveLength(1);
      const node = result.records[0].get('e');
      expect(node.properties.description).toBe('Test Event 1');
    });

    it('should execute MATCH queries with LIMIT', async () => {
      const query = `
        MATCH (e:Event)
        RETURN e
        LIMIT 1
      `;

      const result = await graphStore.executeQuery(query);
      expect(result.records).toHaveLength(1);
    });

    it('should execute DELETE queries', async () => {
      const deleteQuery = `
        MATCH (e:Event { id: $id })
        DELETE e
      `;

      const result = await graphStore.executeQuery(deleteQuery, {
        id: 'event1'
      });

      expect(result.summary.counters.nodesDeleted).toBe(1);

      // Verify the node was deleted
      const node = await graphStore.getNode('event1');
      expect(node).toBeNull();
    });

    it('should handle query errors gracefully', async () => {
      const invalidQuery = 'INVALID QUERY SYNTAX';

      await expect(graphStore.executeQuery(invalidQuery))
        .rejects.toThrow('Query execution failed');
    });
  });

  describe('Persistence', () => {
    it('should save and load graph data', async () => {
      // Create some test data
      await graphStore.createNode(['Event'], {
        id: 'persist-event',
        description: 'Persistent event'
      });
      await graphStore.createNode(['Arc'], {
        id: 'persist-arc',
        name: 'Persistent arc'
      });

      // Save the data
      await graphStore.save();

      // Create new graph store and load data
      const newGraphStore = new LocalGraphStore();
      await newGraphStore.load();

      // Verify data was loaded
      const event = await newGraphStore.getNode('persist-event');
      const arc = await newGraphStore.getNode('persist-arc');

      expect(event?.properties.description).toBe('Persistent event');
      expect(arc?.properties.name).toBe('Persistent arc');

      await newGraphStore.shutdown();
    });

    it('should handle missing data file gracefully', async () => {
      const newGraphStore = new LocalGraphStore();
      
      // Should not throw error when file doesn't exist
      await expect(newGraphStore.load()).resolves.not.toThrow();
      
      // Graph should be empty
      const stats = newGraphStore.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.relationshipCount).toBe(0);

      await newGraphStore.shutdown();
    });

    it('should create backups when enabled', async () => {
      // Enable backups for this test
      process.env.LOCAL_BACKUP_ENABLED = 'true';
      const backupGraphStore = new LocalGraphStore();
      
      await backupGraphStore.createNode(['Event'], { id: 'backup-test' });
      await backupGraphStore.createBackup();

      // Check if backup directory was created
      const backupDir = path.join(testDataDir, 'backups');
      const backupExists = await fs.access(backupDir).then(() => true).catch(() => false);
      
      if (process.env.LOCAL_BACKUP_ENABLED === 'true') {
        expect(backupExists).toBe(true);
      }

      await backupGraphStore.shutdown();
    });
  });

  describe('Statistics and Management', () => {
    it('should provide accurate statistics', async () => {
      const initialStats = graphStore.getStats();
      expect(initialStats.nodeCount).toBe(0);
      expect(initialStats.relationshipCount).toBe(0);

      await graphStore.createNode(['Event'], { id: 'stats-event' });
      await graphStore.createNode(['Arc'], { id: 'stats-arc' });
      await graphStore.createRelationship('stats-event', 'stats-arc', 'PART_OF');

      const stats = graphStore.getStats();
      expect(stats.nodeCount).toBe(2);
      expect(stats.relationshipCount).toBe(1);
      expect(stats.labelCount).toBe(2); // Event and Arc
      expect(stats.relationshipTypeCount).toBe(1); // PART_OF
    });

    it('should clear all data', async () => {
      await graphStore.createNode(['Event'], { id: 'clear-test' });
      await graphStore.createRelationship('clear-test', 'clear-test', 'SELF');

      await graphStore.clear();

      const stats = graphStore.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.relationshipCount).toBe(0);
    });

    it('should shutdown gracefully', async () => {
      await graphStore.createNode(['Event'], { id: 'shutdown-test' });
      
      // Should not throw error
      await expect(graphStore.shutdown()).resolves.not.toThrow();
    });
  });
});

describe('CypherQueryParser', () => {
  it('should parse CREATE node queries', () => {
    const query = 'CREATE (e:Event { id: $id, description: $description })';
    const parameters = { id: 'test-id', description: 'Test Description' };
    const graphData = {
      nodes: new Map(),
      relationships: new Map(),
      nodesByLabel: new Map(),
      relationshipsByType: new Map(),
      backups: []
    };

    const result = CypherQueryParser.execute(query, parameters, graphData);
    
    expect(result.summary.counters.nodesCreated).toBe(1);
    expect(graphData.nodes.size).toBe(1);
  });

  it('should parse MATCH queries with WHERE clauses', () => {
    const graphData = {
      nodes: new Map([
        ['test-1', { id: 'test-1', labels: ['Event'], properties: { id: 'test-1', actor: 'Actor1' } }],
        ['test-2', { id: 'test-2', labels: ['Event'], properties: { id: 'test-2', actor: 'Actor2' } }]
      ]),
      relationships: new Map(),
      nodesByLabel: new Map([
        ['Event', new Set(['test-1', 'test-2'])]
      ]),
      relationshipsByType: new Map(),
      backups: []
    };

    const query = 'MATCH (e:Event) WHERE e.actor = $actor RETURN e';
    const parameters = { actor: 'Actor1' };

    const result = CypherQueryParser.execute(query, parameters, graphData);
    
    expect(result.records).toHaveLength(1);
    expect(result.records[0].get('e').properties.actor).toBe('Actor1');
  });

  it('should handle unsupported query types', () => {
    const graphData = {
      nodes: new Map(),
      relationships: new Map(),
      nodesByLabel: new Map(),
      relationshipsByType: new Map(),
      backups: []
    };

    const unsupportedQuery = 'MERGE (n:Node) RETURN n';
    
    expect(() => {
      CypherQueryParser.execute(unsupportedQuery, {}, graphData);
    }).toThrow('Unsupported query type');
  });
});