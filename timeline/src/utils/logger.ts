/**
 * Structured Logger utility for consistent logging across the application.
 * 
 * Features:
 * - Structured JSON output for production
 * - Human-readable output for development
 * - Log levels: debug, info, warn, error
 * - Context support for adding metadata
 * - Child loggers for component-specific logging
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface ILogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error | unknown, context?: LogContext): void;
  child(defaultContext: LogContext): ILogger;
}

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  /** Minimum log level to output */
  minLevel?: LogLevel;
  /** Use JSON format for output (default: based on NODE_ENV) */
  jsonFormat?: boolean;
  /** Default context to include in all log entries */
  defaultContext?: LogContext;
  /** Custom output function (defaults to console) */
  output?: (entry: LogEntry) => void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Structured Logger implementation
 */
export class Logger implements ILogger {
  private readonly minLevel: LogLevel;
  private readonly jsonFormat: boolean;
  private readonly defaultContext: LogContext;
  private readonly output: (entry: LogEntry) => void;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.minLevel ?? (process.env.LOG_LEVEL as LogLevel) ?? 'info';
    this.jsonFormat = options.jsonFormat ?? process.env.NODE_ENV === 'production';
    this.defaultContext = options.defaultContext ?? {};
    this.output = options.output ?? this.defaultOutput.bind(this);
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  /**
   * Log an error message with optional error object
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorInfo = this.extractErrorInfo(error);
    this.log('error', message, context, errorInfo);
  }

  /**
   * Create a child logger with additional default context
   */
  child(additionalContext: LogContext): ILogger {
    return new Logger({
      minLevel: this.minLevel,
      jsonFormat: this.jsonFormat,
      defaultContext: { ...this.defaultContext, ...additionalContext },
      output: this.output,
    });
  }

  private log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: LogEntry['error']
  ): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
    };

    const mergedContext = { ...this.defaultContext, ...context };
    if (Object.keys(mergedContext).length > 0) {
      entry.context = mergedContext;
    }

    if (error) {
      entry.error = error;
    }

    this.output(entry);
  }

  private extractErrorInfo(error: Error | unknown): LogEntry['error'] | undefined {
    if (!error) {
      return undefined;
    }

    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    // Handle non-Error objects
    if (typeof error === 'object' && error !== null) {
      const errObj = error as Record<string, unknown>;
      return {
        name: String(errObj.name ?? 'UnknownError'),
        message: String(errObj.message ?? JSON.stringify(error)),
        stack: errObj.stack ? String(errObj.stack) : undefined,
      };
    }

    return {
      name: 'UnknownError',
      message: String(error),
    };
  }

  private defaultOutput(entry: LogEntry): void {
    if (this.jsonFormat) {
      this.outputJson(entry);
    } else {
      this.outputHuman(entry);
    }
  }

  private outputJson(entry: LogEntry): void {
    const output = JSON.stringify(entry);
    switch (entry.level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }

  private outputHuman(entry: LogEntry): void {
    const levelColors: Record<LogLevel, string> = {
      debug: '\x1b[36m', // cyan
      info: '\x1b[32m',  // green
      warn: '\x1b[33m',  // yellow
      error: '\x1b[31m', // red
    };
    const reset = '\x1b[0m';
    const dim = '\x1b[2m';

    const levelStr = `${levelColors[entry.level]}[${entry.level.toUpperCase()}]${reset}`;
    const timeStr = `${dim}${entry.timestamp}${reset}`;
    
    let output = `${timeStr} ${levelStr} ${entry.message}`;

    if (entry.context && Object.keys(entry.context).length > 0) {
      output += ` ${dim}${JSON.stringify(entry.context)}${reset}`;
    }

    switch (entry.level) {
      case 'error':
        console.error(output);
        if (entry.error?.stack) {
          console.error(`${dim}${entry.error.stack}${reset}`);
        }
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }
}

/**
 * Default logger instance for the application
 */
export const logger = new Logger();

/**
 * Create a logger for a specific component/service
 */
export function createLogger(component: string, additionalContext?: LogContext): ILogger {
  return logger.child({ component, ...additionalContext });
}

/**
 * Silent logger for testing - suppresses all output
 */
export class SilentLogger implements ILogger {
  debug(): void { /* noop */ }
  info(): void { /* noop */ }
  warn(): void { /* noop */ }
  error(): void { /* noop */ }
  child(): ILogger { return this; }
}

/**
 * Create a silent logger instance (useful for tests)
 */
export const silentLogger = new SilentLogger();
