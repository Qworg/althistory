import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import {
  extractApiKeyFromRequest,
  authenticate,
  requireAuth,
  AuthenticatedRequest,
} from './middleware';
import { ApiKey, type Permission } from '@/models/ApiKey';

describe('Authentication Middleware', () => {
  describe('extractApiKeyFromRequest', () => {
    it('extracts key from X-API-Key header', () => {
      const req = {
        get: vi.fn((header: string) => (header === 'X-API-Key' ? 'ak_my-api-key' : undefined)),
      } as unknown as Request;

      expect(extractApiKeyFromRequest(req)).toBe('ak_my-api-key');
    });

    it('extracts key from Authorization Bearer header', () => {
      const req = {
        get: vi.fn((header: string) => (header === 'Authorization' ? 'Bearer ak_bearer-key' : undefined)),
      } as unknown as Request;

      expect(extractApiKeyFromRequest(req)).toBe('ak_bearer-key');
    });

    it('extracts key from Authorization ApiKey header', () => {
      const req = {
        get: vi.fn((header: string) => (header === 'Authorization' ? 'ApiKey ak_apikey-key' : undefined)),
      } as unknown as Request;

      expect(extractApiKeyFromRequest(req)).toBe('ak_apikey-key');
    });

    it('extracts raw token from Authorization header', () => {
      const req = {
        get: vi.fn((header: string) => (header === 'Authorization' ? 'ak_raw-key' : undefined)),
      } as unknown as Request;

      expect(extractApiKeyFromRequest(req)).toBe('ak_raw-key');
    });

    it('prefers X-API-Key header over Authorization header', () => {
      const req = {
        get: vi.fn((header: string) => {
          if (header === 'X-API-Key') return 'ak_header-key';
          if (header === 'Authorization') return 'Bearer ak_bearer-key';
          return undefined;
        }),
      } as unknown as Request;

      expect(extractApiKeyFromRequest(req)).toBe('ak_header-key');
    });

    it('returns undefined when no auth headers are present', () => {
      const req = {
        get: vi.fn(() => undefined),
      } as unknown as Request;

      expect(extractApiKeyFromRequest(req)).toBeUndefined();
    });
  });

  describe('authenticate middleware', () => {
    let mockAuthService: {
      authenticate: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockAuthService = {
        authenticate: vi.fn(),
      };
    });

    it('authenticates request with valid Bearer token', async () => {
      const mockKey = new ApiKey({
        name: 'Test Key',
        keyHash: 'hash',
        keyPrefix: 'ak_test12',
        permissions: ['read:graphs'] as Permission[],
      });

      mockAuthService.authenticate.mockResolvedValue({
        authenticated: true,
        apiKey: mockKey,
      });

      const req = {
        get: vi.fn((header: string) => (header === 'Authorization' ? 'Bearer ak_valid-key' : undefined)),
        container: { authService: mockAuthService },
        path: '/api/graphs',
        method: 'GET',
      } as unknown as AuthenticatedRequest;

      const res = {} as Response;
      const next = vi.fn();

      authenticate(req, res, next);

      // Await promise resolution inside authenticate
      await vi.waitFor(() => {
        expect(next).toHaveBeenCalled();
      });

      expect(req.isAuthenticated).toBe(true);
      expect(req.apiKey).toBe(mockKey);
    });

    it('leaves request unauthenticated when no headers are provided', () => {
      const req = {
        get: vi.fn(() => undefined),
        container: { authService: mockAuthService },
        path: '/api/graphs',
        method: 'GET',
      } as unknown as AuthenticatedRequest;

      const res = {} as Response;
      const next = vi.fn();

      authenticate(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.isAuthenticated).toBe(false);
      expect(req.apiKey).toBeUndefined();
      expect(mockAuthService.authenticate).not.toHaveBeenCalled();
    });
  });

  describe('requireAuth middleware', () => {
    it('calls next when request is authenticated with an apiKey', () => {
      const req = {
        isAuthenticated: true,
        apiKey: {} as ApiKey,
      } as AuthenticatedRequest;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn();

      requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 401 when request is not authenticated', () => {
      const req = {
        isAuthenticated: false,
        apiKey: undefined,
        path: '/api/graphs',
      } as AuthenticatedRequest;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn();

      requireAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'API key is required',
          }),
        })
      );
    });
  });
});
