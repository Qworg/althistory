/**
 * The CLI importer (issue 29): every import is recorded as a version, so the
 * head and the export match the live store and a rollback keeps the import;
 * and the rename strategy remaps `metadata.parentArcId` with `parent_arc_id`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { ImportService } from '@/services/ImportService';
import { GraphImporter } from '@/cli/export/GraphImporter';

describe('the CLI importer', () => {
  let container: Container;
  let testDataDir: string;
  let graphCount = 0;

  beforeAll(async () => {
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-import-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'cli-import-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    const config = loadConfig();
    container = initializeContainer(initializeDatabaseManager(config.database), config);
    await container.initialize();
  });

  afterAll(async () => {
    await cleanupContainer();
    await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  const arc = (id: string, level: number, from: number, to: number, parent?: string, name = id) => ({
    id,
    name,
    description: name,
    start_time: `${from}-01-01T00:00:00.000Z`,
    end_time: `${to}-01-01T00:00:00.000Z`,
    level,
    metadata: parent ? { parentArcId: parent } : {},
  });
  const event = (id: string, description: string, arcId?: string) => ({
    id,
    description,
    actor: 'A',
    target: 'B',
    timestamp: '1850-01-01T00:00:00.000Z',
    metadata: arcId ? { arcId } : {},
  });

  async function newGraph(): Promise<string> {
    graphCount += 1;
    return (await container.graphService.createGraph({ name: `CLI import ${graphCount}` })).id;
  }

  const run = (document: unknown, graphId: string, strategy: 'skip' | 'overwrite' | 'rename') =>
    new GraphImporter().import(JSON.stringify(document), container as never, { strategy, graphId });

  const versionCount = async (graphId: string): Promise<number> => (await container.graphRepository.getVersionHistory(graphId)).total;

  async function exported(graphId: string) {
    const document = await container.exportService.exportGraph({ graphId, scope: 'full', includeProvenance: false });
    const result = await new ImportService({ dataDir: testDataDir }).validateFormat(document.export);
    return {
      valid: result.valid,
      errors: result.errors.map((error) => `${error.code}: ${error.message}`),
      arcs: Object.fromEntries(document.export.data.arcs.map((a) => [a.id, [a.level, a.parent_arc_id ?? null, a.name]])),
    };
  }

  const document = (arcs: unknown[], events: unknown[] = [], causalRelationships: unknown[] = []) => ({ metadata: {}, data: { arcs, events, causalRelationships } });

  it('records a first import as a version, and a rollback keeps it', async () => {
    const graphId = await newGraph();
    const before = await versionCount(graphId);
    await run(document([arc('G', 0, 1700, 1950), arc('P', 1, 1800, 1900, 'G')], [event('e1', 'In P', 'P'), event('e2', 'Then')], [{ cause_event_id: 'e1', effect_event_id: 'e2', weight: 0.5 }]), graphId, 'skip');

    expect(await versionCount(graphId)).toBe(before + 1);
    const head = await container.graphRepository.checkout(graphId);
    expect(Object.keys(head.arcs).sort()).toEqual(['G', 'P']);
    expect(Object.keys(head.events).sort()).toEqual(['e1', 'e2']);
    expect(Object.keys(head.relationships)).toHaveLength(1);
    expect(await exported(graphId)).toMatchObject({ valid: true, arcs: { G: [0, null, 'G'], P: [1, 'G', 'P'] } });

    // A rebuild of the live store from the head (a rollback, a merge, a branch) loses nothing.
    await container.liveStoreSyncService.materialize(graphId, 'rollback');
    const { arcRepository, eventRepository } = await container.graphScopedRepositories(graphId);
    expect((await arcRepository.findAll()).map((a) => a.id).sort()).toEqual(['G', 'P']);
    expect((await eventRepository.findAll()).map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('records an overwrite, and the head and the export hold what it wrote', async () => {
    const graphId = await newGraph();
    await run(document([arc('G', 0, 1700, 1950), arc('P', 1, 1800, 1900, 'G')], [event('e1', 'Before')]), graphId, 'skip');
    const before = await versionCount(graphId);

    const result = await run(
      document([arc('G', 0, 1700, 1950, undefined, 'G overwritten'), arc('P', 0, 1800, 1900, undefined, 'P promoted'), arc('N', 1, 1810, 1820, 'P', 'New')], [event('e1', 'After')]),
      graphId,
      'overwrite'
    );
    expect(result.imported).toMatchObject({ arcs: 3, events: 1 });

    expect(await versionCount(graphId)).toBe(before + 1);
    const head = await container.graphRepository.checkout(graphId);
    expect(head.arcs.G.name).toBe('G overwritten');
    expect(head.events.e1.description).toBe('After');
    expect(await exported(graphId)).toMatchObject({ valid: true, errors: [], arcs: { G: [0, null, 'G overwritten'], P: [0, null, 'P promoted'], N: [1, 'P', 'New'] } });

    await container.liveStoreSyncService.materialize(graphId, 'rollback');
    const { arcRepository, eventRepository } = await container.graphScopedRepositories(graphId);
    expect((await arcRepository.findById('G'))?.name).toBe('G overwritten');
    expect((await arcRepository.findById('N'))?.level).toBe(1);
    expect((await eventRepository.findById('e1'))?.description).toBe('After');
  });

  it('records the parent an export names only in parent_arc_id, where the live store keeps one', async () => {
    const graphId = await newGraph();
    const exportShape = [
      { ...arc('G', 0, 1700, 1950), parent_arc_id: null },
      { ...arc('P', 1, 1800, 1900), parent_arc_id: 'G' },
    ];
    await run(document(exportShape), graphId, 'skip');
    expect(await exported(graphId)).toMatchObject({ valid: true, arcs: { G: [0, null, 'G'], P: [1, 'G', 'P'] } });
  });

  for (const childFirst of [false, true]) {
    it(`remaps metadata.parentArcId with parent_arc_id when it renames (child listed ${childFirst ? 'first' : 'last'})`, async () => {
      const graphId = await newGraph();
      const arcs = [arc('G', 0, 1700, 1950), arc('P', 1, 1800, 1900, 'G'), arc('C', 2, 1810, 1820, 'P')];
      await run(document(arcs), graphId, 'skip');
      const before = await versionCount(graphId);

      // The same arcs again: every id conflicts, so each is renamed. The export names the parent in the field too.
      const again = arcs.map((a) => ({ ...a, parent_arc_id: (a.metadata as { parentArcId?: string }).parentArcId ?? null }));
      await run(document(childFirst ? [...again].reverse() : again), graphId, 'rename');

      expect(await versionCount(graphId)).toBe(before + 1);
      const after = await exported(graphId);
      expect(after.valid).toBe(true);
      const { arcRepository } = await container.graphScopedRepositories(graphId);
      const copies = (await arcRepository.findAll()).filter((a) => !['G', 'P', 'C'].includes(a.id));
      expect(copies).toHaveLength(3);
      const copyOf = (name: string) => copies.find((a) => a.name === name)!;
      const [g, p, c] = [copyOf('G'), copyOf('P'), copyOf('C')];
      // The copies hang from each other, not from the originals, in the live store and in the export.
      expect(p.metadata?.parentArcId).toBe(g.id);
      expect(c.metadata?.parentArcId).toBe(p.id);
      expect(after.arcs[p.id]).toEqual([1, g.id, 'P']);
      expect(after.arcs[c.id]).toEqual([2, p.id, 'C']);
      // The originals stay as they were.
      expect(after.arcs.P).toEqual([1, 'G', 'P']);
      expect(after.arcs.C).toEqual([2, 'P', 'C']);
    });
  }

  describe('an id used by an arc and an event', () => {
    for (const strategy of ['skip', 'overwrite', 'rename'] as const) {
      it(`is refused in one document under ${strategy}, and nothing is written`, async () => {
        const graphId = await newGraph();
        await expect(run(document([arc('X', 0, 1800, 1900)], [event('X', 'same id')]), graphId, strategy)).rejects.toThrow(/id "X" is used by arcs\[0\] and events\[0\]/);
        const { arcRepository, eventRepository } = await container.graphScopedRepositories(graphId);
        expect(await eventRepository.findById('X')).toBeFalsy();
        expect(await arcRepository.findAll()).toHaveLength(0);
      });
      it(`is refused when the graph holds the id for the other kind, under ${strategy}`, async () => {
        const graphId = await newGraph();
        await run(document([arc('A1', 0, 1800, 1900)], [event('E1', 'an event')]), graphId, 'skip');
        const before = await versionCount(graphId);
        await expect(run(document([], [event('A1', 'takes an arc id')]), graphId, strategy)).rejects.toThrow(/event id "A1" \(events\[0\]\) is already used by an arc/);
        await expect(run(document([arc('E1', 0, 1800, 1900)]), graphId, strategy)).rejects.toThrow(/arc id "E1" \(arcs\[0\]\) is already used by an event/);
        expect(await versionCount(graphId)).toBe(before);
        const { arcRepository } = await container.graphScopedRepositories(graphId);
        expect((await arcRepository.findAll()).map((a) => a.id)).toEqual(['A1']);
      });
    }

    it('is refused by the API importer too, for an id the target graph uses for the other kind', async () => {
      const graphId = await newGraph();
      await run(document([arc('A1', 0, 1800, 1900)]), graphId, 'skip');
      const incoming = {
        version: '1.0',
        metadata: { graphId: 'x', graphName: 'x', exportedAt: new Date().toISOString(), sourceVersion: '1.0.0', graphVersion: 1, checksum: '' },
        data: { events: [{ id: 'A1', description: 'd', actor: 'A', target: 'B', timestamp: '1850-01-01T00:00:00.000Z' }], arcs: [], causalRelationships: [], inferredPressures: [] },
      };
      const service = new ImportService({ dataDir: testDataDir });
      await service.initialize();
      const result = await service.executeImport(incoming as never, { graphId, mode: 'merge', conflictResolution: 'overwrite' } as never);
      const arcIntoEvent = {
        ...incoming,
        data: { ...incoming.data, events: [], arcs: [{ id: 'E9', name: 'n', description: 'd', start_time: '1800-01-01T00:00:00.000Z', end_time: '1900-01-01T00:00:00.000Z', level: 0 }] },
      };
      await run(document([], [event('E9', 'an event')]), graphId, 'skip');
      const arcSide = await service.executeImport(arcIntoEvent as never, { graphId, mode: 'merge', conflictResolution: 'overwrite' } as never);
      // The preview and the conflict list say the same.
      const conflicts = await service.detectConflicts(incoming as never, graphId, 'merge');
      const arcConflicts = await service.detectConflicts(arcIntoEvent as never, graphId, 'merge');
      await service.destroy();
      expect(arcSide.success).toBe(false);
      expect(arcSide.errors.map((e) => e.message).join(' ')).toMatch(/ID 'E9' is used by an event in the target graph/);
      expect(conflicts.map((c) => `${c.severity} ${c.entityType} ${c.entityId}`)).toContain('error event A1');
      expect(arcConflicts.map((c) => `${c.severity} ${c.entityType} ${c.entityId}`)).toContain('error arc E9');
      expect(result.success).toBe(false);
      expect(result.errors.map((e) => e.message).join(' ')).toMatch(/ID 'A1' is used by an arc in the target graph/);
      const { eventRepository } = await container.graphScopedRepositories(graphId);
      expect(await eventRepository.findById('A1')).toBeFalsy();
    });
  });

  describe('an id listed twice in the document (issue 39)', () => {
    it('names every position when it is listed three or more times, and counts the rest', async () => {
      const graphId = await newGraph();
      await expect(run(document([arc('T', 0, 1800, 1900), arc('T', 0, 1800, 1900), arc('T', 0, 1800, 1900)]), graphId, 'skip')).rejects.toThrow(
        /arc id "T" appears 3 times in the document, at arcs\[0\], arcs\[1\], arcs\[2\]/
      );
      const many = Array.from({ length: 7 }, (_, i) => [arc(`d${i}`, 0, 1800, 1900), arc(`d${i}`, 0, 1800, 1900)]).flat();
      await expect(run(document(many), graphId, 'skip')).rejects.toThrow(/; and 2 more\. Each id may be listed once\./);
    });

    for (const strategy of ['skip', 'overwrite', 'rename'] as const) {
      for (const holdsIt of [false, true]) {
        it(`refuses a repeated arc id under ${strategy}${holdsIt ? ' into a graph that holds it' : ''}, and writes nothing`, async () => {
          const graphId = await newGraph();
          if (holdsIt) await run(document([arc('R', 0, 1800, 1900)]), graphId, 'skip');
          const before = await versionCount(graphId);
          const arcsBefore = (await container.graphScopedRepositories(graphId)).arcRepository;
          const countBefore = (await arcsBefore.findAll()).length;
          await expect(run(document([arc('R', 0, 1800, 1900, undefined, 'First'), arc('X', 0, 1800, 1900), arc('R', 0, 1800, 1900, undefined, 'Second')]), graphId, strategy)).rejects.toThrow(
            /arc id "R" appears twice in the document, at arcs\[0\] and arcs\[2\]/
          );
          expect(await versionCount(graphId)).toBe(before);
          expect((await arcsBefore.findAll()).length).toBe(countBefore);
        });
      }
      it(`refuses a repeated event id under ${strategy}, and writes nothing`, async () => {
        const graphId = await newGraph();
        const before = await versionCount(graphId);
        await expect(run(document([], [event('E', 'one'), event('E', 'two')]), graphId, strategy)).rejects.toThrow(/event id "E" appears twice in the document, at events\[0\] and events\[1\]/);
        expect(await versionCount(graphId)).toBe(before);
        expect(await (await container.graphScopedRepositories(graphId)).eventRepository.findById('E')).toBeFalsy();
      });
    }
  });
});
