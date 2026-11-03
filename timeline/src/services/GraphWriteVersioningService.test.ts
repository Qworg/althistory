import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Container } from '@/container';
import { LocalDatabaseManager } from '@/utils/database';
import { LocalGraphStore } from '@/utils/LocalGraphStore';
import { AppConfig } from '@/utils/config';
import { describeEntityWrite } from './GraphWriteVersioningService';

/**
 * Version history shows each commit's description. These used to read
 * "create relationship local_179366…"; they now name what changed in words and
 * never carry an id.
 */
describe('describeEntityWrite', () => {
  const census = { description: 'Census of 1851', timestamp: '1851-03-30T00:00:00.000Z', actor: 'Registrar', target: 'Britain' };
  const protest = { description: "Clerks' protest", timestamp: '1852-06-01T00:00:00.000Z' };

  it('names an added event, arc and link', () => {
    expect(describeEntityWrite('create', 'event', { data: census })).toBe('Added event “Census of 1851”');
    expect(describeEntityWrite('create', 'arc', { data: { name: 'The Calculating Offices' } })).toBe(
      'Added arc “The Calculating Offices”'
    );
    expect(describeEntityWrite('create', 'relationship', { data: {}, cause: census, effect: protest })).toBe(
      "Added link: “Census of 1851” → “Clerks' protest”"
    );
  });

  it('says an event was moved when only its date changed', () => {
    expect(
      describeEntityWrite('update', 'event', {
        previous: census,
        data: { ...census, timestamp: '1066-10-14T00:00:00.000Z' },
      })
    ).toBe('Moved “Census of 1851” to Oct 14, 1066');
  });

  it('says an event was renamed when only its description changed', () => {
    expect(
      describeEntityWrite('update', 'event', { previous: census, data: { ...census, description: 'The 1851 census' } })
    ).toBe('Renamed event “Census of 1851” to “The 1851 census”');
  });

  it('says "Edited" for any other change', () => {
    expect(describeEntityWrite('update', 'event', { previous: census, data: { ...census, actor: 'Parliament' } })).toBe(
      'Edited event “Census of 1851”'
    );
  });

  it('counts the links a deleted event took with it', () => {
    expect(describeEntityWrite('delete', 'event', { previous: census, cascadedLinks: 2 })).toBe(
      'Deleted event “Census of 1851” and its 2 links'
    );
    expect(describeEntityWrite('delete', 'event', { previous: census, cascadedLinks: 1 })).toBe(
      'Deleted event “Census of 1851” and its link'
    );
  });

  it('falls back to the kind of entity, never an id, when the name is unknown', () => {
    expect(describeEntityWrite('create', 'relationship', {})).toBe('Added a link');
    expect(describeEntityWrite('delete', 'arc', {})).toBe('Deleted an arc');
    expect(describeEntityWrite('update', 'event', { data: { description: '   ' } })).toBe('Edited an event');
  });

  it('shortens a long description', () => {
    const summary = describeEntityWrite('create', 'event', { data: { description: 'x'.repeat(200) } });
    expect(summary.length).toBeLessThan(100);
    expect(summary).toMatch(/…”$/);
  });
});

function createConfig(dataDirectory: string): AppConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    database: {
      neo4j: { uri: 'bolt://localhost:7687', username: 'neo4j', password: 'password' },
      redis: { host: 'localhost', port: 6379 },
    },
    performance: { queryTimeoutMs: 2000, maxQueryResults: 10000, cacheExpirationMs: 300000 },
    cloudState: { singleReplicaAcknowledged: true },
    apiAuth: { required: false },
    localExecution: {
      enabled: true,
      dataDirectory,
      graphFile: 'unscoped-graph.json',
      cacheSize: 1000,
      persistenceInterval: 30000,
      backupEnabled: false,
      backupInterval: 300000,
      maxMemoryUsage: 512,
    },
  };
}

describe('GraphWriteVersioningService version descriptions (via the container)', () => {
  let testDir: string;
  let container: Container;
  const originalBackupSetting = process.env.LOCAL_BACKUP_ENABLED;
  const originalLocal = process.env.LOCAL_EXECUTION_ENABLED;
  const originalDataDir = process.env.LOCAL_DATA_DIR;

  beforeEach(async () => {
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'version-descriptions-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDir;
    const unscoped = new LocalGraphStore({ dataFile: path.join(testDir, 'unscoped.json') });
    container = new Container(new LocalDatabaseManager(unscoped), createConfig(testDir));
  });

  afterEach(async () => {
    await container.cleanup();
    await fs.rm(testDir, { recursive: true, force: true });
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('LOCAL_BACKUP_ENABLED', originalBackupSetting);
    restore('LOCAL_EXECUTION_ENABLED', originalLocal);
    restore('LOCAL_DATA_DIR', originalDataDir);
  });

  it('describes writes, moves, deletes and restores in words, without ids', async () => {
    const graph = await container.graphService.createGraph({ name: 'The Engine Age' });
    const repos = await container.graphScopedRepositories(graph.id);
    const versioning = container.graphWriteVersioningService;

    const census = await repos.eventRepository.create({
      description: 'Census of 1851',
      actor: 'Registrar General',
      target: 'Britain',
      timestamp: new Date('1851-03-30T00:00:00Z'),
    });
    await versioning.recordEvent(graph.id, census, 'create');
    const protest = await repos.eventRepository.create({
      description: "Clerks' protest",
      actor: 'Clerks',
      target: 'Calculating Offices',
      timestamp: new Date('1852-06-01T00:00:00Z'),
    });
    await versioning.recordEvent(graph.id, protest, 'create');
    const link = await repos.causalService.createCausalLink(census, protest, {
      relationship_type: 'direct',
      weight: 0.7,
      confidence: 0.8,
      evidence: 'The census counted the clerks.',
    });
    await versioning.recordRelationship(graph.id, link, 'create');

    const moved = await repos.eventRepository.update(protest.id, { timestamp: new Date('1852-07-04T00:00:00Z') });
    await versioning.recordEvent(graph.id, moved!, 'update');
    await versioning.recordDeletion(graph.id, 'event', census.id);
    await container.graphService.rollbackGraph(graph.id, 2);

    const { versions } = await container.graphRepository.getVersionHistory(graph.id, 20);
    const descriptions = versions.map((v) => v.description).reverse().slice(-6);
    expect(descriptions).toEqual([
      'Added event “Census of 1851”',
      "Added event “Clerks' protest”",
      "Added link: “Census of 1851” → “Clerks' protest”",
      "Moved “Clerks' protest” to Jul 4, 1852",
      'Deleted event “Census of 1851” and its link',
      'Restored version 2',
    ]);
    for (const description of descriptions) {
      expect(description).not.toContain(census.id);
      expect(description).not.toContain(protest.id);
      expect(description).not.toContain(link.id);
    }
  });
});
