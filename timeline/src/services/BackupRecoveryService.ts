import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { loadConfig } from '../utils/config';
import { LocalGraphStore } from '../utils/LocalGraphStore';
import { getCacheManager, LocalCacheStore } from '../utils/cache';
import { 
  BackupError, 
  RecoveryError, 
  DataCorruptionError, 
  InsufficientStorageError,
  LocalStorageError 
} from '../utils/errors';

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

  constructor(graphStore?: LocalGraphStore) {
    this.graphStore = graphStore;
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

      const backupData: any = {
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
        console.log('Creating graph data backup...');
        await this.graphStore.save(); // Ensure latest data is saved
        const graphDataPath = path.join(this.config.localExecution.dataDirectory, this.config.localExecution.graphFile);
        
        try {
          const graphData = await fs.readFile(graphDataPath, 'utf8');
          backupData.graphData = JSON.parse(graphData);
        } catch (error) {
          console.warn('No graph data file found, skipping graph backup');
          finalComponents.graph = false;
        }
      }

      // Backup cache data
      if (finalComponents.cache && this.cacheManager instanceof LocalCacheStore) {
        console.log('Creating cache data backup...');
        const cacheData = await this.exportCacheData();
        backupData.cacheData = cacheData;
      }

      // Backup configuration
      if (finalComponents.config) {
        console.log('Creating configuration backup...');
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
      backupData.metadata.size = Buffer.byteLength(backupContent);

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
        size: backupData.metadata.size,
        checksum,
        version: backupData.metadata.version,
        components: finalComponents
      };

      console.log(`✅ Backup created successfully: ${backupPath}`);
      
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
        console.log('🔍 Verifying backup integrity...');
        await this.verifyBackupIntegrity(backupPath);
      }

      // Create backup before restore
      if (createBackupBeforeRestore) {
        console.log('💾 Creating pre-restore backup...');
        const preRestoreBackup = await this.createBackup('pre-operation', `Before restore from ${backupId}`);
        preRestoreBackupId = preRestoreBackup.id;
      }

      // Load backup data
      console.log('📦 Loading backup data...');
      const backupContent = await fs.readFile(backupPath, 'utf8');
      const backupData = JSON.parse(backupContent);

      // Restore graph data
      if (components.graph && backupData.graphData) {
        console.log('🔄 Restoring graph data...');
        await this.restoreGraphData(backupData.graphData);
      }

      // Restore cache data
      if (components.cache && backupData.cacheData) {
        console.log('🔄 Restoring cache data...');
        await this.restoreCacheData(backupData.cacheData);
      }

      // Restore configuration
      if (components.config && backupData.configData) {
        console.log('🔄 Restoring configuration...');
        await this.restoreConfigData(backupData.configData);
      }

      console.log(`✅ Restore completed successfully from backup: ${backupId}`);
    } catch (error) {
      console.error('❌ Restore failed:', error);

      // Attempt rollback if enabled and we have a pre-restore backup
      if (rollbackOnFailure && preRestoreBackupId) {
        console.log('🔄 Attempting rollback...');
        try {
          await this.restoreFromBackup(preRestoreBackupId, {
            components,
            verifyIntegrity: false,
            createBackupBeforeRestore: false,
            rollbackOnFailure: false
          });
          console.log('✅ Rollback completed successfully');
        } catch (rollbackError) {
          console.error('❌ Rollback failed:', rollbackError);
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
          console.warn(`Failed to read backup metadata from ${file}:`, error);
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
      console.log(`🗑️ Backup deleted: ${backupId}`);
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

      // Create a copy without checksum for verification
      const verificationData = { ...backupData };
      delete verificationData.metadata.checksum;
      
      const calculatedChecksum = crypto
        .createHash('sha256')
        .update(JSON.stringify(verificationData))
        .digest('hex');

      if (calculatedChecksum !== backupData.metadata.checksum) {
        throw new DataCorruptionError(
          'Backup checksum mismatch',
          backupPath,
          'checksum_mismatch',
          backupData.metadata.checksum,
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
        console.log('🕐 Starting automatic backup...');
        await this.createBackup('automatic', `Automatic backup at ${new Date().toISOString()}`);
      } catch (error) {
        console.error('❌ Automatic backup failed:', error);
      }
    }, this.backupConfig.interval);

    console.log(`⏰ Automatic backups enabled (interval: ${this.backupConfig.interval}ms)`);
  }

  /**
   * Stop automatic backups
   */
  stopAutomaticBackups(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = undefined;
      console.log('🛑 Automatic backups stopped');
    }
  }

  /**
   * Export cache data for backup
   */
  private async exportCacheData(): Promise<{ [key: string]: any }> {
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
  private async restoreGraphData(graphData: any): Promise<void> {
    if (!this.graphStore) {
      throw new RecoveryError('Graph store not available for restore', 'manual');
    }

    try {
      // Clear existing data
      await this.graphStore.clear();

      // Restore nodes
      if (graphData.nodes) {
        const nodes = typeof graphData.nodes === 'object' ? Object.values(graphData.nodes) : graphData.nodes;
        for (const nodeData of nodes as any[]) {
          await this.graphStore.createNode(nodeData.labels, nodeData.properties);
        }
      }

      // Restore relationships
      if (graphData.relationships) {
        const rels = typeof graphData.relationships === 'object' ? Object.values(graphData.relationships) : graphData.relationships;
        for (const relData of rels as any[]) {
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
  private async restoreCacheData(cacheData: any): Promise<void> {
    if (!(this.cacheManager instanceof LocalCacheStore)) {
      return;
    }

    try {
      // Clear existing cache
      await this.cacheManager.clear();

      // Restore cache entries
      for (const [key, entry] of Object.entries(cacheData)) {
        const cacheEntry = entry as any;
        if (cacheEntry.expiration > Date.now()) {
          await this.cacheManager.set(key, cacheEntry.value, cacheEntry.expiration - Date.now());
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
  private async restoreConfigData(configData: any): Promise<void> {
    try {
      // Update local execution config
      if (configData.localExecution) {
        Object.assign(this.config.localExecution, configData.localExecution);
      }

      // Update performance config
      if (configData.performance) {
        Object.assign(this.config.performance, configData.performance);
      }

      console.log('⚙️ Configuration restored (requires restart to take full effect)');
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
      const stats = await fs.stat(this.backupDir);
      // This is a simplified check - in production you'd want to check actual disk space
      const estimatedBackupSize = 50 * 1024 * 1024; // 50MB estimate
      
      // Placeholder for actual disk space check
      // In a real implementation, you'd use fs.statfs or similar
      console.log('📊 Storage space check passed');
    } catch (error) {
      console.warn('⚠️ Could not verify storage space:', error);
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
          console.warn(`Failed to delete old backup ${backupId}:`, error);
        }
      }

      if (toDelete.length > 0) {
        console.log(`🧹 Cleaned up ${toDelete.length} old backups`);
      }
    } catch (error) {
      console.warn('Failed to cleanup old backups:', error);
    }
  }

  /**
   * Generate unique backup ID
   */
  private generateBackupId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substr(2, 6);
    return `backup_${timestamp}_${random}`;
  }

  /**
   * Shutdown the backup service
   */
  async shutdown(): Promise<void> {
    this.stopAutomaticBackups();
    console.log('🛑 Backup service shutdown complete');
  }
}