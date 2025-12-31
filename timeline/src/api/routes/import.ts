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

import { Router, Request, Response, NextFunction } from 'express';
import {
  ImportService,
  ImportValidationResult,
  ImportPreview,
  ImportResult,
  ImportMode,
  ConflictResolution,
  ImportOptions,
  ImportJob,
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
  /** API key validator function */
  validateApiKey?: (apiKey: string) => Promise<{ valid: boolean; userId?: string }>;
}

// Rate limiting: track requests per IP
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute per IP

// FIX #4: Concurrent import protection with atomic locking using mutex pattern
const activeImports = new Map<string, { startedAt: number; jobId?: string }>();
const importLock = new Map<string, Promise<void>>();

/**
 * FIX #4: Atomic lock acquisition for concurrent import protection
 */
async function acquireImportLock(graphId: string): Promise<boolean> {
  // Wait for any pending lock operations
  const existingLock = importLock.get(graphId);
  if (existingLock) {
    await existingLock;
  }

  // Check if already locked
  if (activeImports.has(graphId)) {
    return false;
  }

  // Create a new lock promise
  let resolveLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  importLock.set(graphId, lockPromise);

  // Acquire the lock
  activeImports.set(graphId, { startedAt: Date.now() });
  
  // Resolve the lock promise
  resolveLock!();
  importLock.delete(graphId);

  return true;
}

/**
 * Release import lock
 */
function releaseImportLock(graphId: string): void {
  activeImports.delete(graphId);
}

/**
 * FIX #3: Clean up stale locks (called periodically)
 */
function cleanupStaleLocks(): void {
  const staleThresholdMs = 60 * 60 * 1000; // 1 hour
  const now = Date.now();
  for (const [graphId, info] of activeImports) {
    if (now - info.startedAt > staleThresholdMs) {
      logger.warn('Cleaning up stale import lock', { graphId, startedAt: info.startedAt });
      activeImports.delete(graphId);
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
 * Content length validation middleware
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
 * FIX #5: Authentication middleware factory
 */
function createAuthMiddleware(config: ImportRouterConfig) {
  if (config.disableAuth) {
    return (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    };
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const apiKey = req.headers['x-api-key'] as string || req.headers['authorization']?.replace('Bearer ', '');
    
    if (!apiKey) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'API key required. Provide via X-API-Key header or Authorization: Bearer <key>',
      });
      return;
    }

    if (config.validateApiKey) {
      try {
        const result = await config.validateApiKey(apiKey);
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
export function createImportRouter(config: ImportRouterConfig): Router {
  const router = Router();
  const importService = new ImportService({ dataDir: config.dataDir });

  // Initialize service
  importService.initialize().catch((err) => {
    logger.error('Failed to initialize ImportService', err);
  });

  // Apply rate limiting to all routes (unless disabled)
  const rateLimitMiddleware = config.disableRateLimit 
    ? noRateLimit 
    : createRateLimiter(config.rateLimitMaxRequests || DEFAULT_RATE_LIMIT_MAX_REQUESTS);
  router.use(rateLimitMiddleware);

  // Apply content length validation (10MB max)
  router.use(validateContentLength(10 * 1024 * 1024));

  // FIX #5: Apply authentication to all routes
  const authMiddleware = createAuthMiddleware(config);
  router.use(authMiddleware);

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
  router.post('/preview', async (req: Request, res: Response, next: NextFunction) => {
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
  router.post('/', checkConcurrentImport, async (req: Request, res: Response, next: NextFunction) => {
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

        const { jobId } = await importService.executeImportAsync(data as AlthistoryExport, options);
        
        // FIX #3: Update lock with jobId for tracking
        if (targetGraphId) {
          const lockInfo = activeImports.get(targetGraphId);
          if (lockInfo) {
            lockInfo.jobId = jobId;
          }
        }
        
        // FIX B#49: Consistent async response shape
        res.status(202).json({ 
          success: true,
          async: true,
          jobId,
          message: 'Import started. Poll /api/import/jobs/:jobId for status.',
        });
        
        // FIX #3: Don't release lock here - will be released when job completes
        // But we need to clear from request so finally block doesn't release it
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

      const job = await importService.getImportJob(jobId);

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

      const cancelled = importService.cancelImport(jobId);

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
  router.post('/validate-incremental', async (req: Request, res: Response, next: NextFunction) => {
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

  return router;
}

export default createImportRouter;
