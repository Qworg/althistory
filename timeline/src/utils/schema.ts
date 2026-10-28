import { Session } from 'neo4j-driver';
import { getDatabaseManager } from './database';

/**
 * Schema creation and management utilities
 */
export class SchemaManager {
  private session: Session;

  constructor(session?: Session) {
    this.session = session || getDatabaseManager().getNeo4jSession();
  }

  /**
   * Create all database constraints and indexes
   */
  async createSchema(): Promise<void> {
    try {
      console.log('Creating database schema...');
      
      await this.createConstraints();
      await this.createIndexes();
      
      console.log('Database schema created successfully');
    } catch (error) {
      console.error('Failed to create database schema:', error);
      throw error;
    }
  }

  /**
   * Create all database constraints
   */
  private async createConstraints(): Promise<void> {
    // Neo4j Community supports uniqueness constraints only. The property-range
    // constraints this list used to carry (`REQUIRE x >= 0.0 AND x <= 1.0` on
    // relationships and on InferredPressure) are not valid Cypher on Neo4j 5,
    // and swapping them for relationship property existence constraints fails
    // too because those require Enterprise. The 0..1 bounds they expressed are
    // enforced by `ValidationService` on the domain objects, so the schema
    // keeps the uniqueness the write path actually relies on.
    const constraints = [
      // Event node constraints
      'CREATE CONSTRAINT event_id IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE',

      // Arc node constraints
      'CREATE CONSTRAINT arc_id IF NOT EXISTS FOR (a:Arc) REQUIRE a.id IS UNIQUE',

      // InferredPressure node constraints
      'CREATE CONSTRAINT pressure_id IF NOT EXISTS FOR (p:InferredPressure) REQUIRE p.id IS UNIQUE',
    ];

    // The id constraints stay global, not `(id, graphId)`. Ids are generated
    // UUIDs, so a global uniqueness is not what keeps graphs apart, and a
    // composite constraint would stop applying to unattributed legacy rows
    // (a uniqueness constraint ignores null properties) for the window in which
    // `attributeUnattributedCloudData` has not run yet. What keeps graphs apart
    // is the `graphId` filter on every query, and what keeps those queries usable
    // is the `*_graph_*` indexes below.

    for (const constraint of constraints) {
      try {
        await this.session.run(constraint);
        console.log(`Created constraint: ${constraint.split(' ')[2]}`);
      } catch (error) {
        // Ignore constraint already exists errors
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('already exists') && !message.includes('An equivalent constraint already exists')) {
          console.error(`Failed to create constraint: ${constraint}`, error);
          throw error;
        }
      }
    }
  }

  /**
   * Create all database indexes
   */
  private async createIndexes(): Promise<void> {
    const indexes = [
      // Event indexes for temporal queries
      'CREATE INDEX event_timestamp IF NOT EXISTS FOR (e:Event) ON (e.timestamp)',
      'CREATE INDEX event_actor IF NOT EXISTS FOR (e:Event) ON (e.actor)',
      'CREATE INDEX event_target IF NOT EXISTS FOR (e:Event) ON (e.target)',
      'CREATE INDEX event_temporal_actor IF NOT EXISTS FOR (e:Event) ON (e.timestamp, e.actor)',

      // Graph-scoped event indexes (#59). Every cloud read of an Event names a
      // graph, so the graph property leads the index: `(graphId, timestamp)`
      // answers "this graph's events in order" in one range scan instead of
      // reading every graph's events and dropping the other graphs afterwards.
      'CREATE INDEX event_graph_timestamp IF NOT EXISTS FOR (e:Event) ON (e.graphId, e.timestamp)',
      'CREATE INDEX event_graph_actor IF NOT EXISTS FOR (e:Event) ON (e.graphId, e.actor)',

      // Arc indexes for temporal and hierarchy queries
      'CREATE INDEX arc_timerange IF NOT EXISTS FOR (a:Arc) ON (a.start_time, a.end_time)',
      'CREATE INDEX arc_level IF NOT EXISTS FOR (a:Arc) ON (a.level)',
      'CREATE INDEX arc_temporal_compound IF NOT EXISTS FOR (a:Arc) ON (a.start_time, a.end_time, a.level)',
      'CREATE INDEX arc_start_time IF NOT EXISTS FOR (a:Arc) ON (a.start_time)',
      'CREATE INDEX arc_end_time IF NOT EXISTS FOR (a:Arc) ON (a.end_time)',

      // Graph-scoped arc indexes (#59), same reasoning as the event ones.
      'CREATE INDEX arc_graph_level IF NOT EXISTS FOR (a:Arc) ON (a.graphId, a.level)',
      'CREATE INDEX arc_graph_start_time IF NOT EXISTS FOR (a:Arc) ON (a.graphId, a.start_time)',

      // The causal relationship carries its graph too, and the cycle and chain
      // queries filter the relationship, not only its endpoints.
      'CREATE INDEX causal_graph IF NOT EXISTS FOR ()-[r:CAUSES]-() ON (r.graphId)',

      // InferredPressure indexes
      'CREATE INDEX pressure_confidence IF NOT EXISTS FOR (p:InferredPressure) ON (p.confidence_score)',
      'CREATE INDEX pressure_type IF NOT EXISTS FOR (p:InferredPressure) ON (p.pressure_type)'
    ];

    for (const index of indexes) {
      try {
        await this.session.run(index);
        console.log(`Created index: ${index.split(' ')[2]}`);
      } catch (error) {
        // Ignore index already exists errors
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('already exists') && !message.includes('An equivalent index already exists')) {
          console.error(`Failed to create index: ${index}`, error);
          throw error;
        }
      }
    }
  }

  /**
   * Drop all constraints and indexes (for testing/cleanup)
   */
  async dropSchema(): Promise<void> {
    try {
      console.log('Dropping database schema...');
      
      // Get all constraints and indexes
      const constraintsResult = await this.session.run('SHOW CONSTRAINTS');
      const indexesResult = await this.session.run('SHOW INDEXES');
      
      // Drop constraints
      for (const record of constraintsResult.records) {
        const constraintName = record.get('name');
        try {
          await this.session.run(`DROP CONSTRAINT ${constraintName} IF EXISTS`);
          console.log(`Dropped constraint: ${constraintName}`);
        } catch (error) {
          console.warn(`Failed to drop constraint ${constraintName}:`, error);
        }
      }
      
      // Drop indexes (excluding built-in ones)
      for (const record of indexesResult.records) {
        const indexName = record.get('name');
        const indexType = record.get('type');
        
        // Skip built-in indexes
        if (indexType !== 'LOOKUP' && !indexName.startsWith('__')) {
          try {
            await this.session.run(`DROP INDEX ${indexName} IF EXISTS`);
            console.log(`Dropped index: ${indexName}`);
          } catch (error) {
            console.warn(`Failed to drop index ${indexName}:`, error);
          }
        }
      }
      
      console.log('Database schema dropped successfully');
    } catch (error) {
      console.error('Failed to drop database schema:', error);
      throw error;
    }
  }

  /**
   * Validate schema exists and is correct
   */
  async validateSchema(): Promise<SchemaValidationResult> {
    const result: SchemaValidationResult = {
      valid: true,
      constraints: { expected: 0, found: 0, missing: [] },
      indexes: { expected: 0, found: 0, missing: [] }
    };

    try {
      // Check constraints
      const constraintsResult = await this.session.run('SHOW CONSTRAINTS');
      const existingConstraints = constraintsResult.records.map(record => record.get('name'));
      
      const expectedConstraints = [
        'event_id', 'arc_id', 'pressure_id'
      ];
      
      result.constraints.expected = expectedConstraints.length;
      result.constraints.found = existingConstraints.length;
      result.constraints.missing = expectedConstraints.filter(name => 
        !existingConstraints.some(existing => existing.includes(name))
      );

      // Check indexes
      const indexesResult = await this.session.run('SHOW INDEXES WHERE type <> "LOOKUP"');
      const existingIndexes = indexesResult.records.map(record => record.get('name'));
      
      const expectedIndexes = [
        'event_timestamp', 'event_actor', 'event_target', 'event_temporal_actor',
        'arc_timerange', 'arc_level', 'arc_temporal_compound', 'arc_start_time', 'arc_end_time',
        'pressure_confidence', 'pressure_type'
      ];
      
      result.indexes.expected = expectedIndexes.length;
      result.indexes.found = existingIndexes.length;
      result.indexes.missing = expectedIndexes.filter(name => 
        !existingIndexes.some(existing => existing.includes(name))
      );

      result.valid = result.constraints.missing.length === 0 && result.indexes.missing.length === 0;
      
      return result;
    } catch (error) {
      console.error('Failed to validate schema:', error);
      throw error;
    }
  }

  /**
   * Close the session
   */
  async close(): Promise<void> {
    await this.session.close();
  }
}

/**
 * Schema validation result interface
 */
export interface SchemaValidationResult {
  valid: boolean;
  constraints: {
    expected: number;
    found: number;
    missing: string[];
  };
  indexes: {
    expected: number;
    found: number;
    missing: string[];
  };
}

/**
 * Initialize database schema
 */
export async function initializeSchema(): Promise<void> {
  const schemaManager = new SchemaManager();
  try {
    await schemaManager.createSchema();
  } finally {
    await schemaManager.close();
  }
}

/**
 * Validate database schema
 */
export async function validateSchema(): Promise<SchemaValidationResult> {
  const schemaManager = new SchemaManager();
  try {
    return await schemaManager.validateSchema();
  } finally {
    await schemaManager.close();
  }
}