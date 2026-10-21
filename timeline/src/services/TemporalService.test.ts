import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemporalService } from './TemporalService';
import { Event, Arc, TimeRange } from '@/models';
import { TemporalConstraintError, PerformanceError } from '@/utils/errors';
import { EventRepository } from '@/repositories/EventRepository';
import { ArcRepository } from '@/repositories/ArcRepository';

describe('TemporalService', () => {
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

  describe('validateEventInArc', () => {
    it('should return true when event timestamp is within arc boundaries', () => {
      // Arrange
      const event = new Event({
        description: 'Test event',
        actor: 'Test actor',
        target: 'Test target',
        timestamp: new Date('2023-06-15T12:00:00Z')
      });

      const arc = new Arc({
        name: 'Test arc',
        start_time: new Date('2023-06-01T00:00:00Z'),
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 0
      });

      // Act & Assert
      expect(() => temporalService.validateEventInArc(event, arc)).not.toThrow();
      expect(temporalService.validateEventInArc(event, arc)).toBe(true);
    });

    it('should return true when event timestamp equals arc start time', () => {
      // Arrange
      const timestamp = new Date('2023-06-01T00:00:00Z');
      const event = new Event({
        description: 'Test event',
        actor: 'Test actor',
        target: 'Test target',
        timestamp
      });

      const arc = new Arc({
        name: 'Test arc',
        start_time: timestamp,
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 0
      });

      // Act & Assert
      expect(() => temporalService.validateEventInArc(event, arc)).not.toThrow();
      expect(temporalService.validateEventInArc(event, arc)).toBe(true);
    });

    it('should return true when event timestamp equals arc end time', () => {
      // Arrange
      const timestamp = new Date('2023-06-30T23:59:59Z');
      const event = new Event({
        description: 'Test event',
        actor: 'Test actor',
        target: 'Test target',
        timestamp
      });

      const arc = new Arc({
        name: 'Test arc',
        start_time: new Date('2023-06-01T00:00:00Z'),
        end_time: timestamp,
        level: 0
      });

      // Act & Assert
      expect(() => temporalService.validateEventInArc(event, arc)).not.toThrow();
      expect(temporalService.validateEventInArc(event, arc)).toBe(true);
    });

    it('should throw TemporalConstraintError when event timestamp is before arc start time', () => {
      // Arrange
      const event = new Event({
        description: 'Test event',
        actor: 'Test actor',
        target: 'Test target',
        timestamp: new Date('2023-05-31T23:59:59Z')
      });

      const arc = new Arc({
        name: 'Test arc',
        start_time: new Date('2023-06-01T00:00:00Z'),
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 0
      });

      // Act & Assert
      expect(() => temporalService.validateEventInArc(event, arc))
        .toThrow(TemporalConstraintError);
      
      try {
        temporalService.validateEventInArc(event, arc);
      } catch (error) {
        expect(error).toBeInstanceOf(TemporalConstraintError);
        const temporalError = error as TemporalConstraintError;
        expect(temporalError.eventId).toBe(event.id);
        expect(temporalError.arcId).toBe(arc.id);
        expect(temporalError.eventTime).toEqual(event.timestamp);
        expect(temporalError.arcBounds).toEqual({
          start: arc.start_time,
          end: arc.end_time
        });
      }
    });

    it('should throw TemporalConstraintError when event timestamp is after arc end time', () => {
      // Arrange
      const event = new Event({
        description: 'Test event',
        actor: 'Test actor',
        target: 'Test target',
        timestamp: new Date('2023-07-01T00:00:01Z')
      });

      const arc = new Arc({
        name: 'Test arc',
        start_time: new Date('2023-06-01T00:00:00Z'),
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 0
      });

      // Act & Assert
      expect(() => temporalService.validateEventInArc(event, arc))
        .toThrow(TemporalConstraintError);
      
      try {
        temporalService.validateEventInArc(event, arc);
      } catch (error) {
        expect(error).toBeInstanceOf(TemporalConstraintError);
        const temporalError = error as TemporalConstraintError;
        expect(temporalError.message).toContain('falls outside arc');
        expect(temporalError.eventId).toBe(event.id);
        expect(temporalError.arcId).toBe(arc.id);
      }
    });
  });

  describe('validateArcNesting', () => {
    it('should return true when child arc is completely contained within parent arc', () => {
      // Arrange
      const parentArc = new Arc({
        name: 'Parent arc',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 0
      });

      const childArc = new Arc({
        name: 'Child arc',
        start_time: new Date('2023-06-01T00:00:00Z'),
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 1
      });

      // Act & Assert
      expect(() => temporalService.validateArcNesting(parentArc, childArc)).not.toThrow();
      expect(temporalService.validateArcNesting(parentArc, childArc)).toBe(true);
    });

    it('should return true when child arc boundaries exactly match parent arc boundaries', () => {
      // Arrange
      const startTime = new Date('2023-06-01T00:00:00Z');
      const endTime = new Date('2023-06-30T23:59:59Z');
      
      const parentArc = new Arc({
        name: 'Parent arc',
        start_time: startTime,
        end_time: endTime,
        level: 0
      });

      const childArc = new Arc({
        name: 'Child arc',
        start_time: startTime,
        end_time: endTime,
        level: 1
      });

      // Act & Assert
      expect(() => temporalService.validateArcNesting(parentArc, childArc)).not.toThrow();
      expect(temporalService.validateArcNesting(parentArc, childArc)).toBe(true);
    });

    it('should throw TemporalConstraintError when child arc starts before parent arc', () => {
      // Arrange
      const parentArc = new Arc({
        name: 'Parent arc',
        start_time: new Date('2023-06-01T00:00:00Z'),
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 0
      });

      const childArc = new Arc({
        name: 'Child arc',
        start_time: new Date('2023-05-31T23:59:59Z'),
        end_time: new Date('2023-06-15T12:00:00Z'),
        level: 1
      });

      // Act & Assert
      expect(() => temporalService.validateArcNesting(parentArc, childArc))
        .toThrow(TemporalConstraintError);
      
      try {
        temporalService.validateArcNesting(parentArc, childArc);
      } catch (error) {
        expect(error).toBeInstanceOf(TemporalConstraintError);
        const temporalError = error as TemporalConstraintError;
        expect(temporalError.message).toContain('extends beyond parent arc');
        expect(temporalError.arcId).toBe(childArc.id);
      }
    });

    it('should throw TemporalConstraintError when child arc ends after parent arc', () => {
      // Arrange
      const parentArc = new Arc({
        name: 'Parent arc',
        start_time: new Date('2023-06-01T00:00:00Z'),
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 0
      });

      const childArc = new Arc({
        name: 'Child arc',
        start_time: new Date('2023-06-15T12:00:00Z'),
        end_time: new Date('2023-07-01T00:00:01Z'),
        level: 1
      });

      // Act & Assert
      expect(() => temporalService.validateArcNesting(parentArc, childArc))
        .toThrow(TemporalConstraintError);
      
      try {
        temporalService.validateArcNesting(parentArc, childArc);
      } catch (error) {
        expect(error).toBeInstanceOf(TemporalConstraintError);
        const temporalError = error as TemporalConstraintError;
        expect(temporalError.message).toContain('extends beyond parent arc');
        expect(temporalError.arcBounds).toEqual({
          start: parentArc.start_time,
          end: parentArc.end_time
        });
      }
    });

    it('should throw TemporalConstraintError when child arc extends beyond both boundaries', () => {
      // Arrange
      const parentArc = new Arc({
        name: 'Parent arc',
        start_time: new Date('2023-06-01T00:00:00Z'),
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 0
      });

      const childArc = new Arc({
        name: 'Child arc',
        start_time: new Date('2023-05-31T23:59:59Z'),
        end_time: new Date('2023-07-01T00:00:01Z'),
        level: 1
      });

      // Act & Assert
      expect(() => temporalService.validateArcNesting(parentArc, childArc))
        .toThrow(TemporalConstraintError);
    });
  });

  describe('preventTemporalParadox', () => {
    it('should return true when cause event occurs before effect event', () => {
      // Arrange
      const causeEvent = new Event({
        description: 'Cause event',
        actor: 'Actor A',
        target: 'Target A',
        timestamp: new Date('2023-06-01T10:00:00Z')
      });

      const effectEvent = new Event({
        description: 'Effect event',
        actor: 'Actor B',
        target: 'Target B',
        timestamp: new Date('2023-06-01T11:00:00Z')
      });

      // Act & Assert
      expect(() => temporalService.preventTemporalParadox(causeEvent, effectEvent)).not.toThrow();
      expect(temporalService.preventTemporalParadox(causeEvent, effectEvent)).toBe(true);
    });

    it('should allow a cause and an effect at the same moment', () => {
      // Arrange
      const timestamp = new Date('2023-06-01T10:00:00Z');
      const causeEvent = new Event({
        description: 'Cause event',
        actor: 'Actor A',
        target: 'Target A',
        timestamp
      });

      const effectEvent = new Event({
        description: 'Effect event',
        actor: 'Actor B',
        target: 'Target B',
        timestamp
      });

      // Act & Assert
      // The rule the whole project uses: a cause may not follow its effect,
      // but it may happen at the same moment.
      expect(() => temporalService.preventTemporalParadox(causeEvent, effectEvent))
        .not.toThrow();
    });

    it('should throw TemporalConstraintError when cause event occurs after effect event', () => {
      // Arrange
      const causeEvent = new Event({
        description: 'Cause event',
        actor: 'Actor A',
        target: 'Target A',
        timestamp: new Date('2023-06-01T11:00:00Z')
      });

      const effectEvent = new Event({
        description: 'Effect event',
        actor: 'Actor B',
        target: 'Target B',
        timestamp: new Date('2023-06-01T10:00:00Z')
      });

      // Act & Assert
      expect(() => temporalService.preventTemporalParadox(causeEvent, effectEvent))
        .toThrow(TemporalConstraintError);
      
      try {
        temporalService.preventTemporalParadox(causeEvent, effectEvent);
      } catch (error) {
        expect(error).toBeInstanceOf(TemporalConstraintError);
        const temporalError = error as TemporalConstraintError;
        expect(temporalError.message).toContain('occurs after effect event');
        expect(temporalError.eventId).toBe(causeEvent.id);
        expect(temporalError.arcId).toBe(effectEvent.id);
        expect(temporalError.eventTime).toEqual(causeEvent.timestamp);
        expect(temporalError.arcBounds).toEqual({
          start: effectEvent.timestamp,
          end: effectEvent.timestamp
        });
      }
    });

    it('should handle edge case with millisecond precision', () => {
      // Arrange
      const causeEvent = new Event({
        description: 'Cause event',
        actor: 'Actor A',
        target: 'Target A',
        timestamp: new Date('2023-06-01T10:00:00.001Z')
      });

      const effectEvent = new Event({
        description: 'Effect event',
        actor: 'Actor B',
        target: 'Target B',
        timestamp: new Date('2023-06-01T10:00:00.002Z')
      });

      // Act & Assert
      expect(() => temporalService.preventTemporalParadox(causeEvent, effectEvent)).not.toThrow();
      expect(temporalService.preventTemporalParadox(causeEvent, effectEvent)).toBe(true);
    });
  });

  describe('findOverlappingArcs', () => {
    it('should return overlapping arcs from repository', async () => {
      // Arrange
      const timeRange: TimeRange = {
        start: new Date('2023-06-01T00:00:00Z'),
        end: new Date('2023-06-30T23:59:59Z')
      };

      const mockArcs = [
        new Arc({
          name: 'Arc 1',
          start_time: new Date('2023-05-15T00:00:00Z'),
          end_time: new Date('2023-06-15T23:59:59Z'),
          level: 0
        }),
        new Arc({
          name: 'Arc 2',
          start_time: new Date('2023-06-10T00:00:00Z'),
          end_time: new Date('2023-07-10T23:59:59Z'),
          level: 1
        })
      ];

      vi.mocked(mockArcRepository.findOverlappingArcs).mockResolvedValue(mockArcs);

      // Act
      const result = await temporalService.findOverlappingArcs(timeRange);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Arc 1');
      expect(result[1].name).toBe('Arc 2');
      expect(mockArcRepository.findOverlappingArcs).toHaveBeenCalledWith(timeRange, undefined, undefined);
    });

    it('should handle pagination parameters', async () => {
      // Arrange
      const timeRange: TimeRange = {
        start: new Date('2023-06-01T00:00:00Z'),
        end: new Date('2023-06-30T23:59:59Z')
      };

      vi.mocked(mockArcRepository.findOverlappingArcs).mockResolvedValue([]);

      // Act
      await temporalService.findOverlappingArcs(timeRange, 10, 20);

      // Assert
      expect(mockArcRepository.findOverlappingArcs).toHaveBeenCalledWith(timeRange, 10, 20);
    });

    it('should throw PerformanceError when query exceeds timeout', async () => {
      // Arrange
      const timeRange: TimeRange = {
        start: new Date('2023-06-01T00:00:00Z'),
        end: new Date('2023-06-30T23:59:59Z')
      };

      // Clear cache first to ensure we hit the database
      await temporalService.clearTemporalCache();

      // Mock a slow query that takes longer than the timeout
      vi.mocked(mockArcRepository.findOverlappingArcs).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve([]), 3000))
      );

      // Act & Assert
      await expect(temporalService.findOverlappingArcs(timeRange))
        .rejects.toThrow(PerformanceError);
    });
  });

  describe('findEventsInRange', () => {
    it('should return events from repository within time range', async () => {
      // Arrange
      const timeRange: TimeRange = {
        start: new Date('2023-06-01T00:00:00Z'),
        end: new Date('2023-06-30T23:59:59Z')
      };

      const mockEvents = [
        new Event({
          description: 'Event 1',
          actor: 'Actor A',
          target: 'Target A',
          timestamp: new Date('2023-06-05T10:00:00Z')
        }),
        new Event({
          description: 'Event 2',
          actor: 'Actor B',
          target: 'Target B',
          timestamp: new Date('2023-06-15T14:30:00Z')
        })
      ];

      vi.mocked(mockEventRepository.findByTimeRange).mockResolvedValue(mockEvents);

      // Act
      const result = await temporalService.findEventsInRange(timeRange);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].description).toBe('Event 1');
      expect(result[1].description).toBe('Event 2');
      expect(mockEventRepository.findByTimeRange).toHaveBeenCalledWith(timeRange, 1000, 0);
    });

    it('should apply custom pagination parameters', async () => {
      // Arrange
      const timeRange: TimeRange = {
        start: new Date('2023-06-01T00:00:00Z'),
        end: new Date('2023-06-30T23:59:59Z')
      };

      vi.mocked(mockEventRepository.findByTimeRange).mockResolvedValue([]);

      // Act
      await temporalService.findEventsInRange(timeRange, 50, 100);

      // Assert
      expect(mockEventRepository.findByTimeRange).toHaveBeenCalledWith(timeRange, 50, 100);
    });

    it('should throw PerformanceError when query exceeds timeout', async () => {
      // Arrange - use a unique time range to avoid cache interference
      const timeRange: TimeRange = {
        start: new Date('2024-06-01T00:00:00Z'),
        end: new Date('2024-06-30T23:59:59Z')
      };

      // Clear cache first to ensure we hit the database
      await temporalService.clearTemporalCache();

      // Mock Date.now() to simulate slow query (more reliable than real setTimeout)
      let callCount = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => {
        callCount++;
        // First call is at start, subsequent calls simulate 3000ms elapsed
        return callCount === 1 ? 1000 : 4000;
      });

      // Mock repository to return immediately (timing handled by Date.now mock)
      vi.mocked(mockEventRepository.findByTimeRange).mockResolvedValue([]);

      try {
        // Act & Assert
        await expect(temporalService.findEventsInRange(timeRange))
          .rejects.toThrow(PerformanceError);
      } finally {
        // Restore Date.now
        vi.spyOn(Date, 'now').mockRestore();
      }
    });

    it('should handle empty results', async () => {
      // Arrange
      const timeRange: TimeRange = {
        start: new Date('2023-07-01T00:00:00Z'), // Different time range to avoid cache
        end: new Date('2023-07-31T23:59:59Z')
      };

      // Clear cache first
      await temporalService.clearTemporalCache();

      vi.mocked(mockEventRepository.findByTimeRange).mockResolvedValue([]);

      // Act
      const result = await temporalService.findEventsInRange(timeRange);

      // Assert
      expect(result).toHaveLength(0);
    });
  });

  describe('findEventsByActorAndRange', () => {
    it('should return events for specific actor within time range', async () => {
      // Arrange
      const actor = 'Napoleon Bonaparte';
      const timeRange: TimeRange = {
        start: new Date('1804-01-01T00:00:00Z'),
        end: new Date('1815-12-31T23:59:59Z')
      };

      const mockEvents = [
        new Event({
          description: 'Coronation as Emperor',
          actor,
          target: 'French Empire',
          timestamp: new Date('1804-12-02T10:00:00Z')
        }),
        new Event({
          description: 'Battle of Austerlitz',
          actor,
          target: 'Coalition Forces',
          timestamp: new Date('1805-12-02T14:00:00Z')
        })
      ];

      vi.mocked(mockEventRepository.findByActorAndTimeRange).mockResolvedValue(mockEvents);

      // Act
      const result = await temporalService.findEventsByActorAndRange(actor, timeRange);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].actor).toBe(actor);
      expect(result[1].actor).toBe(actor);
      expect(mockEventRepository.findByActorAndTimeRange).toHaveBeenCalledWith(actor, timeRange, 1000, 0);
    });

    it('should handle pagination for actor-specific queries', async () => {
      // Arrange
      const actor = 'Julius Caesar';
      const timeRange: TimeRange = {
        start: new Date('1800-01-01T00:00:00Z'), // Use modern dates to avoid BC date issues
        end: new Date('1850-12-31T23:59:59Z')
      };

      vi.mocked(mockEventRepository.findByActorAndTimeRange).mockResolvedValue([]);

      // Act
      await temporalService.findEventsByActorAndRange(actor, timeRange, 25, 50);

      // Assert
      expect(mockEventRepository.findByActorAndTimeRange).toHaveBeenCalledWith(actor, timeRange, 25, 50);
    });
  });

  describe('performance and caching', () => {
    it('should return performance threshold from configuration', () => {
      // Act
      const threshold = temporalService.getPerformanceThreshold();

      // Assert
      expect(typeof threshold).toBe('number');
      expect(threshold).toBeGreaterThan(0);
    });

    it('should clear temporal cache without throwing errors', async () => {
      // Act & Assert
      await expect(temporalService.clearTemporalCache()).resolves.not.toThrow();
    });
  });

  describe('edge cases and error scenarios', () => {
    it('should handle events with identical timestamps in different validation contexts', () => {
      // Arrange
      const timestamp = new Date('2023-06-15T12:00:00Z');
      const event1 = new Event({
        description: 'Event 1',
        actor: 'Actor A',
        target: 'Target A',
        timestamp
      });

      const event2 = new Event({
        description: 'Event 2',
        actor: 'Actor B',
        target: 'Target B',
        timestamp
      });

      const arc = new Arc({
        name: 'Test arc',
        start_time: new Date('2023-06-01T00:00:00Z'),
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 0
      });

      // Act & Assert
      // Event in arc should work
      expect(temporalService.validateEventInArc(event1, arc)).toBe(true);
      
      // A causal relationship at the same moment is allowed: the cause and
      // the effect can be part of the same occurrence.
      expect(() => temporalService.preventTemporalParadox(event1, event2))
        .not.toThrow();
    });

    it('should handle complex nested arc validation scenarios', () => {
      // Arrange
      const grandparentArc = new Arc({
        name: 'Grandparent arc',
        start_time: new Date('2023-01-01T00:00:00Z'),
        end_time: new Date('2023-12-31T23:59:59Z'),
        level: 0
      });

      const parentArc = new Arc({
        name: 'Parent arc',
        start_time: new Date('2023-06-01T00:00:00Z'),
        end_time: new Date('2023-08-31T23:59:59Z'),
        level: 1
      });

      const childArc = new Arc({
        name: 'Child arc',
        start_time: new Date('2023-06-15T00:00:00Z'),
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 2
      });

      // Act & Assert
      expect(temporalService.validateArcNesting(grandparentArc, parentArc)).toBe(true);
      expect(temporalService.validateArcNesting(parentArc, childArc)).toBe(true);
      expect(temporalService.validateArcNesting(grandparentArc, childArc)).toBe(true);
    });

    it('should handle database errors gracefully in temporal queries', async () => {
      // Arrange
      const timeRange: TimeRange = {
        start: new Date('2023-06-01T00:00:00Z'),
        end: new Date('2023-06-30T23:59:59Z')
      };

      vi.mocked(mockEventRepository.findByTimeRange).mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(temporalService.findEventsInRange(timeRange))
        .rejects.toThrow('Failed to find events in range');
    });
  });
});