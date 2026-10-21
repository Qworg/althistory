/**
 * Types of historical pressures that can be inferred
 */
export type PressureType = 'economic' | 'social' | 'environmental' | 'political';

/**
 * InferredPressure represents systemic forces driving historical events
 */
export interface IInferredPressure {
  /** Unique identifier for the pressure */
  id: string;
  
  /** Human-readable description of the pressure */
  description: string;
  
  /** Confidence score between 0.0 and 1.0 */
  confidence_score: number;
  
  /** Type of pressure */
  pressure_type: PressureType;
  
  /** Evidence supporting this pressure inference, as display strings */
  evidence: string[];

  /**
   * The ids of the events the inference rests on.
   *
   * `evidence` is a display string (`Event: ... (2024-01-01T...)`), which a
   * client cannot use to link the pressure to the events it came from. These
   * ids can.
   */
  evidence_event_ids: string[];

  /**
   * The period the pressure was inferred over.
   *
   * Without it a client cannot place the pressure in time; the period used to
   * appear only inside the description text.
   */
  time_range?: {
    start: string;
    end: string;
  };
}

/**
 * InferredPressure class with confidence scoring validation
 */
export class InferredPressure implements IInferredPressure {
  public readonly id: string;
  public readonly description: string;
  public readonly confidence_score: number;
  public readonly pressure_type: PressureType;
  public readonly evidence: string[];
  public readonly evidence_event_ids: string[];
  public readonly time_range?: { start: string; end: string };

  constructor(data: CreateInferredPressureRequest & { id?: string }) {
    // Generate ID if not provided
    this.id = data.id || this.generateId();
    
    // Validate and assign properties
    const validation = InferredPressure.validate(data);
    if (!validation.isValid) {
      throw new Error(`InferredPressure validation failed: ${validation.errors.join(', ')}`);
    }

    this.description = data.description.trim();
    this.confidence_score = data.confidence_score;
    this.pressure_type = data.pressure_type;
    this.evidence = [...data.evidence]; // Create a copy of the array
    this.evidence_event_ids = [...(data.evidence_event_ids ?? [])];
    this.time_range = data.time_range
      ? { start: data.time_range.start, end: data.time_range.end }
      : undefined;
  }

  /**
   * Validates inferred pressure data including confidence score bounds
   */
  static validate(data: Partial<CreateInferredPressureRequest>): PressureValidationResult {
    const errors: string[] = [];

    // Required field validation
    if (!data.description || typeof data.description !== 'string' || data.description.trim().length === 0) {
      errors.push('Description is required and must be a non-empty string');
    }

    // Confidence score validation (0.0 to 1.0)
    if (data.confidence_score === undefined || data.confidence_score === null) {
      errors.push('Confidence score is required');
    } else if (typeof data.confidence_score !== 'number' || isNaN(data.confidence_score)) {
      errors.push('Confidence score must be a valid number');
    } else if (data.confidence_score < 0.0 || data.confidence_score > 1.0) {
      errors.push('Confidence score must be between 0.0 and 1.0');
    }

    // Pressure type validation
    const validPressureTypes: PressureType[] = ['economic', 'social', 'environmental', 'political'];
    if (!data.pressure_type) {
      errors.push('Pressure type is required');
    } else if (!validPressureTypes.includes(data.pressure_type)) {
      errors.push(`Pressure type must be one of: ${validPressureTypes.join(', ')}`);
    }

    // Evidence validation
    if (!data.evidence) {
      errors.push('Evidence is required');
    } else if (!Array.isArray(data.evidence)) {
      errors.push('Evidence must be an array');
    } else {
      // Validate each evidence item
      data.evidence.forEach((item, index) => {
        if (typeof item !== 'string' || item.trim().length === 0) {
          errors.push(`Evidence item at index ${index} must be a non-empty string`);
        }
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Checks if this pressure is considered tentative (below confidence threshold)
   */
  isTentative(threshold: number = 0.5): boolean {
    return this.confidence_score < threshold;
  }

  /**
   * Checks if this pressure has high confidence
   */
  isHighConfidence(threshold: number = 0.8): boolean {
    return this.confidence_score >= threshold;
  }

  /**
   * Adds new evidence to the pressure and optionally updates confidence
   */
  addEvidence(newEvidence: string[], newConfidenceScore?: number): InferredPressure {
    const updatedEvidence = [...this.evidence, ...newEvidence];
    const updatedConfidence = newConfidenceScore ?? this.confidence_score;

    return new InferredPressure({
      id: this.id,
      description: this.description,
      confidence_score: updatedConfidence,
      pressure_type: this.pressure_type,
      evidence: updatedEvidence,
      // The evidence ids and the period belong to the pressure, so a copy
      // keeps them: dropping them left the copy claiming to rest on no events
      // and to cover no time.
      evidence_event_ids: this.evidence_event_ids,
      time_range: this.time_range
    });
  }

  /**
   * Creates a copy of this pressure with updated properties
   */
  update(updates: UpdateInferredPressureRequest): InferredPressure {
    return new InferredPressure({
      id: this.id,
      description: updates.description ?? this.description,
      confidence_score: updates.confidence_score ?? this.confidence_score,
      pressure_type: updates.pressure_type ?? this.pressure_type,
      evidence: updates.evidence ?? this.evidence,
      evidence_event_ids: this.evidence_event_ids,
      time_range: this.time_range
    });
  }

  /**
   * Converts the pressure to a plain object
   */
  toJSON(): IInferredPressure {
    return {
      id: this.id,
      description: this.description,
      confidence_score: this.confidence_score,
      pressure_type: this.pressure_type,
      evidence: [...this.evidence], // Return a copy of the array
      evidence_event_ids: [...this.evidence_event_ids],
      ...(this.time_range ? { time_range: { ...this.time_range } } : {})
    };
  }

  /**
   * Generates a unique ID for the pressure
   */
  private generateId(): string {
    return `pressure_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

/**
 * Interface for creating new inferred pressures
 */
export interface CreateInferredPressureRequest {
  description: string;
  confidence_score: number;
  pressure_type: PressureType;
  evidence: string[];
  /** The ids of the events the inference rests on. */
  evidence_event_ids?: string[];
  /** The period the pressure was inferred over. */
  time_range?: {
    start: string;
    end: string;
  };
}

/**
 * Interface for updating existing inferred pressures
 */
export interface UpdateInferredPressureRequest {
  description?: string;
  confidence_score?: number;
  pressure_type?: PressureType;
  evidence?: string[];
}

/**
 * Pressure validation result
 */
export interface PressureValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Pressure inference suggestion
 */
export interface PressureSuggestion {
  description: string;
  pressure_type: PressureType;
  confidence_score: number;
  supporting_events: string[]; // Event IDs
  evidence: string[];
}