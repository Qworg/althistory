import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Graph,
  IGraph,
  CreateGraphData,
  UpdateGraphData,
  GraphStatus,
  GraphMetadata,
  GraphValidationResult,
} from './Graph';

describe('Graph Model', () => {
  const validGraphData: CreateGraphData = {
    name: 'Alternate History Timeline',
    description: 'A timeline exploring what if Napoleon won at Waterloo',
  };

  const validMetadata: GraphMetadata = {
    eventCount: 10,
    arcCount: 3,
    relationshipCount: 15,
    pressureCount: 5,
    temporalRange: {
      start: '1800-01-01',
      end: '1850-12-31',
    },
    actors: ['Napoleon', 'Wellington', 'Alexander I'],
  };

  // Mock Date.now for predictable ID generation
  let dateNowSpy: ReturnType<typeof vi.spyOn>;
  let mathRandomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1704067200000);
    mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    mathRandomSpy.mockRestore();
  });

  describe('Graph Class Creation', () => {
    it('should create a graph with valid data', () => {
      const graph = new Graph(validGraphData);

      expect(graph.name).toBe('Alternate History Timeline');
      expect(graph.description).toBe('A timeline exploring what if Napoleon won at Waterloo');
      expect(graph.id).toBeDefined();
      expect(typeof graph.id).toBe('string');
      expect(graph.status).toBe('active');
      expect(graph.version).toBe(0);
    });

    it('should create a graph with provided ID', () => {
      const graphWithId = new Graph({ ...validGraphData, id: 'custom-graph-id' });
      expect(graphWithId.id).toBe('custom-graph-id');
    });

    it('should generate a unique ID when not provided', () => {
      const graph = new Graph(validGraphData);
      expect(graph.id).toMatch(/^graph_\d+_[a-z0-9]+$/);
    });

    it('should create a graph without description', () => {
      const graph = new Graph({ name: 'Minimal Graph' });

      expect(graph.name).toBe('Minimal Graph');
      expect(graph.description).toBeUndefined();
    });

    it('should create a graph with metadata', () => {
      const graphWithMetadata = new Graph({
        ...validGraphData,
        metadata: validMetadata,
      });

      expect(graphWithMetadata.metadata).toEqual(validMetadata);
    });

    it('should create a graph with default metadata when not provided', () => {
      const graph = new Graph(validGraphData);

      expect(graph.metadata).toEqual({
        eventCount: 0,
        arcCount: 0,
        relationshipCount: 0,
        pressureCount: 0,
      });
    });

    it('should trim whitespace from name', () => {
      const graph = new Graph({
        name: '  Alternate History Timeline  ',
        description: 'A timeline',
      });

      expect(graph.name).toBe('Alternate History Timeline');
    });

    it('should trim whitespace from description', () => {
      const graph = new Graph({
        name: 'Timeline',
        description: '  A timeline exploring history  ',
      });

      expect(graph.description).toBe('A timeline exploring history');
    });

    it('should set createdAt to current time when not provided', () => {
      const graph = new Graph(validGraphData);
      expect(graph.createdAt).toBeDefined();
      expect(typeof graph.createdAt).toBe('string');
    });

    it('should preserve provided createdAt', () => {
      const customCreatedAt = '2024-01-01T00:00:00.000Z';
      const graph = new Graph({
        ...validGraphData,
        createdAt: customCreatedAt,
      });

      expect(graph.createdAt).toBe(customCreatedAt);
    });

    it('should set updatedAt to createdAt when not provided', () => {
      const graph = new Graph(validGraphData);
      expect(graph.updatedAt).toBe(graph.createdAt);
    });

    it('should preserve provided updatedAt', () => {
      const customUpdatedAt = '2024-06-01T00:00:00.000Z';
      const graph = new Graph({
        ...validGraphData,
        updatedAt: customUpdatedAt,
      });

      expect(graph.updatedAt).toBe(customUpdatedAt);
    });

    it('should set version to 0 when not provided', () => {
      const graph = new Graph(validGraphData);
      expect(graph.version).toBe(0);
    });

    it('should preserve provided version', () => {
      const graph = new Graph({
        ...validGraphData,
        version: 5,
      });

      expect(graph.version).toBe(5);
    });

    it('should set status to active when not provided', () => {
      const graph = new Graph(validGraphData);
      expect(graph.status).toBe('active');
    });

    it('should preserve provided status', () => {
      const graph = new Graph({
        ...validGraphData,
        status: 'archived',
      });

      expect(graph.status).toBe('archived');
    });

    it('should create a graph with parent graph reference', () => {
      const graph = new Graph({
        ...validGraphData,
        parentGraphId: 'parent-graph-123',
        branchPoint: 10,
      });

      expect(graph.parentGraphId).toBe('parent-graph-123');
      expect(graph.branchPoint).toBe(10);
    });
  });

  describe('Graph Validation', () => {
    it('should validate correct graph data', () => {
      const result = Graph.validate(validGraphData);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing name', () => {
      const result = Graph.validate({ description: 'A description' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Name is required and must be a non-empty string');
    });

    it('should reject empty name', () => {
      const result = Graph.validate({ name: '' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Name is required and must be a non-empty string');
    });

    it('should reject whitespace-only name', () => {
      const result = Graph.validate({ name: '   ' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Name is required and must be a non-empty string');
    });

    it('should reject non-string name', () => {
      const result = Graph.validate({ name: 123 as any });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Name is required and must be a non-empty string');
    });

    it('should reject name exceeding 255 characters', () => {
      const longName = 'a'.repeat(256);
      const result = Graph.validate({ name: longName });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Name must be 255 characters or less');
    });

    it('should accept name at exactly 255 characters', () => {
      const maxLengthName = 'a'.repeat(255);
      const result = Graph.validate({ name: maxLengthName });
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject description exceeding 2000 characters', () => {
      const longDescription = 'a'.repeat(2001);
      const result = Graph.validate({
        name: 'Valid Name',
        description: longDescription,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Description must be 2000 characters or less');
    });

    it('should accept description at exactly 2000 characters', () => {
      const maxLengthDescription = 'a'.repeat(2000);
      const result = Graph.validate({
        name: 'Valid Name',
        description: maxLengthDescription,
      });
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept empty description', () => {
      const result = Graph.validate({
        name: 'Valid Name',
        description: '',
      });
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid status value', () => {
      const result = Graph.validate({
        name: 'Valid Name',
        status: 'invalid-status' as GraphStatus,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Status must be active, archived, or deleted');
    });

    it('should accept valid status values', () => {
      const statuses: GraphStatus[] = ['active', 'archived', 'deleted'];
      
      for (const status of statuses) {
        const result = Graph.validate({
          name: 'Valid Name',
          status,
        });
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }
    });

    it('should collect multiple validation errors', () => {
      const result = Graph.validate({
        name: '',
        description: 'a'.repeat(2001),
        status: 'invalid' as GraphStatus,
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Graph Creation Validation', () => {
    it('should throw error when creating graph with invalid data', () => {
      expect(() => {
        new Graph({ name: '' });
      }).toThrow('Graph validation failed: Name is required and must be a non-empty string');
    });

    it('should throw error with multiple validation messages', () => {
      expect(() => {
        new Graph({
          name: '',
          status: 'invalid' as GraphStatus,
        });
      }).toThrow('Graph validation failed');
    });

    it('should throw error for name exceeding max length', () => {
      expect(() => {
        new Graph({ name: 'a'.repeat(256) });
      }).toThrow('Graph validation failed');
    });
  });

  describe('Graph.toJSON()', () => {
    it('should convert graph to JSON with all fields', () => {
      const graph = new Graph({
        ...validGraphData,
        id: 'test-graph-id',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-06-01T00:00:00.000Z',
        version: 5,
        parentGraphId: 'parent-123',
        branchPoint: 3,
        status: 'active',
        metadata: validMetadata,
      });

      const json = graph.toJSON();

      expect(json).toEqual({
        id: 'test-graph-id',
        name: 'Alternate History Timeline',
        description: 'A timeline exploring what if Napoleon won at Waterloo',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-06-01T00:00:00.000Z',
        version: 5,
        parentGraphId: 'parent-123',
        branchPoint: 3,
        status: 'active',
        metadata: validMetadata,
      });
    });

    it('should convert graph without optional fields to JSON', () => {
      const graph = new Graph({ name: 'Minimal Graph' });
      const json = graph.toJSON();

      expect(json.name).toBe('Minimal Graph');
      expect(json.description).toBeUndefined();
      expect(json.parentGraphId).toBeUndefined();
      expect(json.branchPoint).toBeUndefined();
      expect(json.status).toBe('active');
      expect(json.metadata).toEqual({
        eventCount: 0,
        arcCount: 0,
        relationshipCount: 0,
        pressureCount: 0,
      });
    });

    it('should return IGraph interface compatible object', () => {
      const graph = new Graph(validGraphData);
      const json: IGraph = graph.toJSON();

      expect(json.id).toBe(graph.id);
      expect(json.name).toBe(graph.name);
      expect(json.version).toBe(graph.version);
      expect(json.status).toBe(graph.status);
    });
  });

  describe('Graph.update()', () => {
    it('should create updated graph with new name', () => {
      const originalGraph = new Graph(validGraphData);
      const updatedGraph = originalGraph.update({ name: 'Updated Timeline' });

      expect(updatedGraph.name).toBe('Updated Timeline');
      expect(updatedGraph.description).toBe(originalGraph.description);
      expect(updatedGraph.id).toBe(originalGraph.id);
      expect(updatedGraph.createdAt).toBe(originalGraph.createdAt);
      expect(updatedGraph.parentGraphId).toBe(originalGraph.parentGraphId);
      expect(updatedGraph.branchPoint).toBe(originalGraph.branchPoint);
    });

    it('should create updated graph with new description', () => {
      const originalGraph = new Graph(validGraphData);
      const updatedGraph = originalGraph.update({ description: 'Updated description' });

      expect(updatedGraph.description).toBe('Updated description');
      expect(updatedGraph.name).toBe(originalGraph.name);
    });

    it('should increment version on update', () => {
      const originalGraph = new Graph(validGraphData);
      const updatedGraph = originalGraph.update({ name: 'Updated Name' });

      expect(updatedGraph.version).toBe(originalGraph.version + 1);
    });

    it('should update the updatedAt timestamp', () => {
      const originalGraph = new Graph({
        ...validGraphData,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const updatedGraph = originalGraph.update({ name: 'Updated Name' });

      expect(updatedGraph.updatedAt).not.toBe(originalGraph.updatedAt);
      expect(new Date(updatedGraph.updatedAt).getTime()).toBeGreaterThan(
        new Date(originalGraph.updatedAt).getTime()
      );
    });

    it('should create updated graph with new status', () => {
      const originalGraph = new Graph(validGraphData);
      const updatedGraph = originalGraph.update({ status: 'archived' });

      expect(updatedGraph.status).toBe('archived');
      expect(updatedGraph.name).toBe(originalGraph.name);
    });

    it('should create updated graph with new metadata', () => {
      const originalGraph = new Graph(validGraphData);
      const newMetadata: GraphMetadata = {
        eventCount: 20,
        arcCount: 5,
        relationshipCount: 30,
        pressureCount: 10,
      };
      const updatedGraph = originalGraph.update({ metadata: newMetadata });

      expect(updatedGraph.metadata).toEqual(newMetadata);
    });

    it('should create updated graph with multiple changes', () => {
      const originalGraph = new Graph(validGraphData);
      const updatedGraph = originalGraph.update({
        name: 'New Timeline Name',
        description: 'New description',
        status: 'archived',
        metadata: {
          eventCount: 50,
          arcCount: 10,
          relationshipCount: 75,
          pressureCount: 20,
        },
      });

      expect(updatedGraph.name).toBe('New Timeline Name');
      expect(updatedGraph.description).toBe('New description');
      expect(updatedGraph.status).toBe('archived');
      expect(updatedGraph.metadata.eventCount).toBe(50);
    });

    it('should validate updated graph data', () => {
      const originalGraph = new Graph(validGraphData);

      expect(() => {
        originalGraph.update({ name: '' });
      }).toThrow('Graph validation failed');
    });

    it('should validate status in updated graph', () => {
      const originalGraph = new Graph(validGraphData);

      expect(() => {
        originalGraph.update({ status: 'invalid-status' as GraphStatus });
      }).toThrow('Graph validation failed');
    });

    it('should preserve original graph immutability', () => {
      const originalGraph = new Graph(validGraphData);
      const originalName = originalGraph.name;
      
      originalGraph.update({ name: 'Updated Name' });

      expect(originalGraph.name).toBe(originalName);
    });
  });

  describe('Graph.branch()', () => {
    it('should create a branch with new name', () => {
      const originalGraph = new Graph({
        ...validGraphData,
        id: 'original-graph-id',
        version: 5,
      });

      const branchedGraph = originalGraph.branch('Branched Timeline');

      expect(branchedGraph.name).toBe('Branched Timeline');
      expect(branchedGraph.id).not.toBe(originalGraph.id);
    });

    it('should set parent graph reference', () => {
      const originalGraph = new Graph({
        ...validGraphData,
        id: 'original-graph-id',
        version: 5,
      });

      const branchedGraph = originalGraph.branch('Branched Timeline');

      expect(branchedGraph.parentGraphId).toBe('original-graph-id');
    });

    it('should set branch point to parent version', () => {
      const originalGraph = new Graph({
        ...validGraphData,
        id: 'original-graph-id',
        version: 5,
      });

      const branchedGraph = originalGraph.branch('Branched Timeline');

      expect(branchedGraph.branchPoint).toBe(5);
    });

    it('should create branch with description', () => {
      const originalGraph = new Graph(validGraphData);

      const branchedGraph = originalGraph.branch(
        'Branched Timeline',
        'A branch exploring alternative outcomes'
      );

      expect(branchedGraph.description).toBe('A branch exploring alternative outcomes');
    });

    it('should create branch without description', () => {
      const originalGraph = new Graph(validGraphData);

      const branchedGraph = originalGraph.branch('Branched Timeline');

      expect(branchedGraph.description).toBeUndefined();
    });

    it('should set branch status to active', () => {
      const originalGraph = new Graph({
        ...validGraphData,
        status: 'archived',
      });

      const branchedGraph = originalGraph.branch('Branched Timeline');

      expect(branchedGraph.status).toBe('active');
    });

    it('should copy metadata from parent graph', () => {
      const originalGraph = new Graph({
        ...validGraphData,
        metadata: validMetadata,
      });

      const branchedGraph = originalGraph.branch('Branched Timeline');

      expect(branchedGraph.metadata).toEqual(validMetadata);
    });

    it('should create independent copy of metadata', () => {
      const originalGraph = new Graph({
        ...validGraphData,
        metadata: validMetadata,
      });

      const branchedGraph = originalGraph.branch('Branched Timeline');

      // Verify it's a copy, not a reference
      expect(branchedGraph.metadata).not.toBe(originalGraph.metadata);
    });

    it('should start branch at version 0', () => {
      const originalGraph = new Graph({
        ...validGraphData,
        version: 10,
      });

      const branchedGraph = originalGraph.branch('Branched Timeline');

      expect(branchedGraph.version).toBe(0);
    });

    it('should throw error for invalid branch name', () => {
      const originalGraph = new Graph(validGraphData);

      expect(() => {
        originalGraph.branch('');
      }).toThrow('Graph validation failed');
    });

    it('should set new createdAt for branch', () => {
      const originalGraph = new Graph({
        ...validGraphData,
        createdAt: '2024-01-01T00:00:00.000Z',
      });

      const branchedGraph = originalGraph.branch('Branched Timeline');

      expect(branchedGraph.createdAt).not.toBe(originalGraph.createdAt);
    });
  });

  describe('Graph Status Transitions', () => {
    it('should allow transition from active to archived', () => {
      const graph = new Graph({ ...validGraphData, status: 'active' });
      const archivedGraph = graph.update({ status: 'archived' });

      expect(archivedGraph.status).toBe('archived');
    });

    it('should allow transition from active to deleted', () => {
      const graph = new Graph({ ...validGraphData, status: 'active' });
      const deletedGraph = graph.update({ status: 'deleted' });

      expect(deletedGraph.status).toBe('deleted');
    });

    it('should allow transition from archived to active', () => {
      const graph = new Graph({ ...validGraphData, status: 'archived' });
      const activeGraph = graph.update({ status: 'active' });

      expect(activeGraph.status).toBe('active');
    });

    it('should allow transition from archived to deleted', () => {
      const graph = new Graph({ ...validGraphData, status: 'archived' });
      const deletedGraph = graph.update({ status: 'deleted' });

      expect(deletedGraph.status).toBe('deleted');
    });

    it('should allow transition from deleted to active', () => {
      const graph = new Graph({ ...validGraphData, status: 'deleted' });
      const activeGraph = graph.update({ status: 'active' });

      expect(activeGraph.status).toBe('active');
    });

    it('should allow transition from deleted to archived', () => {
      const graph = new Graph({ ...validGraphData, status: 'deleted' });
      const archivedGraph = graph.update({ status: 'archived' });

      expect(archivedGraph.status).toBe('archived');
    });

    it('should maintain status when not updating it', () => {
      const graph = new Graph({ ...validGraphData, status: 'archived' });
      const updatedGraph = graph.update({ name: 'New Name' });

      expect(updatedGraph.status).toBe('archived');
    });
  });

  describe('Graph Metadata Updates', () => {
    it('should update event count', () => {
      const graph = new Graph(validGraphData);
      const updatedGraph = graph.update({
        metadata: {
          ...graph.metadata,
          eventCount: 25,
        },
      });

      expect(updatedGraph.metadata.eventCount).toBe(25);
    });

    it('should update arc count', () => {
      const graph = new Graph(validGraphData);
      const updatedGraph = graph.update({
        metadata: {
          ...graph.metadata,
          arcCount: 10,
        },
      });

      expect(updatedGraph.metadata.arcCount).toBe(10);
    });

    it('should update relationship count', () => {
      const graph = new Graph(validGraphData);
      const updatedGraph = graph.update({
        metadata: {
          ...graph.metadata,
          relationshipCount: 50,
        },
      });

      expect(updatedGraph.metadata.relationshipCount).toBe(50);
    });

    it('should update pressure count', () => {
      const graph = new Graph(validGraphData);
      const updatedGraph = graph.update({
        metadata: {
          ...graph.metadata,
          pressureCount: 15,
        },
      });

      expect(updatedGraph.metadata.pressureCount).toBe(15);
    });

    it('should update temporal range', () => {
      const graph = new Graph(validGraphData);
      const newTemporalRange = {
        start: '1900-01-01',
        end: '2000-12-31',
      };
      const updatedGraph = graph.update({
        metadata: {
          ...graph.metadata,
          temporalRange: newTemporalRange,
        },
      });

      expect(updatedGraph.metadata.temporalRange).toEqual(newTemporalRange);
    });

    it('should update actors list', () => {
      const graph = new Graph(validGraphData);
      const newActors = ['Churchill', 'Roosevelt', 'Stalin'];
      const updatedGraph = graph.update({
        metadata: {
          ...graph.metadata,
          actors: newActors,
        },
      });

      expect(updatedGraph.metadata.actors).toEqual(newActors);
    });

    it('should allow clearing optional metadata fields', () => {
      const graph = new Graph({
        ...validGraphData,
        metadata: validMetadata,
      });

      const updatedGraph = graph.update({
        metadata: {
          eventCount: 0,
          arcCount: 0,
          relationshipCount: 0,
          pressureCount: 0,
        },
      });

      expect(updatedGraph.metadata.temporalRange).toBeUndefined();
      expect(updatedGraph.metadata.actors).toBeUndefined();
    });

    it('should replace entire metadata object on update', () => {
      const graph = new Graph({
        ...validGraphData,
        metadata: validMetadata,
      });

      const newMetadata: GraphMetadata = {
        eventCount: 100,
        arcCount: 20,
        relationshipCount: 200,
        pressureCount: 50,
      };

      const updatedGraph = graph.update({ metadata: newMetadata });

      expect(updatedGraph.metadata).toEqual(newMetadata);
      expect(updatedGraph.metadata.temporalRange).toBeUndefined();
      expect(updatedGraph.metadata.actors).toBeUndefined();
    });
  });

  describe('Interface Compatibility', () => {
    it('should be compatible with IGraph interface', () => {
      const graph = new Graph({
        ...validGraphData,
        metadata: validMetadata,
      });
      const graphInterface: IGraph = graph;

      expect(graphInterface.id).toBe(graph.id);
      expect(graphInterface.name).toBe(graph.name);
      expect(graphInterface.description).toBe(graph.description);
      expect(graphInterface.createdAt).toBe(graph.createdAt);
      expect(graphInterface.updatedAt).toBe(graph.updatedAt);
      expect(graphInterface.version).toBe(graph.version);
      expect(graphInterface.status).toBe(graph.status);
      expect(graphInterface.metadata).toEqual(graph.metadata);
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined description gracefully', () => {
      const graph = new Graph({ name: 'Test Graph', description: undefined });
      expect(graph.description).toBeUndefined();
    });

    it('should handle null-ish values in optional fields', () => {
      const graph = new Graph({
        name: 'Test Graph',
      });

      expect(graph.parentGraphId).toBeUndefined();
      expect(graph.branchPoint).toBeUndefined();
    });

    it('should handle updating with same values', () => {
      const graph = new Graph(validGraphData);
      const updatedGraph = graph.update({
        name: validGraphData.name,
        description: validGraphData.description,
      });

      expect(updatedGraph.name).toBe(graph.name);
      expect(updatedGraph.description).toBe(graph.description);
      expect(updatedGraph.version).toBe(graph.version + 1);
    });

    it('should handle special characters in name', () => {
      const specialName = 'Timeline: What If? (1805) [Alt]';
      const graph = new Graph({ name: specialName });

      expect(graph.name).toBe(specialName);
    });

    it('should handle unicode characters in description', () => {
      const unicodeDescription = 'Timeline exploring 日本語 and émojis 🎭';
      const graph = new Graph({
        name: 'Unicode Test',
        description: unicodeDescription,
      });

      expect(graph.description).toBe(unicodeDescription);
    });

    it('should handle version 0 correctly', () => {
      const graph = new Graph({ ...validGraphData, version: 0 });
      expect(graph.version).toBe(0);
    });

    it('should handle large version numbers', () => {
      const graph = new Graph({ ...validGraphData, version: 999999 });
      expect(graph.version).toBe(999999);
    });

    it('should handle branching from version 0', () => {
      const graph = new Graph({ ...validGraphData, version: 0 });
      const branch = graph.branch('Branch from v0');

      expect(branch.branchPoint).toBe(0);
    });

    it('should handle multiple sequential updates', () => {
      let graph = new Graph(validGraphData);

      for (let i = 0; i < 5; i++) {
        graph = graph.update({ name: `Version ${i + 1}` });
      }

      expect(graph.version).toBe(5);
      expect(graph.name).toBe('Version 5');
    });

    it('should handle chained branches', () => {
      const original = new Graph({ ...validGraphData, id: 'original' });
      const branch1 = original.branch('Branch 1');
      const branch1Updated = branch1.update({ name: 'Branch 1 Updated' });
      const branch2 = branch1Updated.branch('Branch 2');

      expect(branch2.parentGraphId).toBe(branch1.id);
      expect(branch2.branchPoint).toBe(1); // branch1Updated is at version 1
    });
  });
});
