import { describe, it, expect } from 'vitest';
import { 
  TemporalConstraintError, 
  CausalParadoxError, 
  ValidationError,
  ErrorHandler 
} from './errors';

describe('Error Classes', () => {
  it('should create TemporalConstraintError correctly', () => {
    const error = new TemporalConstraintError(
      'Event outside arc bounds',
      'event-1',
      'arc-1',
      new Date('1805-01-01'),
      { start: new Date('1800-01-01'), end: new Date('1804-12-31') }
    );

    expect(error.message).toBe('Event outside arc bounds');
    expect(error.statusCode).toBe(400);
    expect(error.isOperational).toBe(true);
    expect(error.eventId).toBe('event-1');
    expect(error.arcId).toBe('arc-1');
  });

  it('should create CausalParadoxError correctly', () => {
    const error = new CausalParadoxError(
      'Effect precedes cause',
      'cause-1',
      'effect-1',
      new Date('1805-01-02'),
      new Date('1805-01-01')
    );

    expect(error.message).toBe('Effect precedes cause');
    expect(error.statusCode).toBe(400);
    expect(error.isOperational).toBe(true);
    expect(error.causeId).toBe('cause-1');
    expect(error.effectId).toBe('effect-1');
  });

  it('should create ValidationError correctly', () => {
    const error = new ValidationError(
      'Invalid field value',
      'timestamp',
      'invalid-date',
      ['Timestamp must be a valid Date']
    );

    expect(error.message).toBe('Invalid field value');
    expect(error.statusCode).toBe(400);
    expect(error.isOperational).toBe(true);
    expect(error.field).toBe('timestamp');
    expect(error.validationErrors).toEqual(['Timestamp must be a valid Date']);
  });
});

describe('ErrorHandler', () => {
  it('should identify operational errors correctly', () => {
    const operationalError = new ValidationError('Test error');
    const programmingError = new Error('Programming error');

    expect(ErrorHandler.isOperationalError(operationalError)).toBe(true);
    expect(ErrorHandler.isOperationalError(programmingError)).toBe(false);
  });

  it('should format error response correctly', () => {
    const error = new ValidationError('Invalid input', 'name', 'test');
    const response = ErrorHandler.formatErrorResponse(error);

    expect(response.message).toBe('Invalid input');
    expect(response.statusCode).toBe(400);
    expect(response.details).toBeDefined();
  });

  it('should handle unknown errors safely', () => {
    const error = new Error('Unknown error');
    const response = ErrorHandler.formatErrorResponse(error);

    expect(response.message).toBe('Internal server error');
    expect(response.statusCode).toBe(500);
    expect(response.details).toBeUndefined();
  });
});