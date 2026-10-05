/**
 * Base error class for the application
 */
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly isOperational: boolean;

  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    
    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Temporal constraint violation error
 */
export class TemporalConstraintError extends AppError {
  readonly statusCode = 400;
  readonly isOperational = true;

  constructor(
    message: string,
    public readonly eventId?: string,
    public readonly arcId?: string,
    public readonly eventTime?: Date,
    public readonly arcBounds?: { start: Date; end: Date }
  ) {
    super(message);
  }
}

/**
 * Causal paradox error
 */
export class CausalParadoxError extends AppError {
  readonly statusCode = 400;
  readonly isOperational = true;

  constructor(
    message: string,
    public readonly causeId?: string,
    public readonly effectId?: string,
    public readonly causeTime?: Date,
    public readonly effectTime?: Date
  ) {
    super(message);
  }
}

/**
 * Validation error for invalid input data
 */
export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly isOperational = true;

  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: any,
    public readonly validationErrors?: string[]
  ) {
    super(message);
  }
}

/**
 * Resource not found error
 */
export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly isOperational = true;

  constructor(
    message: string,
    public readonly resourceType?: string,
    public readonly resourceId?: string
  ) {
    super(message);
  }
}

/**
 * Database operation error
 */
export class DatabaseError extends AppError {
  readonly statusCode = 500;
  readonly isOperational = true;

  constructor(
    message: string,
    public readonly operation?: string,
    cause?: Error
  ) {
    super(message, cause);
  }
}

/**
 * Performance constraint error (queries taking too long)
 */
export class PerformanceError extends AppError {
  readonly statusCode = 408;
  readonly isOperational = true;

  constructor(
    message: string,
    public readonly operation?: string,
    public readonly duration?: number,
    public readonly threshold?: number
  ) {
    super(message);
  }
}

/**
 * Integrity constraint error
 */
export class IntegrityError extends AppError {
  readonly statusCode = 409;
  readonly isOperational = true;

  constructor(
    message: string,
    public readonly constraintType?: string,
    public readonly violatedConstraint?: string
  ) {
    super(message);
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends AppError {
  readonly statusCode = 500;
  readonly isOperational = false;

  constructor(
    message: string,
    public readonly configKey?: string,
    cause?: Error
  ) {
    super(message, cause);
  }
}

/**
 * Database connection error
 */
export class DatabaseConnectionError extends AppError {
  readonly statusCode = 503;
  readonly isOperational = true;

  constructor(message: string, cause?: Error) {
    super(message, cause);
  }
}

/**
 * Local storage error for file system operations
 */
export class LocalStorageError extends AppError {
  readonly statusCode = 500;
  readonly isOperational = true;

  constructor(
    message: string,
    public readonly operation?: string,
    public readonly filePath?: string,
    cause?: Error
  ) {
    super(message, cause);
  }
}

/**
 * Data corruption error for local storage
 */
export class DataCorruptionError extends AppError {
  readonly statusCode = 500;
  readonly isOperational = true;

  constructor(
    message: string,
    public readonly filePath?: string,
    public readonly corruptionType?: string,
    public readonly expectedChecksum?: string,
    public readonly actualChecksum?: string,
    cause?: Error
  ) {
    super(message, cause);
  }
}

/**
 * Insufficient storage space error
 */
export class InsufficientStorageError extends AppError {
  readonly statusCode = 507;
  readonly isOperational = true;

  constructor(
    message: string,
    public readonly requiredSpace?: number,
    public readonly availableSpace?: number,
    public readonly operation?: string
  ) {
    super(message);
  }
}

/**
 * Local execution mode configuration error
 */
export class LocalExecutionError extends AppError {
  readonly statusCode = 500;
  readonly isOperational = true;

  constructor(
    message: string,
    public readonly component?: string,
    public readonly configIssue?: string,
    cause?: Error
  ) {
    super(message, cause);
  }
}

/**
 * Migration error for data migration operations
 */
export class MigrationError extends AppError {
  readonly statusCode = 500;
  readonly isOperational = true;

  constructor(
    message: string,
    public readonly migrationType?: 'export' | 'import',
    public readonly stage?: string,
    public readonly processedCount?: number,
    public readonly totalCount?: number,
    cause?: Error
  ) {
    super(message, cause);
  }
}

/**
 * Backup operation error
 */
export class BackupError extends AppError {
  readonly statusCode = 500;
  readonly isOperational = true;

  constructor(
    message: string,
    public readonly backupPath?: string,
    public readonly operation?: 'create' | 'restore' | 'verify' | 'list' | 'delete',
    cause?: Error
  ) {
    super(message, cause);
  }
}

/**
 * Recovery operation error
 */
export class RecoveryError extends AppError {
  readonly statusCode = 500;
  readonly isOperational = true;

  constructor(
    message: string,
    public readonly recoveryType?: 'automatic' | 'manual',
    public readonly backupSource?: string,
    public readonly failedOperation?: string,
    cause?: Error
  ) {
    super(message, cause);
  }
}

/**
 * Error handler utility functions
 */
export class ErrorHandler {
  /**
   * Check if error is operational (expected) or programming error
   */
  static isOperationalError(error: Error): boolean {
    if (error instanceof AppError) {
      return error.isOperational;
    }
    return false;
  }

  /**
   * Format error for API response
   */
  static formatErrorResponse(error: Error): {
    message: string;
    statusCode: number;
    details?: any;
  } {
    if (error instanceof AppError) {
      return {
        message: error.message,
        statusCode: error.statusCode,
        details: this.getErrorDetails(error),
      };
    }

    // Unknown error - don't expose internal details
    return {
      message: 'Internal server error',
      statusCode: 500,
    };
  }

  /**
   * Get error-specific details for debugging
   */
  private static getErrorDetails(error: AppError): any {
    const details: any = {};

    if (error instanceof TemporalConstraintError) {
      details.eventId = error.eventId;
      details.arcId = error.arcId;
      details.eventTime = error.eventTime;
      details.arcBounds = error.arcBounds;
    } else if (error instanceof CausalParadoxError) {
      details.causeId = error.causeId;
      details.effectId = error.effectId;
      details.causeTime = error.causeTime;
      details.effectTime = error.effectTime;
    } else if (error instanceof ValidationError) {
      details.field = error.field;
      details.value = error.value;
      details.validationErrors = error.validationErrors;
    } else if (error instanceof NotFoundError) {
      details.resourceType = error.resourceType;
      details.resourceId = error.resourceId;
    } else if (error instanceof DatabaseError) {
      details.operation = error.operation;
    } else if (error instanceof PerformanceError) {
      details.operation = error.operation;
      details.duration = error.duration;
      details.threshold = error.threshold;
    } else if (error instanceof IntegrityError) {
      details.constraintType = error.constraintType;
      details.violatedConstraint = error.violatedConstraint;
    } else if (error instanceof LocalStorageError) {
      details.operation = error.operation;
      details.filePath = error.filePath;
    } else if (error instanceof DataCorruptionError) {
      details.filePath = error.filePath;
      details.corruptionType = error.corruptionType;
      details.expectedChecksum = error.expectedChecksum;
      details.actualChecksum = error.actualChecksum;
    } else if (error instanceof InsufficientStorageError) {
      details.requiredSpace = error.requiredSpace;
      details.availableSpace = error.availableSpace;
      details.operation = error.operation;
    } else if (error instanceof LocalExecutionError) {
      details.component = error.component;
      details.configIssue = error.configIssue;
    } else if (error instanceof MigrationError) {
      details.migrationType = error.migrationType;
      details.stage = error.stage;
      details.processedCount = error.processedCount;
      details.totalCount = error.totalCount;
    } else if (error instanceof BackupError) {
      details.backupPath = error.backupPath;
      details.operation = error.operation;
    } else if (error instanceof RecoveryError) {
      details.recoveryType = error.recoveryType;
      details.backupSource = error.backupSource;
      details.failedOperation = error.failedOperation;
    }

    return Object.keys(details).length > 0 ? details : undefined;
  }
}