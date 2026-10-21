/**
 * API key management routes
 */

import { Router, Response, RequestHandler } from 'express';
import {
  AuthenticatedRequest,
  authenticate,
  requireAuth,
  authorize,
  rateLimit,
  asyncHandler,
} from '../middleware';
import { CreateApiKeyRequest, UpdateApiKeyRequest, Permission } from '@/models/ApiKey';
import { createLogger } from '@/utils/logger';
import { currentUsageWindow } from '@/services/RateLimitService';

const logger = createLogger('KeyRoutes');

export const keyRoutes = Router();

// Pagination defaults
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * List all API keys with pagination
 * GET /api/keys
 * Query params:
 *   - activeOnly: boolean - filter to active keys only
 *   - page: number - page number (1-based, default 1)
 *   - pageSize: number - items per page (default 20, max 100)
 * Requires: admin permission
 */
keyRoutes.get(
  '/',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('admin') as RequestHandler,
  rateLimit() as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const authService = req.container.authService;
      const activeOnly = req.query.activeOnly === 'true';
      
      // Parse pagination params
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const requestedPageSize = parseInt(req.query.pageSize as string, 10) || DEFAULT_PAGE_SIZE;
      const pageSize = Math.min(Math.max(1, requestedPageSize), MAX_PAGE_SIZE);
      
      // Get all keys (filtered by activeOnly)
      const allKeys = await authService.listApiKeys({ activeOnly });
      const total = allKeys.length;
      
      // Calculate pagination
      const totalPages = Math.ceil(total / pageSize);
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedKeys = allKeys.slice(startIndex, endIndex);

      // Return keys without the hash (toJSON removes it)
      res.json({
        keys: paginatedKeys.map((k) => k.toJSON()),
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      });
    } catch (error) {
      logger.error('Error listing keys', error);
      res.status(500).json({
        error: { message: 'Failed to list API keys' },
      });
    }
  })
);

/**
 * Get current user's API key info (must come before /:id route)
 * GET /api/keys/me
 * Requires: authentication
 */
keyRoutes.get(
  '/me',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  rateLimit() as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.apiKey) {
      return res.status(401).json({
        error: { message: 'Not authenticated' },
      });
    }

    // Return current key info without the hash
    res.json(req.apiKey.toJSON());
  })
);

/**
 * Get the current usage of one API key.
 *
 * GET /api/keys/:id/usage
 *
 * The rate limits are the ones configured on the key; the usage is what the
 * rate limiter has counted against them in the window that is still running.
 * A key that has not been used yet has no window, and its usage reads as zero
 * with no reset time.
 */
keyRoutes.get(
  '/:id/usage',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('admin') as RequestHandler,
  rateLimit() as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const authService = req.container.authService;
      const { id } = req.params;
      const key = await authService.getApiKey(id);

      if (!key) {
        return res.status(404).json({
          error: { message: `API key not found: ${id}`, code: 'KEY_NOT_FOUND' },
        });
      }

      const state = req.container.rateLimitService.getState(id);
      const now = Date.now();

      // A key that has never been used has no window at all, and a window
      // that has already reset is not running either: both read as a count of
      // zero with no reset time.
      const window_ = (w: { count: number; resetAt: number | null } | undefined): {
        count: number;
        resetAt: number | null;
      } =>
        w ? currentUsageWindow(w, now) : { count: 0, resetAt: null };

      res.json({
        keyId: key.id,
        rateLimit: key.rateLimit,
        currentUsage: {
          minute: window_(state?.minute),
          hour: window_(state?.hour),
          day: window_(state?.day),
        },
      });
    } catch (error) {
      logger.error('Error getting key usage', error);
      res.status(500).json({
        error: { message: 'Failed to get API key usage' },
      });
    }
  })
);

/**
 * Get API key statistics
 * GET /api/keys/stats
 * Requires: admin permission
 */
keyRoutes.get(
  '/stats',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('admin') as RequestHandler,
  rateLimit() as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const authService = req.container.authService;
      const stats = await authService.getApiKeyStats();
      res.json(stats);
    } catch (error) {
      logger.error('Error getting stats', error);
      res.status(500).json({
        error: { message: 'Failed to get API key statistics' },
      });
    }
  })
);

/**
 * Create a new API key
 * POST /api/keys
 * Requires: admin permission
 * Body: CreateApiKeyRequest
 * Returns: CreateApiKeyResponse (with full key, shown only once)
 */
keyRoutes.post(
  '/',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('admin') as RequestHandler,
  rateLimit() as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const authService = req.container.authService;
      const request = req.body as CreateApiKeyRequest;

      // Validate request
      if (!request.name || typeof request.name !== 'string') {
        return res.status(400).json({
          error: { message: 'Name is required' },
        });
      }

      if (!request.permissions || !Array.isArray(request.permissions) || request.permissions.length === 0) {
        return res.status(400).json({
          error: { message: 'At least one permission is required' },
        });
      }

      // Validate permissions
      const validPermissions: Permission[] = [
        'read:events', 'write:events',
        'read:arcs', 'write:arcs',
        'read:relationships', 'write:relationships',
        'read:graphs', 'write:graphs',
        'export', 'import', 'ingest', 'admin',
      ];

      const invalidPermissions = request.permissions.filter(
        (p) => !validPermissions.includes(p)
      );

      if (invalidPermissions.length > 0) {
        return res.status(400).json({
          error: { message: `Invalid permissions: ${invalidPermissions.join(', ')}` },
        });
      }

      // Validate expiration date if provided
      if (request.expiresAt) {
        const expirationDate = new Date(request.expiresAt);
        if (isNaN(expirationDate.getTime())) {
          return res.status(400).json({
            error: { message: 'Invalid expiration date format' },
          });
        }
        if (expirationDate <= new Date()) {
          return res.status(400).json({
            error: { message: 'Expiration date must be in the future' },
          });
        }
      }

      const response = await authService.createApiKey(request);

      logger.info('Created new API key', { keyPrefix: response.keyPrefix, name: response.name });

      // Return 201 Created with full key (shown only once)
      res.status(201).json(response);
    } catch (error) {
      logger.error('Error creating key', error);
      res.status(500).json({
        error: { message: 'Failed to create API key' },
      });
    }
  })
);

/**
 * Get a specific API key
 * GET /api/keys/:id
 * Requires: admin permission
 */
keyRoutes.get(
  '/:id',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('admin') as RequestHandler,
  rateLimit() as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const authService = req.container.authService;
      const { id } = req.params;
      const key = await authService.getApiKey(id);

      if (!key) {
        return res.status(404).json({
          error: { message: `API key not found: ${id}` },
        });
      }

      // Return key without the hash
      res.json(key.toJSON());
    } catch (error) {
      logger.error('Error getting key', error);
      res.status(500).json({
        error: { message: 'Failed to get API key' },
      });
    }
  })
);

/**
 * Update an API key
 * PUT /api/keys/:id
 * Requires: admin permission
 * Body: UpdateApiKeyRequest
 */
keyRoutes.put(
  '/:id',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('admin') as RequestHandler,
  rateLimit() as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const authService = req.container.authService;
      const { id } = req.params;
      const updates = req.body as UpdateApiKeyRequest;

      // Validate permissions if provided
      if (updates.permissions) {
        const validPermissions: Permission[] = [
          'read:events', 'write:events',
          'read:arcs', 'write:arcs',
          'read:relationships', 'write:relationships',
          'read:graphs', 'write:graphs',
          'export', 'import', 'ingest', 'admin',
        ];

        const invalidPermissions = updates.permissions.filter(
          (p) => !validPermissions.includes(p)
        );

        if (invalidPermissions.length > 0) {
          return res.status(400).json({
            error: { message: `Invalid permissions: ${invalidPermissions.join(', ')}` },
          });
        }
      }

      const key = await authService.updateApiKey(id, updates);

      if (!key) {
        return res.status(404).json({
          error: { message: `API key not found: ${id}` },
        });
      }

      logger.info('Updated API key', { keyPrefix: key.keyPrefix, name: key.name });

      // Return updated key without the hash
      res.json(key.toJSON());
    } catch (error) {
      logger.error('Error updating key', error);
      res.status(500).json({
        error: { message: 'Failed to update API key' },
      });
    }
  })
);

/**
 * Revoke an API key (soft delete)
 * POST /api/keys/:id/revoke
 * Requires: admin permission
 */
keyRoutes.post(
  '/:id/revoke',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('admin') as RequestHandler,
  rateLimit() as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const authService = req.container.authService;
      const { id } = req.params;

      // Prevent revoking own key
      if (req.apiKey && req.apiKey.id === id) {
        return res.status(400).json({
          error: { message: 'Cannot revoke your own API key' },
        });
      }

      const success = await authService.revokeApiKey(id);

      if (!success) {
        return res.status(404).json({
          error: { message: `API key not found: ${id}` },
        });
      }

      logger.info('Revoked API key', { keyId: id });

      res.json({ success: true, message: 'API key revoked' });
    } catch (error) {
      logger.error('Error revoking key', error);
      res.status(500).json({
        error: { message: 'Failed to revoke API key' },
      });
    }
  })
);

/**
 * Delete an API key permanently
 * DELETE /api/keys/:id
 * Requires: admin permission
 */
keyRoutes.delete(
  '/:id',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('admin') as RequestHandler,
  rateLimit() as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const authService = req.container.authService;
      const { id } = req.params;

      // Prevent deleting own key
      if (req.apiKey && req.apiKey.id === id) {
        return res.status(400).json({
          error: { message: 'Cannot delete your own API key' },
        });
      }

      const success = await authService.deleteApiKey(id);

      if (!success) {
        return res.status(404).json({
          error: { message: `API key not found: ${id}` },
        });
      }

      logger.info('Deleted API key', { keyId: id });

      res.json({ success: true, message: 'API key deleted' });
    } catch (error) {
      logger.error('Error deleting key', error);
      res.status(500).json({
        error: { message: 'Failed to delete API key' },
      });
    }
  })
);
