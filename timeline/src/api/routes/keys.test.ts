/**
 * Tests for API key management routes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { keyRoutes } from './keys';
import { errorHandler, RequestWithContainer, AuthenticatedRequest } from '@/api/middleware';
import { ApiKey, Permission, PERMISSION_GROUPS } from '@/models/ApiKey';

// Create mock auth service
let mockAuthService: any;

// Mock the middleware module
vi.mock('@/api/middleware', async () => {
  const actual = await vi.importActual('@/api/middleware');
  return {
    ...actual,
    authenticate: (req: any, res: any, next: any) => {
      req.isAuthenticated = req.get('X-API-Key') === 'valid-admin-key';
      if (req.isAuthenticated) {
        req.apiKey = {
          id: 'test-key-id',
          name: 'Test Key',
          keyPrefix: 'ak_test123',
          permissions: PERMISSION_GROUPS.admin,
          hasPermission: (p: Permission) => PERMISSION_GROUPS.admin.includes(p),
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
    authorize: () => (req: any, res: any, next: any) => next(),
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
      toJSON: () => ({ id: 'test-key-id', name: 'Test Key', keyPrefix: 'ak_test123', permissions: PERMISSION_GROUPS.admin }),
    };
    
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

    // Create fresh app for each test
    app = express();
    app.use(express.json());
    app.use((req: AuthenticatedRequest, res, next) => {
      req.requestId = 'test-request-id';
      req.startTime = Date.now();
      // Inject mock auth service into container
      req.container = {
        authService: mockAuthService,
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
