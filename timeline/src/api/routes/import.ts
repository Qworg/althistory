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
 * - Concurrent import protection
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
}

// Rate limiting: track requests per IP
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute per IP

// Concurrent import protection
const activeImports = new Set<string>();

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
 * Concurrent import protection middleware
 */
function checkConcurrentImport(req: Request, res: Response, next: NextFunction): void {
  const graphId = req.body.targetGraphId;
  if (graphId && activeImports.has(graphId)) {
    res.status(409).json({
      error: 'Conflict',
      message: 'An import is already in progress for this graph. Please wait for it to complete.',
    });
    return;
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
   * Response: ImportResult or { jobId: string } for async
   */
  router.post('/', checkConcurrentImport, async (req: Request, res: Response, next: NextFunction) => {
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

      const options: ImportOptions = {
        graphId: targetGraphId,
        mode,
        conflictResolution,
        manualResolutions,
      };

      // Check if should use async import
      const shouldAsync = forceAsync || importService.shouldUseAsyncImport(data as AlthistoryExport);

      if (shouldAsync) {
        logger.info('Executing async import', {
          mode,
          targetGraphId,
          conflictResolution,
        });

        // Track active import
        if (targetGraphId) {
          activeImports.add(targetGraphId);
        }

        try {
          const { jobId } = await importService.executeImportAsync(data as AlthistoryExport, options);
          res.status(202).json({ 
            jobId,
            message: 'Import started. Poll /api/import/jobs/:jobId for status.',
            async: true,
          });
        } finally {
          // Will be removed when job completes, but remove if creation fails
          if (targetGraphId) {
            // Note: job completion will handle cleanup in the service
          }
        }
      } else {
        logger.info('Executing sync import', {
          mode,
          targetGraphId,
          conflictResolution,
        });

        // Track active import
        if (targetGraphId) {
          activeImports.add(targetGraphId);
        }

        try {
          const result = await importService.executeImport(data as AlthistoryExport, options);

          // Set appropriate status code based on result
          if (result.success) {
            res.status(201).json(result);
          } else {
            res.status(400).json(result);
          }
        } finally {
          if (targetGraphId) {
            activeImports.delete(targetGraphId);
          }
        }
      }
    } catch (error) {
      // Clean up on error
      const targetGraphId = req.body.targetGraphId;
      if (targetGraphId) {
        activeImports.delete(targetGraphId);
      }
      next(error);
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
