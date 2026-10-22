import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config';
import { ConfigurationError } from './errors';

describe('Configuration System', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('cloud state constraint', () => {
    it('should refuse cloud mode without the single-replica acknowledgement', () => {
      // Cloud mode keeps graph metadata, jobs and versions in files, so two
      // replicas would each have their own. The server refuses to start rather
      // than serving state that is silently per-process.
      process.env.NEO4J_URI = 'bolt://localhost:7687';
      process.env.NEO4J_USERNAME = 'neo4j';
      process.env.NEO4J_PASSWORD = 'password';
      process.env.NODE_ENV = 'production';
      process.env.LOCAL_EXECUTION_ENABLED = 'false';
      delete process.env.CLOUD_SINGLE_REPLICA_STATE;

      // `loadConfig` wraps whatever it caught, so the reason to look at is
      // the cause: that is where the requirement and the variable are named.
      let caught: unknown;
      try {
        loadConfig();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConfigurationError);
      const cause = (caught as ConfigurationError).cause as ConfigurationError;
      expect(cause).toBeInstanceOf(ConfigurationError);
      expect(cause.message).toMatch(/single replica with a persistent volume/);
      expect(cause.configKey).toBe('CLOUD_SINGLE_REPLICA_STATE');
    });

    it('should accept cloud mode when the deployment is acknowledged as one', () => {
      process.env.NEO4J_URI = 'bolt://localhost:7687';
      process.env.NEO4J_USERNAME = 'neo4j';
      process.env.NEO4J_PASSWORD = 'password';
      process.env.NODE_ENV = 'production';
      process.env.LOCAL_EXECUTION_ENABLED = 'false';
      process.env.CLOUD_SINGLE_REPLICA_STATE = 'true';

      expect(loadConfig().cloudState.singleReplicaAcknowledged).toBe(true);
    });

    it('should not require the acknowledgement in local mode', () => {
      process.env.NODE_ENV = 'production';
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
      delete process.env.CLOUD_SINGLE_REPLICA_STATE;

      // Local mode keeps everything in one directory by design, so there is
      // nothing to acknowledge.
      expect(() => loadConfig()).not.toThrow();
      expect(loadConfig().cloudState.singleReplicaAcknowledged).toBe(false);
    });

    it('should skip the check under NODE_ENV=test, which is how the cloud suite runs', () => {
      // The cloud integration suites run cloud mode under NODE_ENV=test, so the
      // check has to stand down there. This test pins that, because the same
      // variable also skips the Neo4j credential checks -- copying a test
      // environment into a deployment would disable both.
      process.env.NODE_ENV = 'test';
      process.env.LOCAL_EXECUTION_ENABLED = 'false';
      delete process.env.CLOUD_SINGLE_REPLICA_STATE;

      expect(() => loadConfig()).not.toThrow();
    });

    it('should refuse a value that is not a boolean rather than guess', () => {
      process.env.NODE_ENV = 'production';
      process.env.LOCAL_EXECUTION_ENABLED = 'false';
      process.env.NEO4J_URI = 'bolt://localhost:7687';
      process.env.NEO4J_USERNAME = 'neo4j';
      process.env.NEO4J_PASSWORD = 'password';
      process.env.CLOUD_SINGLE_REPLICA_STATE = 'yes-please';

      // `loadConfig` wraps what it catches in a ConfigurationError, so the
      // class alone would not tell a bad boolean apart from the refusal. The
      // cause names the variable that could not be parsed.
      let caught: unknown;
      try {
        loadConfig();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConfigurationError);
      const cause = (caught as ConfigurationError).cause as ConfigurationError;
      expect(cause.message).toMatch(/Invalid boolean value for CLOUD_SINGLE_REPLICA_STATE/);
    });
  });

  describe('loadConfig', () => {
    it('should load default configuration when no environment variables are set', () => {
      // Set required environment variables
      process.env.NEO4J_URI = 'bolt://localhost:7687';
      process.env.NEO4J_USERNAME = 'neo4j';
      process.env.NEO4J_PASSWORD = 'password';
      // Clear NODE_ENV to test default
      delete process.env.NODE_ENV;
      // Clear LOCAL_EXECUTION_ENABLED to test default
      delete process.env.LOCAL_EXECUTION_ENABLED;
      // Cloud mode now requires the deployment to acknowledge that it is a
      // single replica with a persistent volume; see the tests below.
      process.env.CLOUD_SINGLE_REPLICA_STATE = 'true';

      const config = loadConfig();

      expect(config.port).toBe(3000);
      expect(config.nodeEnv).toBe('development');
      expect(config.localExecution.enabled).toBe(false);
      expect(config.localExecution.dataDirectory).toBe('./data');
      expect(config.localExecution.graphFile).toBe('graph.json');
      expect(config.localExecution.cacheSize).toBe(1000);
      expect(config.localExecution.persistenceInterval).toBe(30000);
      expect(config.localExecution.backupEnabled).toBe(true);
      expect(config.localExecution.backupInterval).toBe(300000);
      expect(config.localExecution.maxMemoryUsage).toBe(512);
    });

    it('should parse local execution environment variables correctly', () => {
      // Set required environment variables
      process.env.NEO4J_URI = 'bolt://localhost:7687';
      process.env.NEO4J_USERNAME = 'neo4j';
      process.env.NEO4J_PASSWORD = 'password';

      // Set local execution environment variables
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
      process.env.LOCAL_DATA_DIR = '/custom/data';
      process.env.LOCAL_GRAPH_FILE = 'custom-graph.json';
      process.env.LOCAL_CACHE_SIZE = '2000';
      process.env.LOCAL_PERSISTENCE_INTERVAL = '60000';
      process.env.LOCAL_BACKUP_ENABLED = 'false';
      process.env.LOCAL_BACKUP_INTERVAL = '600000';
      process.env.LOCAL_MAX_MEMORY_MB = '1024';

      const config = loadConfig();

      expect(config.localExecution.enabled).toBe(true);
      expect(config.localExecution.dataDirectory).toBe('/custom/data');
      expect(config.localExecution.graphFile).toBe('custom-graph.json');
      expect(config.localExecution.cacheSize).toBe(2000);
      expect(config.localExecution.persistenceInterval).toBe(60000);
      expect(config.localExecution.backupEnabled).toBe(false);
      expect(config.localExecution.backupInterval).toBe(600000);
      expect(config.localExecution.maxMemoryUsage).toBe(1024);
    });

    it('should parse boolean environment variables correctly', () => {
      // Set required environment variables
      process.env.NEO4J_URI = 'bolt://localhost:7687';
      process.env.NEO4J_USERNAME = 'neo4j';
      process.env.NEO4J_PASSWORD = 'password';

      // Test different boolean formats
      process.env.LOCAL_EXECUTION_ENABLED = '1';
      process.env.LOCAL_BACKUP_ENABLED = 'yes';

      const config = loadConfig();

      expect(config.localExecution.enabled).toBe(true);
      expect(config.localExecution.backupEnabled).toBe(true);
    });

    it('should throw error for invalid boolean values', () => {
      // Set required environment variables
      process.env.NEO4J_URI = 'bolt://localhost:7687';
      process.env.NEO4J_USERNAME = 'neo4j';
      process.env.NEO4J_PASSWORD = 'password';

      process.env.LOCAL_EXECUTION_ENABLED = 'invalid';

      expect(() => loadConfig()).toThrow(ConfigurationError);
    });

    it('should skip cloud database validation when local execution is enabled', () => {
      // Don't set cloud database environment variables
      process.env.LOCAL_EXECUTION_ENABLED = 'true';

      expect(() => loadConfig()).not.toThrow();
    });

    it('should require cloud database configuration when local execution is disabled', () => {
      process.env.LOCAL_EXECUTION_ENABLED = 'false';
      // Clear NODE_ENV to ensure we're not in test mode
      delete process.env.NODE_ENV;
      // Clear cloud database environment variables to force validation error
      delete process.env.NEO4J_URI;
      delete process.env.NEO4J_USERNAME;
      delete process.env.NEO4J_PASSWORD;

      expect(() => loadConfig()).toThrow(ConfigurationError);
    });
  });

  describe('LOCAL_EXPORT_ASYNC_ENTITY_THRESHOLD', () => {
    beforeEach(() => {
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
      delete process.env.LOCAL_EXPORT_ASYNC_ENTITY_THRESHOLD;
    });

    it('is undefined when unset', () => {
      expect(loadConfig().localExecution.exportAsyncEntityThreshold).toBeUndefined();
    });

    it('parses a digits-only value', () => {
      process.env.LOCAL_EXPORT_ASYNC_ENTITY_THRESHOLD = '250';
      expect(loadConfig().localExecution.exportAsyncEntityThreshold).toBe(250);
    });

    it.each(['1e5', '10k', '2.5', '0x10'])(
      'rejects %j instead of letting parseInt truncate it',
      (value) => {
        process.env.LOCAL_EXPORT_ASYNC_ENTITY_THRESHOLD = value;
        expect(() => loadConfig()).toThrow(ConfigurationError);
      }
    );
  });

  describe('Local Execution Configuration Validation', () => {
    beforeEach(() => {
      // Set minimal required environment variables
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
    });

    it('should validate data directory', () => {
      process.env.LOCAL_DATA_DIR = '';
      expect(() => loadConfig()).toThrow(ConfigurationError);
      
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        // Check the cause for the specific error message
        expect((error as ConfigurationError).cause?.message).toContain('Local data directory cannot be empty');
      }

      process.env.LOCAL_DATA_DIR = '../invalid';
      expect(() => loadConfig()).toThrow(ConfigurationError);
      
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).cause?.message).toContain('Local data directory cannot contain relative path traversal');
      }
    });

    it('should validate graph file', () => {
      process.env.LOCAL_GRAPH_FILE = '';
      expect(() => loadConfig()).toThrow(ConfigurationError);
      
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).cause?.message).toContain('Local graph file name cannot be empty');
      }

      process.env.LOCAL_GRAPH_FILE = 'invalid.txt';
      expect(() => loadConfig()).toThrow(ConfigurationError);
      
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).cause?.message).toContain('Local graph file must have .json extension');
      }

      process.env.LOCAL_GRAPH_FILE = 'path/to/file.json';
      expect(() => loadConfig()).toThrow(ConfigurationError);
      
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).cause?.message).toContain('Local graph file name cannot contain path separators');
      }
    });

    it('should validate cache size', () => {
      process.env.LOCAL_CACHE_SIZE = '0';
      expect(() => loadConfig()).toThrow(ConfigurationError);
      
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).cause?.message).toContain('Local cache size must be at least 1');
      }

      process.env.LOCAL_CACHE_SIZE = '200000';
      expect(() => loadConfig()).toThrow(ConfigurationError);
      
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).cause?.message).toContain('Local cache size cannot exceed 100,000 entries');
      }
    });

    it('should validate persistence interval', () => {
      process.env.LOCAL_PERSISTENCE_INTERVAL = '500';
      expect(() => loadConfig()).toThrow(ConfigurationError);
      
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).cause?.message).toContain('Local persistence interval must be at least 1000ms');
      }

      process.env.LOCAL_PERSISTENCE_INTERVAL = '4000000';
      expect(() => loadConfig()).toThrow(ConfigurationError);
      
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).cause?.message).toContain('Local persistence interval cannot exceed 3600000ms');
      }
    });

    it('should validate backup interval when backup is enabled', () => {
      process.env.LOCAL_BACKUP_ENABLED = 'true';
      process.env.LOCAL_BACKUP_INTERVAL = '30000';
      expect(() => loadConfig()).toThrow(ConfigurationError);
      
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).cause?.message).toContain('Local backup interval must be at least 60000ms');
      }

      process.env.LOCAL_BACKUP_INTERVAL = '90000000';
      expect(() => loadConfig()).toThrow(ConfigurationError);
      
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).cause?.message).toContain('Local backup interval cannot exceed 86400000ms');
      }
    });

    it('should validate memory usage limits', () => {
      process.env.LOCAL_MAX_MEMORY_MB = '32';
      expect(() => loadConfig()).toThrow(ConfigurationError);
      
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).cause?.message).toContain('Local max memory usage must be at least 64 MB');
      }

      process.env.LOCAL_MAX_MEMORY_MB = '10000';
      expect(() => loadConfig()).toThrow(ConfigurationError);
      
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).cause?.message).toContain('Local max memory usage cannot exceed 8192 MB');
      }
    });

    it('should accept valid configuration', () => {
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
      process.env.LOCAL_DATA_DIR = './data';
      process.env.LOCAL_GRAPH_FILE = 'graph.json';
      process.env.LOCAL_CACHE_SIZE = '1000';
      process.env.LOCAL_PERSISTENCE_INTERVAL = '30000';
      process.env.LOCAL_BACKUP_ENABLED = 'true';
      process.env.LOCAL_BACKUP_INTERVAL = '300000';
      process.env.LOCAL_MAX_MEMORY_MB = '512';

      expect(() => loadConfig()).not.toThrow();
    });
  });
});