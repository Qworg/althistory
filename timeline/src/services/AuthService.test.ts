/**
 * Tests for AuthService
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AuthService, AuthServiceConfig } from './AuthService';
import { ApiKey } from '../models/ApiKey';

describe('AuthService', () => {
  let authService: AuthService;
  let testDir: string;
  let config: AuthServiceConfig;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = path.join(os.tmpdir(), `auth-service-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    await fs.promises.mkdir(testDir, { recursive: true });

    config = {
      dataDir: testDir,
      bcryptRounds: 4, // Use low rounds for faster tests
    };

    // Suppress console output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    authService = new AuthService(config);
    await authService.initialize();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    
    // Cleanup test directory
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      const newService = new AuthService(config);
      await expect(newService.initialize()).resolves.not.toThrow();
    });

    it('should not re-initialize if already initialized', async () => {
      await authService.initialize();
      await expect(authService.initialize()).resolves.not.toThrow();
    });
  });

  describe('authenticate', () => {
    it('should return error when no API key provided', async () => {
      const result = await authService.authenticate(undefined);
      expect(result.authenticated).toBe(false);
      expect(result.error).toBe('API key is required');
    });

    it('should return error for invalid API key', async () => {
      const result = await authService.authenticate('invalid_key');
      expect(result.authenticated).toBe(false);
      expect(result.error).toBe('Invalid or expired API key');
    });

    it('should authenticate with valid API key', async () => {
      const response = await authService.createApiKey({
        name: 'Test Key',
        permissions: ['read:events'],
      });

      const result = await authService.authenticate(response.key);
      expect(result.authenticated).toBe(true);
      expect(result.apiKey).toBeDefined();
      expect(result.apiKey?.name).toBe('Test Key');
    });

    it('should reject revoked API key', async () => {
      const response = await authService.createApiKey({
        name: 'Revokable Key',
        permissions: ['read:events'],
      });

      await authService.revokeApiKey(response.id);

      const result = await authService.authenticate(response.key);
      expect(result.authenticated).toBe(false);
    });
  });

  describe('checkPermission', () => {
    let testKey: ApiKey;

    beforeEach(async () => {
      const response = await authService.createApiKey({
        name: 'Permission Test Key',
        permissions: ['read:events', 'write:events'],
      });
      testKey = (await authService.getApiKey(response.id))!;
    });

    it('should allow permission that key has', () => {
      const result = authService.checkPermission(testKey, 'read:events');
      expect(result.allowed).toBe(true);
    });

    it('should deny permission that key lacks', () => {
      const result = authService.checkPermission(testKey, 'admin');
      expect(result.allowed).toBe(false);
      expect(result.missingPermissions).toContain('admin');
    });
  });

  describe('checkPermissions', () => {
    let testKey: ApiKey;

    beforeEach(async () => {
      const response = await authService.createApiKey({
        name: 'Multi Permission Key',
        permissions: ['read:events', 'write:events', 'read:arcs'],
      });
      testKey = (await authService.getApiKey(response.id))!;
    });

    it('should allow when all permissions present', () => {
      const result = authService.checkPermissions(testKey, ['read:events', 'write:events']);
      expect(result.allowed).toBe(true);
    });

    it('should deny when any permission missing', () => {
      const result = authService.checkPermissions(testKey, ['read:events', 'admin']);
      expect(result.allowed).toBe(false);
      expect(result.missingPermissions).toContain('admin');
      expect(result.missingPermissions).not.toContain('read:events');
    });
  });

  describe('checkAnyPermission', () => {
    let testKey: ApiKey;

    beforeEach(async () => {
      const response = await authService.createApiKey({
        name: 'Any Permission Key',
        permissions: ['read:events'],
      });
      testKey = (await authService.getApiKey(response.id))!;
    });

    it('should allow when at least one permission present', () => {
      const result = authService.checkAnyPermission(testKey, ['read:events', 'admin']);
      expect(result.allowed).toBe(true);
    });

    it('should deny when no permissions present', () => {
      const result = authService.checkAnyPermission(testKey, ['admin', 'write:graphs']);
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkGraphAccess', () => {
    it('should allow access to wildcard graphs', async () => {
      const response = await authService.createApiKey({
        name: 'Wildcard Key',
        permissions: ['read:events'],
        allowedGraphs: '*',
      });
      const key = (await authService.getApiKey(response.id))!;

      const result = authService.checkGraphAccess(key, 'any-graph');
      expect(result.allowed).toBe(true);
    });

    it('should allow access to specified graph', async () => {
      const response = await authService.createApiKey({
        name: 'Limited Key',
        permissions: ['read:events'],
        allowedGraphs: ['graph1', 'graph2'],
      });
      const key = (await authService.getApiKey(response.id))!;

      const result = authService.checkGraphAccess(key, 'graph1');
      expect(result.allowed).toBe(true);
    });

    it('should deny access to non-allowed graph', async () => {
      const response = await authService.createApiKey({
        name: 'Limited Key',
        permissions: ['read:events'],
        allowedGraphs: ['graph1'],
      });
      const key = (await authService.getApiKey(response.id))!;

      const result = authService.checkGraphAccess(key, 'graph2');
      expect(result.allowed).toBe(false);
    });
  });

  describe('authorize', () => {
    let adminKey: ApiKey;
    let limitedKey: ApiKey;

    beforeEach(async () => {
      const adminResponse = await authService.createApiKey({
        name: 'Admin Key',
        permissions: ['admin', 'read:events', 'write:events'],
        allowedGraphs: '*',
      });
      adminKey = (await authService.getApiKey(adminResponse.id))!;

      const limitedResponse = await authService.createApiKey({
        name: 'Limited Key',
        permissions: ['read:events'],
        allowedGraphs: ['graph1'],
      });
      limitedKey = (await authService.getApiKey(limitedResponse.id))!;
    });

    it('should authorize admin with all permissions', () => {
      const result = authService.authorize(adminKey, {
        requiredPermissions: ['admin'],
        graphId: 'any-graph',
      });
      expect(result.authorized).toBe(true);
    });

    it('should deny limited key accessing wrong graph', () => {
      const result = authService.authorize(limitedKey, {
        requiredPermissions: ['read:events'],
        graphId: 'graph2',
      });
      expect(result.authorized).toBe(false);
      expect(result.error).toContain('graph2');
    });

    it('should deny limited key with missing permissions', () => {
      const result = authService.authorize(limitedKey, {
        requiredPermissions: ['write:events'],
      });
      expect(result.authorized).toBe(false);
      expect(result.error).toContain('write:events');
    });

    it('should authorize with any permissions check', () => {
      const result = authService.authorize(limitedKey, {
        anyPermissions: ['read:events', 'admin'],
      });
      expect(result.authorized).toBe(true);
    });
  });

  describe('API Key Management', () => {
    describe('createApiKey', () => {
      it('should create a new API key', async () => {
        const response = await authService.createApiKey({
          name: 'New Key',
          permissions: ['read:events'],
        });

        expect(response.id).toBeDefined();
        expect(response.key).toMatch(/^ak_/);
        expect(response.name).toBe('New Key');
      });
    });

    describe('getApiKey', () => {
      it('should get key by ID', async () => {
        const response = await authService.createApiKey({
          name: 'Get Test Key',
          permissions: ['read:events'],
        });

        const key = await authService.getApiKey(response.id);
        expect(key).not.toBeNull();
        expect(key?.name).toBe('Get Test Key');
      });

      it('should return null for non-existent key', async () => {
        const key = await authService.getApiKey('non-existent');
        expect(key).toBeNull();
      });
    });

    describe('listApiKeys', () => {
      it('should list all keys', async () => {
        await authService.createApiKey({ name: 'Key 1', permissions: ['read:events'] });
        await authService.createApiKey({ name: 'Key 2', permissions: ['write:events'] });

        const keys = await authService.listApiKeys();
        expect(keys.length).toBeGreaterThanOrEqual(2);
      });

      it('should filter active only', async () => {
        await authService.createApiKey({ name: 'Active Key', permissions: ['read:events'] });
        const revokedKey = await authService.createApiKey({ name: 'Revoked Key', permissions: ['read:events'] });
        await authService.revokeApiKey(revokedKey.id);

        const activeKeys = await authService.listApiKeys({ activeOnly: true });
        expect(activeKeys.every((k) => k.isActive)).toBe(true);
      });
    });

    describe('updateApiKey', () => {
      it('should update key properties', async () => {
        const response = await authService.createApiKey({
          name: 'Original Name',
          permissions: ['read:events'],
        });

        const updated = await authService.updateApiKey(response.id, {
          name: 'Updated Name',
          permissions: ['read:events', 'write:events'],
        });

        expect(updated?.name).toBe('Updated Name');
        expect(updated?.permissions).toContain('write:events');
      });
    });

    describe('revokeApiKey', () => {
      it('should revoke a key', async () => {
        const response = await authService.createApiKey({
          name: 'Revokable',
          permissions: ['read:events'],
        });

        const success = await authService.revokeApiKey(response.id);
        expect(success).toBe(true);

        const key = await authService.getApiKey(response.id);
        expect(key?.isActive).toBe(false);
      });
    });

    describe('deleteApiKey', () => {
      it('should delete a key permanently', async () => {
        const response = await authService.createApiKey({
          name: 'Deletable',
          permissions: ['read:events'],
        });

        const success = await authService.deleteApiKey(response.id);
        expect(success).toBe(true);

        const key = await authService.getApiKey(response.id);
        expect(key).toBeNull();
      });
    });

    describe('getApiKeyStats', () => {
      it('should return correct statistics', async () => {
        await authService.createApiKey({ name: 'Active', permissions: ['read:events'] });
        const response = await authService.createApiKey({ name: 'Revoked', permissions: ['read:events'] });
        await authService.revokeApiKey(response.id);

        const stats = await authService.getApiKeyStats();
        expect(stats.total).toBeGreaterThanOrEqual(2);
        expect(stats.inactive).toBeGreaterThanOrEqual(1);
      });
    });

    describe('hasAdminKey', () => {
      it('should return true when admin key exists', async () => {
        // Admin key is auto-created during initialization
        const hasAdmin = await authService.hasAdminKey();
        expect(hasAdmin).toBe(true);
      });
    });
  });
});
