import { describe, it, expect } from 'vitest';
import { ValidationService } from './ValidationService';
import { CreateEventRequest, CreateArcRequest } from '@/models';

describe('ValidationService', () => {
  const validationService = new ValidationService();

  describe('validateCreateEvent', () => {
    it('should validate valid event request', () => {
      const request: CreateEventRequest = {
        description: 'Battle of Austerlitz',
        actor: 'Napoleon Bonaparte',
        target: 'Coalition Forces',
        timestamp: new Date('1805-12-02')
      };

      const result = validationService.validateCreateEvent(request);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject event with missing required fields', () => {
      const request: CreateEventRequest = {
        description: '',
        actor: '',
        target: '',
        timestamp: new Date('1805-12-02')
      };

      const result = validationService.validateCreateEvent(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Description is required and cannot be empty');
      expect(result.errors).toContain('Actor is required and cannot be empty');
      expect(result.errors).toContain('Target is required and cannot be empty');
    });

    it('should reject event with invalid timestamp', () => {
      const request: CreateEventRequest = {
        description: 'Test event',
        actor: 'Test actor',
        target: 'Test target',
        timestamp: new Date('invalid-date')
      };

      const result = validationService.validateCreateEvent(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Timestamp must be a valid Date object');
    });
  });

  describe('validateCreateArc', () => {
    it('should validate valid arc request', () => {
      const request: CreateArcRequest = {
        name: 'Napoleonic Wars',
        description: 'Series of conflicts involving Napoleon',
        start_time: new Date('1803-05-18'),
        end_time: new Date('1815-11-20'),
        level: 0
      };

      const result = validationService.validateCreateArc(request);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject arc with invalid time range', () => {
      const request: CreateArcRequest = {
        name: 'Invalid Arc',
        start_time: new Date('1815-11-20'),
        end_time: new Date('1803-05-18'), // End before start
        level: 0
      };

      const result = validationService.validateCreateArc(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Start time must be before end time');
    });

    it('should reject arc with negative level', () => {
      const request: CreateArcRequest = {
        name: 'Test Arc',
        start_time: new Date('1800-01-01'),
        end_time: new Date('1810-01-01'),
        level: -1
      };

      const result = validationService.validateCreateArc(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Level must be non-negative');
    });
  });
});