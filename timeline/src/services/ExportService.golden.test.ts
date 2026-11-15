/**
 * The export's bytes, frozen from before deep time (issue 26).
 *
 * docs/specs/deep-time.md (Req 15) promises that a history whose dates all lie
 * within what a `Date` holds exports as it always did: version "1.0", byte for
 * byte, with the same checksum. Checking that by exporting twice with the
 * current code proves nothing about the past, so the checksums below were
 * taken from the code before #24 (deep time) merged: commit cbe43bc, the first
 * parent of the #24 merge deace4e, running this file's fixture through the
 * same calls. A change that moves any of them changes the format: it needs a
 * new export version, not a new number here.
 *
 * The fixture has no expanded-year dates (every year is 0000-9999), and covers
 * what the converters touch: metadata (nested, absent, with a date's
 * precision), a cross-graph reference lifted out of an event's metadata, an
 * arc's parent, years 1-99 (which must never read as 19xx), links and a
 * pressure.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { ExportService } from '@/services/ExportService';
import { ImportService } from '@/services/ImportService';
import { GraphRepository } from '@/repositories/GraphRepository';
import type { EntityType } from '@/models/Graph';

/** `metadata.checksum` of the fixture's export at cbe43bc (in memory and streamed alike). */
const GOLDEN_CHECKSUM = '945f165110c7b02a36e97043e0530b161a71098eb3539bbc1b9550b5efb2ff62';
/** The same without the cross-graph reference, which the importer refuses for a graph that does not exist. */
const GOLDEN_PLAIN_CHECKSUM = '9c671b40462271772e77288fbe863512d38ab78249653d3ebd6074af47f94a0a';
/**
 * That export imported into a new graph and exported again, with the two
 * fields the importer stamps that change on every run (`importedAt`,
 * `sourceGraphId`) taken out before hashing.
 */
const GOLDEN_ROUNDTRIP_DIGEST = '3619cf09c18ea63c9962de5970fcb7997278c0c0e53af87dd76b3a01c96591ab';

const events: Array<Record<string, unknown>> = [
  { id: 'evt-austerlitz', description: 'Battle of Austerlitz', actor: 'Napoleon', target: 'Coalition', timestamp: '1805-12-02T08:00:00.000Z', metadata: { source: 'fixture', tags: ['war', 'france'], crossGraphRefs: [{ referencedGraphId: 'graph-elsewhere', referencedEntityId: 'evt-remote', referencedEntityType: 'event' }] } },
  { id: 'evt-tilsit', description: 'Treaty of Tilsit', actor: 'Napoleon', target: 'Alexander I', timestamp: '1807-07-07T00:00:00.000Z' },
  { id: 'evt-ides', description: 'Ides of March, as a Julian reading', actor: 'Brutus', target: 'Caesar', timestamp: '0001-03-15T12:00:00.000Z', metadata: { datePrecision: 'day' } },
  { id: 'evt-year-50', description: 'A census in the year 50', actor: 'Rome', target: 'Provinces', timestamp: '0050-03-01T00:00:00.000Z', metadata: { datePrecision: 'month' } },
];
const arcs: Array<Record<string, unknown>> = [
  { id: 'arc-wars', name: 'Napoleonic Wars', description: 'European conflicts', start_time: '1803-05-18T00:00:00.000Z', end_time: '1815-11-20T00:00:00.000Z', level: 0, parent_arc_id: null, metadata: { color: '#336699' } },
  { id: 'arc-third', name: 'War of the Third Coalition', description: 'Austerlitz and after', start_time: '1805-03-01T00:00:00.000Z', end_time: '1806-07-12T00:00:00.000Z', level: 1, parent_arc_id: 'arc-wars' },
  { id: 'arc-republic', name: 'Late Republic', description: 'Rome before the empire', start_time: '0007-01-01T00:00:00.000Z', end_time: '0099-12-31T23:59:59.999Z', level: 0, parent_arc_id: null },
];
const relationships: Array<Record<string, unknown>> = [
  { id: 'rel-1', cause_event_id: 'evt-austerlitz', effect_event_id: 'evt-tilsit', weight: 0.8, evidence: 'Victory led to the treaty', confidence: 0.9, relationship_type: 'direct' },
  { id: 'rel-2', cause_event_id: 'evt-ides', effect_event_id: 'evt-year-50', weight: 0.25, evidence: 'Distant', confidence: 0.4, relationship_type: 'indirect' },
];
const pressures: Array<Record<string, unknown>> = [
  { id: 'p-1', description: 'Nationalist sentiment', confidence_score: 0.85, pressure_type: 'political', evidence_event_ids: ['evt-austerlitz'], affected_arc_ids: ['arc-wars'] },
];

function fixture(withCrossGraphRef: boolean): Array<{ type: EntityType; id: string; data: Record<string, unknown> }> {
  const entities = (type: EntityType, list: Array<Record<string, unknown>>) =>
    list.map((data) => ({ type, id: data.id as string, data: structuredClone(data) }));
  const added = [...entities('event', events), ...entities('arc', arcs), ...entities('relationship', relationships), ...entities('pressure', pressures)];
  if (!withCrossGraphRef) {
    const metadata = added[0].data.metadata as Record<string, unknown>;
    delete metadata.crossGraphRefs;
  }
  return added;
}

const sha256 = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');

describe('the export format, frozen from before deep time', () => {
  let dir: string;
  let repository: GraphRepository;
  let exporter: ExportService;

  async function graphOf(withCrossGraphRef: boolean): Promise<string> {
    const graph = await repository.create({ name: 'Golden' });
    await repository.commitChanges(graph.id, { added: fixture(withCrossGraphRef), modified: [], deleted: [] }, 'import', 'fixture');
    return graph.id;
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-golden-'));
    repository = new GraphRepository({ dataDir: dir });
    await repository.initialize();
    exporter = new ExportService({ dataDir: dir, appVersion: '1.0.0' });
    await exporter.initialize();
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('writes the pre-deep-time checksum, in memory and streamed', async () => {
    const graphId = await graphOf(true);

    const memory = await exporter.exportGraph({ graphId, scope: 'full', includeProvenance: false });
    expect(memory.export.version).toBe('1.0');
    expect(memory.export.data.crossGraphRefs).toHaveLength(1);
    expect(memory.export.metadata.checksum).toBe(GOLDEN_CHECKSUM);
    // The checksum is over the data section's bytes, so they are what is frozen.
    expect(sha256(JSON.stringify(memory.export.data))).toBe(GOLDEN_CHECKSUM);

    const file = await exporter.exportToFile({ graphId, scope: 'full', includeProvenance: false });
    const streamed = JSON.parse(await fs.readFile(file, 'utf8')) as { version: string; metadata: { checksum: string } };
    expect(streamed.version).toBe('1.0');
    expect(streamed.metadata.checksum).toBe(GOLDEN_CHECKSUM);
  });

  it('round-trips through the importer to the pre-deep-time bytes', async () => {
    const graphId = await graphOf(false);
    const plain = await exporter.exportGraph({ graphId, scope: 'full', includeProvenance: false });
    expect(plain.export.metadata.checksum).toBe(GOLDEN_PLAIN_CHECKSUM);

    const importer = new ImportService({ dataDir: dir });
    await importer.initialize();
    const result = await importer.executeImport(plain.export, { mode: 'create-new', conflictResolution: 'skip' });
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);

    const again = await exporter.exportGraph({ graphId: result.graphId, scope: 'full', includeProvenance: false });
    expect(again.export.version).toBe('1.0');
    const settled = JSON.parse(JSON.stringify(again.export.data), (key, value: unknown) =>
      key === 'importedAt' || key === 'sourceGraphId' ? undefined : value
    );
    expect(sha256(JSON.stringify(settled))).toBe(GOLDEN_ROUNDTRIP_DIGEST);
  });
});
