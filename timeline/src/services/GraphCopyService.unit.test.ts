import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphCopyService, CopyResult, IntegrityReport, CopyProgress } from './GraphCopyService';
import { Session, Integer } from 'neo4j-driver';

describe('GraphCopyService Unit Tests', () => {
  let graphCopyService: GraphCopyService;
  let mockSession: Session;

  beforeEach(() => {
    // Create mock session
    mockSession = {
      run: vi.fn(),
      close: vi.fn()
    } as any;

    graphCopyService = new GraphCopyService(mockSession);
  });

  describe('copyFullGraph', () => {
    it('should successfully copy a simple graph', async () => {
      // Arrange
      const sourceGraphId = 'test-source';
      const targetGraphId = 'test-target';

      // Mock total counts query
      vi.mocked(mockSession.run)
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(5)) }]
        } as any) // totalNodes
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(3)) }]
        } as any) // totalRelationships
        // Mock node batch copy
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(5)) }]
        } as any)
        // Mock relationship batch copy
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(3)) }]
        } as any)
        // Mock integrity validation queries
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('Event').mockReturnValueOnce(Integer.fromNumber(3)) }
          ]
        } as any) // source node counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('Event').mockReturnValueOnce(Integer.fromNumber(3)) }
          ]
        } as any) // target node counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('PART_OF').mockReturnValueOnce(Integer.fromNumber(3)) }
          ]
        } as any) // source relationship counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('PART_OF').mockReturnValueOnce(Integer.fromNumber(3)) }
          ]
        } as any) // target relationship counts
        .mockResolvedValueOnce({
          records: []
        } as any); // orphaned relationships

      // Act
      const result = await graphCopyService.copyFullGraph(sourceGraphId, targetGraphId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.sourceGraphId).toBe(sourceGraphId);
      expect(result.targetGraphId).toBe(targetGraphId);
      expect(result.copiedNodes).toBe(5);
      expect(result.copiedRelationships).toBe(3);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle progress tracking during copy', async () => {
      // Arrange
      const sourceGraphId = 'test-source';
      const targetGraphId = 'test-target';
      const progressUpdates: CopyProgress[] = [];

      const progressCallback = (progress: CopyProgress) => {
        progressUpdates.push({ ...progress });
      };

      // Mock queries for larger dataset requiring multiple batches
      vi.mocked(mockSession.run)
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(25)) }]
        } as any) // totalNodes
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(15)) }]
        } as any) // totalRelationships
        // Mock multiple node batches
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(10)) }]
        } as any)
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(10)) }]
        } as any)
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(5)) }]
        } as any)
        // Mock multiple relationship batches
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(10)) }]
        } as any)
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(5)) }]
        } as any)
        // Mock integrity validation (simplified)
        .mockResolvedValue({
          records: []
        } as any);

      // Act
      const result = await graphCopyService.copyFullGraph(sourceGraphId, targetGraphId, {
        batchSize: 10,
        progressCallback,
        validateIntegrity: false // Skip integrity validation for this test
      });

      // Assert
      expect(result.success).toBe(true);
      expect(progressUpdates.length).toBeGreaterThan(0);
      
      // Verify progress increases
      for (let i = 1; i < progressUpdates.length; i++) {
        expect(progressUpdates[i].percentage).toBeGreaterThanOrEqual(progressUpdates[i - 1].percentage);
      }
    });

    it('should handle batch processing errors gracefully', async () => {
      // Arrange
      const sourceGraphId = 'test-source';
      const targetGraphId = 'test-target';

      // Mock total counts
      vi.mocked(mockSession.run)
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(10)) }]
        } as any) // totalNodes
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(5)) }]
        } as any) // totalRelationships
        // Mock successful first batch
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(5)) }]
        } as any)
        // Mock failed second batch
        .mockRejectedValueOnce(new Error('Database connection lost'));

      // Act
      const result = await graphCopyService.copyFullGraph(sourceGraphId, targetGraphId, {
        batchSize: 5,
        validateIntegrity: false
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.copiedNodes).toBe(5); // First batch succeeded
      expect(result.copiedRelationships).toBe(0); // Relationships not reached due to error
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors![0]).toContain('Node batch copy failed');
    });

    it('should preserve IDs when preserveIds is true', async () => {
      // Arrange
      const sourceGraphId = 'test-source';
      const targetGraphId = 'test-target';

      // Mock successful copy
      vi.mocked(mockSession.run)
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(3)) }]
        } as any) // totalNodes
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(2)) }]
        } as any) // totalRelationships
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(3)) }]
        } as any) // node batch
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(2)) }]
        } as any); // relationship batch

      // Act
      const result = await graphCopyService.copyFullGraph(sourceGraphId, targetGraphId, {
        preserveIds: true,
        validateIntegrity: false
      });

      // Assert
      expect(result.success).toBe(true);
      
      // Verify that the node batch copy was called with preserveIds: true
      const nodeCallArgs = vi.mocked(mockSession.run).mock.calls.find(call => 
        call[1] && call[1].preserveIds === true
      );
      expect(nodeCallArgs).toBeDefined();
    });
  });

  describe('validateCopyIntegrity', () => {
    it('should validate successful copy integrity', async () => {
      // Arrange
      const copyResult: CopyResult = {
        sourceGraphId: 'test-source',
        targetGraphId: 'test-target',
        copiedNodes: 5,
        copiedRelationships: 3,
        duration: 1000,
        success: true
      };

      // Mock integrity validation queries
      vi.mocked(mockSession.run)
        // Source node counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('Event').mockReturnValueOnce(Integer.fromNumber(3)) },
            { get: vi.fn().mockReturnValueOnce('Arc').mockReturnValueOnce(Integer.fromNumber(2)) }
          ]
        } as any)
        // Target node counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('Event').mockReturnValueOnce(Integer.fromNumber(3)) },
            { get: vi.fn().mockReturnValueOnce('Arc').mockReturnValueOnce(Integer.fromNumber(2)) }
          ]
        } as any)
        // Source relationship counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('PART_OF').mockReturnValueOnce(Integer.fromNumber(3)) }
          ]
        } as any)
        // Target relationship counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('PART_OF').mockReturnValueOnce(Integer.fromNumber(3)) }
          ]
        } as any)
        // Orphaned relationships
        .mockResolvedValueOnce({
          records: []
        } as any);

      // Act
      const integrityReport = await graphCopyService.validateCopyIntegrity(copyResult);

      // Assert
      expect(integrityReport.isValid).toBe(true);
      expect(integrityReport.missingNodes).toHaveLength(0);
      expect(integrityReport.missingRelationships).toHaveLength(0);
      expect(integrityReport.orphanedRelationships).toHaveLength(0);
      expect(integrityReport.violations).toHaveLength(0);
    });

    it('should detect missing nodes in copy', async () => {
      // Arrange
      const copyResult: CopyResult = {
        sourceGraphId: 'test-source',
        targetGraphId: 'test-target',
        copiedNodes: 3,
        copiedRelationships: 2,
        duration: 1000,
        success: true
      };

      // Mock integrity validation queries showing missing nodes
      vi.mocked(mockSession.run)
        // Source node counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('Event').mockReturnValueOnce(Integer.fromNumber(5)) }
          ]
        } as any)
        // Target node counts (missing nodes)
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('Event').mockReturnValueOnce(Integer.fromNumber(3)) }
          ]
        } as any)
        // Source relationship counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('PART_OF').mockReturnValueOnce(Integer.fromNumber(2)) }
          ]
        } as any)
        // Target relationship counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('PART_OF').mockReturnValueOnce(Integer.fromNumber(2)) }
          ]
        } as any)
        // Orphaned relationships
        .mockResolvedValueOnce({
          records: []
        } as any);

      // Act
      const integrityReport = await graphCopyService.validateCopyIntegrity(copyResult);

      // Assert
      expect(integrityReport.isValid).toBe(false);
      expect(integrityReport.missingNodes.length).toBeGreaterThan(0);
      expect(integrityReport.missingNodes[0]).toContain('Event: expected 5, found 3');
      expect(integrityReport.violations.length).toBeGreaterThan(0);
    });

    it('should detect missing relationships in copy', async () => {
      // Arrange
      const copyResult: CopyResult = {
        sourceGraphId: 'test-source',
        targetGraphId: 'test-target',
        copiedNodes: 5,
        copiedRelationships: 2,
        duration: 1000,
        success: true
      };

      // Mock integrity validation queries showing missing relationships
      vi.mocked(mockSession.run)
        // Source node counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('Event').mockReturnValueOnce(Integer.fromNumber(5)) }
          ]
        } as any)
        // Target node counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('Event').mockReturnValueOnce(Integer.fromNumber(5)) }
          ]
        } as any)
        // Source relationship counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('PART_OF').mockReturnValueOnce(Integer.fromNumber(4)) }
          ]
        } as any)
        // Target relationship counts (missing relationships)
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('PART_OF').mockReturnValueOnce(Integer.fromNumber(2)) }
          ]
        } as any)
        // Orphaned relationships
        .mockResolvedValueOnce({
          records: []
        } as any);

      // Act
      const integrityReport = await graphCopyService.validateCopyIntegrity(copyResult);

      // Assert
      expect(integrityReport.isValid).toBe(false);
      expect(integrityReport.missingRelationships.length).toBeGreaterThan(0);
      expect(integrityReport.missingRelationships[0]).toContain('PART_OF: expected 4, found 2');
      expect(integrityReport.violations.length).toBeGreaterThan(0);
    });

    it('should detect orphaned relationships', async () => {
      // Arrange
      const copyResult: CopyResult = {
        sourceGraphId: 'test-source',
        targetGraphId: 'test-target',
        copiedNodes: 5,
        copiedRelationships: 3,
        duration: 1000,
        success: true
      };

      // Mock integrity validation queries showing orphaned relationships
      vi.mocked(mockSession.run)
        // Source node counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('Event').mockReturnValueOnce(Integer.fromNumber(5)) }
          ]
        } as any)
        // Target node counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('Event').mockReturnValueOnce(Integer.fromNumber(5)) }
          ]
        } as any)
        // Source relationship counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('PART_OF').mockReturnValueOnce(Integer.fromNumber(3)) }
          ]
        } as any)
        // Target relationship counts
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValueOnce('PART_OF').mockReturnValueOnce(Integer.fromNumber(3)) }
          ]
        } as any)
        // Orphaned relationships
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValue('CAUSES relationship with missing endpoint') }
          ]
        } as any);

      // Act
      const integrityReport = await graphCopyService.validateCopyIntegrity(copyResult);

      // Assert
      expect(integrityReport.isValid).toBe(false);
      expect(integrityReport.orphanedRelationships.length).toBeGreaterThan(0);
      expect(integrityReport.orphanedRelationships[0]).toContain('CAUSES relationship with missing endpoint');
      expect(integrityReport.violations.length).toBeGreaterThan(0);
    });

    it('should handle integrity validation errors gracefully', async () => {
      // Arrange
      const copyResult: CopyResult = {
        sourceGraphId: 'test-source',
        targetGraphId: 'test-target',
        copiedNodes: 5,
        copiedRelationships: 3,
        duration: 1000,
        success: true
      };

      // Mock database error during integrity validation
      vi.mocked(mockSession.run).mockRejectedValue(new Error('Database connection failed'));

      // Act
      const integrityReport = await graphCopyService.validateCopyIntegrity(copyResult);

      // Assert
      expect(integrityReport.isValid).toBe(false);
      expect(integrityReport.violations.length).toBeGreaterThan(0);
      expect(integrityReport.violations[0]).toContain('Integrity validation failed');
    });
  });

  describe('error handling', () => {
    it('should handle copy operation failures gracefully', async () => {
      // Arrange
      const sourceGraphId = 'non-existent-source';
      const targetGraphId = 'test-target';

      // Mock database error during total counts
      vi.mocked(mockSession.run).mockRejectedValue(new Error('Graph not found'));

      // Act
      const result = await graphCopyService.copyFullGraph(sourceGraphId, targetGraphId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.copiedNodes).toBe(0);
      expect(result.copiedRelationships).toBe(0);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors![0]).toContain('Copy operation failed');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle session close gracefully', async () => {
      // Arrange
      vi.mocked(mockSession.close).mockResolvedValue();

      // Act & Assert
      await expect(graphCopyService.close()).resolves.not.toThrow();
      expect(mockSession.close).toHaveBeenCalledOnce();
    });
  });

  describe('configuration options', () => {
    it('should use default batch size when not specified', async () => {
      // Arrange
      const sourceGraphId = 'test-source';
      const targetGraphId = 'test-target';

      // Mock successful copy with small dataset
      vi.mocked(mockSession.run)
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(5)) }]
        } as any) // totalNodes
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(3)) }]
        } as any) // totalRelationships
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(5)) }]
        } as any) // node batch
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(3)) }]
        } as any); // relationship batch

      // Act
      const result = await graphCopyService.copyFullGraph(sourceGraphId, targetGraphId, {
        validateIntegrity: false
      });

      // Assert
      expect(result.success).toBe(true);
      // Verify that batch operations were called (indicating default batch size was used)
      expect(mockSession.run).toHaveBeenCalledTimes(4);
    });

    it('should skip integrity validation when disabled', async () => {
      // Arrange
      const sourceGraphId = 'test-source';
      const targetGraphId = 'test-target';

      // Mock successful copy
      vi.mocked(mockSession.run)
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(5)) }]
        } as any) // totalNodes
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(3)) }]
        } as any) // totalRelationships
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(5)) }]
        } as any) // node batch
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(3)) }]
        } as any); // relationship batch

      // Act
      const result = await graphCopyService.copyFullGraph(sourceGraphId, targetGraphId, {
        validateIntegrity: false
      });

      // Assert
      expect(result.success).toBe(true);
      // Should only have 4 calls (2 for counts, 1 for nodes, 1 for relationships)
      // No additional calls for integrity validation
      expect(mockSession.run).toHaveBeenCalledTimes(4);
    });
  });

  describe('copyByTimeRange', () => {
    it('should copy nodes and relationships within time range', async () => {
      // Arrange
      const sourceGraphId = 'test-source';
      const targetGraphId = 'test-target';
      const timeRange = {
        start: new Date('2023-01-01T00:00:00Z'),
        end: new Date('2023-12-31T23:59:59Z')
      };

      // Mock time range filtering
      vi.mocked(mockSession.run)
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValue('event1') },
            { get: vi.fn().mockReturnValue('event2') },
            { get: vi.fn().mockReturnValue('arc1') }
          ]
        } as any) // getNodesInTimeRange
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(3)) }]
        } as any) // copyNodeBatchByIds
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValue('1') },
            { get: vi.fn().mockReturnValue('2') }
          ]
        } as any) // getRelationshipsBetweenNodes
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(2)) }]
        } as any); // copyRelationshipBatchByIds

      // Act
      const result = await graphCopyService.copyByTimeRange(sourceGraphId, timeRange, targetGraphId, {
        validateIntegrity: false
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.copiedNodes).toBe(3);
      expect(result.copiedRelationships).toBe(2);
      expect(result.sourceGraphId).toBe(sourceGraphId);
      expect(result.targetGraphId).toBe(targetGraphId);
    });

    it('should handle empty time range results', async () => {
      // Arrange
      const sourceGraphId = 'test-source';
      const targetGraphId = 'test-target';
      const timeRange = {
        start: new Date('2025-01-01T00:00:00Z'),
        end: new Date('2025-12-31T23:59:59Z')
      };

      // Mock empty results
      vi.mocked(mockSession.run)
        .mockResolvedValueOnce({
          records: []
        } as any) // getNodesInTimeRange (empty)
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(0)) }]
        } as any) // copyNodeBatchByIds (no nodes)
        .mockResolvedValueOnce({
          records: []
        } as any) // getRelationshipsBetweenNodes (empty)
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(0)) }]
        } as any); // copyRelationshipBatchByIds (no relationships)

      // Act
      const result = await graphCopyService.copyByTimeRange(sourceGraphId, timeRange, targetGraphId, {
        validateIntegrity: false
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.copiedNodes).toBe(0);
      expect(result.copiedRelationships).toBe(0);
    });

    it('should handle time range copy errors gracefully', async () => {
      // Arrange
      const sourceGraphId = 'test-source';
      const targetGraphId = 'test-target';
      const timeRange = {
        start: new Date('2023-01-01T00:00:00Z'),
        end: new Date('2023-12-31T23:59:59Z')
      };

      // Mock error during node filtering
      vi.mocked(mockSession.run).mockRejectedValue(new Error('Time range query failed'));

      // Act
      const result = await graphCopyService.copyByTimeRange(sourceGraphId, timeRange, targetGraphId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.copiedNodes).toBe(0);
      expect(result.copiedRelationships).toBe(0);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors![0]).toContain('Time range copy operation failed');
    });
  });

  describe('copyByEntityFilter', () => {
    it('should copy nodes matching actor filter', async () => {
      // Arrange
      const sourceGraphId = 'test-source';
      const targetGraphId = 'test-target';
      const filter = {
        actors: ['Napoleon', 'Wellington']
      };

      // Mock entity filtering
      vi.mocked(mockSession.run)
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValue('event1') },
            { get: vi.fn().mockReturnValue('event2') }
          ]
        } as any) // getNodesMatchingFilter
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(2)) }]
        } as any) // copyNodeBatchByIds
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValue('1') }
          ]
        } as any) // getRelationshipsBetweenNodes
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(1)) }]
        } as any); // copyRelationshipBatchByIds

      // Act
      const result = await graphCopyService.copyByEntityFilter(sourceGraphId, filter, targetGraphId, {
        validateIntegrity: false
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.copiedNodes).toBe(2);
      expect(result.copiedRelationships).toBe(1);
    });

    it('should copy nodes matching multiple filter criteria', async () => {
      // Arrange
      const sourceGraphId = 'test-source';
      const targetGraphId = 'test-target';
      const filter = {
        actors: ['Napoleon'],
        targets: ['French Empire'],
        arcLevels: [0, 1]
      };

      // Mock entity filtering with multiple criteria
      vi.mocked(mockSession.run)
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValue('event1') },
            { get: vi.fn().mockReturnValue('arc1') }
          ]
        } as any) // getNodesMatchingFilter
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(2)) }]
        } as any) // copyNodeBatchByIds
        .mockResolvedValueOnce({
          records: [
            { get: vi.fn().mockReturnValue('1') }
          ]
        } as any) // getRelationshipsBetweenNodes
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(1)) }]
        } as any); // copyRelationshipBatchByIds

      // Act
      const result = await graphCopyService.copyByEntityFilter(sourceGraphId, filter, targetGraphId, {
        validateIntegrity: false
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.copiedNodes).toBe(2);
      expect(result.copiedRelationships).toBe(1);
    });

    it('should handle empty filter results', async () => {
      // Arrange
      const sourceGraphId = 'test-source';
      const targetGraphId = 'test-target';
      const filter = {
        actors: ['NonExistentActor']
      };

      // Mock empty filter results
      vi.mocked(mockSession.run)
        .mockResolvedValueOnce({
          records: []
        } as any) // getNodesMatchingFilter (empty)
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(0)) }]
        } as any) // copyNodeBatchByIds (no nodes)
        .mockResolvedValueOnce({
          records: []
        } as any) // getRelationshipsBetweenNodes (empty)
        .mockResolvedValueOnce({
          records: [{ get: vi.fn().mockReturnValue(Integer.fromNumber(0)) }]
        } as any); // copyRelationshipBatchByIds (no relationships)

      // Act
      const result = await graphCopyService.copyByEntityFilter(sourceGraphId, filter, targetGraphId, {
        validateIntegrity: false
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.copiedNodes).toBe(0);
      expect(result.copiedRelationships).toBe(0);
    });

    it('should handle entity filter copy errors gracefully', async () => {
      // Arrange
      const sourceGraphId = 'test-source';
      const targetGraphId = 'test-target';
      const filter = {
        actors: ['Napoleon']
      };

      // Mock error during entity filtering
      vi.mocked(mockSession.run).mockRejectedValue(new Error('Entity filter query failed'));

      // Act
      const result = await graphCopyService.copyByEntityFilter(sourceGraphId, filter, targetGraphId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.copiedNodes).toBe(0);
      expect(result.copiedRelationships).toBe(0);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors![0]).toContain('Entity filter copy operation failed');
    });
  });
});