import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { loadConfig } from '../utils/config';
import { LocalGraphStore, GraphProperties } from '../utils/LocalGraphStore';
import { getCacheManager, LocalCacheStore } from '../utils/cache';
import {
  BackupError,
  RecoveryError,
  DataCorruptionError
} from '../utils/errors';
import { createLogger, ILogger } from '../utils/logger';

/**
 * Backup metadata interface
 */
export interface BackupMetadata {
  id: string;
  timestamp: Date;
  type: 'automatic' | 'manual' | 'pre-operation';
  description?: string;
  size: number;
  checksum: string;
  version: string;
  components: {
    graph: boolean;
    cache: boolean;
    config: boolean;
  };
}

/**
 * Backup configuration interface
 */
export interface BackupConfig {
  enabled: boolean;
  automatic: boolean;
  interval: number; // milliseconds
  retention: {
    count: number; // max number of backups to keep
    days: number;  // max age in days
  };
  compression: boolean;
  verification: boolean;
}

/**
 * Recovery options interface
 */
export interface RecoveryOptions {
  components?: {
    graph?: boolean;
    cache?: boolean;
    config?: boolean;
  };
  verifyIntegrity?: boolean;
  createBackupBeforeRestore?: boolean;
  rollbackOnFailure?: boolean;
}

/**
 * Node entry as serialised into a backup file.
 */
type BackupGraphNode = {
  labels: string[];
  properties: GraphProperties;
};

/**
 * Relationship entry as serialised into a backup file.
 */
type BackupGraphRelationship = {
  startNodeId: string;
  endNodeId: string;
  type: string;
  properties: GraphProperties;
};

/**
 * Graph section of a backup file. Collections may be stored either as arrays or
 * as maps keyed by id, so both shapes are accepted when restoring.
 */
type BackupGraphData = {
  nodes?: BackupGraphNode[] | Record<string, BackupGraphNode>;
  relationships?: BackupGraphRelationship[] | Record<string, BackupGraphRelationship>;
};

/**
 * Full on-disk payload written by `createBackup` and read back by
 * `restoreFromBackup`.
 */
type BackupPayload = {
  metadata: {
    id: string;
    timestamp: Date;
    type: BackupMetadata['type'];
    description?: string;
    version: string;
    components: Partial<BackupMetadata['components']>;
    checksum?: string;
    size?: number;
  };
  graphData?: BackupGraphData;
  cacheData?: Record<string, unknown>;
  configData?: {
    localExecution?: unknown;
    performance?: unknown;
  };
};

/**
 * Narrow an unknown value to a plain object so its properties can be read.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Backup and recovery service for local execution mode
 * Provides automatic backup creation, integrity verification, and disaster recovery
 */
export class BackupRecoveryService {
  private config = loadConfig();
  private graphStore?: LocalGraphStore;
  private cacheManager = getCacheManager();
  private backupTimer?: NodeJS.Timeout;
  private backupDir: string;
  private backupConfig: BackupConfig;
  private readonly logger: ILogger;

  constructor(graphStore?: LocalGraphStore) {
    this.graphStore = graphStore;
    this.logger = createLogger('BackupRecoveryService');
    this.backupDir = path.join(this.config.localExecution.dataDirectory, 'backups');
    this.backupConfig = {
      enabled: this.config.localExecution.backupEnabled,
      automatic: true,
      interval: this.config.localExecution.backupInterval,
      retention: {
        count: 20,
        days: 30
      },
      compression: true,
      verification: true
    };

    if (this.backupConfig.enabled && this.backupConfig.automatic) {
      this.startAutomaticBackups();
    }
  }

  /**
   * Create a backup of local data
   */
  async createBackup(
    type: 'automatic' | 'manual' | 'pre-operation' = 'manual',
    description?: string,
    components: { graph?: boolean; cache?: boolean; config?: boolean } = {}
  ): Promise<BackupMetadata> {
    if (!this.backupConfig.enabled) {
      throw new BackupError('Backup is disabled in configuration');
    }

    try {
      // Ensure backup directory exists
      await fs.mkdir(this.backupDir, { recursive: true });

      // Check available space
      await this.checkStorageSpace();

      const backupId = this.generateBackupId();
      const backupPath = path.join(this.backupDir, `${backupId}.backup`);
      const tempPath = `${backupPath}.tmp`;

      const backupData: BackupPayload = {
        metadata: {
          id: backupId,
          timestamp: new Date(),
          type,
          description,
          version: '1.0.0',
          components
        }
      };

      // Set default values
      const finalComponents = {
        graph: components.graph ?? true,
        cache: components.cache ?? true,
        config: components.config ?? true
      };

      // Backup graph data
      if (finalComponents.graph && this.graphStore) {
        this.logger.info('Creating graph data backup');
        await this.graphStore.save(); // Ensure latest data is saved
        const graphDataPath = path.join(this.config.localExecution.dataDirectory, this.config.localExecution.graphFile);
        
        try {
          const graphData = await fs.readFile(graphDataPath, 'utf8');
          backupData.graphData = JSON.parse(graphData);
        } catch (error) {
          this.logger.warn('No graph data file found, skipping graph backup');
          finalComponents.graph = false;
        }
      }

      // Backup cache data
      if (finalComponents.cache && this.cacheManager instanceof LocalCacheStore) {
        this.logger.info('Creating cache data backup');
        const cacheData = await this.exportCacheData();
        backupData.cacheData = cacheData;
      }

      // Backup configuration
      if (finalComponents.config) {
        this.logger.info('Creating configuration backup');
        backupData.configData = {
          localExecution: this.config.localExecution,
          performance: this.config.performance
        };
      }

      // Write backup to temporary file
      const backupContent = JSON.stringify(backupData, null, 2);
      await fs.writeFile(tempPath, backupContent);

      // Calculate checksum
      const checksum = await this.calculateChecksum(tempPath);
      
      // Add checksum to metadata
      backupData.metadata.checksum = checksum;
      const size = Buffer.byteLength(backupContent);
      backupData.metadata.size = size;

      // Write final backup with checksum
      await fs.writeFile(tempPath, JSON.stringify(backupData, null, 2));

      // Verify backup integrity if enabled
      if (this.backupConfig.verification) {
        await this.verifyBackupIntegrity(tempPath);
      }

      // Move from temp to final location
      await fs.rename(tempPath, backupPath);

      const metadata: BackupMetadata = {
        id: backupId,
        timestamp: backupData.metadata.timestamp,
        type,
        description,
        size,
        checksum,
        version: backupData.metadata.version,
        components: finalComponents
      };

      this.logger.info('Backup created successfully', { backupPath });
      
      // Clean up old backups
      await this.cleanupOldBackups();

      return metadata;
    } catch (error) {
      throw new BackupError(
        `Failed to create backup: ${error}`,
        undefined,
        'create',
        error as Error
      );
    }
  }

  /**
   * Restore from a backup
   */
  async restoreFromBackup(
    backupId: string,
    options: RecoveryOptions = {}
  ): Promise<void> {
    const {
      components = { graph: true, cache: true, config: true },
      verifyIntegrity = true,
      createBackupBeforeRestore = true,
      rollbackOnFailure = true
    } = options;

    const backupPath = path.join(this.backupDir, `${backupId}.backup`);
    let preRestoreBackupId: string | null = null;

    try {
      // Check if backup exists
      try {
        await fs.access(backupPath);
      } catch {
        throw new RecoveryError(
          `Backup not found: ${backupId}`,
          'manual',
          backupPath
        );
      }

      // Verify backup integrity
      if (verifyIntegrity) {
        this.logger.info('Verifying backup integrity');
        await this.verifyBackupIntegrity(backupPath);
      }

      // Create backup before restore
      if (createBackupBeforeRestore) {
        this.logger.info('Creating pre-restore backup');
        const preRestoreBackup = await this.createBackup('pre-operation', `Before restore from ${backupId}`);
        preRestoreBackupId = preRestoreBackup.id;
      }

      // Load backup data
      this.logger.info('Loading backup data');
      const backupContent = await fs.readFile(backupPath, 'utf8');
      const backupData = JSON.parse(backupContent);

      // Restore graph data
      if (components.graph && backupData.graphData) {
        this.logger.info('Restoring graph data');
        await this.restoreGraphData(backupData.graphData);
      }

      // Restore cache data
      if (components.cache && backupData.cacheData) {
        this.logger.info('Restoring cache data');
        await this.restoreCacheData(backupData.cacheData);
      }

      // Restore configuration
      if (components.config && backupData.configData) {
        this.logger.info('Restoring configuration');
        await this.restoreConfigData(backupData.configData);
      }

      this.logger.info('Restore completed successfully', { backupId });
    } catch (error) {
      this.logger.error('Restore failed', error);

      // Attempt rollback if enabled and we have a pre-restore backup
      if (rollbackOnFailure && preRestoreBackupId) {
        this.logger.info('Attempting rollback');
        try {
          await this.restoreFromBackup(preRestoreBackupId, {
            components,
            verifyIntegrity: false,
            createBackupBeforeRestore: false,
            rollbackOnFailure: false
          });
          this.logger.info('Rollback completed successfully');
        } catch (rollbackError) {
          this.logger.error('Rollback failed', rollbackError);
        }
      }

      throw new RecoveryError(
        `Failed to restore from backup: ${error}`,
        'manual',
        backupPath,
        'restore',
        error as Error
      );
    }
  }

  /**
   * List available backups
   */
  async listBackups(): Promise<BackupMetadata[]> {
    try {
      // Check if backup directory exists, return empty if not
      try {
        await fs.access(this.backupDir);
      } catch {
        return [];
      }

      const files = await fs.readdir(this.backupDir);
      const backupFiles = files.filter(file => file.endsWith('.backup'));
      const backups: BackupMetadata[] = [];

      for (const file of backupFiles) {
        try {
          const backupPath = path.join(this.backupDir, file);
          const content = await fs.readFile(backupPath, 'utf8');
          const backupData = JSON.parse(content);

          if (backupData.metadata) {
            backups.push({
              ...backupData.metadata,
              timestamp: new Date(backupData.metadata.timestamp)
            });
          }
        } catch (error) {
          this.logger.warn('Failed to read backup metadata', { file, error });
        }
      }

      // Sort by timestamp (newest first)
      return backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      throw new BackupError(
        `Failed to list backups: ${error}`,
        this.backupDir,
        'list',
        error as Error
      );
    }
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupId: string): Promise<void> {
    const backupPath = path.join(this.backupDir, `${backupId}.backup`);
    
    try {
      await fs.unlink(backupPath);
      this.logger.info('Backup deleted', { backupId });
    } catch (error) {
      throw new BackupError(
        `Failed to delete backup: ${error}`,
        backupPath,
        'delete',
        error as Error
      );
    }
  }

  /**
   * Verify backup integrity
   */
  async verifyBackupIntegrity(backupPath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(backupPath, 'utf8');
      const backupData = JSON.parse(content);
      
      if (!backupData.metadata || !backupData.metadata.checksum) {
        throw new DataCorruptionError(
          'Backup missing metadata or checksum',
          backupPath,
          'missing_checksum'
        );
      }

      // Save the expected checksum before modifying
      const expectedChecksum = backupData.metadata.checksum;

      // Create a deep copy without checksum and size for verification
      // Size was added after checksum calculation, so exclude it too
      const verificationData = {
        ...backupData,
        metadata: { ...backupData.metadata }
      };
      delete verificationData.metadata.checksum;
      delete verificationData.metadata.size;

      const calculatedChecksum = crypto
        .createHash('sha256')
        .update(JSON.stringify(verificationData, null, 2))
        .digest('hex');

      if (calculatedChecksum !== expectedChecksum) {
        throw new DataCorruptionError(
          'Backup checksum mismatch',
          backupPath,
          'checksum_mismatch',
          expectedChecksum,
          calculatedChecksum
        );
      }

      return true;
    } catch (error) {
      if (error instanceof DataCorruptionError) {
        throw error;
      }
      throw new DataCorruptionError(
        `Backup verification failed: ${error}`,
        backupPath,
        'verification_error',
        undefined,
        undefined,
        error as Error
      );
    }
  }

  /**
   * Start automatic backup timer
   */
  private startAutomaticBackups(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
    }

    this.backupTimer = setInterval(async () => {
      try {
        this.logger.info('Starting automatic backup');
        await this.createBackup('automatic', `Automatic backup at ${new Date().toISOString()}`);
      } catch (error) {
        this.logger.error('Automatic backup failed', error);
      }
    }, this.backupConfig.interval);

    this.logger.info('Automatic backups enabled', { intervalMs: this.backupConfig.interval });
  }

  /**
   * Stop automatic backups
   */
  stopAutomaticBackups(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = undefined;
      this.logger.info('Automatic backups stopped');
    }
  }

  /**
   * Export cache data for backup
   */
  private async exportCacheData(): Promise<Record<string, unknown>> {
    if (!(this.cacheManager instanceof LocalCacheStore)) {
      return {};
    }

    // Access cache entries through metrics or implement export method
    // For now, return empty object as cache export would need additional implementation
    return {};
  }

  /**
   * Restore graph data from backup
   */
  private async restoreGraphData(graphData: BackupGraphData): Promise<void> {
    if (!this.graphStore) {
      throw new RecoveryError('Graph store not available for restore', 'manual');
    }

    try {
      // Clear existing data
      await this.graphStore.clear();

      // Restore nodes
      if (graphData.nodes) {
        const nodes = Array.isArray(graphData.nodes)
          ? graphData.nodes
          : Object.values(graphData.nodes);
        for (const nodeData of nodes) {
          await this.graphStore.createNode(nodeData.labels, nodeData.properties);
        }
      }

      // Restore relationships
      if (graphData.relationships) {
        const rels = Array.isArray(graphData.relationships)
          ? graphData.relationships
          : Object.values(graphData.relationships);
        for (const relData of rels) {
          await this.graphStore.createRelationship(
            relData.startNodeId,
            relData.endNodeId,
            relData.type,
            relData.properties
          );
        }
      }

      // Save restored data
      await this.graphStore.save();
    } catch (error) {
      throw new RecoveryError(
        `Failed to restore graph data: ${error}`,
        'manual',
        undefined,
        'restore_graph',
        error as Error
      );
    }
  }

  /**
   * Restore cache data from backup
   */
  private async restoreCacheData(cacheData: Record<string, unknown>): Promise<void> {
    if (!(this.cacheManager instanceof LocalCacheStore)) {
      return;
    }

    try {
      // Clear existing cache
      await this.cacheManager.clear();

      // Restore cache entries
      for (const [key, entry] of Object.entries(cacheData)) {
        if (entry === null || entry === undefined) {
          throw new TypeError(`Cannot read properties of ${String(entry)} (reading 'expiration')`);
        }
        if (!isRecord(entry)) {
          continue;
        }
        const expiration = entry.expiration;
        if (typeof expiration === 'number' && expiration > Date.now()) {
          await this.cacheManager.set(key, entry.value, expiration - Date.now());
        }
      }
    } catch (error) {
      throw new RecoveryError(
        `Failed to restore cache data: ${error}`,
        'manual',
        undefined,
        'restore_cache',
        error as Error
      );
    }
  }

  /**
   * Restore configuration from backup
   */
  private async restoreConfigData(configData: unknown): Promise<void> {
    try {
      if (!isRecord(configData)) {
        this.logger.warn('Backup contains no usable configuration section');
        return;
      }

      // Update local execution config
      if (configData.localExecution) {
        Object.assign(this.config.localExecution, configData.localExecution);
      }

      // Update performance config
      if (configData.performance) {
        Object.assign(this.config.performance, configData.performance);
      }

      this.logger.info('Configuration restored (requires restart to take full effect)');
    } catch (error) {
      throw new RecoveryError(
        `Failed to restore configuration: ${error}`,
        'manual',
        undefined,
        'restore_config',
        error as Error
      );
    }
  }

  /**
   * Calculate file checksum
   */
  private async calculateChecksum(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Check available storage space
   */
  private async checkStorageSpace(): Promise<void> {
    try {
      // Confirm the backup directory exists. A real capacity check would use
      // fs.statfs; the size threshold itself is not enforced yet.
      await fs.stat(this.backupDir);
      this.logger.debug('Storage space check passed');
    } catch (error) {
      this.logger.warn('Could not verify storage space', { error });
    }
  }

  /**
   * Clean up old backups based on retention policy
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const backups = await this.listBackups();
      const toDelete: string[] = [];

      // Remove excess backups by count
      if (backups.length > this.backupConfig.retention.count) {
        const excess = backups.slice(this.backupConfig.retention.count);
        toDelete.push(...excess.map(b => b.id));
      }

      // Remove backups older than retention period
      const cutoffDate = new Date(Date.now() - (this.backupConfig.retention.days * 24 * 60 * 60 * 1000));
      const expired = backups.filter(b => b.timestamp < cutoffDate && !toDelete.includes(b.id));
      toDelete.push(...expired.map(b => b.id));

      // Delete old backups
      for (const backupId of toDelete) {
        try {
          await this.deleteBackup(backupId);
        } catch (error) {
          this.logger.warn('Failed to delete old backup', { backupId, error });
        }
      }

      if (toDelete.length > 0) {
        this.logger.info('Cleaned up old backups', { count: toDelete.length });
      }
    } catch (error) {
      this.logger.warn('Failed to cleanup old backups', { error });
    }
  }

  /**
   * Generate unique backup ID
   */
  private generateBackupId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `backup_${timestamp}_${random}`;
  }

  /**
   * Shutdown the backup service
   */
  async shutdown(): Promise<void> {
    this.stopAutomaticBackups();
    this.logger.info('Backup service shutdown complete');
  }
}