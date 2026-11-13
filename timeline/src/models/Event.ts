import { compareInstants, toAxisTime, toInstant } from '@althistory/calendar';

/**
 * Event represents a specific historical occurrence with precise temporal information
 */
export interface IEvent {
  /** Unique identifier for the event */
  id: string;
  
  /** Human-readable description of what happened */
  description: string;
  
  /** The entity or person who performed the action */
  actor: string;
  
  /** The entity or person who was affected by the action */
  target: string;
  
  /** Exact timestamp when the event occurred */
  timestamp: Date;

  /**
   * The same moment as a decimal string of milliseconds on the axis (an
   * `AxisTime`; JSON has no bigint). Exact at any distance from 1970.
   */
  timestamp_ms?: string;
  
  /** Additional metadata for the event */
  metadata?: Record<string, unknown>;
}

/**
 * Event class with validation methods
 */
export class Event implements IEvent {
  public readonly id: string;
  public readonly description: string;
  public readonly actor: string;
  public readonly target: string;
  public readonly timestamp: Date;
  public readonly metadata?: Record<string, unknown>;

  constructor(data: CreateEventRequest & { id?: string }) {
    // Generate ID if not provided
    this.id = data.id || this.generateId();
    
    // Validate and assign properties
    const validation = Event.validate(data);
    if (!validation.isValid) {
      throw new Error(`Event validation failed: ${validation.errors.join(', ')}`);
    }

    this.description = data.description.trim();
    this.actor = data.actor.trim();
    this.target = data.target.trim();
    this.timestamp = toInstant(data.timestamp);
    this.metadata = data.metadata;
  }

  /**
   * Validates event data
   */
  static validate(data: Partial<CreateEventRequest>): EventValidationResult {
    const errors: string[] = [];

    // Required field validation
    if (!data.description || typeof data.description !== 'string' || data.description.trim().length === 0) {
      errors.push('Description is required and must be a non-empty string');
    }

    if (!data.actor || typeof data.actor !== 'string' || data.actor.trim().length === 0) {
      errors.push('Actor is required and must be a non-empty string');
    }

    if (!data.target || typeof data.target !== 'string' || data.target.trim().length === 0) {
      errors.push('Target is required and must be a non-empty string');
    }

    // Timestamp validation
    if (!data.timestamp) {
      errors.push('Timestamp is required');
    } else {
      const timestamp = toInstant(data.timestamp);
      if (isNaN(timestamp.getTime())) {
        errors.push('Timestamp must be a valid date');
      }
    }

    // Metadata validation (if provided)
    if (data.metadata !== undefined && (typeof data.metadata !== 'object' || data.metadata === null || Array.isArray(data.metadata))) {
      errors.push('Metadata must be an object');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validates if this event's timestamp falls within the given time range
   */
  isWithinTimeRange(timeRange: TimeRange): boolean {
    return compareInstants(this.timestamp, timeRange.start) >= 0 && compareInstants(this.timestamp, timeRange.end) <= 0;
  }

  /**
   * Creates a copy of this event with updated properties
   */
  update(updates: UpdateEventRequest): Event {
    return new Event({
      id: this.id,
      description: updates.description ?? this.description,
      actor: updates.actor ?? this.actor,
      target: updates.target ?? this.target,
      timestamp: updates.timestamp ?? this.timestamp,
      metadata: updates.metadata ?? this.metadata
    });
  }

  /**
   * The event's moment on the axis, in milliseconds as a decimal string: exact
   * at any distance from 1970 (what the API, the CLI and the tools send as
   * `timestamp_ms`; JSON has no bigint).
   */
  get timestampMs(): string {
    return String(toAxisTime(this.timestamp));
  }

  /**
   * Converts the event to a plain object
   */
  toJSON(): IEvent {
    return {
      id: this.id,
      description: this.description,
      actor: this.actor,
      target: this.target,
      timestamp: this.timestamp,
      timestamp_ms: this.timestampMs,
      metadata: this.metadata
    };
  }

  /**
   * Generates a unique ID for the event
   */
  private generateId(): string {
    return `event_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

/**
 * Interface for creating new events
 */
export interface CreateEventRequest {
  id?: string;
  description: string;
  actor: string;
  target: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Interface for updating existing events
 */
export interface UpdateEventRequest {
  description?: string;
  actor?: string;
  target?: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Event validation result
 */
export interface EventValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Time range for querying events
 */
export interface TimeRange {
  start: Date;
  end: Date;
}