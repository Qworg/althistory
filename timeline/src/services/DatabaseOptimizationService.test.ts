import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseOptimizationService } from './DatabaseOptimizationService';
import { getDatabaseManager } from '@/utils/database';

// Mock the database manager
vi.mock('@/utils/database', () => ({
  getDatabaseManager: vi.fn(() => ({
    getNeo4jSession: vi.fn(() => ({
      run: vi.fn(),
      close: vi.fn()
    }))
  }))
}));

describe('DatabaseOptimizationService', () => {
  let service: DatabaseOptimizationService;
  let mockSession: any;

  beforeEach(() => {
    service = new DatabaseOptimizationService();
    mockSession = {
      run: vi.fn(),
      close: vi.fn()
    };
    
    (getDatabaseManager as any).mockReturnValue({
      getNeo4jSession: vi.fn(() => mockSession)
    });
  });

  describe('createOptimizedIndexes', () => {
    it('should create all required indexes', async () => {
      mockSession.run.mockResolvedValue({ records: [] });

      await service.createOptimizedIndexes();

      // Verify that multiple index creation queries were executed
      expect(mockSession.run).toHaveBeenCalledTimes(14); // Updated count based on actual implementation
      expect(mockSession.close).toHaveBeenCalled();

      // Check some specific index creations
      const indexQueries: string[] = mockSession.run.mock.calls.map(
        (call: [string]) => call[0]
      );

      expect(indexQueries.some(query => 
        query.includes('event_timestamp_actor')
      )).toBe(true);
      
      expect(indexQueries.some(query => 
        query.includes('arc_temporal_compound')
      )).toBe(true);
      
      expect(indexQueries.some(query => 
        query.includes('causal_weight_confidence')
      )).toBe(true);
    });

    it('should handle index creation errors gracefully', async () => {
      mockSession.run.mockRejectedValueOnce(new Error('Index already exists'));
      mockSession.run.mockResolvedValue({ records: [] });

      // Should not throw error even if some indexes fail
      await expect(service.createOptimizedIndexes()).resolves.not.toThrow();
      
      expect(mockSession.close).toHaveBeenCalled();
    });
  });

  describe('analyzeQueryPerformance', () => {
    it('should analyze query performance and return metrics', async () => {
      const mockResult = {
        records: [{ get: vi.fn() }, { get: vi.fn() }],
        summary: {
          profile: {
            operatorType: 'NodeByLabelScan',
            children: []
          }
        }
      };

      // Add delay to make execution time measurable
      mockSession.run.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve(mockResult), 5))
      );

      const query = 'MATCH (e:Event) RETURN e LIMIT 10';
      const metrics = await service.analyzeQueryPerformance(query);

      expect(metrics).toMatchObject({
        queryType: 'event_query',
        recordsReturned: 2,
        planDescription: 'NodeByLabelScan',
        indexesUsed: expect.any(Array)
      });

      expect(metrics.executionTime).toBeGreaterThan(0);
      expect(metrics.timestamp).toBeInstanceOf(Date);
      expect(mockSession.close).toHaveBeenCalled();
    });

    it('should throw PerformanceError for slow queries', async () => {
      const mockResult = {
        records: [],
        summary: { profile: null }
      };

      // Mock Date.now() to simulate slow query (more reliable than real setTimeout)
      let callCount = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => {
        callCount++;
        // First call is at start, subsequent calls simulate 3000ms elapsed
        return callCount === 1 ? 1000 : 4000;
      });

      // Mock repository to return immediately (timing handled by Date.now mock)
      mockSession.run.mockResolvedValue(mockResult);

      const query = 'MATCH (e:Event) RETURN e';

      try {
        await expect(service.analyzeQueryPerformance(query))
          .rejects.toThrow('Query exceeded performance threshold');
      } finally {
        // Restore Date.now
        vi.spyOn(Date, 'now').mockRestore();
      }
    });
  });

  describe('executeOptimizedQuery', () => {
    it('should execute query with timeout and return results', async () => {
      const mockResult = {
        records: [
          { get: vi.fn().mockReturnValue({ id: '1', name: 'Test' }) },
          { get: vi.fn().mockReturnValue({ id: '2', name: 'Test2' }) }
        ]
      };

      mockSession.run.mockResolvedValue(mockResult);

      const mapper = (record: any) => ({ id: record.get().id });
      const result = await service.executeOptimizedQuery(
        'MATCH (e:Event) RETURN e',
        {},
        mapper
      );

      expect(result.results).toHaveLength(2);
      expect(result.metrics).toMatchObject({
        queryType: 'event_query',
        recordsReturned: 2
      });
      expect(mockSession.close).toHaveBeenCalled();
    });

    it('should handle query timeout', async () => {
      // Mock a query that never resolves
      mockSession.run.mockImplementation(() => new Promise(() => {}));

      await expect(service.executeOptimizedQuery(
        'MATCH (e:Event) RETURN e',
        {}
      )).rejects.toThrow('Query timeout exceeded');
    });
  });

  describe('getPerformanceStatistics', () => {
    it('should return empty statistics when no metrics exist', () => {
      const stats = service.getPerformanceStatistics();

      expect(stats).toEqual({
        averageExecutionTime: 0,
        slowestQueries: [],
        queryTypeBreakdown: {},
        indexUsageStats: {}
      });
    });

    it('should calculate statistics from performance metrics', async () => {
      // Generate some test metrics
      const mockResult = {
        records: [{ get: vi.fn() }],
        summary: { profile: { operatorType: 'IndexSeek' } }
      };

      // Use Date.now() mock to ensure measurable execution times
      let baseTime = 1000;
      vi.spyOn(Date, 'now').mockImplementation(() => {
        baseTime += 50; // Each call advances by 50ms
        return baseTime;
      });

      // Mock repository to return immediately (timing handled by Date.now mock)
      mockSession.run.mockResolvedValue(mockResult);

      try {
        // Execute a few queries to generate metrics
        await service.analyzeQueryPerformance('MATCH (e:Event) RETURN e');
        await service.analyzeQueryPerformance('MATCH (a:Arc) RETURN a');
        await service.analyzeQueryPerformance('MATCH (e:Event) RETURN e');

        const stats = service.getPerformanceStatistics();

        expect(stats.averageExecutionTime).toBeGreaterThan(0);
        expect(stats.queryTypeBreakdown['event_query']).toBe(2);
        expect(stats.queryTypeBreakdown['arc_query']).toBe(1);
        expect(stats.slowestQueries.length).toBeGreaterThan(0);
      } finally {
        vi.spyOn(Date, 'now').mockRestore();
      }
    });
  });

  describe('suggestOptimizations', () => {
    it('should provide optimization suggestions based on metrics', async () => {
      // Generate some slow query metrics
      const mockResult = {
        records: Array(1000).fill({ get: vi.fn() }),
        summary: { profile: null }
      };

      // Use Date.now() mock to simulate slow queries (> 50% of threshold)
      // queryTimeoutMs = 2000ms, so 1500ms is 75% of threshold
      let callCount = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => {
        callCount++;
        // Simulate 1500ms elapsed time for each query
        return callCount % 2 === 1 ? 1000 : 2500;
      });

      // Mock repository to return immediately (timing handled by Date.now mock)
      mockSession.run.mockResolvedValue(mockResult);

      try {
        await service.analyzeQueryPerformance('MATCH (e:Event) RETURN e');

        const suggestions = service.suggestOptimizations();

        expect(Array.isArray(suggestions)).toBe(true);
        // Should have suggestions due to slow performance (1500ms > 1000ms = 50% of 2000ms)
        expect(suggestions.length).toBeGreaterThan(0);
      } finally {
        vi.spyOn(Date, 'now').mockRestore();
      }
    });
  });

  describe('query type determination', () => {
    it('should correctly identify different query types', async () => {
      const mockResult = {
        records: [],
        summary: { profile: null }
      };

      mockSession.run.mockResolvedValue(mockResult);

      const testCases = [
        { query: 'MATCH (e:Event) WHERE e.timestamp > datetime("2023-01-01") RETURN e', expected: 'temporal_range' },
        { query: 'MATCH (e1:Event)-[:CAUSES]->(e2:Event) RETURN e1, e2', expected: 'causal_relationship' },
        { query: 'MATCH (e:Event) RETURN e', expected: 'event_query' },
        { query: 'MATCH (a:Arc) RETURN a', expected: 'arc_query' },
        { query: 'CREATE (e:Event {id: "test"}) RETURN e', expected: 'create_operation' },
        { query: 'MERGE (e:Event {id: "test"}) RETURN e', expected: 'upsert_operation' }
      ];

      for (const testCase of testCases) {
        const metrics = await service.analyzeQueryPerformance(testCase.query);
        expect(metrics.queryType).toBe(testCase.expected);
      }
    });
  });

  describe('clearPerformanceMetrics', () => {
    it('should clear all performance metrics', async () => {
      const mockResult = {
        records: [],
        summary: { profile: null }
      };

      mockSession.run.mockResolvedValue(mockResult);

      // Generate some metrics
      await service.analyzeQueryPerformance('MATCH (e:Event) RETURN e');
      
      let stats = service.getPerformanceStatistics();
      expect(stats.queryTypeBreakdown['event_query']).toBe(1);

      // Clear metrics
      service.clearPerformanceMetrics();
      
      stats = service.getPerformanceStatistics();
      expect(stats.averageExecutionTime).toBe(0);
      expect(Object.keys(stats.queryTypeBreakdown)).toHaveLength(0);
    });
  });
});