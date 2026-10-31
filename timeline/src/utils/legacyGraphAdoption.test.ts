import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { GraphRepository } from '@/repositories';
import { GraphContextStore } from './GraphContextStore';
import { LocalGraphStore } from './LocalGraphStore';
import { adoptLegacyGraphStore, LegacyAdoptionResult } from './legacyGraphAdoption';

/**
 * Behavioural tests for legacy live-store adoption. They use
 * a real temp data directory, a real `GraphRepository`, a real
 * `GraphContextStore` and the real file-backed `LocalGraphStore`, then assert on
 * the bytes on disk and on data read back through the store — never on mock
 * calls.
 */
describe('adoptLegacyGraphStore', () => {
  let testDir: string;
  let graphRepository: GraphRepository;
  let graphContextStore: GraphContextStore;
  const originalBackupSetting = process.env.LOCAL_BACKUP_ENABLED;

  const legacyPath = (): string => path.join(testDir, 'graph.json');
  const perGraphPath = (graphId: string): string => graphContextStore.getFilePath(graphId);

  beforeEach(async () => {
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-adoption-'));
    graphRepository = new GraphRepository({ dataDir: testDir });
    await graphRepository.initialize();
    graphContextStore = new GraphContextStore({
      dataDirectory: path.join(testDir, 'graphs-live'),
    });
  });

  afterEach(async () => {
    await graphContextStore.evictAll();
    await fs.rm(testDir, { recursive: true, force: true });
    if (originalBackupSetting === undefined) {
      delete process.env.LOCAL_BACKUP_ENABLED;
    } else {
      process.env.LOCAL_BACKUP_ENABLED = originalBackupSetting;
    }
  });

  async function seedLegacyStore(nodeId: string, description: string): Promise<void> {
    const store = new LocalGraphStore({ dataFile: legacyPath() });
    await store.createNode(['Event'], { id: nodeId, description });
    await store.save();
    await store.shutdown();
  }

  async function seedPerGraphStore(
    graphId: string,
    nodeId: string,
    description: string
  ): Promise<void> {
    const store = new LocalGraphStore({ dataFile: perGraphPath(graphId) });
    await store.createNode(['Event'], { id: nodeId, description });
    await store.save();
    await store.shutdown();
  }

  function adopt(): Promise<LegacyAdoptionResult> {
    return adoptLegacyGraphStore({
      legacyFilePath: legacyPath(),
      graphContextStore,
      graphRepository,
    });
  }

  it('is a no-op when no legacy file exists', async () => {
    const result = await adopt();

    expect(result.status).toBe('no-legacy-file');
    expect(await graphRepository.getActiveGraph()).toBeNull();
    expect((await graphRepository.findAll()).total).toBe(0);
    // No per-graph store was created for any graph.
    await expect(fs.access(path.join(testDir, 'graphs-live'))).rejects.toBeDefined();
  });

  it('adopts the legacy contents into an existing active graph', async () => {
    const graph = await graphRepository.create({ name: 'Existing active' });
    await seedLegacyStore('legacy-event', 'Legacy data');
    const legacyBefore = await fs.readFile(legacyPath(), 'utf8');

    const result = await adopt();

    expect(result.status).toBe('adopted');
    expect(result.graphId).toBe(graph.id);
    expect(await fs.readFile(perGraphPath(graph.id), 'utf8')).toBe(legacyBefore);

    // Read the data back through the real per-graph store.
    const store = await graphContextStore.getStore(graph.id);
    expect((await store.getNode('legacy-event'))?.properties.description).toBe('Legacy data');

    // The legacy file survives untouched as a backup.
    expect(await fs.readFile(legacyPath(), 'utf8')).toBe(legacyBefore);
  });

  it('creates and activates a default graph when no graph exists', async () => {
    await seedLegacyStore('legacy-event', 'Legacy data');

    const result = await adopt();

    expect(result.status).toBe('adopted');
    const active = await graphRepository.getActiveGraph();
    expect(active).not.toBeNull();
    expect(active!.name).toBe('Default Graph');
    expect(result.graphId).toBe(active!.id);

    const store = await graphContextStore.getStore(active!.id);
    expect((await store.getNode('legacy-event'))?.properties.description).toBe('Legacy data');
  });

  it('skips when the active graph already has a per-graph store, leaving it unchanged', async () => {
    const graph = await graphRepository.create({ name: 'Already populated' });
    await seedPerGraphStore(graph.id, 'existing-event', 'Existing data');
    const existingBefore = await fs.readFile(perGraphPath(graph.id), 'utf8');

    await seedLegacyStore('legacy-event', 'Legacy data');
    const legacyBefore = await fs.readFile(legacyPath(), 'utf8');

    const result = await adopt();

    expect(result.status).toBe('skipped-existing-file');
    expect(await fs.readFile(perGraphPath(graph.id), 'utf8')).toBe(existingBefore);

    const store = await graphContextStore.getStore(graph.id);
    expect(await store.getNode('legacy-event')).toBeNull();
    expect((await store.getNode('existing-event'))?.properties.description).toBe('Existing data');

    expect(await fs.readFile(legacyPath(), 'utf8')).toBe(legacyBefore);
  });

  it('does not adopt underneath a graph whose store is already loaded', async () => {
    const graph = await graphRepository.create({ name: 'Loaded store' });
    await seedLegacyStore('legacy-event', 'Legacy data');

    // Loading a missing file creates and caches a store without writing the
    // file. That is exactly the case where adoption must not fire: the guard
    // must not be defeated by `getStore`'s create-on-load behaviour.
    await graphContextStore.getStore(graph.id);
    expect(graphContextStore.has(graph.id)).toBe(true);
    await expect(fs.access(perGraphPath(graph.id))).rejects.toBeDefined();

    const result = await adopt();

    expect(result.status).toBe('skipped-store-loaded');
    await expect(fs.access(perGraphPath(graph.id))).rejects.toBeDefined();
    expect(await fs.readFile(legacyPath(), 'utf8')).toContain('Legacy data');
  });

  it('is idempotent: a second adoption does not modify the per-graph file', async () => {
    await graphRepository.create({ name: 'Idempotent' });
    await seedLegacyStore('legacy-event', 'Legacy data');

    const first = await adopt();
    expect(first.status).toBe('adopted');
    const afterFirst = await fs.readFile(perGraphPath(first.graphId!), 'utf8');

    const second = await adopt();

    expect(second.status).toBe('skipped-existing-file');
    expect(await fs.readFile(perGraphPath(first.graphId!), 'utf8')).toBe(afterFirst);

    const store = await graphContextStore.getStore(first.graphId!);
    expect((await store.getNode('legacy-event'))?.properties.description).toBe('Legacy data');
  });

  it('logs and skips a corrupt legacy file without writing or destroying anything', async () => {
    await graphRepository.create({ name: 'Existing' });
    const corrupt = 'not valid json {';
    await fs.writeFile(legacyPath(), corrupt, 'utf8');

    const result = await adopt();

    expect(result.status).toBe('legacy-invalid');
    // The legacy file is byte-for-byte intact and no per-graph store was planted.
    expect(await fs.readFile(legacyPath(), 'utf8')).toBe(corrupt);
    await expect(fs.access(path.join(testDir, 'graphs-live'))).rejects.toBeDefined();
  });

  it('logs and skips an unreadable legacy path without crashing or creating a graph', async () => {
    // A directory at the legacy path makes `readFile` fail with EISDIR, standing
    // in for any I/O error (for example EACCES) that is not ENOENT.
    await fs.mkdir(legacyPath(), { recursive: true });

    const result = await adopt();

    expect(result.status).toBe('legacy-unreadable');
    expect(await graphRepository.getActiveGraph()).toBeNull();
  });
});
