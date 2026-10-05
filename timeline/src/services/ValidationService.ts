import { 
  Event, 
  Arc, 
  InferredPressure,
  CreateEventRequest,
  CreateArcRequest,
  CreateInferredPressureRequest,
  EventValidationResult,
  ArcValidationResult,
  PressureValidationResult
} from '@/models';
import { CausalRelationship, CausalValidationResult } from '@/models/relationships';
import { ValidationError } from '@/utils/errors';

/**
 * Service for validating domain objects and business rules
 */
export class ValidationService {
  /**
   * Validate event creation request
   */
  validateCreateEvent(request: CreateEventRequest): EventValidationResult {
    const errors: string[] = [];

    // Required field validation
    if (!request.description || request.description.trim().length === 0) {
      errors.push('Description is required and cannot be empty');
    }

    if (!request.actor || request.actor.trim().length === 0) {
      errors.push('Actor is required and cannot be empty');
    }

    if (!request.target || request.target.trim().length === 0) {
      errors.push('Target is required and cannot be empty');
    }

    if (!request.timestamp) {
      errors.push('Timestamp is required');
    } else if (!(request.timestamp instanceof Date) || isNaN(request.timestamp.getTime())) {
      errors.push('Timestamp must be a valid Date object');
    }

    // Length validation
    if (request.description && request.description.length > 1000) {
      errors.push('Description cannot exceed 1000 characters');
    }

    if (request.actor && request.actor.length > 200) {
      errors.push('Actor name cannot exceed 200 characters');
    }

    if (request.target && request.target.length > 200) {
      errors.push('Target name cannot exceed 200 characters');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate arc creation request
   */
  validateCreateArc(request: CreateArcRequest): ArcValidationResult {
    const errors: string[] = [];

    // Required field validation
    if (!request.name || request.name.trim().length === 0) {
      errors.push('Name is required and cannot be empty');
    }

    if (!request.start_time) {
      errors.push('Start time is required');
    } else if (!(request.start_time instanceof Date) || isNaN(request.start_time.getTime())) {
      errors.push('Start time must be a valid Date object');
    }

    if (!request.end_time) {
      errors.push('End time is required');
    } else if (!(request.end_time instanceof Date) || isNaN(request.end_time.getTime())) {
      errors.push('End time must be a valid Date object');
    }

    if (typeof request.level !== 'number') {
      errors.push('Level is required and must be a number');
    } else if (request.level < 0) {
      errors.push('Level must be non-negative');
    } else if (!Number.isInteger(request.level)) {
      errors.push('Level must be an integer');
    }

    // Temporal validation
    if (request.start_time && request.end_time && 
        request.start_time instanceof Date && request.end_time instanceof Date &&
        !isNaN(request.start_time.getTime()) && !isNaN(request.end_time.getTime())) {
      if (request.start_time.getTime() >= request.end_time.getTime()) {
        errors.push('Start time must be before end time');
      }
    }

    // Length validation
    if (request.name && request.name.length > 200) {
      errors.push('Name cannot exceed 200 characters');
    }

    if (request.description && request.description.length > 1000) {
      errors.push('Description cannot exceed 1000 characters');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate inferred pressure creation request
   */
  validateCreateInferredPressure(request: CreateInferredPressureRequest): PressureValidationResult {
    const errors: string[] = [];

    // Required field validation
    if (!request.description || request.description.trim().length === 0) {
      errors.push('Description is required and cannot be empty');
    }

    if (typeof request.confidence_score !== 'number') {
      errors.push('Confidence score is required and must be a number');
    } else if (request.confidence_score < 0.0 || request.confidence_score > 1.0) {
      errors.push('Confidence score must be between 0.0 and 1.0');
    }

    if (!request.pressure_type) {
      errors.push('Pressure type is required');
    } else if (!['economic', 'social', 'environmental', 'political'].includes(request.pressure_type)) {
      errors.push('Pressure type must be one of: economic, social, environmental, political');
    }

    if (!Array.isArray(request.evidence)) {
      errors.push('Evidence must be an array');
    } else if (request.evidence.length === 0) {
      errors.push('At least one piece of evidence is required');
    } else {
      request.evidence.forEach((evidence, index) => {
        if (typeof evidence !== 'string' || evidence.trim().length === 0) {
          errors.push(`Evidence item ${index + 1} must be a non-empty string`);
        }
      });
    }

    // Length validation
    if (request.description && request.description.length > 1000) {
      errors.push('Description cannot exceed 1000 characters');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate causal relationship
   */
  validateCausalRelationship(relationship: CausalRelationship): CausalValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Weight validation
    if (typeof relationship.weight !== 'number') {
      errors.push('Weight must be a number');
    } else if (relationship.weight < 0.0 || relationship.weight > 1.0) {
      errors.push('Weight must be between 0.0 and 1.0');
    } else if (relationship.weight < 0.1) {
      warnings.push('Very low weight (< 0.1) may indicate weak causal relationship');
    }

    // Confidence validation
    if (typeof relationship.confidence !== 'number') {
      errors.push('Confidence must be a number');
    } else if (relationship.confidence < 0.0 || relationship.confidence > 1.0) {
      errors.push('Confidence must be between 0.0 and 1.0');
    } else if (relationship.confidence < 0.3) {
      warnings.push('Low confidence (< 0.3) may indicate uncertain causal relationship');
    }

    // Evidence validation
    if (!relationship.evidence || relationship.evidence.trim().length === 0) {
      errors.push('Evidence is required and cannot be empty');
    } else if (relationship.evidence.length > 500) {
      errors.push('Evidence cannot exceed 500 characters');
    }

    // Relationship type validation
    if (!relationship.relationship_type) {
      errors.push('Relationship type is required');
    } else if (!['direct', 'indirect', 'contributory'].includes(relationship.relationship_type)) {
      errors.push('Relationship type must be one of: direct, indirect, contributory');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate that an event object is complete and valid
   */
  validateEvent(event: Event): EventValidationResult {
    const errors: string[] = [];

    if (!event.id || event.id.trim().length === 0) {
      errors.push('Event ID is required');
    }

    const createRequest: CreateEventRequest = {
      description: event.description,
      actor: event.actor,
      target: event.target,
      timestamp: event.timestamp,
      metadata: event.metadata
    };

    const createValidation = this.validateCreateEvent(createRequest);
    errors.push(...createValidation.errors);

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate that an arc object is complete and valid
   */
  validateArc(arc: Arc): ArcValidationResult {
    const errors: string[] = [];

    if (!arc.id || arc.id.trim().length === 0) {
      errors.push('Arc ID is required');
    }

    const createRequest: CreateArcRequest = {
      name: arc.name,
      description: arc.description,
      start_time: arc.start_time,
      end_time: arc.end_time,
      level: arc.level,
      metadata: arc.metadata
    };

    const createValidation = this.validateCreateArc(createRequest);
    errors.push(...createValidation.errors);

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate that an inferred pressure object is complete and valid
   */
  validateInferredPressure(pressure: InferredPressure): PressureValidationResult {
    const errors: string[] = [];

    if (!pressure.id || pressure.id.trim().length === 0) {
      errors.push('Inferred pressure ID is required');
    }

    const createRequest: CreateInferredPressureRequest = {
      description: pressure.description,
      confidence_score: pressure.confidence_score,
      pressure_type: pressure.pressure_type,
      evidence: pressure.evidence,
      metadata: pressure.metadata
    };

    const createValidation = this.validateCreateInferredPressure(createRequest);
    errors.push(...createValidation.errors);

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}