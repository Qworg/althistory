import { describe, it, expect } from 'vitest';
import { 
  InferredPressure, 
  IInferredPressure, 
  CreateInferredPressureRequest, 
  UpdateInferredPressureRequest,
  PressureType,
  PressureValidationResult 
} from './InferredPressure';

describe('InferredPressure Model', () => {
  const validPressureData: CreateInferredPressureRequest = {
    description: 'Economic instability due to war costs',
    confidence_score: 0.85,
    pressure_type: 'economic',
    evidence: [
      'Rising national debt from military expenditures',
      'Inflation due to currency debasement',
      'Trade disruptions affecting commerce'
    ]
  };

  describe('InferredPressure Class Creation', () => {
    it('should create a pressure with valid data', () => {
      const pressure = new InferredPressure(validPressureData);

      expect(pressure.description).toBe('Economic instability due to war costs');
      expect(pressure.confidence_score).toBe(0.85);
      expect(pressure.pressure_type).toBe('economic');
      expect(pressure.evidence).toEqual([
        'Rising national debt from military expenditures',
        'Inflation due to currency debasement',
        'Trade disruptions affecting commerce'
      ]);
      expect(pressure.id).toBeDefined();
      expect(typeof pressure.id).toBe('string');
    });

    it('should create a pressure with provided ID', () => {
      const pressureWithId = new InferredPressure({ ...validPressureData, id: 'custom-pressure-id' });
      expect(pressureWithId.id).toBe('custom-pressure-id');
    });

    it('should create a pressure with different pressure types', () => {
      const socialPressure = new InferredPressure({
        ...validPressureData,
        pressure_type: 'social',
        description: 'Social unrest due to class inequality'
      });
      expect(socialPressure.pressure_type).toBe('social');

      const politicalPressure = new InferredPressure({
        ...validPressureData,
        pressure_type: 'political',
        description: 'Political instability from succession crisis'
      });
      expect(politicalPressure.pressure_type).toBe('political');

      const environmentalPressure = new InferredPressure({
        ...validPressureData,
        pressure_type: 'environmental',
        description: 'Agricultural crisis from climate change'
      });
      expect(environmentalPressure.pressure_type).toBe('environmental');
    });

    it('should trim whitespace from description', () => {
      const pressureWithWhitespace = new InferredPressure({
        ...validPressureData,
        description: '  Economic instability due to war costs  '
      });

      expect(pressureWithWhitespace.description).toBe('Economic instability due to war costs');
    });

    it('should create a copy of the evidence array', () => {
      const originalEvidence = ['Evidence 1', 'Evidence 2'];
      const pressure = new InferredPressure({
        ...validPressureData,
        evidence: originalEvidence
      });

      // Modify original array
      originalEvidence.push('Evidence 3');

      // Pressure should not be affected
      expect(pressure.evidence).toHaveLength(2);
      expect(pressure.evidence).not.toContain('Evidence 3');
    });
  });

  describe('InferredPressure Validation', () => {
    it('should validate correct pressure data', () => {
      const result = InferredPressure.validate(validPressureData);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing description', () => {
      const result = InferredPressure.validate({ ...validPressureData, description: '' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Description is required and must be a non-empty string');
    });

    it('should reject missing confidence_score', () => {
      const { confidence_score, ...dataWithoutScore } = validPressureData;
      const result = InferredPressure.validate(dataWithoutScore);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Confidence score is required');
    });

    it('should reject invalid confidence_score type', () => {
      const result = InferredPressure.validate({ ...validPressureData, confidence_score: 'invalid' as any });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Confidence score must be a valid number');
    });

    it('should reject confidence_score below 0.0', () => {
      const result = InferredPressure.validate({ ...validPressureData, confidence_score: -0.1 });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Confidence score must be between 0.0 and 1.0');
    });

    it('should reject confidence_score above 1.0', () => {
      const result = InferredPressure.validate({ ...validPressureData, confidence_score: 1.1 });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Confidence score must be between 0.0 and 1.0');
    });

    it('should accept confidence_score at boundaries', () => {
      const resultMin = InferredPressure.validate({ ...validPressureData, confidence_score: 0.0 });
      expect(resultMin.isValid).toBe(true);

      const resultMax = InferredPressure.validate({ ...validPressureData, confidence_score: 1.0 });
      expect(resultMax.isValid).toBe(true);
    });

    it('should reject missing pressure_type', () => {
      const { pressure_type, ...dataWithoutType } = validPressureData;
      const result = InferredPressure.validate(dataWithoutType);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Pressure type is required');
    });

    it('should reject invalid pressure_type', () => {
      const result = InferredPressure.validate({ ...validPressureData, pressure_type: 'invalid' as any });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Pressure type must be one of: economic, social, environmental, political');
    });

    it('should reject missing evidence', () => {
      const { evidence, ...dataWithoutEvidence } = validPressureData;
      const result = InferredPressure.validate(dataWithoutEvidence);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Evidence is required');
    });

    it('should reject non-array evidence', () => {
      const result = InferredPressure.validate({ ...validPressureData, evidence: 'not an array' as any });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Evidence must be an array');
    });

    it('should reject empty string evidence items', () => {
      const result = InferredPressure.validate({ 
        ...validPressureData, 
        evidence: ['Valid evidence', '', 'Another valid evidence'] 
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Evidence item at index 1 must be a non-empty string');
    });

    it('should reject non-string evidence items', () => {
      const result = InferredPressure.validate({ 
        ...validPressureData, 
        evidence: ['Valid evidence', 123 as any, 'Another valid evidence'] 
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Evidence item at index 1 must be a non-empty string');
    });

    it('should collect multiple validation errors', () => {
      const result = InferredPressure.validate({
        description: '',
        confidence_score: 1.5,
        pressure_type: 'invalid' as any,
        evidence: 'not an array' as any
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('InferredPressure Creation Validation', () => {
    it('should throw error when creating pressure with invalid data', () => {
      expect(() => {
        new InferredPressure({ ...validPressureData, description: '' });
      }).toThrow('InferredPressure validation failed: Description is required and must be a non-empty string');
    });

    it('should throw error with multiple validation messages', () => {
      expect(() => {
        new InferredPressure({
          description: '',
          confidence_score: 1.5,
          pressure_type: 'economic',
          evidence: ['Valid evidence']
        });
      }).toThrow('InferredPressure validation failed');
    });
  });

  describe('Confidence Assessment Methods', () => {
    it('should identify tentative pressure with default threshold', () => {
      const lowConfidencePressure = new InferredPressure({
        ...validPressureData,
        confidence_score: 0.3
      });
      
      expect(lowConfidencePressure.isTentative()).toBe(true);
      expect(lowConfidencePressure.isHighConfidence()).toBe(false);
    });

    it('should identify high confidence pressure with default threshold', () => {
      const highConfidencePressure = new InferredPressure({
        ...validPressureData,
        confidence_score: 0.9
      });
      
      expect(highConfidencePressure.isTentative()).toBe(false);
      expect(highConfidencePressure.isHighConfidence()).toBe(true);
    });

    it('should use custom thresholds for confidence assessment', () => {
      const pressure = new InferredPressure({
        ...validPressureData,
        confidence_score: 0.6
      });
      
      expect(pressure.isTentative(0.7)).toBe(true);
      expect(pressure.isTentative(0.5)).toBe(false);
      expect(pressure.isHighConfidence(0.5)).toBe(true);
      expect(pressure.isHighConfidence(0.7)).toBe(false);
    });

    it('should handle boundary cases for confidence thresholds', () => {
      const pressure = new InferredPressure({
        ...validPressureData,
        confidence_score: 0.5
      });
      
      expect(pressure.isTentative(0.5)).toBe(false); // exactly at threshold
      expect(pressure.isHighConfidence(0.5)).toBe(true); // exactly at threshold
    });
  });

  describe('Evidence Management', () => {
    it('should add new evidence without changing confidence', () => {
      const originalPressure = new InferredPressure(validPressureData);
      const newEvidence = ['New evidence item 1', 'New evidence item 2'];
      
      const updatedPressure = originalPressure.addEvidence(newEvidence);
      
      expect(updatedPressure.evidence).toHaveLength(5);
      expect(updatedPressure.evidence).toContain('New evidence item 1');
      expect(updatedPressure.evidence).toContain('New evidence item 2');
      expect(updatedPressure.confidence_score).toBe(originalPressure.confidence_score);
      expect(updatedPressure.id).toBe(originalPressure.id);
    });

    it('should add new evidence with updated confidence', () => {
      const originalPressure = new InferredPressure(validPressureData);
      const newEvidence = ['Strong supporting evidence'];
      const newConfidence = 0.95;
      
      const updatedPressure = originalPressure.addEvidence(newEvidence, newConfidence);
      
      expect(updatedPressure.evidence).toHaveLength(4);
      expect(updatedPressure.evidence).toContain('Strong supporting evidence');
      expect(updatedPressure.confidence_score).toBe(newConfidence);
    });

    it('should not modify original pressure when adding evidence', () => {
      const originalPressure = new InferredPressure(validPressureData);
      const originalEvidenceLength = originalPressure.evidence.length;
      const originalConfidence = originalPressure.confidence_score;
      
      originalPressure.addEvidence(['New evidence'], 0.95);
      
      expect(originalPressure.evidence).toHaveLength(originalEvidenceLength);
      expect(originalPressure.confidence_score).toBe(originalConfidence);
    });
  });

  describe('InferredPressure Update', () => {
    it('should create updated pressure with new description', () => {
      const originalPressure = new InferredPressure(validPressureData);
      const updatedPressure = originalPressure.update({ description: 'Updated economic pressure description' });

      expect(updatedPressure.description).toBe('Updated economic pressure description');
      expect(updatedPressure.confidence_score).toBe(originalPressure.confidence_score);
      expect(updatedPressure.pressure_type).toBe(originalPressure.pressure_type);
      expect(updatedPressure.evidence).toEqual(originalPressure.evidence);
      expect(updatedPressure.id).toBe(originalPressure.id);
    });

    it('should create updated pressure with multiple changes', () => {
      const originalPressure = new InferredPressure(validPressureData);
      const newEvidence = ['Updated evidence 1', 'Updated evidence 2'];
      const updatedPressure = originalPressure.update({
        description: 'Updated Description',
        confidence_score: 0.75,
        pressure_type: 'social',
        evidence: newEvidence
      });

      expect(updatedPressure.description).toBe('Updated Description');
      expect(updatedPressure.confidence_score).toBe(0.75);
      expect(updatedPressure.pressure_type).toBe('social');
      expect(updatedPressure.evidence).toEqual(newEvidence);
      expect(updatedPressure.id).toBe(originalPressure.id);
    });

    it('should validate updated pressure data', () => {
      const originalPressure = new InferredPressure(validPressureData);
      
      expect(() => {
        originalPressure.update({ description: '' });
      }).toThrow('InferredPressure validation failed');
    });

    it('should validate confidence score in updated pressure', () => {
      const originalPressure = new InferredPressure(validPressureData);
      
      expect(() => {
        originalPressure.update({ confidence_score: 1.5 });
      }).toThrow('InferredPressure validation failed');
    });
  });

  describe('InferredPressure Serialization', () => {
    it('should convert pressure to JSON', () => {
      const pressure = new InferredPressure(validPressureData);
      const json = pressure.toJSON();

      expect(json).toEqual({
        id: pressure.id,
        description: 'Economic instability due to war costs',
        confidence_score: 0.85,
        pressure_type: 'economic',
        evidence: [
          'Rising national debt from military expenditures',
          'Inflation due to currency debasement',
          'Trade disruptions affecting commerce'
        ]
      });
    });

    it('should return a copy of evidence array in JSON', () => {
      const pressure = new InferredPressure(validPressureData);
      const json = pressure.toJSON();
      
      // Modify the returned evidence array
      json.evidence.push('Modified evidence');
      
      // Original pressure should not be affected
      expect(pressure.evidence).not.toContain('Modified evidence');
      expect(pressure.evidence).toHaveLength(3);
    });
  });

  describe('Interface Compatibility', () => {
    it('should be compatible with IInferredPressure interface', () => {
      const pressure = new InferredPressure(validPressureData);
      const pressureInterface: IInferredPressure = pressure;

      expect(pressureInterface.id).toBe(pressure.id);
      expect(pressureInterface.description).toBe(pressure.description);
      expect(pressureInterface.confidence_score).toBe(pressure.confidence_score);
      expect(pressureInterface.pressure_type).toBe(pressure.pressure_type);
      expect(pressureInterface.evidence).toEqual(pressure.evidence);
    });
  });

  describe('PressureType Validation', () => {
    const pressureTypes: PressureType[] = ['economic', 'social', 'environmental', 'political'];
    
    pressureTypes.forEach(type => {
      it(`should accept ${type} as valid pressure type`, () => {
        const pressure = new InferredPressure({
          ...validPressureData,
          pressure_type: type
        });
        
        expect(pressure.pressure_type).toBe(type);
      });
    });
  });
});