/**
 * The app's own key (the configured ADMIN_API_KEY) is exempt from rate limits;
 * every other key, admin permission or not, keeps its limits (issue #32).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Response, NextFunction } from 'express';
import { ApiKeyRepository } from '@/repositories/ApiKeyRepository';
import { RateLimitService } from '@/services/RateLimitService';
import { rateLimit, type AuthenticatedRequest } from './middleware';
import { PERMISSION_GROUPS } from '@/models/ApiKey';

const APP_KEY = 'ak_appkey_' + 'x'.repeat(32);

describe('the app key and rate limits', () => {
  let dir: string;
  let repo: ApiKeyRepository;
  let limiter: RateLimitService;

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'app-key-rl-'));
    process.env.TEST_APP_ADMIN_KEY = APP_KEY;
    repo = new ApiKeyRepository({ dataDir: dir, bcryptRounds: 4, adminKeyEnvVar: 'TEST_APP_ADMIN_KEY' });
    await repo.initialize();
    limiter = new RateLimitService({ dataDir: dir });
  });

  afterEach(async () => {
    limiter.stop();
    delete process.env.TEST_APP_ADMIN_KEY;
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  /** Send `n` requests through the real middleware; return the statuses. */
  function hammer(apiKey: NonNullable<AuthenticatedRequest['apiKey']>, n: number): number[] {
    const statuses: number[] = [];
    for (let i = 0; i < n; i++) {
      const req = {
        isAuthenticated: true,
        apiKey,
        container: { rateLimitService: limiter },
        method: 'POST',
        path: '/api/graphs/g/activate',
      } as unknown as AuthenticatedRequest;
      let status = 200;
      const res = {
        setHeader: vi.fn(),
        status: (s: number) => {
          status = s;
          return { json: vi.fn() };
        },
      } as unknown as Response;
      rateLimit()(req, res, (() => undefined) as NextFunction);
      statuses.push(status);
    }
    return statuses;
  }

  it('never refuses the configured admin key', async () => {
    const key = await repo.validateKey(APP_KEY);
    expect(key?.rateLimitExempt).toBe(true);
    expect(hammer(key!, 200).filter((s) => s === 429)).toEqual([]);
  });

  it('still refuses an admin key minted through the API', async () => {
    const minted = await repo.create({ name: 'minted admin', permissions: PERMISSION_GROUPS.admin });
    const key = await repo.validateKey(minted.key);
    expect(key?.rateLimitExempt).toBe(false);
    expect(hammer(key!, 61).at(-1)).toBe(429);
  });

  it('still refuses a scoped key', async () => {
    const minted = await repo.create({ name: 'agent', permissions: ['read:events'] });
    const key = await repo.validateKey(minted.key);
    expect(hammer(key!, 61).at(-1)).toBe(429);
  });

  it('withdraws the exemption when the variable no longer names the key', async () => {
    process.env.TEST_APP_ADMIN_KEY = 'ak_other_' + 'y'.repeat(32);
    const again = new ApiKeyRepository({ dataDir: dir, bcryptRounds: 4, adminKeyEnvVar: 'TEST_APP_ADMIN_KEY' });
    await again.initialize();
    const old = await again.validateKey(APP_KEY);
    expect(old?.rateLimitExempt).toBe(false);
  });

  it('does not exempt a different key stored under the configured key\'s prefix', async () => {
    // Same first 11 characters, different secret: the prefix alone must not
    // grant the exemption; the hash comparison does.
    const impostor = APP_KEY.slice(0, 11) + 'z'.repeat(30);
    process.env.TEST_APP_ADMIN_KEY = impostor;
    const again = new ApiKeyRepository({ dataDir: dir, bcryptRounds: 4, adminKeyEnvVar: 'TEST_APP_ADMIN_KEY' });
    await again.initialize();
    const stored = await again.validateKey(APP_KEY);
    expect(stored).not.toBeNull();
    expect(stored?.rateLimitExempt).toBe(false);
    expect(await again.validateKey(impostor)).toBeNull();
  });

  it('lets only the app key hold unlimited streams', async () => {
    const app = (await repo.validateKey(APP_KEY))!;
    expect(app.maxConcurrentStreams()).toBe(Infinity);
    const minted = await repo.create({ name: 'minted admin', permissions: PERMISSION_GROUPS.admin });
    const other = (await repo.validateKey(minted.key))!;
    expect(other.maxConcurrentStreams()).toBe(5);
  });

  it('is not carried in the stored key', async () => {
    const app = (await repo.validateKey(APP_KEY))!;
    expect(JSON.stringify(app.toStorage())).not.toContain('rateLimitExempt');
  });
});
