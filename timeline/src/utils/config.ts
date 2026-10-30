import { config } from 'dotenv';
import { ConfigurationError } from './errors';
import { DatabaseConfig } from './database';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables from .env and .env.local.
//
// Precedence, strongest first:
//
//   1. the process environment (what the operator or the container runtime set)
//   2. .env.local
//   3. .env
//
// `.env.local` is a developer's local override, so it beats `.env` -- but it
// must NOT beat the real environment. Loading it with `override: true` made it
// win over `process.env`, which is how a developer checkout of
// `timeline/.env.local` (LOCAL_EXECUTION_ENABLED=true) silently forced local
// execution mode in a container that had asked for cloud mode, and how the
// "cloud" integration suites ended up running against the local JSON store
// instead of Neo4j. The environment is restored after the files are read, so
// the file order still decides between the two files and the environment still
// decides over both.
export function loadDotEnvFiles(
  envPath: string = path.resolve(process.cwd(), '.env'),
  envLocalPath: string = path.resolve(process.cwd(), '.env.local')
): void {
  // Snapshot the environment before any file is read, so the values an
  // operator set can be restored afterwards.
  const environmentSnapshot = new Map<string, string | undefined>(
    Object.keys(process.env).map((key) => [key, process.env[key]])
  );

  // Load .env first (base configuration)
  if (fs.existsSync(envPath)) {
    config({ path: envPath });
  }

  // Load .env.local second (overrides .env - takes precedence)
  if (fs.existsSync(envLocalPath)) {
    config({ path: envLocalPath, override: true });
  }

  // Restore anything the environment set explicitly. `dotenv` cannot express
  // "this file may override that file but not the environment", so the
  // distinction is made here.
  for (const [key, value] of environmentSnapshot) {
    // `Object.keys(process.env)` never yields an undefined value, so this is
    // always an assignment.
    process.env[key] = value as string;
  }
}

loadDotEnvFiles();

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
  /**
   * Byte ceiling for the in-memory export API (`ExportService.exportGraph`).
   * Unset means the service default (50 MB). Unrelated to the streaming paths.
   */
  exportMaxInMemoryBytes?: number;
}

/**
 * Application configuration interface
 */
export interface AppConfig {
  port: number;
  /**
   * Interface the HTTP server listens on. `HOST` wins; otherwise local
   * execution, which runs without API keys by default, listens on loopback
   * only, unless `TAILSCALE=true` (set by `start-local.sh --tailscale`) asks
   * for the network. Cloud mode listens everywhere, since it runs in a
   * container whose port the runtime publishes.
   */
  host: string;
  nodeEnv: string;
  database: DatabaseConfig;
  performance: {
    queryTimeoutMs: number;
    maxQueryResults: number;
    cacheExpirationMs: number;
  };
  localExecution: LocalExecutionConfig;
  cloudState: CloudStateConfig;
  apiAuth: ApiAuthConfig;
}

/**
 * What the entity routes require of a caller.
 *
 * `/api/events`, `/api/arcs`, `/api/causal`, `/api/temporal` and
 * `/api/inference` read and write graph data. They used to be mounted with no
 * authentication at all, so anyone who could reach the port could read a
 * timeline, rewrite it and run inference, while the OpenAPI document called
 * those operations `auth: optional` and `docs/api-integration.md` said the
 * routes were open. `required` is the single switch those five groups and the
 * document both read (`src/api/entityAuth.ts`), so they cannot disagree.
 *
 * It defaults to true, and the one exception is explicit: local execution
 * (`LOCAL_EXECUTION_ENABLED=true`) defaults it to false, because `npm run dev`
 * and the bundled UI have no way to present a key on a developer's own
 * machine. Every other mode -- cloud, and any deployment that does not set
 * the flag -- requires one. Set `API_AUTH_REQUIRED=true` in local mode to get
 * the same enforcement there.
 */
export interface ApiAuthConfig {
  required: boolean;
}

/**
 * What cloud mode keeps where.
 *
 * The *entities* are shared through Neo4j. Everything else is per process:
 *
 * - graph metadata, export/import job records and graph versions are files
 *   under `localExecution.dataDirectory`;
 * - the rate-limit counters are an in-memory map that is *snapshotted* to
 *   Redis (the whole map, at most every 30 seconds while it is changing) and
 *   re-read once at startup, so a second replica does not share the count --
 *   it keeps its own and overwrites the snapshot. Two replicas therefore allow
 *   roughly twice the configured rate.
 * - export artifacts (`export-*` files) are written under the same directory.
 *
 * API keys are files too (`keys/keys.json`), so a key created on one replica
 * does not authenticate on another.
 *
 * Everything but the entities is per process, so the deployment has to be a
 * single replica with a volume that outlives the container, and
 * `singleReplicaAcknowledged` is the operator saying that it is. It is required
 * in cloud mode; the server refuses to start without it rather than serving
 * state that is silently per-process.
 *
 * The flag is a statement of intent, not a detection: it cannot tell how many
 * replicas exist. Setting it on a two-replica deployment silences the refusal
 * and changes nothing about the divergence.
 */
export interface CloudStateConfig {
  singleReplicaAcknowledged: boolean;
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
      host: resolveListenHost(localExecutionEnabled),
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
      cloudState: {
        // A deliberately explicit value rather than "on": an operator should
        // have to mean this one.
        singleReplicaAcknowledged: parseBooleanEnvVar(
          'CLOUD_SINGLE_REPLICA_STATE',
          false
        ),
      },
      apiAuth: {
        // Explicit wins. Unset falls back to "required, unless this process is
        // local execution", never to "required only if someone remembered".
        required: parseRequiredBooleanEnvVar(
          'API_AUTH_REQUIRED',
          !localExecutionEnabled
        ),
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
        exportAsyncEntityThreshold: parseOptionalIntegerEnvVar(
          'LOCAL_EXPORT_ASYNC_ENTITY_THRESHOLD'
        ),
        exportMaxInMemoryBytes: parseOptionalIntegerEnvVar(
          'LOCAL_EXPORT_MAX_IN_MEMORY_BYTES'
        ),
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
/** The listen interface; see {@link AppConfig.host}. */
function resolveListenHost(localExecutionEnabled: boolean): string {
  const explicit = process.env.HOST?.trim();
  if (explicit) return explicit;
  if (parseBooleanEnvVar('TAILSCALE', false)) return '0.0.0.0';
  return localExecutionEnabled ? '127.0.0.1' : '0.0.0.0';
}

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
 * Read a boolean setting that has no "unset by leaving it empty" case.
 *
 * `parseBooleanEnvVar` treats an empty string as absent. For a security switch
 * that would make `API_AUTH_REQUIRED=` silently take the default instead of
 * being refused, so "set but empty" is rejected here as well: a value that is
 * not a boolean is a configuration error, not something to guess at.
 */
function parseRequiredBooleanEnvVar(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }

  if (value.trim() === '') {
    throw new ConfigurationError(
      `Invalid boolean value for ${key}: ${JSON.stringify(value)}. Use true/false, 1/0, or yes/no`,
      key
    );
  }

  return parseBooleanEnvVar(key, defaultValue);
}

/**
 * Read an optional non-negative integer setting.
 *
 * `parseInt` would accept `"1e5"` as 1 and `"10k"` as 10, silently changing a
 * policy number; this requires the value to be digits only and fails startup
 * otherwise.
 */
function parseOptionalIntegerEnvVar(key: string): number | undefined {
  const value = process.env[key];
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  if (!/^\d+$/.test(value.trim())) {
    throw new ConfigurationError(`Invalid integer value for ${key}: ${value}`, key);
  }

  return Number.parseInt(value.trim(), 10);
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

  // Cloud mode keeps graph metadata, jobs and versions in files, so it only
  // works as a single replica with a persistent volume. The operator has to
  // say that the deployment is one, and the server refuses to start otherwise
  // rather than serving state that is per-process and silently incomplete.
  if (!config.localExecution.enabled && !isTestEnvironment && !config.cloudState.singleReplicaAcknowledged) {
    throw new ConfigurationError(
      'Cloud mode keeps graph metadata, export/import jobs, graph versions and API keys in files ' +
        'under LOCAL_DATA_DIR and counts rate limits per process, so it requires a single replica ' +
        'with a persistent volume. Set CLOUD_SINGLE_REPLICA_STATE=true to confirm the deployment is ' +
        'one, and make sure the data directory is on a volume that outlives the container. Running ' +
        'more than one replica or an ephemeral disk loses jobs and versions written by another ' +
        'process. Any script that loads this configuration (the server, `migrate-data`) is ' +
        'subject to it; the `althistory` CLI pins itself to local execution before loading it.',
      'CLOUD_SINGLE_REPLICA_STATE'
    );
  }

  // LOCAL_DEV_AUTH_BYPASS turns every request without a key into the
  // ADMIN_API_KEY holder (`api/middleware.ts`). That is a convenience for a
  // developer's own machine, so anywhere else the server refuses to start
  // rather than run with an unauthenticated admin.
  if (
    process.env.LOCAL_DEV_AUTH_BYPASS === 'true' &&
    (!config.localExecution.enabled || config.nodeEnv === 'production')
  ) {
    throw new ConfigurationError(
      'LOCAL_DEV_AUTH_BYPASS=true makes every request without an API key act as the admin key. ' +
        'It is only allowed under local execution (LOCAL_EXECUTION_ENABLED=true) with NODE_ENV ' +
        'other than production. Remove it.',
      'LOCAL_DEV_AUTH_BYPASS'
    );
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

  if (config.exportMaxInMemoryBytes !== undefined) {
    if (!Number.isInteger(config.exportMaxInMemoryBytes) || config.exportMaxInMemoryBytes < 1) {
      throw new ConfigurationError(
        'Export in-memory byte ceiling must be a positive integer',
        'LOCAL_EXPORT_MAX_IN_MEMORY_BYTES'
      );
    }
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