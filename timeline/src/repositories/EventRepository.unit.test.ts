import { describe, it, expect } from 'vitest';
import { EventRepository, AdvancedEventRepository } from './EventRepository';
// Type-only exports are not part of the runtime module namespace, so the interface
// checks below import them with `import type` rather than through a dynamic import.
import type { EventQueryOptions, EventSearchFilters } from './EventRepository';

describe('EventRepository Unit Tests', () => {
  describe('Class Structure', () => {
    it('should have all required methods', () => {
      expect(EventRepository.prototype.create).toBeDefined();
      expect(EventRepository.prototype.findById).toBeDefined();
      expect(EventRepository.prototype.findAll).toBeDefined();
      expect(EventRepository.prototype.findByTimeRange).toBeDefined();
      expect(EventRepository.prototype.findByActor).toBeDefined();
      expect(EventRepository.prototype.findByTarget).toBeDefined();
      expect(EventRepository.prototype.findByActorAndTimeRange).toBeDefined();
      expect(EventRepository.prototype.update).toBeDefined();
      expect(EventRepository.prototype.delete).toBeDefined();
      expect(EventRepository.prototype.count).toBeDefined();
      expect(EventRepository.prototype.countByActor).toBeDefined();
      expect(EventRepository.prototype.countByTimeRange).toBeDefined();
      expect(EventRepository.prototype.exists).toBeDefined();
      expect(EventRepository.prototype.close).toBeDefined();
    });

    it('should have AdvancedEventRepository with search method', () => {
      expect(AdvancedEventRepository.prototype.search).toBeDefined();
      
      // Should inherit from EventRepository
      expect(AdvancedEventRepository.prototype.create).toBeDefined();
      expect(AdvancedEventRepository.prototype.findById).toBeDefined();
    });
  });

  describe('Interface Definitions', () => {
    it('should have proper query options interface', () => {
      // Test that the interface can be used
      const options: EventQueryOptions = {};
      expect(options).toBeDefined();
    });

    it('should have proper search filters interface', () => {
      // Test that the interface can be used
      const filters: EventSearchFilters = {};
      expect(filters).toBeDefined();
    });
  });
});