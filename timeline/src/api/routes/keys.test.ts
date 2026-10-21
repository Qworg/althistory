/**
 * Tests for API key management routes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { Request } from 'express';
import { keyRoutes } from './keys';
import { errorHandler } from '@/api/middleware';
import { Permission, PERMISSION_GROUPS } from '@/models/ApiKey';

// Create mock auth service
let mockAuthService: any;

// Mock the rate limiter, which counts the requests per key.
let mockRateLimitService: { getState: ReturnType<typeof vi.fn> };

// The key the auth service returns, so a test can make it return a different
// one for a given id.
let mockApiKeyRef: any;

// When the mocked rate limit windows reset.
let mockWindowResetAt = 0;

// Mock the middleware module
vi.mock('@/api/middleware', async () => {
  const actual = await vi.importActual('@/api/middleware');
  return {
    ...actual,
    authenticate: (req: any, res: any, next: any) => {
      const presented = req.get('X-API-Key');
      const isAdmin = presented === 'valid-admin-key';
      const isReadOnly = presented === 'valid-read-key';
      req.isAuthenticated = isAdmin || isReadOnly;
      if (req.isAuthenticated) {
        const permissions = isAdmin ? PERMISSION_GROUPS.admin : ['read:events'];
        req.apiKey = {
          id: 'test-key-id',
          name: 'Test Key',
          keyPrefix: 'ak_test123',
          permissions,
          hasPermission: (p: Permission) => permissions.includes(p),
          hasAnyPermission: () => true,
          canAccessGraph: () => true,
          rateLimit: { requestsPerMinute: 60, requestsPerHour: 1000, requestsPerDay: 10000 },
          toJSON: () => ({ id: 'test-key-id', name: 'Test Key', keyPrefix: 'ak_test123', permissions: PERMISSION_GROUPS.admin }),
        };
      }
      next();
    },
    requireAuth: (req: any, res: any, next: any) => {
      if (!req.isAuthenticated) {
        return res.status(401).json({ error: { message: 'API key is required' } });
      }
      next();
    },
    // The permission is enforced, so a route that forgot `authorize('admin')`
    // would fail the tests that check a read-only key is turned away.
    authorize: (permission: Permission) => (req: any, res: any, next: any) => {
      if (req.apiKey?.hasPermission?.(permission)) {
        return next();
      }
      return res.status(403).json({ error: { message: 'Forbidden' } });
    },
    rateLimit: () => (req: any, res: any, next: any) => next(),
    asyncHandler: (fn: any) => (req: any, res: any, next: any) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    },
  };
});

// Setup Express app
let app: express.Application;

describe('Keys Routes', () => {
  beforeEach(() => {
    const mockApiKey = {
      id: 'test-key-id',
      name: 'Test Key',
      keyPrefix: 'ak_test123',
      permissions: PERMISSION_GROUPS.admin,
      rateLimit: {
        requestsPerMinute: 60,
        requestsPerHour: 1000,
        requestsPerDay: 10000,
        batchSizeLimit: 1000,
        concurrentStreams: 5,
      },
      toJSON: () => ({ id: 'test-key-id', name: 'Test Key', keyPrefix: 'ak_test123', permissions: PERMISSION_GROUPS.admin }),
    };
    
    mockApiKeyRef = mockApiKey;

    mockAuthService = {
      listApiKeys: vi.fn().mockResolvedValue([mockApiKey]),
      getApiKey: vi.fn().mockResolvedValue(mockApiKey),
      createApiKey: vi.fn().mockResolvedValue({
        id: 'new-key-id',
        key: 'ak_newkey12345678901234567890',
        keyPrefix: 'ak_newkey1',
        name: 'New Key',
        permissions: ['read:events'],
        rateLimit: { requestsPerMinute: 60, requestsPerHour: 1000, requestsPerDay: 10000 },
        createdAt: new Date().toISOString(),
      }),
      updateApiKey: vi.fn().mockResolvedValue(mockApiKey),
      revokeApiKey: vi.fn().mockResolvedValue(true),
      deleteApiKey: vi.fn().mockResolvedValue(true),
      getApiKeyStats: vi.fn().mockResolvedValue({ total: 5, active: 4, inactive: 1, expired: 0 }),
    };

    // The windows are still running: a window that has already reset reports
    // a count of zero.
    const resetAt = Date.now() + 60_000;
    mockWindowResetAt = resetAt;
    mockRateLimitService = {
      getState: vi.fn().mockReturnValue({
        keyId: 'test-key-id',
        minute: { count: 12, resetAt },
        hour: { count: 340, resetAt },
        day: { count: 5600, resetAt },
      }),
    };

    // Create fresh app for each test
    app = express();
    app.use(express.json());
    app.use((req: Request, res, next) => {
      req.requestId = 'test-request-id';
      req.startTime = Date.now();
      // Inject mock auth service into container
      req.container = {
        authService: mockAuthService,
        rateLimitService: mockRateLimitService,
      } as any;
      next();
    });
    app.use('/api/keys', keyRoutes);
    app.use(errorHandler);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/keys', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/keys')
        .expect(401);

      expect(response.body.error.message).toBe('API key is required');
    });

    it('should list all keys for admin', async () => {
      const response = await request(app)
        .get('/api/keys')
        .set('X-API-Key', 'valid-admin-key')
        .expect(200);

      expect(response.body.keys).toBeDefined();
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.total).toBe(1);
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.pageSize).toBe(20);
      expect(mockAuthService.listApiKeys).toHaveBeenCalled();
    });

    it('should filter active only keys', async () => {
      await request(app)
        .get('/api/keys?activeOnly=true')
        .set('X-API-Key', 'valid-admin-key')
        .expect(200);

      expect(mockAuthService.listApiKeys).toHaveBeenCalledWith({ activeOnly: true });
    });
  });

  describe('GET /api/keys/me', () => {
    it('should return current key info', async () => {
      const response = await request(app)
        .get('/api/keys/me')
        .set('X-API-Key', 'valid-admin-key')
        .expect(200);

      expect(response.body.name).toBe('Test Key');
      expect(response.body.keyHash).toBeUndefined(); // Should not expose hash
    });
  });

  describe('GET /api/keys/stats', () => {
    it('should return key statistics', async () => {
      const response = await request(app)
        .get('/api/keys/stats')
        .set('X-API-Key', 'valid-admin-key')
        .expect(200);

      expect(response.body.total).toBe(5);
      expect(response.body.active).toBe(4);
      expect(mockAuthService.getApiKeyStats).toHaveBeenCalled();
    });
  });

  describe('GET /api/keys/:id/usage', () => {
    it('should return 401 without authentication', async () => {
      await request(app)
        .get('/api/keys/test-key-id/usage')
        .expect(401);
    });

    it('should turn away a key without the admin permission', async () => {
      const response = await request(app)
        .get('/api/keys/test-key-id/usage')
        .set('X-API-Key', 'valid-read-key')
        .expect(403);

      expect(response.body.error.message).toBe('Forbidden');
      expect(mockRateLimitService.getState).not.toHaveBeenCalled();
    });

    it('should return the rate limits and the current usage', async () => {
      const response = await request(app)
        .get('/api/keys/test-key-id/usage')
        .set('X-API-Key', 'valid-admin-key')
        .expect(200);

      expect(response.body.keyId).toBe('test-key-id');
      expect(response.body.rateLimit).toEqual({
        requestsPerMinute: 60,
        requestsPerHour: 1000,
        requestsPerDay: 10000,
        batchSizeLimit: 1000,
        concurrentStreams: 5,
      });
      expect(response.body.currentUsage.minute.count).toBe(12);
      expect(response.body.currentUsage.hour.count).toBe(340);
      expect(response.body.currentUsage.day.count).toBe(5600);
      // The windows are running, so they keep their reset times.
      expect(response.body.currentUsage.minute.resetAt).toBe(mockWindowResetAt);
    });

    it('should read the usage of the key that was asked for', async () => {
      const otherKey = {
        id: 'other-key-id',
        name: 'Other Key',
        keyPrefix: 'ak_other123',
        permissions: PERMISSION_GROUPS.admin,
        rateLimit: {
          requestsPerMinute: 30,
          requestsPerHour: 500,
          requestsPerDay: 5000,
          batchSizeLimit: 500,
          concurrentStreams: 2,
        },
        toJSON: () => ({ id: 'other-key-id', name: 'Other Key' }),
      };
      mockAuthService.getApiKey.mockImplementation(async (id: string) =>
        id === 'other-key-id' ? otherKey : mockApiKeyRef
      );

      const response = await request(app)
        .get('/api/keys/other-key-id/usage')
        .set('X-API-Key', 'valid-admin-key')
        .expect(200);

      expect(mockRateLimitService.getState).toHaveBeenCalledWith('other-key-id');
      // The response has to describe the key that was asked for, not the one
      // the mock happened to return first.
      expect(response.body.keyId).toBe('other-key-id');
      expect(response.body.rateLimit.requestsPerMinute).toBe(30);
    });

    it('should report zero for a window that has already reset', async () => {
      const past = Date.now() - 60_000;
      mockRateLimitService.getState.mockReturnValue({
        keyId: 'test-key-id',
        minute: { count: 59, resetAt: past },
        hour: { count: 340, resetAt: Date.now() + 60_000 },
        day: { count: 5600, resetAt: Date.now() + 60_000 },
      });

      const response = await request(app)
        .get('/api/keys/test-key-id/usage')
        .set('X-API-Key', 'valid-admin-key')
        .expect(200);

      // The minute window reset an hour ago: the limiter would let the key
      // make the full allowance again, so the usage has to read as zero.
      expect(response.body.currentUsage.minute.count).toBe(0);
      expect(response.body.currentUsage.hour.count).toBe(340);
      // A window that is not running has no reset time either.
      expect(response.body.currentUsage.minute.resetAt).toBeNull();
      // The hour window is still running, so it keeps its reset time.
      expect(response.body.currentUsage.hour.resetAt).toBeGreaterThan(Date.now());
    });

    it('should report zero usage for a key that was never used', async () => {
      mockRateLimitService.getState.mockReturnValue(null);

      const response = await request(app)
        .get('/api/keys/test-key-id/usage')
        .set('X-API-Key', 'valid-admin-key')
        .expect(200);

      expect(response.body.currentUsage.minute.count).toBe(0);
      expect(response.body.currentUsage.hour.count).toBe(0);
      expect(response.body.currentUsage.day.count).toBe(0);
      // No window is running, so there is no moment at which it resets.
      expect(response.body.currentUsage.minute.resetAt).toBeNull();
      expect(response.body.currentUsage.hour.resetAt).toBeNull();
      expect(response.body.currentUsage.day.resetAt).toBeNull();
    });

    it('should return 404 for a key that does not exist', async () => {
      mockAuthService.getApiKey.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/keys/missing/usage')
        .set('X-API-Key', 'valid-admin-key')
        .expect(404);

      // The frontend tells "the key is gone" from "this server has no such
      // route" by this code, so it has to be there.
      expect(response.body.error.code).toBe('KEY_NOT_FOUND');
    });
  });

  describe('POST /api/keys', () => {
    it('should create a new key', async () => {
      const response = await request(app)
        .post('/api/keys')
        .set('X-API-Key', 'valid-admin-key')
        .send({
          name: 'New Key',
          permissions: ['read:events'],
        })
        .expect(201);

      expect(response.body.id).toBe('new-key-id');
      expect(response.body.key).toMatch(/^ak_/);
      expect(mockAuthService.createApiKey).toHaveBeenCalled();
    });

    it('should require name', async () => {
      const response = await request(app)
        .post('/api/keys')
        .set('X-API-Key', 'valid-admin-key')
        .send({
          permissions: ['read:events'],
        })
        .expect(400);

      expect(response.body.error.message).toBe('Name is required');
    });

    it('should require permissions', async () => {
      const response = await request(app)
        .post('/api/keys')
        .set('X-API-Key', 'valid-admin-key')
        .send({
          name: 'No Perms Key',
        })
        .expect(400);

      expect(response.body.error.message).toBe('At least one permission is required');
    });

    it('should reject invalid permissions', async () => {
      const response = await request(app)
        .post('/api/keys')
        .set('X-API-Key', 'valid-admin-key')
        .send({
          name: 'Invalid Perms Key',
          permissions: ['invalid:permission'],
        })
        .expect(400);

      expect(response.body.error.message).toContain('Invalid permissions');
    });
  });

  describe('GET /api/keys/:id', () => {
    it('should get key by ID', async () => {
      const response = await request(app)
        .get('/api/keys/test-key-id')
        .set('X-API-Key', 'valid-admin-key')
        .expect(200);

      expect(response.body.id).toBe('test-key-id');
      expect(mockAuthService.getApiKey).toHaveBeenCalledWith('test-key-id');
    });

    it('should return 404 for non-existent key', async () => {
      mockAuthService.getApiKey.mockResolvedValue(null);

      await request(app)
        .get('/api/keys/non-existent')
        .set('X-API-Key', 'valid-admin-key')
        .expect(404);
    });
  });

  describe('PUT /api/keys/:id', () => {
    it('should update key', async () => {
      await request(app)
        .put('/api/keys/test-key-id')
        .set('X-API-Key', 'valid-admin-key')
        .send({
          name: 'Updated Name',
        })
        .expect(200);

      expect(mockAuthService.updateApiKey).toHaveBeenCalledWith('test-key-id', { name: 'Updated Name' });
    });
  });

  describe('POST /api/keys/:id/revoke', () => {
    it('should revoke a key', async () => {
      // Use a different key ID than the authenticated key
      const response = await request(app)
        .post('/api/keys/other-key-id/revoke')
        .set('X-API-Key', 'valid-admin-key')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockAuthService.revokeApiKey).toHaveBeenCalledWith('other-key-id');
    });

    it('should not allow revoking own key', async () => {
      await request(app)
        .post('/api/keys/test-key-id/revoke')
        .set('X-API-Key', 'valid-admin-key')
        .expect(400);
    });
  });

  describe('DELETE /api/keys/:id', () => {
    it('should delete a key', async () => {
      const response = await request(app)
        .delete('/api/keys/other-key-id')
        .set('X-API-Key', 'valid-admin-key')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockAuthService.deleteApiKey).toHaveBeenCalledWith('other-key-id');
    });

    it('should not allow deleting own key', async () => {
      await request(app)
        .delete('/api/keys/test-key-id')
        .set('X-API-Key', 'valid-admin-key')
        .expect(400);
    });
  });
});
