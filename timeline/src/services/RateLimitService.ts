/**
 * In-process rate limiting persisted to a JSON file under
 * `<dataDir>/rate-limits/limits.json`.
 *
 * The state is file-backed in every mode: the service is constructed with
 * `localExecution.dataDirectory` and writes there even when local execution is
 * disabled, and it counts requests in this process only. No Redis-backed
 * implementation exists; see `Container.initialize`.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RedisClientType } from 'redis';
import { RateLimitConfig, RateLimitState } from '../models/ApiKey';

export interface RateLimitServiceConfig {
  dataDir: string;
  persistenceIntervalMs?: number;
  redisClient?: RedisClientType;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  limit: string;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

export interface RateLimitHeaders {
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
  'Retry-After'?: string;
}

interface RateLimitWindow {
  count: number;
  resetAt: number;
}

interface InternalRateLimitState {
  keyId: string;
  minute: RateLimitWindow;
  hour: RateLimitWindow;
  day: RateLimitWindow;
}

/**
 * Service for tracking and enforcing rate limits
 */
export class RateLimitService {
  private readonly dataDir: string;
  private readonly limitsDir: string;
  private readonly limitsFilePath: string;
  private readonly persistenceIntervalMs: number;
  private readonly redisClient?: RedisClientType;
  private limits: Map<string, InternalRateLimitState> = new Map();
  private persistenceInterval?: NodeJS.Timeout;
  private initialized = false;
  private dirty = false;

  constructor(config: RateLimitServiceConfig) {
    this.dataDir = config.dataDir;
    this.limitsDir = path.join(config.dataDir, 'rate-limits');
    this.limitsFilePath = path.join(this.limitsDir, 'limits.json');
    this.persistenceIntervalMs = config.persistenceIntervalMs || 30000; // 30 seconds default
    this.redisClient = config.redisClient;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure rate-limits directory exists
    await fs.promises.mkdir(this.limitsDir, { recursive: true });

    // Load existing rate limit state from disk
    await this.loadState();

    // Start persistence interval
    this.persistenceInterval = setInterval(() => {
      this.persistState().catch(console.error);
    }, this.persistenceIntervalMs);

    this.initialized = true;
  }

  /**
   * Stop the service (cleanup interval)
   */
  stop(): void {
    if (this.persistenceInterval) {
      clearInterval(this.persistenceInterval);
      this.persistenceInterval = undefined;
    }

    // Persist final state synchronously
    this.persistStateSync();
  }

  /**
   * Check if a request should be allowed based on rate limits
   */
  checkLimit(keyId: string, config: RateLimitConfig): RateLimitCheckResult {
    const now = Date.now();
    const state = this.getOrCreateState(keyId);

    // Reset windows if expired
    this.resetExpiredWindows(state, now);

    // Check limits in order of strictness (minute first)
    const windows: Array<{
      name: string;
      window: RateLimitWindow;
      limit: number;
    }> = [
      { name: 'minute', window: state.minute, limit: config.requestsPerMinute },
      { name: 'hour', window: state.hour, limit: config.requestsPerHour },
      { name: 'day', window: state.day, limit: config.requestsPerDay },
    ];

    for (const { name, window, limit } of windows) {
      if (window.count >= limit) {
        const retryAfter = Math.ceil((window.resetAt - now) / 1000);
        return {
          allowed: false,
          limit: `${limit}/${name}`,
          remaining: 0,
          resetAt: window.resetAt,
          retryAfter: Math.max(1, retryAfter),
        };
      }
    }

    // Find most restrictive limit for response headers
    const minuteRemaining = config.requestsPerMinute - state.minute.count;
    
    return {
      allowed: true,
      limit: `${config.requestsPerMinute}/minute`,
      remaining: minuteRemaining,
      resetAt: state.minute.resetAt,
    };
  }

  /**
   * Record a request for rate limiting
   */
  recordRequest(keyId: string, config: RateLimitConfig): RateLimitCheckResult {
    const checkResult = this.checkLimit(keyId, config);
    
    if (!checkResult.allowed) {
      return checkResult;
    }

    const now = Date.now();
    const state = this.getOrCreateState(keyId);

    // Reset windows if expired
    this.resetExpiredWindows(state, now);

    // Increment counters
    state.minute.count++;
    state.hour.count++;
    state.day.count++;

    this.dirty = true;

    // Log warning if approaching limits
    this.checkLimitWarnings(keyId, state, config);

    // Return updated remaining count
    return {
      allowed: true,
      limit: `${config.requestsPerMinute}/minute`,
      remaining: config.requestsPerMinute - state.minute.count,
      resetAt: state.minute.resetAt,
    };
  }

  /**
   * Get rate limit headers for response
   */
  getHeaders(result: RateLimitCheckResult): RateLimitHeaders {
    const headers: RateLimitHeaders = {
      'X-RateLimit-Limit': result.limit,
      'X-RateLimit-Remaining': String(Math.max(0, result.remaining)),
      'X-RateLimit-Reset': String(Math.floor(result.resetAt / 1000)),
    };

    if (result.retryAfter !== undefined) {
      headers['Retry-After'] = String(result.retryAfter);
    }

    return headers;
  }

  /**
   * Get current rate limit state for a key
   */
  getState(keyId: string): RateLimitState | null {
    const state = this.limits.get(keyId);
    if (!state) return null;

    return {
      keyId: state.keyId,
      minute: { count: state.minute.count, resetAt: state.minute.resetAt },
      hour: { count: state.hour.count, resetAt: state.hour.resetAt },
      day: { count: state.day.count, resetAt: state.day.resetAt },
    };
  }

  /**
   * Reset rate limits for a key
   */
  resetLimits(keyId: string): void {
    this.limits.delete(keyId);
    this.dirty = true;
  }

  /**
   * Get statistics about rate limiting
   */
  getStats(): RateLimitStats {
    const states = Array.from(this.limits.values());
    const now = Date.now();

    let activeKeys = 0;
    let totalRequestsMinute = 0;
    let totalRequestsHour = 0;
    let totalRequestsDay = 0;

    for (const state of states) {
      const isActive =
        state.minute.resetAt > now ||
        state.hour.resetAt > now ||
        state.day.resetAt > now;

      if (isActive) {
        activeKeys++;
        if (state.minute.resetAt > now) totalRequestsMinute += state.minute.count;
        if (state.hour.resetAt > now) totalRequestsHour += state.hour.count;
        if (state.day.resetAt > now) totalRequestsDay += state.day.count;
      }
    }

    return {
      trackedKeys: this.limits.size,
      activeKeys,
      totalRequestsMinute,
      totalRequestsHour,
      totalRequestsDay,
    };
  }

  /**
   * Cleanup expired state entries
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [keyId, state] of this.limits.entries()) {
      // Remove if all windows have expired
      if (
        state.minute.resetAt < now &&
        state.hour.resetAt < now &&
        state.day.resetAt < now
      ) {
        this.limits.delete(keyId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.dirty = true;
    }

    return cleaned;
  }

  // Private methods

  private getOrCreateState(keyId: string): InternalRateLimitState {
    let state = this.limits.get(keyId);

    if (!state) {
      const now = Date.now();
      state = {
        keyId,
        minute: { count: 0, resetAt: now + 60 * 1000 },
        hour: { count: 0, resetAt: now + 60 * 60 * 1000 },
        day: { count: 0, resetAt: now + 24 * 60 * 60 * 1000 },
      };
      this.limits.set(keyId, state);
      this.dirty = true;
    }

    return state;
  }

  private resetExpiredWindows(state: InternalRateLimitState, now: number): void {
    if (state.minute.resetAt <= now) {
      state.minute = { count: 0, resetAt: now + 60 * 1000 };
      this.dirty = true;
    }

    if (state.hour.resetAt <= now) {
      state.hour = { count: 0, resetAt: now + 60 * 60 * 1000 };
      this.dirty = true;
    }

    if (state.day.resetAt <= now) {
      state.day = { count: 0, resetAt: now + 24 * 60 * 60 * 1000 };
      this.dirty = true;
    }
  }

  private checkLimitWarnings(
    keyId: string,
    state: InternalRateLimitState,
    config: RateLimitConfig
  ): void {
    const warningThreshold = 0.8; // Warn at 80% usage

    if (state.minute.count >= config.requestsPerMinute * warningThreshold) {
      console.warn(
        `[RateLimit] Key ${keyId.substring(0, 8)}... approaching minute limit: ${state.minute.count}/${config.requestsPerMinute}`
      );
    }

    if (state.hour.count >= config.requestsPerHour * warningThreshold) {
      console.warn(
        `[RateLimit] Key ${keyId.substring(0, 8)}... approaching hour limit: ${state.hour.count}/${config.requestsPerHour}`
      );
    }

    if (state.day.count >= config.requestsPerDay * warningThreshold) {
      console.warn(
        `[RateLimit] Key ${keyId.substring(0, 8)}... approaching day limit: ${state.day.count}/${config.requestsPerDay}`
      );
    }
  }

  private async loadState(): Promise<void> {
    if (this.redisClient && this.redisClient.isOpen) {
      try {
        const redisData = await this.redisClient.get('althistory:rate-limits:state');
        if (redisData) {
          const parsed = JSON.parse(redisData) as InternalRateLimitState[];
          const now = Date.now();
          for (const state of parsed) {
            if (
              state.minute.resetAt > now ||
              state.hour.resetAt > now ||
              state.day.resetAt > now
            ) {
              this.limits.set(state.keyId, state);
            }
          }
          return;
        }
      } catch (err) {
        console.warn('Could not load rate limits from Redis, falling back to disk:', err);
      }
    }

    try {
      const content = await fs.promises.readFile(this.limitsFilePath, 'utf8');
      const data = JSON.parse(content) as InternalRateLimitState[];

      const now = Date.now();
      for (const state of data) {
        // Only load state that hasn't fully expired
        if (
          state.minute.resetAt > now ||
          state.hour.resetAt > now ||
          state.day.resetAt > now
        ) {
          this.limits.set(state.keyId, state);
        }
      }
    } catch (err) {
      // File may not exist yet
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  private async persistState(): Promise<void> {
    if (!this.dirty) return;

    const states = Array.from(this.limits.values());

    if (this.redisClient && this.redisClient.isOpen) {
      try {
        await this.redisClient.set('althistory:rate-limits:state', JSON.stringify(states), {
          EX: 86400, // 24-hour expiration
        });
      } catch (err) {
        console.error('Failed to sync rate limits to Redis:', err);
      }
    }

    await fs.promises.writeFile(
      this.limitsFilePath,
      JSON.stringify(states, null, 2),
      'utf8'
    );
    this.dirty = false;
  }

  private persistStateSync(): void {
    if (!this.dirty) return;

    try {
      const states = Array.from(this.limits.values());
      fs.writeFileSync(this.limitsFilePath, JSON.stringify(states, null, 2), 'utf8');
      this.dirty = false;
    } catch (err) {
      console.error('Failed to persist rate limit state:', err);
    }
  }
}

export interface RateLimitStats {
  trackedKeys: number;
  activeKeys: number;
  totalRequestsMinute: number;
  totalRequestsHour: number;
  totalRequestsDay: number;
}
