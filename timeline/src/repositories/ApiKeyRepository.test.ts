/**
 * Tests for ApiKeyRepository
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ApiKeyRepository, ApiKeyRepositoryConfig } from './ApiKeyRepository';

describe('ApiKeyRepository', () => {
  let repository: ApiKeyRepository;
  let testDir: string;
  let config: ApiKeyRepositoryConfig;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = path.join(os.tmpdir(), `api-key-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    await fs.promises.mkdir(testDir, { recursive: true });

    config = {
      dataDir: testDir,
      bcryptRounds: 4, // Use low rounds for faster tests
      adminKeyEnvVar: 'TEST_ADMIN_API_KEY',
    };

    // Clear environment variable
    delete process.env.TEST_ADMIN_API_KEY;

    repository = new ApiKeyRepository(config);
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('should initialize and create keys directory', async () => {
      await repository.initialize();

      const keysDir = path.join(testDir, 'keys');
      const stat = await fs.promises.stat(keysDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should auto-generate admin key on first init', async () => {
      // Capture console output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await repository.initialize();

      // Should have created admin key
      const hasAdmin = await repository.hasAdminKey();
      expect(hasAdmin).toBe(true);

      // Should have logged the key
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('AUTO-GENERATED ADMIN API KEY')
      );

      consoleSpy.mockRestore();
    });

    it('should use admin key from environment variable', async () => {
      process.env.TEST_ADMIN_API_KEY = 'test_admin_key_12345';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await repository.initialize();

      // Should have created admin key from env
      const hasAdmin = await repository.hasAdminKey();
      expect(hasAdmin).toBe(true);

      // Should log that key was loaded from env
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Admin API key loaded from TEST_ADMIN_API_KEY')
      );

      consoleSpy.mockRestore();
    });

    it('should not re-initialize if already initialized', async () => {
      await repository.initialize();
      const keys1 = await repository.findAll();

      await repository.initialize();
      const keys2 = await repository.findAll();

      // Should have same number of keys (no duplicate admin key)
      expect(keys1.length).toBe(keys2.length);
    });
  });

  describe('generateKey', () => {
    beforeEach(async () => {
      await repository.initialize();
    });

    it('should generate a valid API key', async () => {
      const { rawKey, keyHash, keyPrefix } = await repository.generateKey();

      expect(rawKey).toMatch(/^ak_[A-Za-z0-9_-]+$/);
      expect(rawKey.length).toBeGreaterThan(20);
      expect(keyHash).toBeDefined();
      expect(keyHash.length).toBeGreaterThan(50);
      expect(keyPrefix).toBe(rawKey.substring(0, 11)); // 'ak_' + 8 chars
    });

    it('should generate unique keys', async () => {
      const key1 = await repository.generateKey();
      const key2 = await repository.generateKey();

      expect(key1.rawKey).not.toBe(key2.rawKey);
      expect(key1.keyHash).not.toBe(key2.keyHash);
    });
  });

  describe('create', () => {
    beforeEach(async () => {
      await repository.initialize();
    });

    it('should create a new API key', async () => {
      const response = await repository.create({
        name: 'Test Key',
        permissions: ['read:events', 'write:events'],
      });

      expect(response.id).toBeDefined();
      expect(response.key).toMatch(/^ak_/);
      expect(response.keyPrefix.length).toBe(11);
      expect(response.name).toBe('Test Key');
      expect(response.permissions).toContain('read:events');
      expect(response.permissions).toContain('write:events');
    });

    it('should create key with custom rate limits', async () => {
      const response = await repository.create({
        name: 'Custom Rate Limit Key',
        permissions: ['read:events'],
        rateLimit: {
          requestsPerMinute: 10,
          requestsPerHour: 100,
          requestsPerDay: 500,
        },
      });

      const key = await repository.findById(response.id);
      expect(key?.rateLimit.requestsPerMinute).toBe(10);
      expect(key?.rateLimit.requestsPerHour).toBe(100);
      expect(key?.rateLimit.requestsPerDay).toBe(500);
    });

    it('should create key with allowed graphs', async () => {
      const response = await repository.create({
        name: 'Graph Limited Key',
        permissions: ['read:events'],
        allowedGraphs: ['graph1', 'graph2'],
      });

      const key = await repository.findById(response.id);
      expect(key?.allowedGraphs).toEqual(['graph1', 'graph2']);
    });

    it('should create key with expiration', async () => {
      const expiresAt = new Date(Date.now() + 86400000).toISOString(); // 1 day from now
      const response = await repository.create({
        name: 'Expiring Key',
        permissions: ['read:events'],
        expiresAt,
      });

      const key = await repository.findById(response.id);
      expect(key?.expiresAt).toBe(expiresAt);
    });

    it('should persist key to disk', async () => {
      await repository.create({
        name: 'Persistent Key',
        permissions: ['read:events'],
      });

      // Create new repository instance to verify persistence
      const newRepo = new ApiKeyRepository(config);
      await newRepo.initialize();

      const keys = await newRepo.findAll();
      const persistentKey = keys.find((k) => k.name === 'Persistent Key');
      expect(persistentKey).toBeDefined();
    });
  });

  describe('findById', () => {
    beforeEach(async () => {
      await repository.initialize();
    });

    it('should find key by ID', async () => {
      const response = await repository.create({
        name: 'Findable Key',
        permissions: ['read:events'],
      });

      const key = await repository.findById(response.id);
      expect(key).not.toBeNull();
      expect(key?.name).toBe('Findable Key');
    });

    it('should return null for non-existent key', async () => {
      const key = await repository.findById('non-existent-id');
      expect(key).toBeNull();
    });
  });

  describe('findByPrefix', () => {
    beforeEach(async () => {
      await repository.initialize();
    });

    it('should find key by prefix', async () => {
      const response = await repository.create({
        name: 'Prefix Key',
        permissions: ['read:events'],
      });

      const key = await repository.findByPrefix(response.keyPrefix);
      expect(key).not.toBeNull();
      expect(key?.name).toBe('Prefix Key');
    });

    it('should return null for non-existent prefix', async () => {
      const key = await repository.findByPrefix('ak_nonexist');
      expect(key).toBeNull();
    });
  });

  describe('persistence', () => {
    const keysFile = (): string => path.join(testDir, 'keys', 'keys.json');

    beforeEach(async () => {
      await repository.initialize();
    });

    it('keeps the keys file whole under concurrent authenticated requests', async () => {
      const created = await Promise.all(
        [1, 2, 3].map((n) => repository.create({ name: `Concurrent ${n}`, permissions: ['read:events'] }))
      );

      // Every validation rewrites the file (lastUsedAt); fire them together.
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => repository.validateKey(created[i % 3].key))
      );
      expect(results.every((key) => key !== null)).toBe(true);

      const stored = JSON.parse(await fs.promises.readFile(keysFile(), 'utf8')) as Array<{ name: string }>;
      expect(stored.map((key) => key.name)).toEqual(
        expect.arrayContaining(['Concurrent 1', 'Concurrent 2', 'Concurrent 3'])
      );
      const leftovers = (await fs.promises.readdir(path.dirname(keysFile()))).filter((f) => f.endsWith('.tmp'));
      expect(leftovers).toEqual([]);
    });

    it.skipIf(process.platform === 'win32')('writes the keys file readable by its owner only', async () => {
      await repository.create({ name: 'Mode', permissions: ['read:events'] });

      const mode = (await fs.promises.stat(keysFile())).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('leaves the previous file in place when a write fails, and keeps writing afterwards', async () => {
      await repository.create({ name: 'Before', permissions: ['read:events'] });
      const before = await fs.promises.readFile(keysFile(), 'utf8');

      const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('disk full'));
      await expect(repository.create({ name: 'Lost', permissions: ['read:events'] })).rejects.toThrow('disk full');
      rename.mockRestore();

      expect(await fs.promises.readFile(keysFile(), 'utf8')).toBe(before);

      await repository.create({ name: 'After', permissions: ['read:events'] });
      const stored = JSON.parse(await fs.promises.readFile(keysFile(), 'utf8')) as Array<{ name: string }>;
      expect(stored.map((key) => key.name)).toEqual(expect.arrayContaining(['Before', 'After']));
    });
  });

  describe('validateKey', () => {
    beforeEach(async () => {
      await repository.initialize();
    });

    it('should validate a correct key', async () => {
      const response = await repository.create({
        name: 'Validate Key',
        permissions: ['read:events'],
      });

      const key = await repository.validateKey(response.key);
      expect(key).not.toBeNull();
      expect(key?.name).toBe('Validate Key');
    });

    it('should return null for invalid key', async () => {
      const key = await repository.validateKey('ak_invalid_key_12345');
      expect(key).toBeNull();
    });

    it('should return null for malformed key', async () => {
      const key = await repository.validateKey('invalid');
      expect(key).toBeNull();
    });

    it('should return null for revoked key', async () => {
      const response = await repository.create({
        name: 'Revokable Key',
        permissions: ['read:events'],
      });

      await repository.revoke(response.id);

      const key = await repository.validateKey(response.key);
      expect(key).toBeNull();
    });

    it('should return null for expired key', async () => {
      const expiredDate = new Date(Date.now() - 1000).toISOString(); // 1 second ago
      const response = await repository.create({
        name: 'Expired Key',
        permissions: ['read:events'],
        expiresAt: expiredDate,
      });

      const key = await repository.validateKey(response.key);
      expect(key).toBeNull();
    });

    it('should update lastUsedAt on successful validation', async () => {
      const response = await repository.create({
        name: 'Touch Key',
        permissions: ['read:events'],
      });

      const keyBefore = await repository.findById(response.id);
      const lastUsedBefore = keyBefore?.lastUsedAt;

      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await repository.validateKey(response.key);

      const keyAfter = await repository.findById(response.id);
      expect(keyAfter?.lastUsedAt).not.toBe(lastUsedBefore);
    });
  });

  describe('findAll', () => {
    beforeEach(async () => {
      await repository.initialize();
    });

    it('should find all keys', async () => {
      await repository.create({ name: 'Key 1', permissions: ['read:events'] });
      await repository.create({ name: 'Key 2', permissions: ['write:events'] });

      const keys = await repository.findAll();
      // +1 for auto-generated admin key
      expect(keys.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by active status', async () => {
      await repository.create({ name: 'Active Key', permissions: ['read:events'] });
      await repository.create({ name: 'Revoked Key', permissions: ['read:events'] });

      // Revoke the second key
      const keys = await repository.findAll();
      const revokedKey = keys.find((k) => k.name === 'Revoked Key');
      if (revokedKey) {
        await repository.revoke(revokedKey.id);
      }

      const activeKeys = await repository.findAll({ isActive: true });
      expect(activeKeys.every((k) => k.isActive)).toBe(true);
    });

    it('should filter by permission', async () => {
      await repository.create({ name: 'Reader', permissions: ['read:events'] });
      await repository.create({ name: 'Writer', permissions: ['write:events'] });

      const readers = await repository.findAll({ hasPermission: 'read:events' });
      expect(readers.every((k) => k.hasPermission('read:events'))).toBe(true);
    });

    it('should filter by allowed graph', async () => {
      await repository.create({ name: 'Graph1 Key', permissions: ['read:events'], allowedGraphs: ['graph1'] });
      await repository.create({ name: 'All Graphs Key', permissions: ['read:events'], allowedGraphs: '*' });

      const graph1Keys = await repository.findAll({ allowedGraph: 'graph1' });
      expect(graph1Keys.every((k) => k.canAccessGraph('graph1'))).toBe(true);
    });
  });

  describe('updateById', () => {
    beforeEach(async () => {
      await repository.initialize();
    });

    it('should update key name', async () => {
      const response = await repository.create({ name: 'Original Name', permissions: ['read:events'] });

      const updated = await repository.updateById(response.id, { name: 'Updated Name' });
      expect(updated?.name).toBe('Updated Name');
    });

    it('should update key permissions', async () => {
      const response = await repository.create({ name: 'Test Key', permissions: ['read:events'] });

      const updated = await repository.updateById(response.id, {
        permissions: ['read:events', 'write:events'],
      });
      expect(updated?.permissions).toContain('write:events');
    });

    it('should update rate limits', async () => {
      const response = await repository.create({ name: 'Test Key', permissions: ['read:events'] });

      const updated = await repository.updateById(response.id, {
        rateLimit: { requestsPerMinute: 5 },
      });
      expect(updated?.rateLimit.requestsPerMinute).toBe(5);
    });

    it('should return null for non-existent key', async () => {
      const updated = await repository.updateById('non-existent', { name: 'New Name' });
      expect(updated).toBeNull();
    });
  });

  describe('revoke', () => {
    beforeEach(async () => {
      await repository.initialize();
    });

    it('should revoke a key', async () => {
      const response = await repository.create({ name: 'Revokable', permissions: ['read:events'] });

      const success = await repository.revoke(response.id);
      expect(success).toBe(true);

      const key = await repository.findById(response.id);
      expect(key?.isActive).toBe(false);
    });

    it('should return false for non-existent key', async () => {
      const success = await repository.revoke('non-existent');
      expect(success).toBe(false);
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await repository.initialize();
    });

    it('should delete a key permanently', async () => {
      const response = await repository.create({ name: 'Deletable', permissions: ['read:events'] });

      const success = await repository.delete(response.id);
      expect(success).toBe(true);

      const key = await repository.findById(response.id);
      expect(key).toBeNull();
    });

    it('should return false for non-existent key', async () => {
      const success = await repository.delete('non-existent');
      expect(success).toBe(false);
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      await repository.initialize();
    });

    it('should return correct statistics', async () => {
      await repository.create({ name: 'Active 1', permissions: ['read:events'] });
      await repository.create({ name: 'Active 2', permissions: ['read:events'] });
      const response3 = await repository.create({ name: 'To Revoke', permissions: ['read:events'] });
      await repository.revoke(response3.id);

      const stats = await repository.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(3);
      expect(stats.active).toBeGreaterThanOrEqual(2);
      expect(stats.inactive).toBeGreaterThanOrEqual(1);
    });
  });

  describe('hasAdminKey', () => {
    it('should return true when admin key exists', async () => {
      await repository.initialize();
      const hasAdmin = await repository.hasAdminKey();
      expect(hasAdmin).toBe(true);
    });
  });
});
