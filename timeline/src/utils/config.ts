import { config } from 'dotenv';
import { ConfigurationError } from './errors';
import { DatabaseConfig } from './database';

// Load environment variables
config();

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
}

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): AppConfig {
  try {
    const appConfig: AppConfig = {
      port: parseInt(process.env.PORT || '3000', 10),
      nodeEnv: process.env.NODE_ENV || 'development',
      database: {
        neo4j: {
          uri: getRequiredEnvVar('NEO4J_URI', 'bolt://localhost:7687'),
          username: getRequiredEnvVar('NEO4J_USERNAME', 'neo4j'),
          password: getRequiredEnvVar('NEO4J_PASSWORD', 'password'),
          database: process.env.NEO4J_DATABASE || 'neo4j',
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
 * Validate configuration values
 */
function validateConfig(config: AppConfig): void {
  // Validate port
  if (config.port < 1 || config.port > 65535) {
    throw new ConfigurationError('Port must be between 1 and 65535', 'port');
  }

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
}