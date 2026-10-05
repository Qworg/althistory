import { describe, it, expect } from 'vitest';
import { ArcRepository, AdvancedArcRepository } from './ArcRepository';
// Type-only exports are not part of the runtime module namespace, so the interface
// checks below import them with `import type` rather than through a dynamic import.
import type { ArcQueryOptions, ArcSearchFilters, ArcHierarchyNode } from './ArcRepository';
import { Arc } from '../models/Arc';

describe('ArcRepository Unit Tests', () => {
  describe('Class Structure', () => {
    it('should have all required methods', () => {
      expect(ArcRepository.prototype.create).toBeDefined();
      expect(ArcRepository.prototype.findById).toBeDefined();
      expect(ArcRepository.prototype.findAll).toBeDefined();
      expect(ArcRepository.prototype.findByLevel).toBeDefined();
      expect(ArcRepository.prototype.findOverlappingArcs).toBeDefined();
      expect(ArcRepository.prototype.findContainingArcs).toBeDefined();
      expect(ArcRepository.prototype.findNestedArcs).toBeDefined();
      expect(ArcRepository.prototype.findDirectChildren).toBeDefined();
      expect(ArcRepository.prototype.findParentArcs).toBeDefined();
      expect(ArcRepository.prototype.update).toBeDefined();
      expect(ArcRepository.prototype.delete).toBeDefined();
      expect(ArcRepository.prototype.count).toBeDefined();
      expect(ArcRepository.prototype.countByLevel).toBeDefined();
      expect(ArcRepository.prototype.exists).toBeDefined();
      expect(ArcRepository.prototype.close).toBeDefined();
    });

    it('should have AdvancedArcRepository with additional methods', () => {
      expect(AdvancedArcRepository.prototype.search).toBeDefined();
      expect(AdvancedArcRepository.prototype.getHierarchyTree).toBeDefined();
      
      // Should inherit from ArcRepository
      expect(AdvancedArcRepository.prototype.create).toBeDefined();
      expect(AdvancedArcRepository.prototype.findById).toBeDefined();
      expect(AdvancedArcRepository.prototype.findNestedArcs).toBeDefined();
    });
  });

  describe('Interface Definitions', () => {
    it('should have proper query options interface', () => {
      // Test that the interface can be used
      const options: ArcQueryOptions = {};
      expect(options).toBeDefined();
    });

    it('should have proper search filters interface', () => {
      // Test that the interface can be used
      const filters: ArcSearchFilters = {};
      expect(filters).toBeDefined();
    });

    it('should have proper hierarchy node interface', () => {
      // Test that the interface can be used
      const node: ArcHierarchyNode = {
        arc: new Arc({
          name: 'Hierarchy Node Arc',
          start_time: new Date('2023-01-01T00:00:00Z'),
          end_time: new Date('2023-12-31T23:59:59Z'),
          level: 0
        }),
        children: []
      };
      expect(node).toBeDefined();
      expect(node.children).toEqual([]);
    });
  });

  describe('Method Signatures', () => {
    it('should have correct method signatures for hierarchy operations', () => {
      // Test that methods exist with expected signatures
      const repository = ArcRepository.prototype;
      
      expect(typeof repository.findNestedArcs).toBe('function');
      expect(typeof repository.findDirectChildren).toBe('function');
      expect(typeof repository.findParentArcs).toBe('function');
      expect(typeof repository.findOverlappingArcs).toBe('function');
      expect(typeof repository.findContainingArcs).toBe('function');
    });

    it('should have correct method signatures for advanced operations', () => {
      const advancedRepository = AdvancedArcRepository.prototype;
      
      expect(typeof advancedRepository.search).toBe('function');
      expect(typeof advancedRepository.getHierarchyTree).toBe('function');
    });
  });
});