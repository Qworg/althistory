import { describe, it, expect } from 'vitest';
import { Event, IEvent, CreateEventRequest, TimeRange, EventValidationResult } from './Event';

describe('Event Model', () => {
  const validEventData: CreateEventRequest = {
    description: 'Battle of Austerlitz',
    actor: 'Napoleon Bonaparte',
    target: 'Coalition Forces',
    timestamp: new Date('1805-12-02')
  };

  describe('Event Class Creation', () => {
    it('should create an event with valid data', () => {
      const event = new Event(validEventData);

      expect(event.description).toBe('Battle of Austerlitz');
      expect(event.actor).toBe('Napoleon Bonaparte');
      expect(event.target).toBe('Coalition Forces');
      expect(event.timestamp).toEqual(new Date('1805-12-02'));
      expect(event.id).toBeDefined();
      expect(typeof event.id).toBe('string');
    });

    it('should create an event with provided ID', () => {
      const eventWithId = new Event({ ...validEventData, id: 'custom-id' });
      expect(eventWithId.id).toBe('custom-id');
    });

    it('should create an event with metadata', () => {
      const eventWithMetadata = new Event({
        ...validEventData,
        metadata: { location: 'Austerlitz', casualties: 15000 }
      });
      
      expect(eventWithMetadata.metadata).toEqual({ location: 'Austerlitz', casualties: 15000 });
    });

    it('should trim whitespace from string fields', () => {
      const eventWithWhitespace = new Event({
        description: '  Battle of Austerlitz  ',
        actor: '  Napoleon Bonaparte  ',
        target: '  Coalition Forces  ',
        timestamp: new Date('1805-12-02')
      });

      expect(eventWithWhitespace.description).toBe('Battle of Austerlitz');
      expect(eventWithWhitespace.actor).toBe('Napoleon Bonaparte');
      expect(eventWithWhitespace.target).toBe('Coalition Forces');
    });
  });

  describe('Event Validation', () => {
    it('should validate correct event data', () => {
      const result = Event.validate(validEventData);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing description', () => {
      const result = Event.validate({ ...validEventData, description: '' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Description is required and must be a non-empty string');
    });

    it('should reject missing actor', () => {
      const result = Event.validate({ ...validEventData, actor: '' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Actor is required and must be a non-empty string');
    });

    it('should reject missing target', () => {
      const result = Event.validate({ ...validEventData, target: '' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Target is required and must be a non-empty string');
    });

    it('should reject missing timestamp', () => {
      const { timestamp, ...dataWithoutTimestamp } = validEventData;
      const result = Event.validate(dataWithoutTimestamp);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Timestamp is required');
    });

    it('should reject invalid timestamp', () => {
      const result = Event.validate({ ...validEventData, timestamp: new Date('invalid-date') });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Timestamp must be a valid date');
    });

    it('should reject invalid metadata type', () => {
      const result = Event.validate({ ...validEventData, metadata: 'invalid' as any });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Metadata must be an object');
    });

    it('should reject array as metadata', () => {
      const result = Event.validate({ ...validEventData, metadata: [] as any });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Metadata must be an object');
    });

    it('should reject null as metadata', () => {
      const result = Event.validate({ ...validEventData, metadata: null as any });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Metadata must be an object');
    });

    it('should collect multiple validation errors', () => {
      const result = Event.validate({
        description: '',
        actor: '',
        target: '',
        timestamp: new Date('invalid')
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(4);
    });
  });

  describe('Event Creation Validation', () => {
    it('should throw error when creating event with invalid data', () => {
      expect(() => {
        new Event({ ...validEventData, description: '' });
      }).toThrow('Event validation failed: Description is required and must be a non-empty string');
    });

    it('should throw error with multiple validation messages', () => {
      expect(() => {
        new Event({
          description: '',
          actor: '',
          target: 'Coalition Forces',
          timestamp: new Date('1805-12-02')
        });
      }).toThrow('Event validation failed: Description is required and must be a non-empty string, Actor is required and must be a non-empty string');
    });
  });

  describe('Time Range Validation', () => {
    it('should validate event is within time range', () => {
      const event = new Event(validEventData);
      const timeRange: TimeRange = {
        start: new Date('1800-01-01'),
        end: new Date('1810-12-31')
      };

      expect(event.isWithinTimeRange(timeRange)).toBe(true);
    });

    it('should validate event is outside time range (before)', () => {
      const event = new Event(validEventData);
      const timeRange: TimeRange = {
        start: new Date('1806-01-01'),
        end: new Date('1810-12-31')
      };

      expect(event.isWithinTimeRange(timeRange)).toBe(false);
    });

    it('should validate event is outside time range (after)', () => {
      const event = new Event(validEventData);
      const timeRange: TimeRange = {
        start: new Date('1800-01-01'),
        end: new Date('1804-12-31')
      };

      expect(event.isWithinTimeRange(timeRange)).toBe(false);
    });

    it('should validate event at exact time range boundaries', () => {
      const event = new Event(validEventData);
      const timeRange: TimeRange = {
        start: new Date('1805-12-02'),
        end: new Date('1805-12-02')
      };

      expect(event.isWithinTimeRange(timeRange)).toBe(true);
    });
  });

  describe('Event Update', () => {
    it('should create updated event with new description', () => {
      const originalEvent = new Event(validEventData);
      const updatedEvent = originalEvent.update({ description: 'Updated Battle Description' });

      expect(updatedEvent.description).toBe('Updated Battle Description');
      expect(updatedEvent.actor).toBe(originalEvent.actor);
      expect(updatedEvent.target).toBe(originalEvent.target);
      expect(updatedEvent.timestamp).toEqual(originalEvent.timestamp);
      expect(updatedEvent.id).toBe(originalEvent.id);
    });

    it('should create updated event with multiple changes', () => {
      const originalEvent = new Event(validEventData);
      const newTimestamp = new Date('1805-12-03');
      const updatedEvent = originalEvent.update({
        description: 'Updated Description',
        timestamp: newTimestamp,
        metadata: { updated: true }
      });

      expect(updatedEvent.description).toBe('Updated Description');
      expect(updatedEvent.timestamp).toEqual(newTimestamp);
      expect(updatedEvent.metadata).toEqual({ updated: true });
      expect(updatedEvent.actor).toBe(originalEvent.actor);
      expect(updatedEvent.target).toBe(originalEvent.target);
    });

    it('should validate updated event data', () => {
      const originalEvent = new Event(validEventData);
      
      expect(() => {
        originalEvent.update({ description: '' });
      }).toThrow('Event validation failed');
    });
  });

  describe('Event Serialization', () => {
    it('should convert event to JSON', () => {
      const event = new Event({ ...validEventData, metadata: { location: 'Austerlitz' } });
      const json = event.toJSON();

      expect(json).toEqual({
        id: event.id,
        description: 'Battle of Austerlitz',
        actor: 'Napoleon Bonaparte',
        target: 'Coalition Forces',
        timestamp: new Date('1805-12-02'),
        metadata: { location: 'Austerlitz' }
      });
    });

    it('should convert event without metadata to JSON', () => {
      const event = new Event(validEventData);
      const json = event.toJSON();

      expect(json.metadata).toBeUndefined();
    });
  });

  describe('Interface Compatibility', () => {
    it('should be compatible with IEvent interface', () => {
      const event = new Event(validEventData);
      const eventInterface: IEvent = event;

      expect(eventInterface.id).toBe(event.id);
      expect(eventInterface.description).toBe(event.description);
      expect(eventInterface.actor).toBe(event.actor);
      expect(eventInterface.target).toBe(event.target);
      expect(eventInterface.timestamp).toEqual(event.timestamp);
    });
  });
});