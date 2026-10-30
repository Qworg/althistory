/**
 * Import API Routes
 * 
 * Provides endpoints for validating, previewing, and executing imports
 * of Althistory export files.
 * 
 * Security features:
 * - Rate limiting on all endpoints
 * - File size validation
 * - Input sanitization
 * - Concurrent import protection (with atomic locking)
 * - Authentication middleware
 */

import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import {
  AuthenticatedRequest,
  authenticate,
  requireAuth,
  authorize,
  authorizeGraphAccess,
} from '../middleware';
import {
  ImportService,
  ImportMode,
  ConflictResolution,
  ImportOptions,
  MAX_IMPORT_SIZE_BYTES,
} from '../../services/ImportService';
import { AlthistoryExport } from '../../services/ExportService';
import { ValidationError } from '../../utils/errors';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ImportRoutes');

export interface ImportRouterConfig {
  dataDir: string;
  /** Disable rate limiting (for testing) */
  disableRateLimit?: boolean;
  /** Rate limit max requests per minute */
  rateLimitMaxRequests?: number;
  /** Disable authentication (for testing) */
  disableAuth?: boolean;
  /**
   * Test seam: a stand-in API key validator. When it is absent (production),
   * the routes use the application's real key check: `authenticate`,
   * `requireAuth` and `authorize('import')`, plus a graph-access check on the
   * graph a request names.
   */
  validateApiKey?: (apiKey: string) => Promise<{ valid: boolean; userId?: string }>;
  /** FIX #6: CSRF token validator function (optional) */
  validateCsrfToken?: (token: string, sessionId: string) => Promise<boolean>;
  /** FIX #6: Disable CSRF validation (for testing or API-only use) */
  disableCsrf?: boolean;
  /** FIX B#53: Enable idempotency key support (disabled by default) */
  enableIdempotency?: boolean;
  /** FIX B#53: TTL for idempotency keys in ms (default: 24 hours) */
  idempotencyTtlMs?: number;
}

// Rate limiting: track requests per IP
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute per IP

// FIX B#53: Idempotency key storage
interface IdempotencyEntry {
  response: {
    status: number;
    body: unknown;
  };
  createdAt: number;
  inProgress?: boolean;
}
const idempotencyMap = new Map<string, IdempotencyEntry>();
const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// FIX #8: Cleanup expired rate limit entries to prevent memory leak
function cleanupExpiredRateLimits(): void {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}

// Run rate limit cleanup every 5 minutes
const rateLimitCleanupInterval = setInterval(cleanupExpiredRateLimits, 5 * 60 * 1000);
// Ensure the interval doesn't prevent process exit
if (rateLimitCleanupInterval.unref) {
  rateLimitCleanupInterval.unref();
}

// Concurrent import protection with atomic locking using mutex pattern
// FIX: Added callback support for async job completion
interface ImportLockInfo {
  startedAt: number;
  jobId?: string;
  onComplete?: () => void;
}
const activeImports = new Map<string, ImportLockInfo>();
// FIX #10: Use a proper mutex for lock acquisition to prevent race conditions
const lockMutex = new Map<string, Promise<boolean>>();

// FIX A#15: Cleanup stale mutex entries that might leak
// Mutex entries are cleaned up synchronously before resolution (see acquireImportLock)
// but we add a periodic cleanup as a safety net for edge cases
function cleanupStaleMutexEntries(): void {
  // If a mutex entry exists but the corresponding activeImports entry doesn't,
  // it's likely a leaked entry that should be cleaned up
  for (const graphId of lockMutex.keys()) {
    if (!activeImports.has(graphId)) {
      // This entry is orphaned - the lock was never acquired or was released
      // but the mutex wasn't cleaned up. This shouldn't happen normally
      // but we clean it up as a safety measure.
      logger.debug('Cleaning up orphaned mutex entry', { graphId });
      lockMutex.delete(graphId);
    }
  }
}

// FIX A#15: Run mutex cleanup every 5 minutes alongside rate limit cleanup
const mutexCleanupInterval = setInterval(cleanupStaleMutexEntries, 5 * 60 * 1000);
if (mutexCleanupInterval.unref) {
  mutexCleanupInterval.unref();
}

// FIX B#53: Cleanup expired idempotency keys
function cleanupExpiredIdempotencyKeys(ttlMs: number): void {
  const now = Date.now();
  for (const [key, entry] of idempotencyMap) {
    // Remove entries that are expired and not in progress
    if (!entry.inProgress && now - entry.createdAt > ttlMs) {
      idempotencyMap.delete(key);
    }
  }
}

// Run idempotency cleanup every hour
const idempotencyCleanupInterval = setInterval(
  () => cleanupExpiredIdempotencyKeys(DEFAULT_IDEMPOTENCY_TTL_MS),
  60 * 60 * 1000
);
if (idempotencyCleanupInterval.unref) {
  idempotencyCleanupInterval.unref();
}

// FIX #6: Distributed lock interface for multi-instance deployments
export interface DistributedLockProvider {
  acquire(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
  extend(key: string, ttlMs: number): Promise<boolean>;
}

let distributedLockProvider: DistributedLockProvider | null = null;

/**
 * Set a distributed lock provider for multi-instance deployments
 */
export function setDistributedLockProvider(provider: DistributedLockProvider): void {
  distributedLockProvider = provider;
}

/**
 * Atomic lock acquisition for concurrent import protection
 * Supports both local and distributed locking
 * FIX #10: Use proper mutex to prevent TOCTOU race conditions
 * FIX #4: Fixed race condition in mutex cleanup
 */
async function acquireImportLock(graphId: string): Promise<boolean> {
  const lockKey = `import:${graphId}`;
  const ttlMs = 60 * 60 * 1000; // 1 hour TTL

  // FIX #6: Use distributed lock if provider is set
  if (distributedLockProvider) {
    const acquired = await distributedLockProvider.acquire(lockKey, ttlMs);
    if (acquired) {
      activeImports.set(graphId, { startedAt: Date.now() });
    }
    return acquired;
  }

  // FIX #10 + FIX #4: Use synchronous mutex pattern
  // Keep looping until we can acquire or determine it's locked.
  // Every exit from this loop is an explicit `return`.
  for (;;) {
    // Check if there's a pending mutex operation
    const existingMutex = lockMutex.get(graphId);
    if (existingMutex) {
      // Wait for it to complete, then retry
      await existingMutex;
      continue;
    }

    // Try to set our mutex - this is synchronous so no race here
    // Create a deferred promise
    let resolveAcquire!: (acquired: boolean) => void;
    const acquirePromise = new Promise<boolean>((resolve) => {
      resolveAcquire = resolve;
    });
    
    // Check again in case another request got in (belt and suspenders)
    if (lockMutex.has(graphId)) {
      continue;
    }
    
    lockMutex.set(graphId, acquirePromise);

    // Now we have exclusive access
    const alreadyLocked = activeImports.has(graphId);
    
    if (alreadyLocked) {
      // Already locked by another request
      // Delete mutex BEFORE resolving to prevent race
      lockMutex.delete(graphId);
      resolveAcquire(false);
      return false;
    }

    // Acquire the lock
    activeImports.set(graphId, { startedAt: Date.now() });
    // Delete mutex BEFORE resolving to prevent race
    lockMutex.delete(graphId);
    resolveAcquire(true);
    return true;
  }
}

// CRITICAL #3: Track locks being released to prevent double-release race conditions
const locksBeingReleased = new Set<string>();

/**
 * Release import lock
 * CRITICAL #3: Protected against double-release race conditions
 */
async function releaseImportLock(graphId: string): Promise<void> {
  // CRITICAL #3: Prevent double-release race condition
  if (locksBeingReleased.has(graphId)) {
    logger.debug('Lock release already in progress, skipping', { graphId });
    return;
  }
  
  const lockInfo = activeImports.get(graphId);
  if (!lockInfo) {
    logger.debug('Lock not found, nothing to release', { graphId });
    return;
  }
  
  // Mark as being released before async operations
  locksBeingReleased.add(graphId);
  
  try {
    // FIX #1: Call completion callback if registered
    if (lockInfo.onComplete) {
      try {
        lockInfo.onComplete();
      } catch (error) {
        logger.warn('Error in lock completion callback', { graphId, error });
      }
    }

    activeImports.delete(graphId);

    // FIX #6: Release distributed lock if provider is set
    if (distributedLockProvider) {
      try {
        await distributedLockProvider.release(`import:${graphId}`);
      } catch (error) {
        logger.warn('Failed to release distributed lock', { graphId, error });
      }
    }
  } finally {
    // Always remove from tracking set
    locksBeingReleased.delete(graphId);
  }
}

/**
 * FIX #1: Register a callback for when an async import completes
 */
function registerLockCompletionCallback(graphId: string, callback: () => void): void {
  const lockInfo = activeImports.get(graphId);
  if (lockInfo) {
    lockInfo.onComplete = callback;
  }
}

/**
 * Clean up stale locks (called periodically)
 */
function cleanupStaleLocks(): void {
  const staleThresholdMs = 60 * 60 * 1000; // 1 hour
  const now = Date.now();
  for (const [graphId, info] of activeImports) {
    if (now - info.startedAt > staleThresholdMs) {
      logger.warn('Cleaning up stale import lock', { graphId, startedAt: info.startedAt });
      releaseImportLock(graphId);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupStaleLocks, 10 * 60 * 1000);

/**
 * Rate limiting middleware factory
 */
function createRateLimiter(maxRequests: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    const entry = rateLimitMap.get(ip);
    if (entry) {
      if (now > entry.resetTime) {
        // Reset window
        rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
      } else if (entry.count >= maxRequests) {
        res.status(429).json({
          error: 'Too many requests',
          message: `Rate limit exceeded. Maximum ${maxRequests} requests per minute.`,
          retryAfter: Math.ceil((entry.resetTime - now) / 1000),
        });
        return;
      } else {
        entry.count++;
      }
    } else {
      rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    }

    next();
  };
}

/**
 * No-op middleware for when rate limiting is disabled
 */
function noRateLimit(_req: Request, _res: Response, next: NextFunction): void {
  next();
}

/**
 * Content length validation middleware (validates header)
 */
function validateContentLength(maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > maxBytes) {
      res.status(413).json({
        error: 'Payload too large',
        message: `Request body exceeds maximum size of ${maxBytes / 1024 / 1024}MB`,
        maxSize: maxBytes,
      });
      return;
    }
    next();
  };
}

/**
 * FIX B#16: Validate actual body size middleware
 * Content-Length header can be spoofed, so we also check the actual parsed body size
 * This runs after body-parser has already parsed the body
 */
function validateActualBodySize(maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // body-parser already parsed the body into req.body
    // We need to check its actual size
    if (req.body) {
      try {
        // Re-stringify to get actual byte size
        const bodyString = JSON.stringify(req.body);
        const actualSize = Buffer.byteLength(bodyString, 'utf8');
        
        if (actualSize > maxBytes) {
          logger.warn('Actual body size exceeds limit', {
            reportedSize: req.headers['content-length'],
            actualSize,
            maxSize: maxBytes,
          });
          res.status(413).json({
            error: 'Payload too large',
            message: `Request body (${Math.round(actualSize / 1024 / 1024 * 100) / 100}MB) exceeds maximum size of ${maxBytes / 1024 / 1024}MB`,
            maxSize: maxBytes,
            actualSize,
          });
          return;
        }
      } catch (error) {
        // If we can't stringify, let other validators handle it
        logger.warn('Could not validate body size', { error });
      }
    }
    next();
  };
}

/**
 * FIX B#53: Idempotency middleware factory
 * Ensures that retries of the same request return the same response
 */
function createIdempotencyMiddleware(config: ImportRouterConfig) {
  if (!config.enableIdempotency) {
    return (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    };
  }

  const ttlMs = config.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const idempotencyKey = req.headers['idempotency-key'] as string;
    
    // If no idempotency key provided, proceed normally
    if (!idempotencyKey) {
      next();
      return;
    }

    // Check if we have a cached response for this key
    const existing = idempotencyMap.get(idempotencyKey);
    
    if (existing) {
      // Check if the request is still in progress
      if (existing.inProgress) {
        res.status(409).json({
          error: 'Conflict',
          message: 'A request with this idempotency key is already in progress',
          idempotencyKey,
        });
        return;
      }

      // Check if the cached response has expired
      const now = Date.now();
      if (now - existing.createdAt > ttlMs) {
        // Expired, remove and process as new
        idempotencyMap.delete(idempotencyKey);
      } else {
        // Return cached response
        logger.info('Returning cached idempotent response', { idempotencyKey });
        res.status(existing.response.status).json(existing.response.body);
        return;
      }
    }

    // Mark this key as in progress
    idempotencyMap.set(idempotencyKey, {
      response: { status: 0, body: null },
      createdAt: Date.now(),
      inProgress: true,
    });

    // Store the idempotency key on the request for use in the response handler
    (req as Request & { idempotencyKey?: string }).idempotencyKey = idempotencyKey;

    // Intercept the response to cache it
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const entry = idempotencyMap.get(idempotencyKey);
      if (entry) {
        entry.response = {
          status: res.statusCode,
          body,
        };
        entry.inProgress = false;
      }
      return originalJson(body);
    };

    next();
  };
}

/**
 * FIX B#21: Request correlation ID middleware
 * Adds a unique correlation ID to each request for distributed tracing and debugging
 */
function addCorrelationId(req: Request, res: Response, next: NextFunction): void {
  // Use provided correlation ID or generate a new one
  const correlationId = (req.headers['x-correlation-id'] as string) ||
    (req.headers['x-request-id'] as string) ||
    `import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Store on request for use in handlers
  (req as Request & { correlationId?: string }).correlationId = correlationId;
  
  // Add to response headers so client can trace the request
  res.setHeader('X-Correlation-ID', correlationId);
  
  next();
}

/**
 * FIX #5: Authentication middleware factory
 */
function createAuthMiddleware(config: ImportRouterConfig): RequestHandler[] {
  if (config.disableAuth) {
    return [(_req: Request, _res: Response, next: NextFunction): void => {
      next();
    }];
  }

  if (!config.validateApiKey) {
    // The same chain the ingest, batch and keys routers use. Checking only that
    // a key header is present would let any string through.
    return [
      authenticate as RequestHandler,
      requireAuth as RequestHandler,
      authorize('import') as RequestHandler,
      (req: Request, _res: Response, next: NextFunction): void => {
        // Provenance, and the owner of any job this request starts.
        (req as Request & { userId?: string }).userId = (req as AuthenticatedRequest).apiKey?.id;
        next();
      },
    ];
  }

  const validateApiKey = config.validateApiKey;
  return [async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const apiKey = req.headers['x-api-key'] as string || req.headers['authorization']?.replace('Bearer ', '');
    
    if (!apiKey) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'API key required. Provide via X-API-Key header or Authorization: Bearer <key>',
      });
      return;
    }

    try {
      const result = await validateApiKey(apiKey);
      if (!result.valid) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid API key',
        });
        return;
      }
      // Store userId in request for provenance tracking
      (req as Request & { userId?: string }).userId = result.userId;
    } catch (error) {
      logger.error('API key validation error', { error });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to validate API key',
      });
      return;
    }

    next();
  }];
}

/**
 * Scope a request to the graph named by `field` in its body, with the same
 * check the graph routes apply to `:id`. Only the real key check carries an
 * API key with graph restrictions, so with auth disabled or a test validator
 * this does nothing.
 */
function createGraphAccessMiddleware(config: ImportRouterConfig, field: 'targetGraphId' | 'graphId'): RequestHandler {
  if (config.disableAuth || config.validateApiKey) {
    return (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    };
  }

  const check = authorizeGraphAccess((req) => req.body?.[field]) as RequestHandler;
  return (req: Request, res: Response, next: NextFunction): void => {
    const graphId: unknown = req.body?.[field];
    if (graphId !== undefined && typeof graphId !== 'string') {
      // A non-string id would skip the access check and reach the service.
      next(new ValidationError(`${field} must be a string`, field));
      return;
    }
    check(req, res, next);
  };
}

/**
 * FIX #6: CSRF protection middleware factory
 * Validates CSRF token for state-changing operations
 */
function createCsrfMiddleware(config: ImportRouterConfig) {
  if (config.disableCsrf) {
    return (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    };
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Only check for browser-based requests (not pure API calls)
    // API keys from Authorization header are exempt as they're not vulnerable to CSRF
    const hasApiKeyHeader = req.headers['x-api-key'] || req.headers['authorization'];
    if (hasApiKeyHeader) {
      // API-based authentication is not vulnerable to CSRF
      next();
      return;
    }

    // For cookie-based sessions, validate CSRF token
    const csrfToken = req.headers['x-csrf-token'] as string;
    const sessionId = req.cookies?.sessionId || req.headers['x-session-id'] as string;

    if (!csrfToken) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'CSRF token required. Provide via X-CSRF-Token header.',
      });
      return;
    }

    if (config.validateCsrfToken) {
      try {
        const valid = await config.validateCsrfToken(csrfToken, sessionId || '');
        if (!valid) {
          res.status(403).json({
            error: 'Forbidden',
            message: 'Invalid CSRF token',
          });
          return;
        }
      } catch (error) {
        logger.error('CSRF validation error', { error });
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to validate CSRF token',
        });
        return;
      }
    }

    next();
  };
}

/**
 * FIX #4: Concurrent import protection middleware (now uses atomic locking)
 */
async function checkConcurrentImport(req: Request, res: Response, next: NextFunction): Promise<void> {
  const graphId = req.body.targetGraphId;
  if (graphId) {
    const acquired = await acquireImportLock(graphId);
    if (!acquired) {
      res.status(409).json({
        error: 'Conflict',
        message: 'An import is already in progress for this graph. Please wait for it to complete.',
      });
      return;
    }
    // Store graphId for cleanup in finally block
    (req as Request & { importLockGraphId?: string }).importLockGraphId = graphId;
  }
  next();
}

/**
 * Create the import router
 */
/**
 * The router produced by {@link createImportRouter}, carrying the test-only
 * `cleanup` hook that shuts the backing ImportService down.
 */
export type ImportRouter = Router & { cleanup?: () => Promise<void> };

export function createImportRouter(config: ImportRouterConfig): Router {
  const router = Router();
  const importService = new ImportService({ dataDir: config.dataDir });

  // Initialize service
  importService.initialize().catch((err) => {
    logger.error('Failed to initialize ImportService', err);
  });

  // FIX B#21: Add correlation ID to all requests
  router.use(addCorrelationId);

  // Apply rate limiting to all routes (unless disabled)
  const rateLimitMiddleware = config.disableRateLimit 
    ? noRateLimit 
    : createRateLimiter(config.rateLimitMaxRequests || DEFAULT_RATE_LIMIT_MAX_REQUESTS);
  router.use(rateLimitMiddleware);

  // FIX #14: Use shared constant for content length validation (header check)
  router.use(validateContentLength(MAX_IMPORT_SIZE_BYTES));

  // FIX B#16: Also validate actual body size (after body-parser)
  router.use(validateActualBodySize(MAX_IMPORT_SIZE_BYTES));

  // FIX #5: Apply authentication to all routes
  const authMiddleware = createAuthMiddleware(config);
  router.use(authMiddleware);

  const targetGraphAccess = createGraphAccessMiddleware(config, 'targetGraphId');
  const graphAccess = createGraphAccessMiddleware(config, 'graphId');

  // FIX #6: Apply CSRF protection to state-changing routes
  const csrfMiddleware = createCsrfMiddleware(config);

  // FIX B#53: Apply idempotency key support to state-changing routes
  const idempotencyMiddleware = createIdempotencyMiddleware(config);

  /**
   * POST /api/import/validate
   * 
   * Validate import data format and structure without executing the import.
   * 
   * Request body: AlthistoryExport JSON
   * Response: ImportValidationResult
   */
  router.post('/validate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = req.body;

      if (!data || typeof data !== 'object') {
        throw new ValidationError('Request body must be a valid JSON object');
      }

      logger.info('Validating import data');
      const result = await importService.validateFormat(data);

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/import/preview
   * 
   * Generate a preview of what the import will do, including conflicts.
   * 
   * Request body:
   * {
   *   data: AlthistoryExport,
   *   targetGraphId?: string,
   *   mode: 'merge' | 'replace' | 'create-new'
   * }
   * 
   * Response: ImportPreview
   */
  router.post('/preview', targetGraphAccess, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { data, targetGraphId, mode = 'create-new' } = req.body;

      if (!data || typeof data !== 'object') {
        throw new ValidationError('Request body must include a valid "data" object');
      }

      // Validate mode
      const validModes: ImportMode[] = ['merge', 'replace', 'create-new'];
      if (!validModes.includes(mode)) {
        throw new ValidationError(`Invalid mode: ${mode}. Must be one of: ${validModes.join(', ')}`);
      }

      // For merge/replace modes, targetGraphId is required
      if ((mode === 'merge' || mode === 'replace') && !targetGraphId) {
        throw new ValidationError(`targetGraphId is required for mode: ${mode}`);
      }

      logger.info('Generating import preview', { mode, targetGraphId });

      const preview = await importService.preview(data as AlthistoryExport, {
        graphId: targetGraphId,
        mode,
        conflictResolution: 'skip', // Default for preview
      });

      res.json(preview);
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/import
   * 
   * Execute the import.
   * 
   * Request body:
   * {
   *   data: AlthistoryExport,
   *   targetGraphId?: string,
   *   mode: 'merge' | 'replace' | 'create-new',
   *   conflictResolution: 'skip' | 'overwrite' | 'rename' | 'manual',
   *   manualResolutions?: Record<string, 'skip' | 'overwrite' | 'rename'>,
   *   async?: boolean  // Force async execution
   * }
   * 
   * Response: ImportResult or { jobId: string, async: true } for async
   * FIX B#49: Consistent response shape
   */
  // FIX #6: CSRF protection on state-changing endpoint
  // FIX B#53: Idempotency key support for safe retries
  router.post('/', targetGraphAccess, csrfMiddleware, idempotencyMiddleware, checkConcurrentImport, async (req: Request, res: Response, next: NextFunction) => {
    const extReq = req as Request & { importLockGraphId?: string; userId?: string };
    try {
      const {
        data,
        targetGraphId,
        mode = 'create-new',
        conflictResolution = 'skip',
        manualResolutions,
        async: forceAsync = false,
      } = req.body;

      if (!data || typeof data !== 'object') {
        throw new ValidationError('Request body must include a valid "data" object');
      }

      // Validate mode
      const validModes: ImportMode[] = ['merge', 'replace', 'create-new'];
      if (!validModes.includes(mode)) {
        throw new ValidationError(`Invalid mode: ${mode}. Must be one of: ${validModes.join(', ')}`);
      }

      // Validate conflict resolution
      const validResolutions: Array<ConflictResolution | 'manual'> = [
        'skip',
        'overwrite',
        'rename',
        'manual',
      ];
      if (!validResolutions.includes(conflictResolution)) {
        throw new ValidationError(
          `Invalid conflictResolution: ${conflictResolution}. Must be one of: ${validResolutions.join(', ')}`
        );
      }

      // For merge/replace modes, targetGraphId is required
      if ((mode === 'merge' || mode === 'replace') && !targetGraphId) {
        throw new ValidationError(`targetGraphId is required for mode: ${mode}`);
      }

      // For manual resolution, manualResolutions map is required if there are conflicts
      if (conflictResolution === 'manual' && !manualResolutions) {
        // We'll allow this and let the service handle unresolved conflicts
        logger.warn('Manual conflict resolution selected but no manualResolutions provided');
      }

      // FIX #6: Include userId in options for provenance
      const options: ImportOptions = {
        graphId: targetGraphId,
        mode,
        conflictResolution,
        manualResolutions,
        userId: extReq.userId,
      };

      // Check if should use async import
      const shouldAsync = forceAsync || importService.shouldUseAsyncImport(data as AlthistoryExport);

      if (shouldAsync) {
        logger.info('Executing async import', {
          mode,
          targetGraphId,
          conflictResolution,
        });

        let jobId: string;
        try {
          const result = await importService.executeImportAsync(data as AlthistoryExport, options);
          jobId = result.jobId;
        } catch (asyncError) {
          // FIX #3: If async job creation fails, ensure lock is released
          logger.error('Async import setup failed', { targetGraphId, error: asyncError });
          // Lock will be released in finally block since importLockGraphId is still set
          throw asyncError;
        }
        
        // FIX #1: Register callback to release lock when async job completes
        if (targetGraphId) {
          const lockInfo = activeImports.get(targetGraphId);
          if (lockInfo) {
            lockInfo.jobId = jobId;
          }
          // Register completion callback that will be called when job finishes
          registerLockCompletionCallback(targetGraphId, () => {
            logger.info('Async import completed, lock released', { graphId: targetGraphId, jobId });
          });
          
          // Set up polling to check when job completes and release lock
          const pollForCompletion = async () => {
            try {
              const job = await importService.getImportJob(jobId);
              if (job && (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')) {
                await releaseImportLock(targetGraphId);
              } else if (job && job.status === 'processing') {
                // Still processing, check again in 1 second
                setTimeout(pollForCompletion, 1000);
              } else if (!job) {
                // FIX #3: Job not found, release lock to prevent deadlock
                logger.warn('Job not found during polling, releasing lock', { jobId, targetGraphId });
                await releaseImportLock(targetGraphId);
              }
            } catch (error) {
              logger.warn('Error polling for job completion', { jobId, error });
              // Release lock on error to prevent deadlock
              await releaseImportLock(targetGraphId);
            }
          };
          // Start polling after a short delay
          setTimeout(pollForCompletion, 500);
        }
        
        // Consistent async response shape
        res.status(202).json({ 
          success: true,
          async: true,
          jobId,
          message: 'Import started. Poll /api/import/jobs/:jobId for status.',
        });
        
        // Don't release lock here - polling will handle it when job completes
        extReq.importLockGraphId = undefined;
      } else {
        logger.info('Executing sync import', {
          mode,
          targetGraphId,
          conflictResolution,
        });

        const result = await importService.executeImport(data as AlthistoryExport, options);

        // FIX B#49: Add async: false for consistent response shape
        const response = { ...result, async: false };

        // Set appropriate status code based on result
        if (result.success) {
          res.status(201).json(response);
        } else {
          res.status(400).json(response);
        }
      }
    } catch (error) {
      next(error);
    } finally {
      // FIX #3: Always release lock on completion/error
      const graphId = extReq.importLockGraphId;
      if (graphId) {
        releaseImportLock(graphId);
      }
    }
  });

  /**
   * GET /api/import/jobs/:jobId
   * 
   * Get the status of an async import job.
   */
  router.get('/jobs/:jobId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { jobId } = req.params;

      if (!jobId) {
        throw new ValidationError('jobId is required');
      }

      const job = await importService.getImportJob(jobId, (req as Request & { userId?: string }).userId);

      if (!job) {
        res.status(404).json({
          error: 'Not found',
          message: `Import job ${jobId} not found`,
        });
        return;
      }

      res.json(job);
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/import/jobs/:jobId/cancel
   * 
   * Cancel an in-progress import job.
   */
  router.post('/jobs/:jobId/cancel', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { jobId } = req.params;

      if (!jobId) {
        throw new ValidationError('jobId is required');
      }

      const cancelled = importService.cancelImport(jobId, (req as Request & { userId?: string }).userId);

      if (cancelled) {
        res.json({
          message: 'Import cancellation requested',
          jobId,
        });
      } else {
        res.status(404).json({
          error: 'Not found',
          message: `Import job ${jobId} not found or already completed`,
        });
      }
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/import/validate-incremental
   * 
   * Validate new entities against existing graph data.
   * Checks if additions would cause conflicts or violations.
   * 
   * Request body:
   * {
   *   graphId: string,
   *   additions: {
   *     events?: Event[],
   *     arcs?: Arc[],
   *     relationships?: CausalRelationship[]
   *   }
   * }
   * 
   * Response: { valid: boolean, conflicts: ImportConflict[], wouldCreate: EntityCounts }
   */
  router.post('/validate-incremental', graphAccess, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { graphId, additions } = req.body;

      if (!graphId || typeof graphId !== 'string') {
        throw new ValidationError('graphId is required and must be a string');
      }

      if (!additions || typeof additions !== 'object') {
        throw new ValidationError('additions object is required');
      }

      logger.info('Validating incremental import', { graphId });

      // Convert additions to export format for validation
      const importData: AlthistoryExport = {
        version: '1.0',
        metadata: {
          graphId,
          graphName: 'Incremental Import',
          exportedAt: new Date().toISOString(),
          sourceVersion: '1.0.0',
          graphVersion: 0,
          checksum: '',
        },
        data: {
          events: additions.events || [],
          arcs: additions.arcs || [],
          causalRelationships: additions.relationships || [],
          inferredPressures: [],
        },
      };

      // Validate format
      const validation = await importService.validateFormat(importData);

      if (!validation.valid) {
        res.json({
          valid: false,
          conflicts: [],
          errors: validation.errors,
          wouldCreate: validation.summary,
        });
        return;
      }

      // Detect conflicts with existing data
      const conflicts = await importService.detectConflicts(importData, graphId, 'merge');

      // Filter to only error-level conflicts
      const errorConflicts = conflicts.filter((c) => c.severity === 'error');

      res.json({
        valid: errorConflicts.length === 0,
        conflicts,
        wouldCreate: {
          events: (additions.events || []).length,
          arcs: (additions.arcs || []).length,
          relationships: (additions.relationships || []).length,
          pressures: 0,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // Attach cleanup function to router for testing purposes
  (router as ImportRouter).cleanup = async () => {
    await importService.destroy();
  };

  return router;
}

export default createImportRouter;
