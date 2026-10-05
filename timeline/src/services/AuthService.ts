/**
 * Authentication service for API key validation and permission checking
 */

import { ApiKeyRepository } from '../repositories/ApiKeyRepository';
import {
  ApiKey,
  Permission,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  UpdateApiKeyRequest,
} from '../models/ApiKey';

export interface AuthServiceConfig {
  dataDir: string;
  bcryptRounds?: number;
}

export interface AuthResult {
  authenticated: boolean;
  apiKey?: ApiKey;
  error?: string;
}

export interface PermissionCheckResult {
  allowed: boolean;
  missingPermissions?: Permission[];
  error?: string;
}

export interface GraphAccessResult {
  allowed: boolean;
  error?: string;
}

/**
 * Service for handling authentication and authorization
 */
export class AuthService {
  private readonly apiKeyRepository: ApiKeyRepository;
  private initialized = false;

  constructor(config: AuthServiceConfig) {
    this.apiKeyRepository = new ApiKeyRepository({
      dataDir: config.dataDir,
      bcryptRounds: config.bcryptRounds,
    });
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.apiKeyRepository.initialize();
    this.initialized = true;
  }

  /**
   * Authenticate a request using API key from header
   */
  async authenticate(apiKey: string | undefined): Promise<AuthResult> {
    if (!apiKey) {
      return {
        authenticated: false,
        error: 'API key is required',
      };
    }

    const validatedKey = await this.apiKeyRepository.validateKey(apiKey);

    if (!validatedKey) {
      return {
        authenticated: false,
        error: 'Invalid or expired API key',
      };
    }

    return {
      authenticated: true,
      apiKey: validatedKey,
    };
  }

  /**
   * Check if an API key has a specific permission
   */
  checkPermission(apiKey: ApiKey, permission: Permission): PermissionCheckResult {
    if (apiKey.hasPermission(permission)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      missingPermissions: [permission],
      error: `Missing required permission: ${permission}`,
    };
  }

  /**
   * Check if an API key has all specified permissions
   */
  checkPermissions(apiKey: ApiKey, permissions: Permission[]): PermissionCheckResult {
    const missingPermissions = permissions.filter((p) => !apiKey.hasPermission(p));

    if (missingPermissions.length === 0) {
      return { allowed: true };
    }

    return {
      allowed: false,
      missingPermissions,
      error: `Missing required permissions: ${missingPermissions.join(', ')}`,
    };
  }

  /**
   * Check if an API key has any of the specified permissions
   */
  checkAnyPermission(apiKey: ApiKey, permissions: Permission[]): PermissionCheckResult {
    if (apiKey.hasAnyPermission(permissions)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      missingPermissions: permissions,
      error: `Requires at least one of: ${permissions.join(', ')}`,
    };
  }

  /**
   * Check if an API key can access a specific graph
   */
  checkGraphAccess(apiKey: ApiKey, graphId: string): GraphAccessResult {
    if (apiKey.canAccessGraph(graphId)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      error: `Access to graph '${graphId}' is not allowed`,
    };
  }

  /**
   * Full authorization check for a request
   */
  authorize(
    apiKey: ApiKey,
    options: {
      requiredPermissions?: Permission[];
      anyPermissions?: Permission[];
      graphId?: string;
    }
  ): { authorized: boolean; error?: string } {
    // Check required permissions
    if (options.requiredPermissions && options.requiredPermissions.length > 0) {
      const result = this.checkPermissions(apiKey, options.requiredPermissions);
      if (!result.allowed) {
        return { authorized: false, error: result.error };
      }
    }

    // Check any permissions
    if (options.anyPermissions && options.anyPermissions.length > 0) {
      const result = this.checkAnyPermission(apiKey, options.anyPermissions);
      if (!result.allowed) {
        return { authorized: false, error: result.error };
      }
    }

    // Check graph access
    if (options.graphId) {
      const result = this.checkGraphAccess(apiKey, options.graphId);
      if (!result.allowed) {
        return { authorized: false, error: result.error };
      }
    }

    return { authorized: true };
  }

  // API Key Management Methods (delegated to repository)

  /**
   * Create a new API key
   */
  async createApiKey(request: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    return this.apiKeyRepository.create(request);
  }

  /**
   * Get an API key by ID
   */
  async getApiKey(id: string): Promise<ApiKey | null> {
    return this.apiKeyRepository.findById(id);
  }

  /**
   * List all API keys
   */
  async listApiKeys(options?: { activeOnly?: boolean }): Promise<ApiKey[]> {
    return this.apiKeyRepository.findAll({
      isActive: options?.activeOnly ? true : undefined,
    });
  }

  /**
   * Update an API key
   */
  async updateApiKey(id: string, updates: UpdateApiKeyRequest): Promise<ApiKey | null> {
    return this.apiKeyRepository.updateById(id, updates);
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(id: string): Promise<boolean> {
    return this.apiKeyRepository.revoke(id);
  }

  /**
   * Delete an API key permanently
   */
  async deleteApiKey(id: string): Promise<boolean> {
    return this.apiKeyRepository.delete(id);
  }

  /**
   * Get API key statistics
   */
  async getApiKeyStats(): Promise<{
    total: number;
    active: number;
    inactive: number;
    expired: number;
  }> {
    return this.apiKeyRepository.getStats();
  }

  /**
   * Check if there are any admin keys
   */
  async hasAdminKey(): Promise<boolean> {
    return this.apiKeyRepository.hasAdminKey();
  }

  /**
   * Get the underlying repository (for advanced use cases)
   */
  getRepository(): ApiKeyRepository {
    return this.apiKeyRepository;
  }
}
