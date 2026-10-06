import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { GRAPHS_LIVE_DIRECTORY } from '@/utils/GraphContextStore';
import { LocalGraphStore } from '@/utils/LocalGraphStore';

const ENV_KEYS = [
  'LOCAL_EXECUTION_ENABLED',
  'LOCAL_DATA_DIR',
  'LOCAL_GRAPH_FILE',
  'LOCAL_BACKUP_ENABLED',
  'LOCAL_MAX_MEMORY_MB',
] as const;

/**
 * Proves the adoption is actually hooked into `Container.initialize()` for
 * local mode: a real container booted with a legacy store on disk must leave the
 * data readable through the graph-scoped store, and must leave the legacy file
 * in place.
 */
describe('legacy live-store adoption is wired into container startup', () => {
  let testDataDir: string;
  let container: Container | undefined;
  const savedEnv: Record<string, string | undefined> = {};
  const legacyFile = 'legacy-custom.json';

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-adoption-wiring-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = legacyFile;
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    // config.ts rejects anything below 64 MB.
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    container = undefined;
  });

  afterEach(async () => {
    if (container) {
      await cleanupContainer();
    }
    await fs.rm(testDataDir, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('adopts the legacy store during initialize and preserves the legacy file', async () => {
    const legacyPath = path.join(testDataDir, legacyFile);
    const seed = new LocalGraphStore({ dataFile: legacyPath });
    await seed.createNode(['Event'], { id: 'legacy-event', description: 'From legacy store' });
    await seed.save();
    await seed.shutdown();
    const legacyBefore = await fs.readFile(legacyPath, 'utf8');

    const config = loadConfig();
    const started = initializeContainer(initializeDatabaseManager(config.database), config);
    container = started;
    await started.initialize();

    const active = await started.graphRepository.getActiveGraph();
    expect(active).not.toBeNull();
    expect(active!.name).toBe('Default Graph');

    const perGraphPath = path.join(testDataDir, GRAPHS_LIVE_DIRECTORY, `${active!.id}.json`);
    expect(await fs.readFile(perGraphPath, 'utf8')).toBe(legacyBefore);

    const store = await started.graphContextStore.getStore(active!.id);
    expect((await store.getNode('legacy-event'))?.properties.description).toBe('From legacy store');

    expect(await fs.readFile(legacyPath, 'utf8')).toBe(legacyBefore);
  });
});
