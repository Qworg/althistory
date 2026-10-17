import { config } from 'dotenv';
import { ConfigurationError } from './errors';
import { DatabaseConfig } from './database';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables from .env and .env.local (local takes precedence)
const rootDir = process.cwd();
const envPath = path.resolve(rootDir, '.env');
const envLocalPath = path.resolve(rootDir, '.env.local');

// Load .env first (base configuration)
if (fs.existsSync(envPath)) {
  config({ path: envPath });
}

// Load .env.local second (overrides - takes precedence)
if (fs.existsSync(envLocalPath)) {
  config({ path: envLocalPath, override: true });
}

/**
 * Local execution configuration interface
 */
export interface LocalExecutionConfig {
  enabled: boolean;
  dataDirectory: string;
  graphFile: string;
  cacheSize: number;
  persistenceInterval: number;
  backupEnabled: boolean;
  backupInterval: number;
  maxMemoryUsage: number;
  /**
   * Entity count above which an export becomes an async job (Req 5.4).
   * Unset means `ExportService`'s default (10,000).
   */
  exportAsyncEntityThreshold?: number;
}

/**
 * Application configuration interface
 */
export interface AppConfig {
  port: number;
  nodeEnv: string;
  database: DatabaseConfig;
  performance: {
    queryTimeoutMs: number;
    maxQueryResults: number;
    cacheExpirationMs: number;
  };
  localExecution: LocalExecutionConfig;
}

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): AppConfig {
  try {
    // First, determine if local execution is enabled or if we're in test mode
    const localExecutionEnabled = parseBooleanEnvVar('LOCAL_EXECUTION_ENABLED', false);
    const isTestEnvironment = process.env.NODE_ENV === 'test';
    const useDefaults = localExecutionEnabled || isTestEnvironment;
    
    const appConfig: AppConfig = {
      port: parseInt(process.env.PORT || '3000', 10),
      nodeEnv: process.env.NODE_ENV || 'development',
      database: {
        neo4j: {
          uri: useDefaults ? 
            getEnvVarWithDefault('NEO4J_URI', 'bolt://localhost:7687') : 
            getRequiredEnvVar('NEO4J_URI'),
          username: useDefaults ? 
            getEnvVarWithDefault('NEO4J_USERNAME', 'neo4j') : 
            getRequiredEnvVar('NEO4J_USERNAME'),
          password: useDefaults ? 
            getEnvVarWithDefault('NEO4J_PASSWORD', 'password') : 
            getRequiredEnvVar('NEO4J_PASSWORD'),
          database: process.env.NEO4J_DATABASE || (isTestEnvironment ? 'test' : 'neo4j'),
        },
        redis: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
          password: process.env.REDIS_PASSWORD,
        },
      },
      performance: {
        queryTimeoutMs: parseInt(process.env.QUERY_TIMEOUT_MS || '2000', 10),
        maxQueryResults: parseInt(process.env.MAX_QUERY_RESULTS || '10000', 10),
        cacheExpirationMs: parseInt(process.env.CACHE_EXPIRATION_MS || '300000', 10), // 5 minutes
      },
      localExecution: {
        enabled: localExecutionEnabled,
        dataDirectory: getEnvVarWithDefault('LOCAL_DATA_DIR', './data'),
        graphFile: getEnvVarWithDefault('LOCAL_GRAPH_FILE', 'graph.json'),
        cacheSize: parseInt(getEnvVarWithDefault('LOCAL_CACHE_SIZE', '1000'), 10),
        persistenceInterval: parseInt(getEnvVarWithDefault('LOCAL_PERSISTENCE_INTERVAL', '30000'), 10), // 30 seconds
        backupEnabled: parseBooleanEnvVar('LOCAL_BACKUP_ENABLED', true),
        backupInterval: parseInt(getEnvVarWithDefault('LOCAL_BACKUP_INTERVAL', '300000'), 10), // 5 minutes
        maxMemoryUsage: parseInt(getEnvVarWithDefault('LOCAL_MAX_MEMORY_MB', '512'), 10), // 512 MB
        exportAsyncEntityThreshold:
          process.env.LOCAL_EXPORT_ASYNC_ENTITY_THRESHOLD !== undefined
            ? parseInt(process.env.LOCAL_EXPORT_ASYNC_ENTITY_THRESHOLD, 10)
            : undefined,
      },
    };

    validateConfig(appConfig);
    return appConfig;
  } catch (error) {
    throw new ConfigurationError(
      'Failed to load application configuration',
      undefined,
      error as Error
    );
  }
}

/**
 * Get required environment variable with optional default
 */
function getRequiredEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new ConfigurationError(`Required environment variable ${key} is not set`);
  }
  return value;
}

/**
 * Get environment variable with default, but preserve empty strings for validation
 */
function getEnvVarWithDefault(key: string, defaultValue: string): string {
  const value = process.env[key];
  return value !== undefined ? value : defaultValue;
}

/**
 * Parse boolean environment variable
 */
function parseBooleanEnvVar(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }
  
  const lowerValue = value.toLowerCase();
  if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes') {
    return true;
  } else if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no') {
    return false;
  } else {
    throw new ConfigurationError(`Invalid boolean value for ${key}: ${value}. Use true/false, 1/0, or yes/no`);
  }
}

/**
 * Validate configuration values
 */
function validateConfig(config: AppConfig): void {
  // Validate port
  if (config.port < 1 || config.port > 65535) {
    throw new ConfigurationError('Port must be between 1 and 65535', 'port');
  }

  // Skip cloud database validation if local execution is enabled or in test mode
  const isTestEnvironment = config.nodeEnv === 'test';
  if (!config.localExecution.enabled && !isTestEnvironment) {
    // Validate Neo4j configuration
    if (!config.database.neo4j.uri) {
      throw new ConfigurationError('Neo4j URI is required', 'NEO4J_URI');
    }

    if (!config.database.neo4j.username) {
      throw new ConfigurationError('Neo4j username is required', 'NEO4J_USERNAME');
    }

    if (!config.database.neo4j.password) {
      throw new ConfigurationError('Neo4j password is required', 'NEO4J_PASSWORD');
    }

    // Validate Redis configuration
    if (config.database.redis.port < 1 || config.database.redis.port > 65535) {
      throw new ConfigurationError('Redis port must be between 1 and 65535', 'REDIS_PORT');
    }
  }

  // Validate performance settings
  if (config.performance.queryTimeoutMs < 100) {
    throw new ConfigurationError('Query timeout must be at least 100ms', 'QUERY_TIMEOUT_MS');
  }

  if (config.performance.maxQueryResults < 1) {
    throw new ConfigurationError('Max query results must be at least 1', 'MAX_QUERY_RESULTS');
  }

  if (config.performance.cacheExpirationMs < 1000) {
    throw new ConfigurationError('Cache expiration must be at least 1000ms', 'CACHE_EXPIRATION_MS');
  }

  // Validate local execution configuration
  validateLocalExecutionConfig(config.localExecution);
}

/**
 * Validate local execution configuration parameters
 */
function validateLocalExecutionConfig(config: LocalExecutionConfig): void {
  // Validate data directory path
  if (!config.dataDirectory || config.dataDirectory.trim() === '') {
    throw new ConfigurationError('Local data directory cannot be empty', 'LOCAL_DATA_DIR');
  }

  // Validate graph file name
  if (!config.graphFile || config.graphFile.trim() === '') {
    throw new ConfigurationError('Local graph file name cannot be empty', 'LOCAL_GRAPH_FILE');
  }

  // Validate graph file extension
  if (!config.graphFile.endsWith('.json')) {
    throw new ConfigurationError('Local graph file must have .json extension', 'LOCAL_GRAPH_FILE');
  }

  // Validate cache size
  if (config.cacheSize < 1) {
    throw new ConfigurationError('Local cache size must be at least 1', 'LOCAL_CACHE_SIZE');
  }

  if (config.cacheSize > 100000) {
    throw new ConfigurationError('Local cache size cannot exceed 100,000 entries', 'LOCAL_CACHE_SIZE');
  }

  // Validate persistence interval
  if (config.persistenceInterval < 1000) {
    throw new ConfigurationError('Local persistence interval must be at least 1000ms (1 second)', 'LOCAL_PERSISTENCE_INTERVAL');
  }

  if (config.persistenceInterval > 3600000) {
    throw new ConfigurationError('Local persistence interval cannot exceed 3600000ms (1 hour)', 'LOCAL_PERSISTENCE_INTERVAL');
  }

  // Validate backup interval
  if (config.backupEnabled) {
    if (config.backupInterval < 60000) {
      throw new ConfigurationError('Local backup interval must be at least 60000ms (1 minute)', 'LOCAL_BACKUP_INTERVAL');
    }

    if (config.backupInterval > 86400000) {
      throw new ConfigurationError('Local backup interval cannot exceed 86400000ms (24 hours)', 'LOCAL_BACKUP_INTERVAL');
    }
  }

  // Validate memory usage limit
  if (config.maxMemoryUsage < 64) {
    throw new ConfigurationError('Local max memory usage must be at least 64 MB', 'LOCAL_MAX_MEMORY_MB');
  }

  // Validate the export async threshold when it is set (Req 5.4). Invalid
  // values fail startup instead of silently disabling the guard.
  if (config.exportAsyncEntityThreshold !== undefined) {
    if (!Number.isInteger(config.exportAsyncEntityThreshold) || config.exportAsyncEntityThreshold < 1) {
      throw new ConfigurationError(
        'Export async entity threshold must be a positive integer',
        'LOCAL_EXPORT_ASYNC_ENTITY_THRESHOLD'
      );
    }
  }

  if (config.maxMemoryUsage > 8192) {
    throw new ConfigurationError('Local max memory usage cannot exceed 8192 MB (8 GB)', 'LOCAL_MAX_MEMORY_MB');
  }

  // Validate data directory path format
  if (config.dataDirectory.includes('..')) {
    throw new ConfigurationError('Local data directory cannot contain relative path traversal (..))', 'LOCAL_DATA_DIR');
  }

  // Validate graph file name format
  if (config.graphFile.includes('/') || config.graphFile.includes('\\')) {
    throw new ConfigurationError('Local graph file name cannot contain path separators', 'LOCAL_GRAPH_FILE');
  }
}