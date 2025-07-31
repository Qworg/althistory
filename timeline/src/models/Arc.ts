/**
 * Arc represents a historical phase or period that can contain events and other arcs
 */
export interface IArc {
  /** Unique identifier for the arc */
  id: string;
  
  /** Human-readable name for the arc */
  name: string;
  
  /** Optional detailed description of the arc */
  description?: string;
  
  /** Start time of the arc */
  start_time: Date;
  
  /** End time of the arc */
  end_time: Date;
  
  /** Hierarchy level for nesting (0 = top level) */
  level: number;
  
  /** Additional metadata for the arc */
  metadata?: Record<string, any>;
}

/**
 * Arc class with temporal boundary validation
 */
export class Arc implements IArc {
  public readonly id: string;
  public readonly name: string;
  public readonly description?: string;
  public readonly start_time: Date;
  public readonly end_time: Date;
  public readonly level: number;
  public readonly metadata?: Record<string, any>;

  constructor(data: CreateArcRequest & { id?: string }) {
    // Generate ID if not provided
    this.id = data.id || this.generateId();
    
    // Validate and assign properties
    const validation = Arc.validate(data);
    if (!validation.isValid) {
      throw new Error(`Arc validation failed: ${validation.errors.join(', ')}`);
    }

    this.name = data.name.trim();
    this.description = data.description?.trim();
    this.start_time = new Date(data.start_time);
    this.end_time = new Date(data.end_time);
    this.level = data.level;
    this.metadata = data.metadata;
  }

  /**
   * Validates arc data including temporal boundaries
   */
  static validate(data: Partial<CreateArcRequest>): ArcValidationResult {
    const errors: string[] = [];

    // Required field validation
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      errors.push('Name is required and must be a non-empty string');
    }

    // Start time validation
    if (!data.start_time) {
      errors.push('Start time is required');
    } else {
      const startTime = new Date(data.start_time);
      if (isNaN(startTime.getTime())) {
        errors.push('Start time must be a valid date');
      }
    }

    // End time validation
    if (!data.end_time) {
      errors.push('End time is required');
    } else {
      const endTime = new Date(data.end_time);
      if (isNaN(endTime.getTime())) {
        errors.push('End time must be a valid date');
      }
    }

    // Temporal boundary validation (start_time < end_time)
    if (data.start_time && data.end_time) {
      const startTime = new Date(data.start_time);
      const endTime = new Date(data.end_time);
      
      if (!isNaN(startTime.getTime()) && !isNaN(endTime.getTime())) {
        if (startTime >= endTime) {
          errors.push('Start time must be before end time');
        }
      }
    }

    // Level validation
    if (data.level === undefined || data.level === null) {
      errors.push('Level is required');
    } else if (typeof data.level !== 'number' || !Number.isInteger(data.level) || data.level < 0) {
      errors.push('Level must be a non-negative integer');
    }

    // Description validation (if provided)
    if (data.description !== undefined && (typeof data.description !== 'string')) {
      errors.push('Description must be a string');
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
   * Validates if this arc can contain another arc (child arc must be completely within parent)
   */
  canContainArc(childArc: Arc): boolean {
    return this.start_time <= childArc.start_time && this.end_time >= childArc.end_time;
  }

  /**
   * Validates if this arc overlaps with another arc
   */
  overlapsWith(otherArc: Arc): boolean {
    return this.start_time < otherArc.end_time && this.end_time > otherArc.start_time;
  }

  /**
   * Validates if a timestamp falls within this arc's boundaries
   */
  containsTimestamp(timestamp: Date): boolean {
    return timestamp >= this.start_time && timestamp <= this.end_time;
  }

  /**
   * Gets the duration of this arc in milliseconds
   */
  getDuration(): number {
    return this.end_time.getTime() - this.start_time.getTime();
  }

  /**
   * Creates a copy of this arc with updated properties
   */
  update(updates: UpdateArcRequest): Arc {
    return new Arc({
      id: this.id,
      name: updates.name ?? this.name,
      description: updates.description ?? this.description,
      start_time: updates.start_time ?? this.start_time,
      end_time: updates.end_time ?? this.end_time,
      level: updates.level ?? this.level,
      metadata: updates.metadata ?? this.metadata
    });
  }

  /**
   * Converts the arc to a plain object
   */
  toJSON(): IArc {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      start_time: this.start_time,
      end_time: this.end_time,
      level: this.level,
      metadata: this.metadata
    };
  }

  /**
   * Generates a unique ID for the arc
   */
  private generateId(): string {
    return `arc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Interface for creating new arcs
 */
export interface CreateArcRequest {
  name: string;
  description?: string;
  start_time: Date;
  end_time: Date;
  level: number;
  metadata?: Record<string, any>;
}

/**
 * Interface for updating existing arcs
 */
export interface UpdateArcRequest {
  name?: string;
  description?: string;
  start_time?: Date;
  end_time?: Date;
  level?: number;
  metadata?: Record<string, any>;
}

/**
 * Arc validation result
 */
export interface ArcValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Arc hierarchy validation result
 */
export interface ArcHierarchyValidation {
  isValid: boolean;
  parentArc?: Arc;
  childArcs: Arc[];
  violations: string[];
}