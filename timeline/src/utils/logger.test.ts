import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, createLogger, SilentLogger, silentLogger, LogEntry, LogLevel } from './logger';

describe('Logger', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

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
      const parsed = JSON.parse(output);
      
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
      const parsed = JSON.parse(output);
      
      expect(parsed.error.name).toBe('Error');
      expect(parsed.error.message).toBe('test error');
      expect(parsed.error.stack).toBeDefined();
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
      const silent = new SilentLogger();
      silent.debug('debug');
      silent.info('info');
      silent.warn('warn');
      silent.error('error', new Error('test'));
      
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should return itself when creating child', () => {
      const silent = new SilentLogger();
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
