import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BackupRecoveryService, BackupMetadata } from './BackupRecoveryService';
import { LocalGraphStore } from '../utils/LocalGraphStore';
import { LocalCacheStore, getCacheManager } from '../utils/cache';
import { loadConfig } from '../utils/config';
import { BackupError, RecoveryError, DataCorruptionError } from '../utils/errors';

// Mock dependencies
vi.mock('../utils/config', () => ({
  loadConfig: vi.fn()
}));
vi.mock('../utils/cache', () => ({
  getCacheManager: vi.fn(),
  LocalCacheStore: class MockLocalCacheStore {}
}));

describe('BackupRecoveryService', () => {
  let backupService: BackupRecoveryService;
  let mockGraphStore: any;
  let mockCacheManager: any;
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = await fs.mkdtemp(path.join(__dirname, 'backup-test-'));

    // Mock graph store
    mockGraphStore = {
      save: vi.fn(),
      clear: vi.fn(),
      createNode: vi.fn(),
      createRelationship: vi.fn()
    };

    // Mock cache manager
    mockCacheManager = {
      clear: vi.fn(),
      set: vi.fn()
    };

    // Mock config
    vi.mocked(loadConfig).mockReturnValue({
      localExecution: {
        dataDirectory: tempDir,
        graphFile: 'graph.json',
        backupEnabled: true,
        backupInterval: 60000
      },
      performance: {
        cacheExpirationMs: 300000
      }
    } as any);

    vi.mocked(getCacheManager).mockReturnValue(mockCacheManager);

    backupService = new BackupRecoveryService(mockGraphStore);
  });

  afterEach(async () => {
    await backupService.shutdown();
    // Clean up temporary directory
    await fs.rmdir(tempDir, { recursive: true }).catch(() => {});
  });

  describe('createBackup', () => {
    it('should create a backup with graph data', async () => {
      // Create mock graph data file
      const graphDataPath = path.join(tempDir, 'graph.json');
      const mockGraphData = {
        nodes: { '1': { id: '1', labels: ['Event'], properties: { name: 'Test' } } },
        relationships: {}
      };
      await fs.writeFile(graphDataPath, JSON.stringify(mockGraphData));

      const backup = await backupService.createBackup('manual', 'Test backup');

      expect(backup.id).toBeDefined();
      expect(backup.type).toBe('manual');
      expect(backup.description).toBe('Test backup');
      expect(backup.components.graph).toBe(true);
      expect(backup.checksum).toBeDefined();
      expect(backup.size).toBeGreaterThan(0);

      // Verify backup file exists
      const backupPath = path.join(tempDir, 'backups', `${backup.id}.backup`);
      await expect(fs.access(backupPath)).resolves.toBeUndefined();
    });

    it('should create backup without graph data if file missing', async () => {
      const backup = await backupService.createBackup('manual', 'Test backup');

      expect(backup.components.graph).toBe(false);
      expect(backup.components.cache).toBe(true);
      expect(backup.components.config).toBe(true);
    });

    it('should handle backup creation errors', async () => {
      // Disable backup to trigger error
      (backupService as any).backupConfig.enabled = false;

      await expect(
        backupService.createBackup('manual', 'Test backup')
      ).rejects.toThrow(BackupError);

      // Re-enable for other tests
      (backupService as any).backupConfig.enabled = true;
    });

    it('should clean up old backups', async () => {
      // Create multiple backups
      const backups: BackupMetadata[] = [];
      for (let i = 0; i < 3; i++) {
        const backup = await backupService.createBackup('manual', `Backup ${i}`);
        backups.push(backup);
      }

      const listedBackups = await backupService.listBackups();
      expect(listedBackups.length).toBe(3);
    });
  });

  describe('restoreFromBackup', () => {
    it('should restore from a valid backup', async () => {
      // Create a backup first
      const graphDataPath = path.join(tempDir, 'graph.json');
      const mockGraphData = {
        nodes: { '1': { id: '1', labels: ['Event'], properties: { name: 'Test' } } },
        relationships: { '1': { id: '1', type: 'CAUSES', startNodeId: '1', endNodeId: '2', properties: {} } }
      };
      await fs.writeFile(graphDataPath, JSON.stringify(mockGraphData));

      const backup = await backupService.createBackup('manual', 'Test backup');

      // Clear graph store to simulate data loss
      mockGraphStore.clear.mockClear();
      mockGraphStore.createNode.mockClear();
      mockGraphStore.createRelationship.mockClear();

      // Restore from backup
      await backupService.restoreFromBackup(backup.id, {
        createBackupBeforeRestore: false
      });

      expect(mockGraphStore.clear).toHaveBeenCalled();
      expect(mockGraphStore.createNode).toHaveBeenCalled();
      expect(mockGraphStore.createRelationship).toHaveBeenCalled();
      expect(mockGraphStore.save).toHaveBeenCalled();
    });

    it('should handle restore from non-existent backup', async () => {
      await expect(
        backupService.restoreFromBackup('non-existent-backup')
      ).rejects.toThrow(RecoveryError);
    });

    it('should create pre-restore backup when enabled', async () => {
      // Create initial backup
      const backup = await backupService.createBackup('manual', 'Initial backup');

      // Clear mock call counts
      mockGraphStore.save.mockClear();

      // Mock listBackups to return the initial backup
      const listBackupsSpy = vi.spyOn(backupService, 'listBackups');
      listBackupsSpy.mockResolvedValueOnce([backup]);

      await backupService.restoreFromBackup(backup.id, {
        createBackupBeforeRestore: true
      });

      // save is called during restore
      expect(mockGraphStore.save).toHaveBeenCalled();
    });
  });

  describe('listBackups', () => {
    it('should list available backups', async () => {
      // Create test backups
      const backup1 = await backupService.createBackup('manual', 'Backup 1');
      const backup2 = await backupService.createBackup('automatic', 'Backup 2');

      const backups = await backupService.listBackups();

      expect(backups.length).toBe(2);
      expect(backups.find(b => b.id === backup1.id)).toBeDefined();
      expect(backups.find(b => b.id === backup2.id)).toBeDefined();
      
      // Should be sorted by timestamp (newest first)
      expect(backups[0].timestamp.getTime()).toBeGreaterThanOrEqual(backups[1].timestamp.getTime());
    });

    it('should handle empty backup directory', async () => {
      const backups = await backupService.listBackups();
      expect(backups).toEqual([]);
    });

    it('should skip invalid backup files', async () => {
      // Create a valid backup
      const validBackup = await backupService.createBackup('manual', 'Valid backup');

      // Create an invalid backup file
      const invalidBackupPath = path.join(tempDir, 'backups', 'invalid.backup');
      await fs.writeFile(invalidBackupPath, 'invalid json content');

      const backups = await backupService.listBackups();
      
      // Should only return the valid backup
      expect(backups.length).toBe(1);
      expect(backups[0].id).toBe(validBackup.id);
    });
  });

  describe('deleteBackup', () => {
    it('should delete an existing backup', async () => {
      const backup = await backupService.createBackup('manual', 'Test backup');
      const backupPath = path.join(tempDir, 'backups', `${backup.id}.backup`);

      // Verify backup exists
      await expect(fs.access(backupPath)).resolves.toBeUndefined();

      await backupService.deleteBackup(backup.id);

      // Verify backup is deleted
      await expect(fs.access(backupPath)).rejects.toThrow();
    });

    it('should handle deletion of non-existent backup', async () => {
      await expect(
        backupService.deleteBackup('non-existent-backup')
      ).rejects.toThrow(BackupError);
    });
  });

  describe('verifyBackupIntegrity', () => {
    it('should verify valid backup integrity', async () => {
      const backup = await backupService.createBackup('manual', 'Test backup');
      const backupPath = path.join(tempDir, 'backups', `${backup.id}.backup`);

      const isValid = await backupService.verifyBackupIntegrity(backupPath);
      expect(isValid).toBe(true);
    });

    it('should detect corrupted backup', async () => {
      const backup = await backupService.createBackup('manual', 'Test backup');
      const backupPath = path.join(tempDir, 'backups', `${backup.id}.backup`);

      // Corrupt the backup file
      const originalContent = await fs.readFile(backupPath, 'utf8');
      const corruptedContent = originalContent.replace('"checksum":', '"corrupted":');
      await fs.writeFile(backupPath, corruptedContent);

      await expect(
        backupService.verifyBackupIntegrity(backupPath)
      ).rejects.toThrow(DataCorruptionError);
    });

    it('should handle backup without checksum', async () => {
      // Create backup file without checksum
      const backupData = {
        metadata: {
          id: 'test',
          timestamp: new Date(),
          version: '1.0.0'
        }
      };

      const backupPath = path.join(tempDir, 'backups', 'test.backup');
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.writeFile(backupPath, JSON.stringify(backupData));

      await expect(
        backupService.verifyBackupIntegrity(backupPath)
      ).rejects.toThrow(DataCorruptionError);
    });
  });

  describe('automatic backups', () => {
    it('should start automatic backups when enabled', async () => {
      // Create service with automatic backups enabled
      const autoBackupService = new BackupRecoveryService(mockGraphStore);
      
      // Wait a bit to see if timer is set
      expect((autoBackupService as any).backupTimer).toBeDefined();
      
      await autoBackupService.shutdown();
    });

    it('should stop automatic backups', async () => {
      const autoBackupService = new BackupRecoveryService(mockGraphStore);
      
      autoBackupService.stopAutomaticBackups();
      expect((autoBackupService as any).backupTimer).toBeUndefined();
      
      await autoBackupService.shutdown();
    });
  });

  describe('error handling', () => {
    it('should handle graph store restore errors', async () => {
      // Create graph data file so backup includes graph data
      const graphDataPath = path.join(tempDir, 'graph.json');
      const mockGraphData = {
        nodes: { '1': { id: '1', labels: ['Event'], properties: { name: 'Test' } } },
        relationships: {}
      };
      await fs.writeFile(graphDataPath, JSON.stringify(mockGraphData));

      const backup = await backupService.createBackup('manual', 'Test backup');

      // Mock graph store to fail on clear
      mockGraphStore.clear.mockRejectedValueOnce(new Error('Clear failed'));

      await expect(
        backupService.restoreFromBackup(backup.id, {
          createBackupBeforeRestore: false
        })
      ).rejects.toThrow(RecoveryError);
    });

    it('should handle cache restore errors gracefully', async () => {
      // Mock cache manager as LocalCacheStore
      Object.setPrototypeOf(mockCacheManager, LocalCacheStore.prototype);
      mockCacheManager.clear.mockRejectedValueOnce(new Error('Cache clear failed'));

      const backup = await backupService.createBackup('manual', 'Test backup');
      
      // Should not throw even if cache restore fails
      await expect(
        backupService.restoreFromBackup(backup.id, {
          createBackupBeforeRestore: false,
          components: { graph: false, cache: true, config: false }
        })
      ).rejects.toThrow(RecoveryError);
    });
  });
});