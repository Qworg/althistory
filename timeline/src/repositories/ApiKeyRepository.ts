/**
 * Repository for managing API keys with bcrypt hashing and local file storage
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import {
  ApiKey,
  IApiKey,
  CreateApiKeyData,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  UpdateApiKeyRequest,
  Permission,
  DEFAULT_RATE_LIMITS,
  PERMISSION_GROUPS,
} from '../models/ApiKey';

export interface ApiKeyRepositoryConfig {
  dataDir: string;
  bcryptRounds?: number;
  adminKeyEnvVar?: string;
}

export interface ApiKeyFilter {
  isActive?: boolean;
  hasPermission?: Permission;
  allowedGraph?: string;
}

const BCRYPT_ROUNDS = 12;
const KEY_PREFIX_LENGTH = 8;
const KEY_RANDOM_BYTES = 32;

/**
 * Repository for persisting and managing API keys
 */
export class ApiKeyRepository {
  private readonly dataDir: string;
  private readonly keysDir: string;
  private readonly keysFilePath: string;
  private readonly bcryptRounds: number;
  private readonly adminKeyEnvVar: string;
  private keys: Map<string, ApiKey> = new Map();
  private prefixIndex: Map<string, string> = new Map(); // prefix -> id
  private initialized = false;

  constructor(config: ApiKeyRepositoryConfig) {
    this.dataDir = config.dataDir;
    this.keysDir = path.join(config.dataDir, 'keys');
    this.keysFilePath = path.join(this.keysDir, 'keys.json');
    this.bcryptRounds = config.bcryptRounds || BCRYPT_ROUNDS;
    this.adminKeyEnvVar = config.adminKeyEnvVar || 'ADMIN_API_KEY';
  }

  /**
   * Initialize the repository
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure keys directory exists
    await fs.promises.mkdir(this.keysDir, { recursive: true });

    // Load existing keys from disk
    await this.loadKeys();

    // Check for admin key in env and create if needed
    await this.ensureAdminKey();

    this.initialized = true;
  }

  /**
   * Generate a new API key
   * Returns the full key (only shown once) and the key data for storage
   */
  async generateKey(): Promise<{ rawKey: string; keyHash: string; keyPrefix: string }> {
    const randomBytes = crypto.randomBytes(KEY_RANDOM_BYTES);
    const rawKey = `ak_${randomBytes.toString('base64url')}`;
    const keyPrefix = rawKey.substring(0, KEY_PREFIX_LENGTH + 3); // 'ak_' + 8 chars
    const keyHash = await bcrypt.hash(rawKey, this.bcryptRounds);

    return { rawKey, keyHash, keyPrefix };
  }

  /**
   * Create a new API key
   */
  async create(request: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    const { rawKey, keyHash, keyPrefix } = await this.generateKey();

    const keyData: CreateApiKeyData = {
      name: request.name,
      keyHash,
      keyPrefix,
      permissions: request.permissions,
      rateLimit: { ...DEFAULT_RATE_LIMITS, ...request.rateLimit },
      allowedGraphs: request.allowedGraphs || '*',
      expiresAt: request.expiresAt,
    };

    const apiKey = new ApiKey(keyData);
    
    // Add to memory temporarily for persistence
    this.keys.set(apiKey.id, apiKey);
    this.prefixIndex.set(keyPrefix, apiKey.id);
    
    try {
      // Persist first - if this fails, rollback the in-memory changes
      await this.persistKeys();
    } catch (error) {
      // Rollback in-memory changes on persist failure
      this.keys.delete(apiKey.id);
      this.prefixIndex.delete(keyPrefix);
      throw error;
    }

    return {
      id: apiKey.id,
      key: rawKey,
      keyPrefix,
      name: apiKey.name,
      permissions: apiKey.permissions,
      rateLimit: apiKey.rateLimit,
      createdAt: apiKey.createdAt,
    };
  }

  /**
   * Find a key by ID
   */
  async findById(id: string): Promise<ApiKey | null> {
    return this.keys.get(id) || null;
  }

  /**
   * Find a key by prefix (for key lookup during validation)
   */
  async findByPrefix(prefix: string): Promise<ApiKey | null> {
    const id = this.prefixIndex.get(prefix);
    if (!id) return null;
    return this.keys.get(id) || null;
  }

  /**
   * Validate a raw API key and return the associated ApiKey if valid
   */
  async validateKey(rawKey: string): Promise<ApiKey | null> {
    // Extract prefix from raw key
    if (!rawKey.startsWith('ak_') || rawKey.length < KEY_PREFIX_LENGTH + 3) {
      return null;
    }

    const prefix = rawKey.substring(0, KEY_PREFIX_LENGTH + 3);
    const apiKey = await this.findByPrefix(prefix);

    if (!apiKey) {
      return null;
    }

    // Check if key is valid (active and not expired)
    if (!apiKey.isValid()) {
      return null;
    }

    // Verify the key hash
    const isMatch = await bcrypt.compare(rawKey, apiKey.keyHash);
    if (!isMatch) {
      return null;
    }

    // Update last used timestamp
    apiKey.touch();
    await this.update(apiKey);

    return apiKey;
  }

  /**
   * Find all keys matching filter
   */
  async findAll(filter?: ApiKeyFilter): Promise<ApiKey[]> {
    let keys = Array.from(this.keys.values());

    if (filter) {
      keys = keys.filter((key) => {
        if (filter.isActive !== undefined && key.isActive !== filter.isActive) {
          return false;
        }

        if (filter.hasPermission && !key.hasPermission(filter.hasPermission)) {
          return false;
        }

        if (filter.allowedGraph && !key.canAccessGraph(filter.allowedGraph)) {
          return false;
        }

        return true;
      });
    }

    // Sort by createdAt descending (newest first)
    keys.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return keys;
  }

  /**
   * Update a key
   */
  async update(apiKey: ApiKey): Promise<ApiKey> {
    if (!this.keys.has(apiKey.id)) {
      throw new Error(`API key not found: ${apiKey.id}`);
    }
    this.keys.set(apiKey.id, apiKey);
    await this.persistKeys();
    return apiKey;
  }

  /**
   * Update a key by ID with partial data
   */
  async updateById(id: string, updates: UpdateApiKeyRequest): Promise<ApiKey | null> {
    const apiKey = await this.findById(id);
    if (!apiKey) return null;

    if (updates.name !== undefined) {
      (apiKey as { name: string }).name = updates.name;
    }
    if (updates.permissions !== undefined) {
      apiKey.permissions = updates.permissions;
    }
    if (updates.rateLimit !== undefined) {
      apiKey.rateLimit = { ...apiKey.rateLimit, ...updates.rateLimit };
    }
    if (updates.allowedGraphs !== undefined) {
      apiKey.allowedGraphs = updates.allowedGraphs;
    }
    if (updates.isActive !== undefined) {
      apiKey.isActive = updates.isActive;
    }

    return this.update(apiKey);
  }

  /**
   * Revoke a key (soft delete - marks as inactive)
   */
  async revoke(id: string): Promise<boolean> {
    const apiKey = await this.findById(id);
    if (!apiKey) return false;

    apiKey.revoke();
    await this.update(apiKey);
    return true;
  }

  /**
   * Delete a key permanently
   */
  async delete(id: string): Promise<boolean> {
    const apiKey = this.keys.get(id);
    if (!apiKey) return false;

    this.keys.delete(id);
    this.prefixIndex.delete(apiKey.keyPrefix);
    await this.persistKeys();

    return true;
  }

  /**
   * Get key statistics
   */
  async getStats(): Promise<ApiKeyStats> {
    const keys = Array.from(this.keys.values());

    const stats: ApiKeyStats = {
      total: keys.length,
      active: keys.filter((k) => k.isActive && !k.isExpired()).length,
      inactive: keys.filter((k) => !k.isActive).length,
      expired: keys.filter((k) => k.isExpired()).length,
    };

    return stats;
  }

  /**
   * Check if any admin key exists
   */
  async hasAdminKey(): Promise<boolean> {
    const keys = await this.findAll({ hasPermission: 'admin' });
    return keys.some((k) => k.isValid());
  }

  // Private methods

  /**
   * Ensure an admin key exists (create from env var or auto-generate)
   */
  private async ensureAdminKey(): Promise<void> {
    const hasAdmin = await this.hasAdminKey();
    if (hasAdmin) return;

    // Check for admin key in environment variable
    const envAdminKey = process.env[this.adminKeyEnvVar];
    
    if (envAdminKey) {
      // Create admin key with provided key
      await this.createWithRawKey(envAdminKey, {
        name: 'Admin Key (from env)',
        permissions: PERMISSION_GROUPS.admin,
      });
      console.log(`🔑 Admin API key loaded from ${this.adminKeyEnvVar} environment variable`);
    } else {
      // Auto-generate admin key
      const response = await this.create({
        name: 'Auto-generated Admin Key',
        permissions: PERMISSION_GROUPS.admin,
      });
      
      // In production, write key to a secure file instead of console
      // In development, show the key but still warn about security
      const isProd = process.env.NODE_ENV === 'production';
      
      console.log('');
      console.log('🔑 ═══════════════════════════════════════════════════════════');
      console.log('   AUTO-GENERATED ADMIN API KEY (save this - shown only once!)');
      if (isProd) {
        // In production, mask most of the key for security
        const maskedKey = response.key.substring(0, 12) + '...' + response.key.substring(response.key.length - 4);
        console.log('   ' + maskedKey);
        console.log('   ⚠️  Full key written to: ./data/keys/admin-key.txt');
        // Write full key to secure file
        const keyFilePath = path.join(this.keysDir, 'admin-key.txt');
        fs.writeFileSync(keyFilePath, response.key, { mode: 0o600 });
      } else {
        console.log('   ' + response.key);
      }
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('');
      console.log(`   To set a custom admin key, add ${this.adminKeyEnvVar}=your_key to .env.local`);
      console.log('');
    }
  }

  /**
   * Create an API key with a specific raw key (for env-provided keys)
   */
  private async createWithRawKey(
    rawKey: string,
    request: Omit<CreateApiKeyRequest, 'rateLimit' | 'allowedGraphs' | 'expiresAt'> & {
      rateLimit?: CreateApiKeyRequest['rateLimit'];
      allowedGraphs?: CreateApiKeyRequest['allowedGraphs'];
      expiresAt?: CreateApiKeyRequest['expiresAt'];
    }
  ): Promise<ApiKey> {
    const keyPrefix = rawKey.substring(0, KEY_PREFIX_LENGTH + 3).padEnd(KEY_PREFIX_LENGTH + 3, '_');
    const keyHash = await bcrypt.hash(rawKey, this.bcryptRounds);

    const keyData: CreateApiKeyData = {
      name: request.name,
      keyHash,
      keyPrefix,
      permissions: request.permissions,
      rateLimit: { ...DEFAULT_RATE_LIMITS, ...request.rateLimit },
      allowedGraphs: request.allowedGraphs || '*',
      expiresAt: request.expiresAt,
    };

    const apiKey = new ApiKey(keyData);
    this.keys.set(apiKey.id, apiKey);
    this.prefixIndex.set(keyPrefix, apiKey.id);
    await this.persistKeys();

    return apiKey;
  }

  private async loadKeys(): Promise<void> {
    try {
      const content = await fs.promises.readFile(this.keysFilePath, 'utf8');
      const data = JSON.parse(content) as IApiKey[];

      for (const keyData of data) {
        try {
          const apiKey = ApiKey.fromStorage(keyData);
          this.keys.set(apiKey.id, apiKey);
          this.prefixIndex.set(apiKey.keyPrefix, apiKey.id);
        } catch (err) {
          console.error(`Failed to load API key ${keyData.id}:`, err);
        }
      }
    } catch (err) {
      // File may not exist yet
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  private async persistKeys(): Promise<void> {
    const keysArray = Array.from(this.keys.values()).map((k) => k.toStorage());
    await fs.promises.writeFile(this.keysFilePath, JSON.stringify(keysArray, null, 2), 'utf8');
  }
}

export interface ApiKeyStats {
  total: number;
  active: number;
  inactive: number;
  expired: number;
}
