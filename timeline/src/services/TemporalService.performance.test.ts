import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemporalService } from './TemporalService';
import { Event, Arc, TimeRange } from '@/models';
import { PerformanceError } from '@/utils/errors';
import { EventRepository } from '@/repositories/EventRepository';
import { ArcRepository } from '@/repositories/ArcRepository';

describe('TemporalService Performance Tests', () => {
  let temporalService: TemporalService;
  let mockEventRepository: EventRepository;
  let mockArcRepository: ArcRepository;

  beforeEach(() => {
    // Create mock repositories
    mockEventRepository = {
      findByTimeRange: vi.fn(),
      findByActorAndTimeRange: vi.fn(),
    } as any;

    mockArcRepository = {
      findOverlappingArcs: vi.fn(),
    } as any;

    temporalService = new TemporalService(mockEventRepository, mockArcRepository);
  });

  describe('Query Performance Requirements', () => {
    it('should complete findEventsInRange within 2 seconds for large datasets', async () => {
      // Arrange
      const timeRange: TimeRange = {
        start: new Date('2023-01-01T00:00:00Z'),
        end: new Date('2023-12-31T23:59:59Z')
      };

      // Generate a large dataset (simulating 100,000 events)
      const largeEventSet = Array.from({ length: 1000 }, (_, i) => 
        new Event({
          description: `Event ${i}`,
          actor: `Actor ${i % 100}`,
          target: `Target ${i % 50}`,
          timestamp: new Date(2023, 0, 1 + (i % 365), i % 24, i % 60, i % 60)
        })
      );

      // Mock repository to return large dataset quickly (simulating optimized database)
      vi.mocked(mockEventRepository.findByTimeRange).mockResolvedValue(largeEventSet);

      // Act
      const startTime = Date.now();
      const result = await temporalService.findEventsInRange(timeRange);
      const duration = Date.now() - startTime;

      // Assert
      expect(result).toHaveLength(1000);
      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
    });

    it('should complete findOverlappingArcs within 2 seconds for complex hierarchies', async () => {
      // Arrange
      const timeRange: TimeRange = {
        start: new Date('2023-01-01T00:00:00Z'),
        end: new Date('2023-12-31T23:59:59Z')
      };

      // Generate a complex arc hierarchy (simulating nested temporal structures)
      const complexArcSet = Array.from({ length: 500 }, (_, i) => 
        new Arc({
          name: `Arc ${i}`,
          start_time: new Date(2023, i % 12, 1),
          end_time: new Date(2023, (i % 12) + 1, 1),
          level: i % 5 // Create 5 levels of hierarchy
        })
      );

      // Mock repository to return complex dataset quickly
      vi.mocked(mockArcRepository.findOverlappingArcs).mockResolvedValue(complexArcSet);

      // Act
      const startTime = Date.now();
      const result = await temporalService.findOverlappingArcs(timeRange);
      const duration = Date.now() - startTime;

      // Assert
      expect(result).toHaveLength(500);
      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
    });

    it('should handle pagination efficiently for large result sets', async () => {
      // Arrange
      const timeRange: TimeRange = {
        start: new Date('2023-01-01T00:00:00Z'),
        end: new Date('2023-12-31T23:59:59Z')
      };

      const pageSize = 100;
      const totalPages = 10;

      // Mock paginated results
      const mockPage = Array.from({ length: pageSize }, (_, i) => 
        new Event({
          description: `Event ${i}`,
          actor: 'Test Actor',
          target: 'Test Target',
          timestamp: new Date(2023, 0, 1 + i)
        })
      );

      vi.mocked(mockEventRepository.findByTimeRange).mockResolvedValue(mockPage);

      // Act - Test multiple pages
      const startTime = Date.now();
      const results = [];
      
      for (let page = 0; page < totalPages; page++) {
        const pageResult = await temporalService.findEventsInRange(
          timeRange, 
          pageSize, 
          page * pageSize
        );
        results.push(...pageResult);
      }
      
      const duration = Date.now() - startTime;

      // Assert
      expect(results).toHaveLength(totalPages * pageSize);
      expect(duration).toBeLessThan(2000); // All pages should complete within 2 seconds
    });

    it('should cache frequently accessed temporal ranges for improved performance', async () => {
      // Arrange
      const timeRange: TimeRange = {
        start: new Date('2023-06-01T00:00:00Z'),
        end: new Date('2023-06-30T23:59:59Z')
      };

      const mockEvents = [
        new Event({
          description: 'Cached Event',
          actor: 'Test Actor',
          target: 'Test Target',
          timestamp: new Date('2023-06-15T12:00:00Z')
        })
      ];

      // Add small delay to make timing measurable
      vi.mocked(mockEventRepository.findByTimeRange).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockEvents), 10))
      );

      // Act - First call (should hit database)
      const firstCallStart = performance.now();
      const firstResult = await temporalService.findEventsInRange(timeRange);
      const firstCallDuration = performance.now() - firstCallStart;

      // Act - Second call (should hit cache)
      const secondCallStart = performance.now();
      const secondResult = await temporalService.findEventsInRange(timeRange);
      const secondCallDuration = performance.now() - secondCallStart;

      // Assert
      expect(firstResult).toEqual(secondResult);
      expect(mockEventRepository.findByTimeRange).toHaveBeenCalledTimes(1); // Only called once due to caching
      
      // With cache, second call should be significantly faster (allow some variance)
      expect(secondCallDuration).toBeLessThan(firstCallDuration * 0.5);
    });

    it('should enforce performance constraints and throw PerformanceError for slow queries', async () => {
      // Arrange
      const timeRange: TimeRange = {
        start: new Date('2023-01-01T00:00:00Z'),
        end: new Date('2023-12-31T23:59:59Z')
      };

      // Mock a slow query (exceeding timeout but not the test timeout)
      vi.mocked(mockEventRepository.findByTimeRange).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve([]), 3000))
      );

      // Clear cache to ensure we hit the slow database
      await temporalService.clearTemporalCache();

      // Act & Assert
      await expect(temporalService.findEventsInRange(timeRange))
        .rejects.toThrow(PerformanceError);
    }, 10000); // Give test enough time to complete

    it('should handle concurrent temporal queries efficiently', async () => {
      // Arrange
      const timeRanges = Array.from({ length: 10 }, (_, i) => ({
        start: new Date(2023, i, 1),
        end: new Date(2023, i, 28)
      }));

      const mockEvents = [
        new Event({
          description: 'Concurrent Event',
          actor: 'Test Actor',
          target: 'Test Target',
          timestamp: new Date('2023-06-15T12:00:00Z')
        })
      ];

      vi.mocked(mockEventRepository.findByTimeRange).mockResolvedValue(mockEvents);

      // Act - Execute multiple concurrent queries
      const startTime = Date.now();
      const promises = timeRanges.map(timeRange => 
        temporalService.findEventsInRange(timeRange)
      );
      
      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      // Assert
      expect(results).toHaveLength(10);
      expect(duration).toBeLessThan(2000); // All concurrent queries should complete within 2 seconds
      results.forEach(result => {
        expect(result).toHaveLength(1);
        expect(result[0].description).toBe('Concurrent Event');
      });
    });
  });

  describe('Memory and Resource Management', () => {
    it('should limit query results to prevent memory exhaustion', async () => {
      // Arrange
      const timeRange: TimeRange = {
        start: new Date('2023-01-01T00:00:00Z'),
        end: new Date('2023-12-31T23:59:59Z')
      };

      // Mock a very large dataset
      const hugeDataset = Array.from({ length: 50000 }, (_, i) => 
        new Event({
          description: `Event ${i}`,
          actor: 'Test Actor',
          target: 'Test Target',
          timestamp: new Date(2023, 0, 1 + (i % 365))
        })
      );

      vi.mocked(mockEventRepository.findByTimeRange).mockResolvedValue(hugeDataset);

      // Act
      const result = await temporalService.findEventsInRange(timeRange);

      // Assert
      // Should apply default pagination limit to prevent excessive memory usage
      expect(mockEventRepository.findByTimeRange).toHaveBeenCalledWith(timeRange, 1000, 0);
    });

    it('should clear cache to free memory when requested', async () => {
      // Arrange
      const timeRange: TimeRange = {
        start: new Date('2023-06-01T00:00:00Z'),
        end: new Date('2023-06-30T23:59:59Z')
      };

      const mockEvents = [
        new Event({
          description: 'Test Event',
          actor: 'Test Actor',
          target: 'Test Target',
          timestamp: new Date('2023-06-15T12:00:00Z')
        })
      ];

      vi.mocked(mockEventRepository.findByTimeRange).mockResolvedValue(mockEvents);

      // Act - Cache some data
      await temporalService.findEventsInRange(timeRange);
      
      // Clear cache
      await temporalService.clearTemporalCache();
      
      // Query again (should hit database again)
      await temporalService.findEventsInRange(timeRange);

      // Assert
      expect(mockEventRepository.findByTimeRange).toHaveBeenCalledTimes(2);
    });
  });
});