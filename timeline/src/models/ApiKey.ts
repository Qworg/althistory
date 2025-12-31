/**
 * API Key model for external system authentication
 */

export type Permission =
  | 'read:events'
  | 'write:events'
  | 'read:arcs'
  | 'write:arcs'
  | 'read:relationships'
  | 'write:relationships'
  | 'read:graphs'
  | 'write:graphs'
  | 'export'
  | 'import'
  | 'ingest'
  | 'admin';

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  batchSizeLimit: number;
  concurrentStreams: number;
}

export interface IApiKey {
  id: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  permissions: Permission[];
  rateLimit: RateLimitConfig;
  allowedGraphs: string[] | '*';
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  isActive: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Default rate limits for new API keys
 */
export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  requestsPerDay: 10000,
  batchSizeLimit: 1000,
  concurrentStreams: 5,
};

/**
 * Permission groups for convenience
 */
export const PERMISSION_GROUPS = {
  readOnly: [
    'read:events',
    'read:arcs',
    'read:relationships',
    'read:graphs',
    'export',
  ] as Permission[],
  
  readWrite: [
    'read:events',
    'write:events',
    'read:arcs',
    'write:arcs',
    'read:relationships',
    'write:relationships',
    'read:graphs',
    'write:graphs',
    'export',
    'import',
  ] as Permission[],
  
  full: [
    'read:events',
    'write:events',
    'read:arcs',
    'write:arcs',
    'read:relationships',
    'write:relationships',
    'read:graphs',
    'write:graphs',
    'export',
    'import',
    'ingest',
  ] as Permission[],
  
  admin: [
    'read:events',
    'write:events',
    'read:arcs',
    'write:arcs',
    'read:relationships',
    'write:relationships',
    'read:graphs',
    'write:graphs',
    'export',
    'import',
    'ingest',
    'admin',
  ] as Permission[],
};

/**
 * ApiKey class
 */
export class ApiKey implements IApiKey {
  public readonly id: string;
  public readonly name: string;
  public readonly keyHash: string;
  public readonly keyPrefix: string;
  public permissions: Permission[];
  public rateLimit: RateLimitConfig;
  public allowedGraphs: string[] | '*';
  public readonly createdAt: string;
  public lastUsedAt?: string;
  public expiresAt?: string;
  public isActive: boolean;
  public metadata?: Record<string, unknown>;

  constructor(data: CreateApiKeyData) {
    const validation = ApiKey.validate(data);
    if (!validation.isValid) {
      throw new Error(`ApiKey validation failed: ${validation.errors.join(', ')}`);
    }

    this.id = data.id || this.generateId();
    this.name = data.name.trim();
    this.keyHash = data.keyHash;
    this.keyPrefix = data.keyPrefix;
    this.permissions = data.permissions;
    this.rateLimit = { ...DEFAULT_RATE_LIMITS, ...data.rateLimit };
    this.allowedGraphs = data.allowedGraphs || '*';
    this.createdAt = data.createdAt || new Date().toISOString();
    this.lastUsedAt = data.lastUsedAt;
    this.expiresAt = data.expiresAt;
    this.isActive = data.isActive ?? true;
    this.metadata = data.metadata;
  }

  /**
   * Validates API key data
   */
  static validate(data: Partial<CreateApiKeyData>): ApiKeyValidationResult {
    const errors: string[] = [];

    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      errors.push('Name is required and must be a non-empty string');
    }

    if (!data.keyHash || typeof data.keyHash !== 'string') {
      errors.push('Key hash is required');
    }

    if (!data.keyPrefix || typeof data.keyPrefix !== 'string' || data.keyPrefix.length < 8) {
      errors.push('Key prefix must be at least 8 characters');
    }

    if (!data.permissions || !Array.isArray(data.permissions) || data.permissions.length === 0) {
      errors.push('At least one permission is required');
    }

    const validPermissions: Permission[] = [
      'read:events', 'write:events',
      'read:arcs', 'write:arcs',
      'read:relationships', 'write:relationships',
      'read:graphs', 'write:graphs',
      'export', 'import', 'ingest', 'admin',
    ];
    
    if (data.permissions) {
      for (const perm of data.permissions) {
        if (!validPermissions.includes(perm)) {
          errors.push(`Invalid permission: ${perm}`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if key has a specific permission
   */
  hasPermission(permission: Permission): boolean {
    return this.permissions.includes(permission) || this.permissions.includes('admin');
  }

  /**
   * Check if key has any of the specified permissions
   */
  hasAnyPermission(permissions: Permission[]): boolean {
    return permissions.some(p => this.hasPermission(p));
  }

  /**
   * Check if key has all specified permissions
   */
  hasAllPermissions(permissions: Permission[]): boolean {
    return permissions.every(p => this.hasPermission(p));
  }

  /**
   * Check if key can access a specific graph
   */
  canAccessGraph(graphId: string): boolean {
    if (this.allowedGraphs === '*') return true;
    return this.allowedGraphs.includes(graphId);
  }

  /**
   * Check if key has expired
   */
  isExpired(): boolean {
    if (!this.expiresAt) return false;
    return new Date() > new Date(this.expiresAt);
  }

  /**
   * Check if key is valid for use
   */
  isValid(): boolean {
    return this.isActive && !this.isExpired();
  }

  /**
   * Update last used timestamp
   */
  touch(): void {
    this.lastUsedAt = new Date().toISOString();
  }

  /**
   * Revoke the key
   */
  revoke(): void {
    this.isActive = false;
  }

  /**
   * Convert to plain object (without hash for API responses)
   */
  toJSON(): Omit<IApiKey, 'keyHash'> {
    return {
      id: this.id,
      name: this.name,
      keyPrefix: this.keyPrefix,
      permissions: this.permissions,
      rateLimit: this.rateLimit,
      allowedGraphs: this.allowedGraphs,
      createdAt: this.createdAt,
      lastUsedAt: this.lastUsedAt,
      expiresAt: this.expiresAt,
      isActive: this.isActive,
      metadata: this.metadata,
    };
  }

  /**
   * Convert to full object (for storage)
   */
  toStorage(): IApiKey {
    return {
      ...this.toJSON(),
      keyHash: this.keyHash,
    } as IApiKey;
  }

  /**
   * Create from storage object
   */
  static fromStorage(data: IApiKey): ApiKey {
    return new ApiKey({
      id: data.id,
      name: data.name,
      keyHash: data.keyHash,
      keyPrefix: data.keyPrefix,
      permissions: data.permissions,
      rateLimit: data.rateLimit,
      allowedGraphs: data.allowedGraphs,
      createdAt: data.createdAt,
      lastUsedAt: data.lastUsedAt,
      expiresAt: data.expiresAt,
      isActive: data.isActive,
      metadata: data.metadata,
    });
  }

  private generateId(): string {
    return `key_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

export interface CreateApiKeyData {
  id?: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  permissions: Permission[];
  rateLimit?: Partial<RateLimitConfig>;
  allowedGraphs?: string[] | '*';
  createdAt?: string;
  lastUsedAt?: string;
  expiresAt?: string;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ApiKeyValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * API request/response types
 */
export interface CreateApiKeyRequest {
  name: string;
  permissions: Permission[];
  rateLimit?: Partial<RateLimitConfig>;
  allowedGraphs?: string[] | '*';
  expiresAt?: string;
}

export interface CreateApiKeyResponse {
  id: string;
  key: string;  // Full key, shown only once
  keyPrefix: string;
  name: string;
  permissions: Permission[];
  rateLimit: RateLimitConfig;
  createdAt: string;
}

export interface UpdateApiKeyRequest {
  name?: string;
  permissions?: Permission[];
  rateLimit?: Partial<RateLimitConfig>;
  allowedGraphs?: string[] | '*';
  isActive?: boolean;
}

/**
 * Rate limit tracking state
 */
export interface RateLimitState {
  keyId: string;
  minute: { count: number; resetAt: number };
  hour: { count: number; resetAt: number };
  day: { count: number; resetAt: number };
}

/**
 * Stream token for WebSocket authentication
 */
export interface StreamToken {
  token: string;
  apiKeyId: string;
  graphId: string;
  permissions: Permission[];
  createdAt: string;
  expiresAt: string;
}
