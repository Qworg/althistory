#!/usr/bin/env npx ts-node

import { Command } from 'commander';
import * as path from 'path';
import { DataMigrationUtility, MigrationProgress } from '../utils/DataMigrationUtility';
import { initializeDatabaseManager } from '../utils/database';
import { initializeCache } from '../utils/cache';
import { loadConfig } from '../utils/config';

/**
 * CLI utility for data migration between cloud and local storage
 */
class DataMigrationCLI {
  private migrationUtility: DataMigrationUtility;

  constructor() {
    this.migrationUtility = new DataMigrationUtility();
  }

  /**
   * Initialize database connections
   */
  async initialize(): Promise<void> {
    const config = loadConfig();
    
    if (!config.localExecution.enabled) {
      // Initialize cloud connections for export
      const dbManager = initializeDatabaseManager(config.database);
      await dbManager.initializeNeo4j();
      await dbManager.initializeRedis();
      await initializeCache();
    }
  }

  /**
   * Export data from cloud to local format
   */
  async exportCloudToLocal(outputPath?: string, options: { includeCache?: boolean; validate?: boolean } = {}): Promise<void> {
    console.log('🚀 Starting cloud to local export...');
    
    try {
      const result = await this.migrationUtility.exportCloudToLocal(outputPath, {
        includeCache: options.includeCache ?? true,
        validateData: options.validate ?? true,
        onProgress: this.createProgressHandler('Export')
      });
      
      console.log(`✅ Export completed successfully!`);
      console.log(`📁 Output file: ${result}`);
    } catch (error) {
      console.error('❌ Export failed:', error);
      process.exit(1);
    }
  }

  /**
   * Import data from local to cloud format
   */
  async importLocalToCloud(
    inputPath: string, 
    options: { clearExisting?: boolean; includeCache?: boolean; validate?: boolean } = {}
  ): Promise<void> {
    console.log('🚀 Starting local to cloud import...');
    
    try {
      await this.migrationUtility.importLocalToCloud(inputPath, {
        clearExisting: options.clearExisting ?? false,
        includeCache: options.includeCache ?? true,
        validateData: options.validate ?? true,
        onProgress: this.createProgressHandler('Import')
      });
      
      console.log(`✅ Import completed successfully!`);
    } catch (error) {
      console.error('❌ Import failed:', error);
      process.exit(1);
    }
  }

  /**
   * Show cloud data statistics
   */
  async showStats(): Promise<void> {
    console.log('📊 Fetching cloud data statistics...');
    
    try {
      const stats = await this.migrationUtility.getCloudDataStats();
      
      console.log('\n📈 Cloud Data Statistics:');
      console.log(`  Nodes: ${stats.nodeCount.toLocaleString()}`);
      console.log(`  Relationships: ${stats.relationshipCount.toLocaleString()}`);
      console.log(`  Cache Keys: ${stats.cacheKeyCount.toLocaleString()}`);
      console.log();
    } catch (error) {
      console.error('❌ Failed to fetch statistics:', error);
      process.exit(1);
    }
  }

  /**
   * Create migration backup
   */
  async createBackup(backupPath?: string): Promise<void> {
    console.log('💾 Creating migration backup...');
    
    try {
      const result = await this.migrationUtility.createMigrationBackup(backupPath);
      
      console.log(`✅ Backup created successfully!`);
      console.log(`📁 Backup file: ${result}`);
    } catch (error) {
      console.error('❌ Backup creation failed:', error);
      process.exit(1);
    }
  }

  /**
   * Create progress handler for migration operations
   */
  private createProgressHandler(operation: string) {
    return (progress: MigrationProgress) => {
      const percentage = Math.round((progress.current / progress.total) * 100);
      const progressBar = this.createProgressBar(percentage);
      
      process.stdout.write(`\r${operation}: ${progressBar} ${percentage}% - ${progress.message}`);
      
      if (progress.phase === 'complete') {
        console.log(); // New line after completion
      }
    };
  }

  /**
   * Create ASCII progress bar
   */
  private createProgressBar(percentage: number, width: number = 30): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${' '.repeat(empty)}]`;
  }
}

// CLI setup
const program = new Command();
const cli = new DataMigrationCLI();

program
  .name('migrate-data')
  .description('Data migration utility for hierarchical temporal graph system')
  .version('1.0.0');

program
  .command('export')
  .description('Export data from cloud (Neo4j/Redis) to local format')
  .option('-o, --output <path>', 'Output file path')
  .option('--no-cache', 'Exclude cache data from export')
  .option('--no-validate', 'Skip data validation')
  .action(async (options) => {
    await cli.initialize();
    await cli.exportCloudToLocal(options.output, {
      includeCache: options.cache !== false,
      validate: options.validate !== false
    });
  });

program
  .command('import')
  .description('Import data from local format to cloud (Neo4j/Redis)')
  .argument('<inputPath>', 'Input file path')
  .option('--clear', 'Clear existing data before import')
  .option('--no-cache', 'Exclude cache data from import')
  .option('--no-validate', 'Skip data validation')
  .action(async (inputPath, options) => {
    await cli.initialize();
    await cli.importLocalToCloud(inputPath, {
      clearExisting: options.clear,
      includeCache: options.cache !== false,
      validate: options.validate !== false
    });
  });

program
  .command('stats')
  .description('Show cloud data statistics')
  .action(async () => {
    await cli.initialize();
    await cli.showStats();
  });

program
  .command('backup')
  .description('Create a migration backup of current cloud data')
  .option('-o, --output <path>', 'Backup file path')
  .action(async (options) => {
    await cli.initialize();
    await cli.createBackup(options.output);
  });

program
  .command('convert-local-to-cloud')
  .description('Convert existing local graph data to cloud format and import it')
  .option('--local-file <path>', 'Local graph file path (defaults to config)')
  .option('--clear', 'Clear existing cloud data before import')
  .action(async (options) => {
    const config = loadConfig();
    const localGraphPath = options.localFile || path.join(config.localExecution.dataDirectory, config.localExecution.graphFile);
    
    console.log('🔄 Converting local graph data to cloud format...');
    
    try {
      // Initialize cloud connections
      await cli.initialize();
      
      // Read local graph data
      const fs = await import('fs/promises');
      const localData = JSON.parse(await fs.readFile(localGraphPath, 'utf8'));
      
      // Convert to export format
      const exportData = {
        metadata: {
          exportDate: new Date(),
          version: '1.0.0',
          nodeCount: Object.keys(localData.nodes || {}).length,
          relationshipCount: Object.keys(localData.relationships || {}).length,
          cacheKeyCount: 0
        },
        nodes: Object.values(localData.nodes || {}),
        relationships: Object.values(localData.relationships || {}),
        cacheData: []
      };
      
      // Save as temporary export file
      const tempExportPath = path.join(path.dirname(localGraphPath), 'temp_export.json');
      await fs.writeFile(tempExportPath, JSON.stringify(exportData, null, 2));
      
      // Import to cloud
      await cli.importLocalToCloud(tempExportPath, {
        clearExisting: options.clear,
        includeCache: false,
        validate: true
      });
      
      // Clean up temp file
      await fs.unlink(tempExportPath);
      
      console.log('✅ Local data successfully converted and imported to cloud!');
    } catch (error) {
      console.error('❌ Conversion failed:', error);
      process.exit(1);
    }
  });

// Add help examples
program.addHelpText('after', `

Examples:
  $ npm run migrate export                    # Export all data to default location
  $ npm run migrate export -o backup.json    # Export to specific file
  $ npm run migrate import backup.json       # Import from backup file
  $ npm run migrate import backup.json --clear # Import and clear existing data
  $ npm run migrate stats                    # Show current cloud data statistics
  $ npm run migrate backup                   # Create backup before migration
  $ npm run migrate convert-local-to-cloud   # Convert local graph to cloud format

Configuration:
  The utility uses the application configuration from src/utils/config.ts
  Ensure your database connection settings are properly configured.

Note:
  - Export operations require cloud database connections (Neo4j/Redis)
  - Import operations also require cloud database connections
  - Local execution mode should be disabled for cloud operations
  - Always create backups before importing data
`);

// Parse command line arguments
program.parse();