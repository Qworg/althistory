import { getDatabaseManager } from '@/utils/database';
import { loadConfig } from '@/utils/config';
import { DatabaseError, PerformanceError } from '@/utils/errors';
import type { QueryResult, Record as Neo4jRecord } from 'neo4j-driver';

/**
 * Structural subset of the Neo4j PROFILE plan tree that this service reads.
 * The driver types the plan as `ProfiledPlan | false`, but tests and the
 * LocalSession path supply plain objects, so only these two fields are relied on.
 */
type QueryProfileNode = {
  operatorType?: string;
  children?: QueryProfileNode[];
};

/**
 * Query performance metrics
 */
export interface QueryPerformanceMetrics {
  queryType: string;
  executionTime: number;
  recordsReturned: number;
  indexesUsed: string[];
  planDescription: string;
  timestamp: Date;
}

/**
 * Database optimization and performance monitoring service
 */
export class DatabaseOptimizationService {
  private config = loadConfig();
  private performanceMetrics: QueryPerformanceMetrics[] = [];

  /**
   * Create optimized compound indexes for temporal and causal queries
   */
  async createOptimizedIndexes(): Promise<void> {
    const session = getDatabaseManager().getNeo4jSession();
    
    try {
      const indexQueries = [
        // Event indexes for temporal queries
        'CREATE INDEX event_timestamp_actor IF NOT EXISTS FOR (e:Event) ON (e.timestamp, e.actor)',
        'CREATE INDEX event_timestamp_target IF NOT EXISTS FOR (e:Event) ON (e.timestamp, e.target)',
        'CREATE INDEX event_actor_timestamp IF NOT EXISTS FOR (e:Event) ON (e.actor, e.timestamp)',
        'CREATE INDEX event_target_timestamp IF NOT EXISTS FOR (e:Event) ON (e.target, e.timestamp)',
        
        // Arc indexes for temporal range queries
        'CREATE INDEX arc_temporal_compound IF NOT EXISTS FOR (a:Arc) ON (a.start_time, a.end_time, a.level)',
        'CREATE INDEX arc_level_temporal IF NOT EXISTS FOR (a:Arc) ON (a.level, a.start_time, a.end_time)',
        'CREATE INDEX arc_hierarchy_lookup IF NOT EXISTS FOR (a:Arc) ON (a.level, a.start_time)',
        
        // Causal relationship indexes
        'CREATE INDEX causal_weight_confidence IF NOT EXISTS FOR ()-[r:CAUSES]-() ON (r.weight, r.confidence)',
        'CREATE INDEX causal_relationship_type IF NOT EXISTS FOR ()-[r:CAUSES]-() ON (r.relationship_type, r.weight)',

        // Graph-scoped indexes (#59). Cloud mode keeps every graph's rows under
        // the same labels and relationship type, so each graph-scoped query
        // filters on `graphId` first; these keep that filter a range scan. The
        // schema initialiser declares the same set -- this list is the
        // optimisation entry point, `SchemaManager` is the one `Application`
        // runs at startup.
        'CREATE INDEX event_graph_timestamp IF NOT EXISTS FOR (e:Event) ON (e.graphId, e.timestamp)',
        'CREATE INDEX event_graph_actor IF NOT EXISTS FOR (e:Event) ON (e.graphId, e.actor)',
        'CREATE INDEX arc_graph_level IF NOT EXISTS FOR (a:Arc) ON (a.graphId, a.level)',
        'CREATE INDEX arc_graph_start_time IF NOT EXISTS FOR (a:Arc) ON (a.graphId, a.start_time)',
        'CREATE INDEX causal_graph IF NOT EXISTS FOR ()-[r:CAUSES]-() ON (r.graphId)',
        
        // Inference and pressure indexes
        'CREATE INDEX pressure_confidence_type IF NOT EXISTS FOR (p:InferredPressure) ON (p.confidence_score, p.pressure_type)',
        'CREATE INDEX pressure_type_confidence IF NOT EXISTS FOR (p:InferredPressure) ON (p.pressure_type, p.confidence_score)',
        
        // Full-text search indexes
        'CREATE FULLTEXT INDEX event_description_fulltext IF NOT EXISTS FOR (e:Event) ON EACH [e.description]',
        'CREATE FULLTEXT INDEX arc_name_description_fulltext IF NOT EXISTS FOR (a:Arc) ON EACH [a.name, a.description]',
        'CREATE FULLTEXT INDEX pressure_description_fulltext IF NOT EXISTS FOR (p:InferredPressure) ON EACH [p.description]'
      ];

      for (const indexQuery of indexQueries) {
        try {
          await session.run(indexQuery);
          console.log(`Created index: ${indexQuery.split(' ')[2]}`);
        } catch (error) {
          // Index might already exist, log but don't fail
          console.warn(`Index creation warning: ${error}`);
        }
      }

      console.log('Database indexes optimization completed');
    } catch (error) {
      throw new DatabaseError(
        'Failed to create optimized indexes',
        'createOptimizedIndexes',
        error as Error
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Analyze query performance and suggest optimizations
   */
  async analyzeQueryPerformance(query: string, parameters: Record<string, unknown> = {}): Promise<QueryPerformanceMetrics> {
    const session = getDatabaseManager().getNeo4jSession();
    
    try {
      const startTime = Date.now();
      
      // Execute query with profiling
      const profileQuery = `PROFILE ${query}`;
      const result = await session.run(profileQuery, parameters);
      
      const executionTime = Date.now() - startTime;
      const recordsReturned = result.records.length;
      
      // Extract performance information from profile
      const profile = result.summary.profile;
      const planDescription = this.extractPlanDescription(profile);
      const indexesUsed = this.extractIndexesUsed(profile);
      
      const metrics: QueryPerformanceMetrics = {
        queryType: this.determineQueryType(query),
        executionTime,
        recordsReturned,
        indexesUsed,
        planDescription,
        timestamp: new Date()
      };

      // Store metrics for analysis
      this.performanceMetrics.push(metrics);
      
      // Keep only last 1000 metrics
      if (this.performanceMetrics.length > 1000) {
        this.performanceMetrics = this.performanceMetrics.slice(-1000);
      }

      // Check if query exceeds performance threshold
      if (executionTime > this.config.performance.queryTimeoutMs) {
        throw new PerformanceError(
          `Query exceeded performance threshold: ${executionTime}ms > ${this.config.performance.queryTimeoutMs}ms`,
          metrics.queryType,
          executionTime,
          this.config.performance.queryTimeoutMs
        );
      }

      return metrics;
    } catch (error) {
      if (error instanceof PerformanceError) {
        throw error;
      }
      throw new DatabaseError(
        'Failed to analyze query performance',
        'analyzeQueryPerformance',
        error as Error
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Execute query with automatic performance monitoring and optimization
   */
  async executeOptimizedQuery(
    query: string,
    parameters?: Record<string, unknown>
  ): Promise<{ results: Neo4jRecord[], metrics: QueryPerformanceMetrics }>;
  async executeOptimizedQuery<T>(
    query: string,
    parameters: Record<string, unknown>,
    mapper: (record: Neo4jRecord) => T
  ): Promise<{ results: T[], metrics: QueryPerformanceMetrics }>;
  async executeOptimizedQuery<T>(
    query: string,
    parameters: Record<string, unknown> = {},
    mapper?: (record: Neo4jRecord) => T
  ): Promise<{ results: Neo4jRecord[] | T[], metrics: QueryPerformanceMetrics }> {
    const session = getDatabaseManager().getNeo4jSession();
    
    try {
      const startTime = Date.now();
      
      // Add query timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new PerformanceError(
            'Query timeout exceeded',
            this.determineQueryType(query),
            this.config.performance.queryTimeoutMs,
            this.config.performance.queryTimeoutMs
          ));
        }, this.config.performance.queryTimeoutMs);
      });

      // Execute query with timeout
      const queryPromise = session.run(query, parameters);
      const result: QueryResult = await Promise.race([queryPromise, timeoutPromise]);
      
      const executionTime = Date.now() - startTime;
      
      // Map results if mapper provided
      const results = mapper ? 
        result.records.map(mapper) : 
        result.records;

      const metrics: QueryPerformanceMetrics = {
        queryType: this.determineQueryType(query),
        executionTime,
        recordsReturned: result.records.length,
        indexesUsed: [], // Would need EXPLAIN to get this
        planDescription: 'Optimized execution',
        timestamp: new Date()
      };

      this.performanceMetrics.push(metrics);

      return { results, metrics };
    } catch (error) {
      if (error instanceof PerformanceError) {
        throw error;
      }
      throw new DatabaseError(
        'Failed to execute optimized query',
        'executeOptimizedQuery',
        error as Error
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Get performance statistics for query optimization
   */
  getPerformanceStatistics(): {
    averageExecutionTime: number;
    slowestQueries: QueryPerformanceMetrics[];
    queryTypeBreakdown: Record<string, number>;
    indexUsageStats: Record<string, number>;
  } {
    if (this.performanceMetrics.length === 0) {
      return {
        averageExecutionTime: 0,
        slowestQueries: [],
        queryTypeBreakdown: {},
        indexUsageStats: {}
      };
    }

    const totalExecutionTime = this.performanceMetrics.reduce(
      (sum, metric) => sum + metric.executionTime, 0
    );
    const averageExecutionTime = totalExecutionTime / this.performanceMetrics.length;

    const slowestQueries = [...this.performanceMetrics]
      .sort((a, b) => b.executionTime - a.executionTime)
      .slice(0, 10);

    const queryTypeBreakdown: Record<string, number> = {};
    const indexUsageStats: Record<string, number> = {};

    this.performanceMetrics.forEach(metric => {
      queryTypeBreakdown[metric.queryType] = (queryTypeBreakdown[metric.queryType] || 0) + 1;
      
      metric.indexesUsed.forEach(index => {
        indexUsageStats[index] = (indexUsageStats[index] || 0) + 1;
      });
    });

    return {
      averageExecutionTime,
      slowestQueries,
      queryTypeBreakdown,
      indexUsageStats
    };
  }

  /**
   * Suggest query optimizations based on performance metrics
   */
  suggestOptimizations(): string[] {
    const stats = this.getPerformanceStatistics();
    const suggestions: string[] = [];

    // Check average execution time
    if (stats.averageExecutionTime > this.config.performance.queryTimeoutMs * 0.5) {
      suggestions.push('Consider adding more specific indexes for frequently used query patterns');
    }

    // Check for slow temporal queries
    const slowTemporalQueries = stats.slowestQueries.filter(
      q => q.queryType.includes('temporal') || q.queryType.includes('range')
    );
    if (slowTemporalQueries.length > 0) {
      suggestions.push('Temporal queries are slow - consider partitioning data by time ranges');
    }

    // Check for unused indexes
    const totalQueries = this.performanceMetrics.length;
    Object.entries(stats.indexUsageStats).forEach(([index, usage]) => {
      if (usage / totalQueries < 0.1) {
        suggestions.push(`Index "${index}" is rarely used - consider removing it`);
      }
    });

    // Check for missing indexes on frequent query types
    Object.entries(stats.queryTypeBreakdown).forEach(([queryType, count]) => {
      if (count / totalQueries > 0.2 && stats.averageExecutionTime > 100) {
        suggestions.push(`Consider adding specialized index for frequent "${queryType}" queries`);
      }
    });

    return suggestions;
  }

  /**
   * Alias for createOptimizedIndexes for backward compatibility
   */
  async optimizeIndexes(): Promise<void> {
    return this.createOptimizedIndexes();
  }

  /**
   * Optimize database connection settings
   */
  async optimizeConnectionSettings(): Promise<void> {
    const session = getDatabaseManager().getNeo4jSession();
    
    try {
      // Set optimal database settings for performance
      const optimizationQueries = [
        // Increase query cache size
        'CALL dbms.setConfigValue("dbms.query_cache_size", "256M")',
        
        // Optimize memory settings
        'CALL dbms.setConfigValue("dbms.memory.heap.initial_size", "1G")',
        'CALL dbms.setConfigValue("dbms.memory.heap.max_size", "2G")',
        
        // Set optimal page cache
        'CALL dbms.setConfigValue("dbms.memory.pagecache.size", "1G")',
        
        // Enable query logging for slow queries
        'CALL dbms.setConfigValue("dbms.logs.query.enabled", "true")',
        'CALL dbms.setConfigValue("dbms.logs.query.threshold", "1s")'
      ];

      for (const query of optimizationQueries) {
        try {
          await session.run(query);
        } catch (error) {
          // Some settings might not be changeable at runtime
          console.warn(`Configuration warning: ${error}`);
        }
      }

      console.log('Database connection optimization completed');
    } catch (error) {
      throw new DatabaseError(
        'Failed to optimize connection settings',
        'optimizeConnectionSettings',
        error as Error
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Clear performance metrics
   */
  clearPerformanceMetrics(): void {
    this.performanceMetrics = [];
  }

  /**
   * Extract plan description from Neo4j profile
   */
  private extractPlanDescription(profile: QueryProfileNode | false | null | undefined): string {
    if (!profile) return 'No profile available';
    
    try {
      return profile.operatorType || 'Unknown operation';
    } catch {
      return 'Profile parsing error';
    }
  }

  /**
   * Extract indexes used from Neo4j profile
   */
  private extractIndexesUsed(profile: QueryProfileNode | false | null | undefined): string[] {
    if (!profile) return [];
    
    try {
      const indexes: string[] = [];
      
      // Recursively search for index usage in profile tree
      const searchProfile = (node: QueryProfileNode): void => {
        if (node.operatorType && node.operatorType.includes('Index')) {
          indexes.push(node.operatorType);
        }
        
        if (node.children) {
          node.children.forEach(searchProfile);
        }
      };
      
      searchProfile(profile);
      return indexes;
    } catch {
      return [];
    }
  }

  /**
   * Determine query type from query string
   */
  private determineQueryType(query: string): string {
    const normalizedQuery = query.toLowerCase().trim();
    
    // Check temporal patterns first (before generic event/arc checks)
    if (normalizedQuery.includes('datetime') || 
        (normalizedQuery.includes('timestamp') && (normalizedQuery.includes('>') || normalizedQuery.includes('<') || normalizedQuery.includes('between')))) {
      return 'temporal_range';
    }
    if (normalizedQuery.includes('causes') || normalizedQuery.includes('causal')) {
      return 'causal_relationship';
    }
    if (normalizedQuery.startsWith('create')) {
      return 'create_operation';
    }
    if (normalizedQuery.startsWith('merge')) {
      return 'upsert_operation';
    }
    if (normalizedQuery.includes('event')) {
      return 'event_query';
    }
    if (normalizedQuery.includes('arc')) {
      return 'arc_query';
    }
    if (normalizedQuery.includes('pressure')) {
      return 'inference_query';
    }
    
    return 'unknown_query';
  }
}