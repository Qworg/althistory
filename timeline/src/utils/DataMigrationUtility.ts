import { RedisClientType } from 'redis';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getDatabaseManager } from './database';
import { getCacheManager, RedisCache } from './cache';
import { GraphNode, GraphRelationship, GraphProperties } from './LocalGraphStore';
import { loadConfig } from './config';

/**
 * Export format for graph data migration
 */
export interface GraphExportData {
  metadata: {
    exportDate: Date;
    version: string;
    nodeCount: number;
    relationshipCount: number;
    cacheKeyCount: number;
  };
  nodes: GraphNode[];
  relationships: GraphRelationship[];
  cacheData: CacheExportEntry[];
}

/**
 * Neo4j driver `Integer` value: the driver returns these for integers unless
 * lossless integers are disabled.
 */
interface Neo4jIntegerLike {
  toNumber(): number;
}

function isNeo4jIntegerLike(value: GraphProperties[string]): value is GraphProperties[string] & Neo4jIntegerLike {
  return typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function';
}

/**
 * Cache export entry format
 */
export interface CacheExportEntry {
  key: string;
  /**
   * Opaque cached payload. Cache values are arbitrary application data, so the
   * export format carries them without interpreting their shape.
   */
  value: unknown;
  expiration: number;
  accessTime?: number;
}

/**
 * Import validation result
 */
export interface ImportValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    validNodes: number;
    validRelationships: number;
    validCacheEntries: number;
  };
}

/**
 * Migration progress tracking
 */
export interface MigrationProgress {
  phase: 'exporting' | 'importing' | 'validating' | 'complete';
  current: number;
  total: number;
  message: string;
}

/**
 * Data migration utility for converting between cloud and local storage formats
 * Supports bidirectional migration between Neo4j/Redis and local storage
 */
export class DataMigrationUtility {
  private config = loadConfig();
  private databaseManager = getDatabaseManager();
  private cacheManager = getCacheManager();
  
  /**
   * Export data from Neo4j and Redis to local format
   */
  async exportCloudToLocal(
    outputPath?: string,
    options: {
      includeCache?: boolean;
      validateData?: boolean;
      onProgress?: (progress: MigrationProgress) => void;
    } = {}
  ): Promise<string> {
    const { includeCache = true, validateData = true, onProgress } = options;
    const exportPath = outputPath || path.join(this.config.localExecution.dataDirectory, 'cloud_export.json');
    
    try {
      // Ensure output directory exists
      await fs.mkdir(path.dirname(exportPath), { recursive: true });
      
      onProgress?.({
        phase: 'exporting',
        current: 0,
        total: 100,
        message: 'Starting cloud data export...'
      });

      // Export graph data from Neo4j
      const { nodes, relationships } = await this.exportGraphData(onProgress);
      
      onProgress?.({
        phase: 'exporting',
        current: 60,
        total: 100,
        message: 'Exporting cache data...'
      });

      // Export cache data from Redis if enabled
      let cacheData: CacheExportEntry[] = [];
      if (includeCache) {
        cacheData = await this.exportCacheData();
      }

      onProgress?.({
        phase: 'exporting',
        current: 80,
        total: 100,
        message: 'Preparing export data...'
      });

      // Create export data structure
      const exportData: GraphExportData = {
        metadata: {
          exportDate: new Date(),
          version: '1.0.0',
          nodeCount: nodes.length,
          relationshipCount: relationships.length,
          cacheKeyCount: cacheData.length
        },
        nodes,
        relationships,
        cacheData
      };

      onProgress?.({
        phase: 'exporting',
        current: 90,
        total: 100,
        message: 'Validating export data...'
      });

      // Validate export data if requested
      if (validateData) {
        const validation = await this.validateExportData(exportData);
        if (!validation.isValid) {
          throw new Error(`Export validation failed: ${validation.errors.join(', ')}`);
        }
      }

      // Write to file
      await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2));

      onProgress?.({
        phase: 'complete',
        current: 100,
        total: 100,
        message: `Export completed successfully: ${exportPath}`
      });

      console.log(`Data exported successfully to: ${exportPath}`);
      console.log(`Exported: ${nodes.length} nodes, ${relationships.length} relationships, ${cacheData.length} cache entries`);
      
      return exportPath;
    } catch (error) {
      console.error('Export failed:', error);
      throw new Error(`Export failed: ${error}`);
    }
  }

  /**
   * Import data from local format to Neo4j and Redis
   */
  async importLocalToCloud(
    importPath: string,
    options: {
      clearExisting?: boolean;
      includeCache?: boolean;
      validateData?: boolean;
      onProgress?: (progress: MigrationProgress) => void;
    } = {}
  ): Promise<void> {
    const { clearExisting = false, includeCache = true, validateData = true, onProgress } = options;
    
    try {
      onProgress?.({
        phase: 'importing',
        current: 0,
        total: 100,
        message: 'Loading import data...'
      });

      // Load and parse import file
      const data = await fs.readFile(importPath, 'utf8');
      const importData: GraphExportData = JSON.parse(data);

      onProgress?.({
        phase: 'validating',
        current: 10,
        total: 100,
        message: 'Validating import data...'
      });

      // Validate import data if requested
      if (validateData) {
        const validation = await this.validateImportData(importData);
        if (!validation.isValid) {
          throw new Error(`Import validation failed: ${validation.errors.join(', ')}`);
        }
      }

      onProgress?.({
        phase: 'importing',
        current: 20,
        total: 100,
        message: 'Clearing existing data...'
      });

      // Clear existing data if requested
      if (clearExisting) {
        await this.clearCloudData();
      }

      onProgress?.({
        phase: 'importing',
        current: 30,
        total: 100,
        message: 'Importing graph data...'
      });

      // Import graph data to Neo4j
      await this.importGraphData(importData.nodes, importData.relationships, onProgress);

      onProgress?.({
        phase: 'importing',
        current: 80,
        total: 100,
        message: 'Importing cache data...'
      });

      // Import cache data to Redis if enabled
      if (includeCache && importData.cacheData.length > 0) {
        await this.importCacheData(importData.cacheData);
      }

      onProgress?.({
        phase: 'complete',
        current: 100,
        total: 100,
        message: 'Import completed successfully'
      });

      console.log(`Data imported successfully from: ${importPath}`);
      console.log(`Imported: ${importData.nodes.length} nodes, ${importData.relationships.length} relationships, ${importData.cacheData.length} cache entries`);
    } catch (error) {
      console.error('Import failed:', error);
      throw new Error(`Import failed: ${error}`);
    }
  }

  /**
   * Export graph data from Neo4j to local format
   */
  private async exportGraphData(onProgress?: (progress: MigrationProgress) => void): Promise<{
    nodes: GraphNode[];
    relationships: GraphRelationship[];
  }> {
    const session = this.databaseManager.getNeo4jSession();
    const nodes: GraphNode[] = [];
    const relationships: GraphRelationship[] = [];

    try {
      onProgress?.({
        phase: 'exporting',
        current: 10,
        total: 100,
        message: 'Exporting nodes...'
      });

      // Export all nodes with their labels and properties
      const nodeQuery = `
        MATCH (n)
        RETURN n, labels(n) as nodeLabels
      `;
      
      const nodeResult = await session.run(nodeQuery);
      
      for (const record of nodeResult.records) {
        const node = record.get('n');
        const labels = record.get('nodeLabels');
        const nodeId = node.identity.toString();
        
        nodes.push({
          id: nodeId,
          labels: labels,
          properties: this.convertNeo4jProperties(node.properties)
        });
      }

      onProgress?.({
        phase: 'exporting',
        current: 40,
        total: 100,
        message: 'Exporting relationships...'
      });

      // Export all relationships with their types and properties
      const relQuery = `
        MATCH (a)-[r]->(b)
        RETURN r, type(r) as relType, id(a) as startId, id(b) as endId
      `;
      
      const relResult = await session.run(relQuery);
      
      for (const record of relResult.records) {
        const rel = record.get('r');
        const relType = record.get('relType');
        const startId = record.get('startId').toString();
        const endId = record.get('endId').toString();
        const relId = rel.identity.toString();
        
        relationships.push({
          id: relId,
          type: relType,
          startNodeId: startId,
          endNodeId: endId,
          properties: this.convertNeo4jProperties(rel.properties)
        });
      }

      return { nodes, relationships };
    } finally {
      await session.close();
    }
  }

  /**
   * Export cache data from Redis to local format
   */
  private async exportCacheData(): Promise<CacheExportEntry[]> {
    if (!(this.cacheManager instanceof RedisCache)) {
      console.log('Cache manager is not Redis, skipping cache export');
      return [];
    }

    try {
      const redisClient = this.databaseManager.getRedisClient() as RedisClientType;
      const cacheEntries: CacheExportEntry[] = [];
      
      // Get all cache keys
      const keys = await redisClient.keys('*');
      
      for (const key of keys) {
        try {
          const value = await redisClient.get(key);
          const ttl = await redisClient.ttl(key);
          
          if (value !== null) {
            cacheEntries.push({
              key,
              value: JSON.parse(value),
              expiration: ttl > 0 ? Date.now() + (ttl * 1000) : Date.now() + (24 * 60 * 60 * 1000), // Default 24h if no TTL
              accessTime: Date.now()
            });
          }
        } catch (error) {
          console.warn(`Failed to export cache key ${key}:`, error);
        }
      }
      
      return cacheEntries;
    } catch (error) {
      console.warn('Failed to export cache data:', error);
      return [];
    }
  }

  /**
   * Import graph data to Neo4j
   */
  private async importGraphData(
    nodes: GraphNode[],
    relationships: GraphRelationship[],
    onProgress?: (progress: MigrationProgress) => void
  ): Promise<void> {
    const session = this.databaseManager.getNeo4jSession();
    
    try {
      // Import nodes in batches
      const nodeBatchSize = 1000;
      const totalNodes = nodes.length;
      
      for (let i = 0; i < totalNodes; i += nodeBatchSize) {
        const batch = nodes.slice(i, i + nodeBatchSize);
        
        onProgress?.({
          phase: 'importing',
          current: 30 + Math.floor((i / totalNodes) * 30),
          total: 100,
          message: `Importing nodes: ${i + batch.length}/${totalNodes}`
        });
        
        // Create nodes with dynamic labels
        for (const node of batch) {
          const labelString = node.labels.map(label => `:${label}`).join('');
          const query = `
            CREATE (n${labelString})
            SET n = $properties, n.neo4j_id = $neo4j_id
          `;
          
          await session.run(query, {
            properties: node.properties,
            neo4j_id: node.id
          });
        }
      }

      // Import relationships in batches
      const relBatchSize = 1000;
      const totalRels = relationships.length;
      
      for (let i = 0; i < totalRels; i += relBatchSize) {
        const batch = relationships.slice(i, i + relBatchSize);
        
        onProgress?.({
          phase: 'importing',
          current: 60 + Math.floor((i / totalRels) * 20),
          total: 100,
          message: `Importing relationships: ${i + batch.length}/${totalRels}`
        });
        
        // Create relationships
        for (const rel of batch) {
          const query = `
            MATCH (a {neo4j_id: $startId}), (b {neo4j_id: $endId})
            CREATE (a)-[r:${rel.type}]->(b)
            SET r = $properties, r.neo4j_id = $neo4j_id
          `;
          
          await session.run(query, {
            startId: rel.startNodeId,
            endId: rel.endNodeId,
            properties: rel.properties,
            neo4j_id: rel.id
          });
        }
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Import cache data to Redis
   */
  private async importCacheData(cacheEntries: CacheExportEntry[]): Promise<void> {
    if (!(this.cacheManager instanceof RedisCache)) {
      console.log('Cache manager is not Redis, skipping cache import');
      return;
    }

    try {
      const redisClient = this.databaseManager.getRedisClient() as RedisClientType;
      
      for (const entry of cacheEntries) {
        try {
          const ttlSeconds = Math.max(1, Math.floor((entry.expiration - Date.now()) / 1000));
          
          if (ttlSeconds > 0) {
            await redisClient.setEx(entry.key, ttlSeconds, JSON.stringify(entry.value));
          }
        } catch (error) {
          console.warn(`Failed to import cache key ${entry.key}:`, error);
        }
      }
    } catch (error) {
      console.warn('Failed to import cache data:', error);
    }
  }

  /**
   * Clear all data from Neo4j and Redis
   */
  private async clearCloudData(): Promise<void> {
    // Clear Neo4j
    const session = this.databaseManager.getNeo4jSession();
    try {
      await session.run('MATCH (n) DETACH DELETE n');
    } finally {
      await session.close();
    }

    // Clear Redis
    if (this.cacheManager instanceof RedisCache) {
      await this.cacheManager.clear();
    }
  }

  /**
   * Convert Neo4j properties to plain JavaScript objects
   */
  private convertNeo4jProperties(properties: GraphProperties): GraphProperties {
    const converted: GraphProperties = {};

    for (const [key, value] of Object.entries(properties)) {
      converted[key] = this.convertNeo4jProperty(value);
    }

    return converted;
  }

  /**
   * Flatten a Neo4j property value to a plain JavaScript value: driver
   * `Integer`s become numbers, temporal/spatial values become their string
   * form, and everything else is returned untouched.
   */
  private convertNeo4jProperty(value: GraphProperties[string]): GraphProperties[string] {
    if (value === null || typeof value !== 'object') {
      return value;
    }

    // Neo4j Integer objects first (they also expose toString)
    if (isNeo4jIntegerLike(value)) {
      return value.toNumber();
    }

    if (typeof value.toString === 'function') {
      return value.toString();
    }

    return value;
  }

  /**
   * Validate export data before writing
   */
  private async validateExportData(data: GraphExportData): Promise<ImportValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let validNodes = 0;
    let validRelationships = 0;
    let validCacheEntries = 0;

    // Validate metadata
    if (!data.metadata || !data.metadata.exportDate) {
      errors.push('Missing or invalid metadata');
    }

    // Validate nodes
    const nodeIds = new Set<string>();
    for (const node of data.nodes) {
      if (!node.id || !node.labels || !Array.isArray(node.labels)) {
        errors.push(`Invalid node structure: ${JSON.stringify(node)}`);
        continue;
      }
      
      if (nodeIds.has(node.id)) {
        errors.push(`Duplicate node ID: ${node.id}`);
        continue;
      }
      
      nodeIds.add(node.id);
      validNodes++;
    }

    // Validate relationships
    const relationshipIds = new Set<string>();
    for (const rel of data.relationships) {
      if (!rel.id || !rel.type || !rel.startNodeId || !rel.endNodeId) {
        errors.push(`Invalid relationship structure: ${JSON.stringify(rel)}`);
        continue;
      }
      
      if (relationshipIds.has(rel.id)) {
        errors.push(`Duplicate relationship ID: ${rel.id}`);
        continue;
      }
      
      if (!nodeIds.has(rel.startNodeId) || !nodeIds.has(rel.endNodeId)) {
        errors.push(`Relationship references non-existent nodes: ${rel.id}`);
        continue;
      }
      
      relationshipIds.add(rel.id);
      validRelationships++;
    }

    // Validate cache entries
    for (const entry of data.cacheData) {
      if (!entry.key || entry.expiration === undefined) {
        warnings.push(`Invalid cache entry: ${JSON.stringify(entry)}`);
        continue;
      }
      
      validCacheEntries++;
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      stats: {
        validNodes,
        validRelationships,
        validCacheEntries
      }
    };
  }

  /**
   * Validate import data before processing
   */
  private async validateImportData(data: GraphExportData): Promise<ImportValidationResult> {
    // Use the same validation logic as export validation
    return this.validateExportData(data);
  }

  /**
   * Get export/import statistics
   */
  async getCloudDataStats(): Promise<{
    nodeCount: number;
    relationshipCount: number;
    cacheKeyCount: number;
  }> {
    const session = this.databaseManager.getNeo4jSession();
    
    try {
      // Count nodes
      const nodeResult = await session.run('MATCH (n) RETURN count(n) as nodeCount');
      const nodeCount = nodeResult.records[0]?.get('nodeCount')?.toNumber() || 0;

      // Count relationships
      const relResult = await session.run('MATCH ()-[r]->() RETURN count(r) as relCount');
      const relationshipCount = relResult.records[0]?.get('relCount')?.toNumber() || 0;

      // Count cache keys
      let cacheKeyCount = 0;
      if (this.cacheManager instanceof RedisCache) {
        try {
          const redisClient = this.databaseManager.getRedisClient() as RedisClientType;
          const keys = await redisClient.keys('*');
          cacheKeyCount = keys.length;
        } catch (error) {
          console.warn('Failed to count cache keys:', error);
        }
      }

      return {
        nodeCount,
        relationshipCount,
        cacheKeyCount
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Create a migration backup before importing
   */
  async createMigrationBackup(backupPath?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultPath = path.join(this.config.localExecution.dataDirectory, 'backups', `migration_backup_${timestamp}.json`);
    const finalPath = backupPath || defaultPath;

    return this.exportCloudToLocal(finalPath, {
      includeCache: true,
      validateData: true,
      onProgress: (progress) => {
        console.log(`Backup progress: ${progress.current}/${progress.total} - ${progress.message}`);
      }
    });
  }
}