import { describe, it, expect } from 'vitest';
import { Arc, IArc, CreateArcRequest, UpdateArcRequest, ArcValidationResult } from './Arc';

describe('Arc Model', () => {
  const validArcData: CreateArcRequest = {
    name: 'Napoleonic Wars',
    description: 'Series of conflicts involving Napoleon Bonaparte',
    start_time: new Date('1803-05-18'),
    end_time: new Date('1815-11-20'),
    level: 0,
    metadata: { region: 'Europe' }
  };

  describe('Arc Class Creation', () => {
    it('should create an arc with valid data', () => {
      const arc = new Arc(validArcData);

      expect(arc.name).toBe('Napoleonic Wars');
      expect(arc.description).toBe('Series of conflicts involving Napoleon Bonaparte');
      expect(arc.start_time).toEqual(new Date('1803-05-18'));
      expect(arc.end_time).toEqual(new Date('1815-11-20'));
      expect(arc.level).toBe(0);
      expect(arc.metadata).toEqual({ region: 'Europe' });
      expect(arc.id).toBeDefined();
      expect(typeof arc.id).toBe('string');
    });

    it('should create an arc with provided ID', () => {
      const arcWithId = new Arc({ ...validArcData, id: 'custom-arc-id' });
      expect(arcWithId.id).toBe('custom-arc-id');
    });

    it('should create an arc without description', () => {
      const { description, ...dataWithoutDescription } = validArcData;
      const arc = new Arc(dataWithoutDescription);
      
      expect(arc.description).toBeUndefined();
      expect(arc.name).toBe('Napoleonic Wars');
    });

    it('should create an arc without metadata', () => {
      const { metadata, ...dataWithoutMetadata } = validArcData;
      const arc = new Arc(dataWithoutMetadata);
      
      expect(arc.metadata).toBeUndefined();
      expect(arc.name).toBe('Napoleonic Wars');
    });

    it('should trim whitespace from string fields', () => {
      const arcWithWhitespace = new Arc({
        name: '  Napoleonic Wars  ',
        description: '  Series of conflicts  ',
        start_time: new Date('1803-05-18'),
        end_time: new Date('1815-11-20'),
        level: 0
      });

      expect(arcWithWhitespace.name).toBe('Napoleonic Wars');
      expect(arcWithWhitespace.description).toBe('Series of conflicts');
    });
  });

  describe('Arc Validation', () => {
    it('should validate correct arc data', () => {
      const result = Arc.validate(validArcData);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing name', () => {
      const result = Arc.validate({ ...validArcData, name: '' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Name is required and must be a non-empty string');
    });

    it('should reject missing start_time', () => {
      const { start_time, ...dataWithoutStartTime } = validArcData;
      const result = Arc.validate(dataWithoutStartTime);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Start time is required');
    });

    it('should reject missing end_time', () => {
      const { end_time, ...dataWithoutEndTime } = validArcData;
      const result = Arc.validate(dataWithoutEndTime);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('End time is required');
    });

    it('should reject invalid start_time', () => {
      const result = Arc.validate({ ...validArcData, start_time: new Date('invalid-date') });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Start time must be a valid date');
    });

    it('should reject invalid end_time', () => {
      const result = Arc.validate({ ...validArcData, end_time: new Date('invalid-date') });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('End time must be a valid date');
    });

    it('should reject start_time >= end_time', () => {
      const result = Arc.validate({
        ...validArcData,
        start_time: new Date('1815-11-20'),
        end_time: new Date('1803-05-18')
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Start time must be before end time');
    });

    it('should reject equal start_time and end_time', () => {
      const sameDate = new Date('1803-05-18');
      const result = Arc.validate({
        ...validArcData,
        start_time: sameDate,
        end_time: sameDate
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Start time must be before end time');
    });

    it('should reject missing level', () => {
      const { level, ...dataWithoutLevel } = validArcData;
      const result = Arc.validate(dataWithoutLevel);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Level is required');
    });

    it('should reject negative level', () => {
      const result = Arc.validate({ ...validArcData, level: -1 });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Level must be a non-negative integer');
    });

    it('should reject non-integer level', () => {
      const result = Arc.validate({ ...validArcData, level: 1.5 });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Level must be a non-negative integer');
    });

    it('should reject invalid description type', () => {
      const result = Arc.validate({ ...validArcData, description: 123 as any });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Description must be a string');
    });

    it('should reject invalid metadata type', () => {
      const result = Arc.validate({ ...validArcData, metadata: 'invalid' as any });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Metadata must be an object');
    });

    it('should reject array as metadata', () => {
      const result = Arc.validate({ ...validArcData, metadata: [] as any });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Metadata must be an object');
    });

    it('should reject null as metadata', () => {
      const result = Arc.validate({ ...validArcData, metadata: null as any });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Metadata must be an object');
    });

    it('should collect multiple validation errors', () => {
      const result = Arc.validate({
        name: '',
        start_time: new Date('invalid'),
        end_time: new Date('invalid'),
        level: -1
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(3);
    });
  });

  describe('Arc Creation Validation', () => {
    it('should throw error when creating arc with invalid data', () => {
      expect(() => {
        new Arc({ ...validArcData, name: '' });
      }).toThrow('Arc validation failed: Name is required and must be a non-empty string');
    });

    it('should throw error with multiple validation messages', () => {
      expect(() => {
        new Arc({
          name: '',
          start_time: new Date('1803-05-18'),
          end_time: new Date('1803-05-18'),
          level: -1
        });
      }).toThrow('Arc validation failed');
    });
  });

  describe('Temporal Boundary Methods', () => {
    const parentArc = new Arc({
      name: 'Napoleonic Wars',
      start_time: new Date('1803-05-18'),
      end_time: new Date('1815-11-20'),
      level: 0
    });

    const childArc = new Arc({
      name: 'Battle of Austerlitz Campaign',
      start_time: new Date('1805-10-01'),
      end_time: new Date('1805-12-31'),
      level: 1
    });

    const overlappingArc = new Arc({
      name: 'Congress of Vienna',
      start_time: new Date('1814-09-01'),
      end_time: new Date('1816-06-09'), // Extends beyond parent arc
      level: 0
    });

    const separateArc = new Arc({
      name: 'Franco-Prussian War',
      start_time: new Date('1870-07-19'),
      end_time: new Date('1871-05-10'),
      level: 0
    });

    describe('canContainArc', () => {
      it('should validate that parent arc can contain child arc', () => {
        expect(parentArc.canContainArc(childArc)).toBe(true);
      });

      it('should validate that child arc cannot contain parent arc', () => {
        expect(childArc.canContainArc(parentArc)).toBe(false);
      });

      it('should validate that arc cannot contain overlapping arc that extends beyond', () => {
        expect(parentArc.canContainArc(overlappingArc)).toBe(false);
      });

      it('should validate that arc cannot contain separate arc', () => {
        expect(parentArc.canContainArc(separateArc)).toBe(false);
      });

      it('should validate arc can contain itself', () => {
        expect(parentArc.canContainArc(parentArc)).toBe(true);
      });
    });

    describe('overlapsWith', () => {
      it('should detect overlap between parent and overlapping arc', () => {
        expect(parentArc.overlapsWith(overlappingArc)).toBe(true);
        expect(overlappingArc.overlapsWith(parentArc)).toBe(true);
      });

      it('should detect no overlap with separate arc', () => {
        expect(parentArc.overlapsWith(separateArc)).toBe(false);
        expect(separateArc.overlapsWith(parentArc)).toBe(false);
      });

      it('should detect overlap between parent and child', () => {
        expect(parentArc.overlapsWith(childArc)).toBe(true);
        expect(childArc.overlapsWith(parentArc)).toBe(true);
      });

      it('should detect arc overlaps with itself', () => {
        expect(parentArc.overlapsWith(parentArc)).toBe(true);
      });
    });

    describe('containsTimestamp', () => {
      it('should validate timestamp within arc boundaries', () => {
        const timestamp = new Date('1805-12-02'); // Battle of Austerlitz
        expect(parentArc.containsTimestamp(timestamp)).toBe(true);
        expect(childArc.containsTimestamp(timestamp)).toBe(true);
      });

      it('should validate timestamp outside arc boundaries (before)', () => {
        const timestamp = new Date('1800-01-01');
        expect(parentArc.containsTimestamp(timestamp)).toBe(false);
        expect(childArc.containsTimestamp(timestamp)).toBe(false);
      });

      it('should validate timestamp outside arc boundaries (after)', () => {
        const timestamp = new Date('1820-01-01');
        expect(parentArc.containsTimestamp(timestamp)).toBe(false);
        expect(childArc.containsTimestamp(timestamp)).toBe(false);
      });

      it('should validate timestamp at exact boundaries', () => {
        expect(parentArc.containsTimestamp(parentArc.start_time)).toBe(true);
        expect(parentArc.containsTimestamp(parentArc.end_time)).toBe(true);
      });
    });

    describe('getDuration', () => {
      it('should calculate arc duration correctly', () => {
        const expectedDuration = new Date('1815-11-20').getTime() - new Date('1803-05-18').getTime();
        expect(parentArc.getDuration()).toBe(expectedDuration);
      });

      it('should calculate child arc duration correctly', () => {
        const expectedDuration = new Date('1805-12-31').getTime() - new Date('1805-10-01').getTime();
        expect(childArc.getDuration()).toBe(expectedDuration);
      });
    });
  });

  describe('Arc Update', () => {
    it('should create updated arc with new name', () => {
      const originalArc = new Arc(validArcData);
      const updatedArc = originalArc.update({ name: 'Updated War Name' });

      expect(updatedArc.name).toBe('Updated War Name');
      expect(updatedArc.description).toBe(originalArc.description);
      expect(updatedArc.start_time).toEqual(originalArc.start_time);
      expect(updatedArc.end_time).toEqual(originalArc.end_time);
      expect(updatedArc.level).toBe(originalArc.level);
      expect(updatedArc.id).toBe(originalArc.id);
    });

    it('should create updated arc with multiple changes', () => {
      const originalArc = new Arc(validArcData);
      const newStartTime = new Date('1804-01-01');
      const newEndTime = new Date('1814-01-01');
      const updatedArc = originalArc.update({
        name: 'Updated Name',
        start_time: newStartTime,
        end_time: newEndTime,
        level: 1,
        metadata: { updated: true }
      });

      expect(updatedArc.name).toBe('Updated Name');
      expect(updatedArc.start_time).toEqual(newStartTime);
      expect(updatedArc.end_time).toEqual(newEndTime);
      expect(updatedArc.level).toBe(1);
      expect(updatedArc.metadata).toEqual({ updated: true });
      expect(updatedArc.description).toBe(originalArc.description);
    });

    it('should validate updated arc data', () => {
      const originalArc = new Arc(validArcData);
      
      expect(() => {
        originalArc.update({ name: '' });
      }).toThrow('Arc validation failed');
    });

    it('should validate temporal boundaries in updated arc', () => {
      const originalArc = new Arc(validArcData);
      
      expect(() => {
        originalArc.update({
          start_time: new Date('1815-11-20'),
          end_time: new Date('1803-05-18')
        });
      }).toThrow('Arc validation failed');
    });
  });

  describe('Arc Serialization', () => {
    it('should convert arc to JSON', () => {
      const arc = new Arc(validArcData);
      const json = arc.toJSON();

      expect(json).toEqual({
        id: arc.id,
        name: 'Napoleonic Wars',
        description: 'Series of conflicts involving Napoleon Bonaparte',
        start_time: new Date('1803-05-18'),
        end_time: new Date('1815-11-20'),
        level: 0,
        metadata: { region: 'Europe' }
      });
    });

    it('should convert arc without optional fields to JSON', () => {
      const { description, metadata, ...minimalData } = validArcData;
      const arc = new Arc(minimalData);
      const json = arc.toJSON();

      expect(json.description).toBeUndefined();
      expect(json.metadata).toBeUndefined();
      expect(json.name).toBe('Napoleonic Wars');
    });
  });

  describe('Interface Compatibility', () => {
    it('should be compatible with IArc interface', () => {
      const arc = new Arc(validArcData);
      const arcInterface: IArc = arc;

      expect(arcInterface.id).toBe(arc.id);
      expect(arcInterface.name).toBe(arc.name);
      expect(arcInterface.description).toBe(arc.description);
      expect(arcInterface.start_time).toEqual(arc.start_time);
      expect(arcInterface.end_time).toEqual(arc.end_time);
      expect(arcInterface.level).toBe(arc.level);
      expect(arcInterface.metadata).toEqual(arc.metadata);
    });
  });
});