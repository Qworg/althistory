/**
 * Semantic Unix exit codes for the Althistory CLI.
 * Agent-first design ensures predictable error handling in automated loops.
 */
export enum ExitCode {
  /** Execution completed successfully */
  SUCCESS = 0,

  /** General application or operational error */
  GENERAL_ERROR = 1,

  /** Validation, temporal constraint, or causal paradox violation */
  VALIDATION_FAILED = 2,

  /** Authentication, permission, or API key validation error */
  AUTH_FAILED = 3,

  /** Target entity, graph, arc, or version not found */
  NOT_FOUND = 4,

  /** Connection refused, daemon unreachable, or network failure */
  CONNECTION_ERROR = 5,
}

export class CLIError extends Error {
  readonly exitCode: ExitCode;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, exitCode: ExitCode = ExitCode.GENERAL_ERROR, code: string = 'CLI_ERROR', details?: unknown) {
    super(message);
    this.name = 'CLIError';
    this.exitCode = exitCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationErrorCLI extends CLIError {
  constructor(message: string, details?: unknown) {
    super(message, ExitCode.VALIDATION_FAILED, 'VALIDATION_FAILED', details);
    this.name = 'ValidationErrorCLI';
  }
}

export class AuthErrorCLI extends CLIError {
  constructor(message: string, details?: unknown) {
    super(message, ExitCode.AUTH_FAILED, 'AUTH_FAILED', details);
    this.name = 'AuthErrorCLI';
  }
}

export class NotFoundErrorCLI extends CLIError {
  constructor(message: string, details?: unknown) {
    super(message, ExitCode.NOT_FOUND, 'NOT_FOUND', details);
    this.name = 'NotFoundErrorCLI';
  }
}

export class ConnectionErrorCLI extends CLIError {
  constructor(message: string, details?: unknown) {
    super(message, ExitCode.CONNECTION_ERROR, 'CONNECTION_ERROR', details);
    this.name = 'ConnectionErrorCLI';
  }
}
