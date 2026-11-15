/**
 * An import's times, from the document to the live store the entity routes
 * and the UI read. The import validated with one reader and the live store
 * materialised with another, so a time the validation took ("+05", a decimal
 * comma) went missing from the live store, and a zone-less one landed in the
 * server's zone. Now the import stores toISOString's spelling and every
 * reader reads alike.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { ImportService } from '@/services/ImportService';
import { AlthistoryExport } from '@/services/ExportService';

const TIMES: Array<[string, string]> = [
  ['1843-11-20T00:00:00Z', '1843-11-20T00:00:00.000Z'],
  ['1066-10-14T09:30+05', '1066-10-14T04:30:00.000Z'],
  ['1870-02-14T09:30:00,5Z', '1870-02-14T09:30:00.500Z'],
  ['1870-02-14 09:30', '1870-02-14T09:30:00.000Z'],
];

function document(): AlthistoryExport {
  return {
    version: '1.0',
    metadata: {
      graphId: 'exported-graph',
      graphName: 'Exported Graph',
      exportedAt: new Date().toISOString(),
      sourceVersion: '1.0.0',
      graphVersion: 1,
      checksum: '',
    },
    data: {
      events: TIMES.map(([timestamp], index) => ({
        id: `event-${index}`,
        description: `At ${timestamp}`,
        actor: 'Actor',
        target: 'Target',
        timestamp,
      })),
      arcs: [
        { id: 'arc-1', name: 'Age', description: 'An age', start_time: '1066-01-01 00:00', end_time: '1900-01-01T05:00+05', level: 0, parent_arc_id: null },
      ],
      causalRelationships: [],
      inferredPressures: [],
    },
  } as AlthistoryExport;
}

describe('an import, from the document to the live store', () => {
  let container: Container;
  let importService: ImportService;
  let testDataDir: string;

  beforeAll(async () => {
    testDataDir = path.join(os.tmpdir(), `import-timestamps-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'import-timestamps-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    await fs.mkdir(path.join(testDataDir, 'graphs'), { recursive: true });
    await fs.mkdir(path.join(testDataDir, 'jobs'), { recursive: true });

    const config = loadConfig();
    container = initializeContainer(initializeDatabaseManager(config.database), config);
    await container.initialize();
    // Wired as src/api/routes.ts wires it: an import brings the live store up to the new head.
    importService = new ImportService({
      dataDir: testDataDir,
      onHeadReplaced: async (graphId) => {
        await container.liveStoreSyncService.materialize(graphId);
      },
    });
    await importService.initialize();
  });

  afterAll(async () => {
    await importService?.destroy();
    await cleanupContainer();
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  it('stores every time the validation takes, as the instant it names, where the entity routes read it', async () => {
    const graphId = (await container.graphService.createGraph({ name: 'Imported times' })).id;
    const result = await importService.executeImport(document(), { graphId, mode: 'replace', conflictResolution: 'overwrite' });
    expect(result.success, JSON.stringify(result.errors ?? result)).toBe(true);

    const scoped = await container.graphScopedRepositories(graphId);
    const events = await scoped.eventRepository.findAll();
    const stored = new Map(events.map((event) => [event.description, event.timestamp.toISOString()]));
    for (const [text, iso] of TIMES) expect(stored.get(`At ${text}`), text).toBe(iso);

    const [arc] = await scoped.arcRepository.findAll();
    expect(arc?.start_time.toISOString()).toBe('1066-01-01T00:00:00.000Z');
    expect(arc?.end_time.toISOString()).toBe('1900-01-01T00:00:00.000Z');

    // And the version tree (which exports read) holds them in toISOString's
    // spelling, so a reader still on new Date() reads the same instants.
    const head = await container.versionRepository.getLatestVersion(graphId);
    const tree = await container.versionRepository.checkout(graphId, head!.version);
    const storedText = new Map(Object.values(tree.events).map((event) => [event.description, event.timestamp]));
    for (const [text, iso] of TIMES) expect(storedText.get(`At ${text}`), text).toBe(iso);
    const storedArc = Object.values(tree.arcs)[0]!;
    expect([storedArc.start_time, storedArc.end_time]).toEqual(['1066-01-01T00:00:00.000Z', '1900-01-01T00:00:00.000Z']);
  });
});
