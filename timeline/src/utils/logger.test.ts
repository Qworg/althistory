import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { Logger, SilentLogger, silentLogger, LogEntry, ILogger, MAX_LOG_STRING_LENGTH } from './logger';

/**
 * Signature of the spied `console` methods, so the mock instances keep the
 * argument types of what they replace instead of collapsing to `unknown`.
 */
type ConsoleSpy = MockInstance<[message?: unknown, ...optionalParams: unknown[]], void>;

/**
 * Shape of a JSON log line as emitted by `Logger` in JSON format.
 */
interface JsonLogEntry {
  level?: string;
  message?: string;
  timestamp?: string;
  context?: Record<string, unknown>;
  error?: {
    name?: string;
    message?: string;
    stack?: string;
  };
}

describe('Logger', () => {
  let consoleLogSpy: ConsoleSpy;
  let consoleWarnSpy: ConsoleSpy;
  let consoleErrorSpy: ConsoleSpy;

  /**
   * Parse the first argument captured by a console spy. `console.log` receives
   * untyped arguments, so the payload has to be checked before parsing.
   */
  const parseLoggedJson = (value: unknown): JsonLogEntry => {
    if (typeof value !== 'string') {
      throw new TypeError(`Expected a logged string, received ${typeof value}`);
    }
    return JSON.parse(value) as JsonLogEntry;
  };

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('basic logging', () => {
    it('should log debug messages', () => {
      const logger = new Logger({ minLevel: 'debug', jsonFormat: false });
      logger.debug('test debug message');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should log info messages', () => {
      const logger = new Logger({ minLevel: 'info', jsonFormat: false });
      logger.info('test info message');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should log warn messages', () => {
      const logger = new Logger({ minLevel: 'warn', jsonFormat: false });
      logger.warn('test warn message');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should log error messages', () => {
      const logger = new Logger({ minLevel: 'error', jsonFormat: false });
      logger.error('test error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('log levels', () => {
    it('should respect minimum log level', () => {
      const logger = new Logger({ minLevel: 'warn', jsonFormat: false });
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');
      
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should include all levels when minLevel is debug', () => {
      const logger = new Logger({ minLevel: 'debug', jsonFormat: false });
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
      
      expect(consoleLogSpy).toHaveBeenCalledTimes(2); // debug and info
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('JSON format', () => {
    it('should output JSON when jsonFormat is true', () => {
      const logger = new Logger({ jsonFormat: true });
      logger.info('test message', { key: 'value' });
      
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = parseLoggedJson(output);
      
      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('test message');
      expect(parsed.context).toEqual({ key: 'value' });
      expect(parsed.timestamp).toBeDefined();
    });

    it('should include error details in JSON output', () => {
      const logger = new Logger({ jsonFormat: true });
      const error = new Error('test error');
      logger.error('error occurred', error);
      
      const output = consoleErrorSpy.mock.calls[0][0];
      const parsed = parseLoggedJson(output);
      
      expect(parsed.error?.name).toBe('Error');
      expect(parsed.error?.message).toBe('test error');
      expect(parsed.error?.stack).toBeDefined();
    });
  });

  describe('context', () => {
    it('should include context in log entries', () => {
      const entries: LogEntry[] = [];
      const logger = new Logger({
        jsonFormat: true,
        output: (entry) => entries.push(entry),
      });
      
      logger.info('test', { requestId: '123', userId: 'abc' });
      
      expect(entries[0].context).toEqual({ requestId: '123', userId: 'abc' });
    });

    it('should merge default context with per-call context', () => {
      const entries: LogEntry[] = [];
      const logger = new Logger({
        defaultContext: { service: 'test-service' },
        output: (entry) => entries.push(entry),
      });
      
      logger.info('test', { requestId: '123' });
      
      expect(entries[0].context).toEqual({ service: 'test-service', requestId: '123' });
    });
  });

  describe('long values', () => {
    // One multi-megabyte line froze the GitHub Actions runner outright.
    it('cuts a long string in the context, the message and the error', () => {
      const entries: LogEntry[] = [];
      const logger = new Logger({ output: (entry) => entries.push(entry) });
      const huge = 'x'.repeat(8 * 1024 * 1024);

      logger.error(`failed: ${huge}`, new Error(huge), { detail: { nested: huge }, list: [huge] });

      const serialized = JSON.stringify(entries[0]);
      expect(serialized.length).toBeLessThan(64 * 1024);
      expect(entries[0].message.startsWith('failed: xxx')).toBe(true);
      expect(entries[0].message).toContain(`[${8 * 1024 * 1024 + 'failed: '.length - MAX_LOG_STRING_LENGTH} more characters]`);
      expect((entries[0].context?.detail as { nested: string }).nested.length).toBeLessThan(MAX_LOG_STRING_LENGTH + 64);
    });

    it('leaves ordinary values alone', () => {
      const entries: LogEntry[] = [];
      const logger = new Logger({ output: (entry) => entries.push(entry) });
      const shared = { id: 'a' };

      logger.info('short', { requestId: '123', count: 3, ok: true, a: shared, b: shared });

      expect(entries[0].message).toBe('short');
      expect(entries[0].context).toEqual({ requestId: '123', count: 3, ok: true, a: { id: 'a' }, b: { id: 'a' } });
    });

    it('cuts a cycle instead of following it', () => {
      const entries: LogEntry[] = [];
      const logger = new Logger({ output: (entry) => entries.push(entry) });
      const cyclic: Record<string, unknown> = { name: 'loop' };
      cyclic.self = cyclic;

      logger.info('cyclic', { cyclic });

      expect(entries[0].context?.cyclic).toEqual({ name: 'loop', self: '[omitted]' });
    });
  });

  describe('child logger', () => {
    it('should create child logger with inherited context', () => {
      const entries: LogEntry[] = [];
      const parentLogger = new Logger({
        defaultContext: { service: 'parent' },
        output: (entry) => entries.push(entry),
      });
      
      const childLogger = parentLogger.child({ component: 'child' });
      childLogger.info('child message');
      
      expect(entries[0].context).toEqual({ service: 'parent', component: 'child' });
    });

    it('should allow child to override parent context', () => {
      const entries: LogEntry[] = [];
      const parentLogger = new Logger({
        defaultContext: { version: '1.0' },
        output: (entry) => entries.push(entry),
      });
      
      const childLogger = parentLogger.child({ version: '2.0' });
      childLogger.info('message');
      
      expect(entries[0].context?.version).toBe('2.0');
    });
  });

  describe('error handling', () => {
    it('should extract error information from Error objects', () => {
      const entries: LogEntry[] = [];
      const logger = new Logger({
        output: (entry) => entries.push(entry),
      });
      
      const error = new Error('Something went wrong');
      logger.error('Operation failed', error);
      
      expect(entries[0].error).toBeDefined();
      expect(entries[0].error?.name).toBe('Error');
      expect(entries[0].error?.message).toBe('Something went wrong');
      expect(entries[0].error?.stack).toContain('Error: Something went wrong');
    });

    it('should handle non-Error objects', () => {
      const entries: LogEntry[] = [];
      const logger = new Logger({
        output: (entry) => entries.push(entry),
      });
      
      logger.error('Operation failed', { code: 'ERR_001', details: 'Invalid input' });
      
      expect(entries[0].error).toBeDefined();
      expect(entries[0].error?.message).toContain('ERR_001');
    });

    it('should handle string errors', () => {
      const entries: LogEntry[] = [];
      const logger = new Logger({
        output: (entry) => entries.push(entry),
      });
      
      logger.error('Operation failed', 'Simple string error');
      
      expect(entries[0].error?.message).toBe('Simple string error');
    });

    it('should handle undefined errors', () => {
      const entries: LogEntry[] = [];
      const logger = new Logger({
        output: (entry) => entries.push(entry),
      });
      
      logger.error('Operation failed', undefined);
      
      expect(entries[0].error).toBeUndefined();
    });

    it('should include context alongside error', () => {
      const entries: LogEntry[] = [];
      const logger = new Logger({
        output: (entry) => entries.push(entry),
      });
      
      const error = new Error('DB connection failed');
      logger.error('Database error', error, { database: 'neo4j', retries: 3 });
      
      expect(entries[0].error).toBeDefined();
      expect(entries[0].context).toEqual({ database: 'neo4j', retries: 3 });
    });
  });

  describe('custom output', () => {
    it('should use custom output function when provided', () => {
      const customOutput = vi.fn();
      const logger = new Logger({ output: customOutput });
      
      logger.info('test message');
      
      expect(customOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          message: 'test message',
        })
      );
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('createLogger helper', () => {
    it('should create a logger with component context', () => {
      const entries: LogEntry[] = [];
      const originalLogger = new Logger({
        output: (entry) => entries.push(entry),
      });
      
      // Test with the module's createLogger by checking behavior
      const componentLogger = originalLogger.child({ component: 'TestComponent' });
      componentLogger.info('test');
      
      expect(entries[0].context?.component).toBe('TestComponent');
    });
  });

  describe('SilentLogger', () => {
    it('should not output anything', () => {
      // Exercise SilentLogger through the ILogger contract it implements: its
      // no-op methods accept the same arguments a real logger receives.
      const silent: ILogger = new SilentLogger();
      silent.debug('debug');
      silent.info('info');
      silent.warn('warn');
      silent.error('error', new Error('test'));
      
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should return itself when creating child', () => {
      const silent: ILogger = new SilentLogger();
      const child = silent.child({ component: 'test' });
      expect(child).toBe(silent);
    });

    it('should have a singleton instance available', () => {
      expect(silentLogger).toBeInstanceOf(SilentLogger);
    });
  });

  describe('timestamp', () => {
    it('should include ISO timestamp in entries', () => {
      const entries: LogEntry[] = [];
      const logger = new Logger({
        output: (entry) => entries.push(entry),
      });
      
      const before = new Date().toISOString();
      logger.info('test');
      const after = new Date().toISOString();
      
      const timestamp = entries[0].timestamp;
      expect(timestamp >= before).toBe(true);
      expect(timestamp <= after).toBe(true);
    });
  });
});
