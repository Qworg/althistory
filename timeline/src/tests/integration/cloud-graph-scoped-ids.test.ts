/**
 * Ids are unique within a graph, not across graphs (issue 35), against a real Neo4j.
 *
 * A branch holds the same ids as the graph it came from. Before the constraints
 * were scoped to `(graphId, id)`, writing the branch's first event failed on the
 * parent's node, so every event and every link of a branch was skipped.
 *
 * Runs only under `vitest.cloud.config.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Session } from 'neo4j-driver';
import { Container, initializeContainer, cleanupContainer } from '@/container';
import { AppConfig, loadConfig } from '@/utils/config';
import { getDatabaseManager, initializeDatabaseManager } from '@/utils/database';
import { GraphCopyService } from '@/services/GraphCopyService';
import { initializeSchema } from '@/utils/schema';
import { migrateGraphScopedIdConstraints } from '@/utils/GraphScopedIdConstraintMigration';

describe('ids are unique within a graph (#35)', () => {
  let container: Container;
  let testDataDir: string;
  const graphs: string[] = [];

  const neo = async <T = Record<string, unknown>>(query: string, parameters: Record<string, unknown> = {}): Promise<T[]> => {
    const session: Session = getDatabaseManager().getNeo4jSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map((record) => record.toObject() as T);
    } finally {
      await session.close();
    }
  };

  beforeAll(async () => {
    testDataDir = path.join(os.tmpdir(), `cloud-graph-scoped-ids-${process.pid}-${Date.now()}`);
    await fs.mkdir(testDataDir, { recursive: true });
    const base = loadConfig();
    const config: AppConfig = { ...base, localExecution: { ...base.localExecution, dataDirectory: testDataDir, backupEnabled: false } };
    const databaseManager = initializeDatabaseManager(config.database);
    await databaseManager.initializeNeo4j();
    await initializeSchema();
    await migrateGraphScopedIdConstraints({ openSession: () => getDatabaseManager().getNeo4jSession(), log: () => undefined });
    container = initializeContainer(databaseManager, config);
    await container.initialize();
  });

  afterEach(async () => {
    await neo('MATCH (n) WHERE n.graphId IN $ids DETACH DELETE n', { ids: graphs.splice(0) });
  });

  afterAll(async () => {
    await cleanupContainer();
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  const newGraph = async (name: string): Promise<string> => {
    const id = (await container.graphService.createGraph({ name })).id;
    graphs.push(id);
    return id;
  };

  /** A graph with two arcs, three events and two links, all versioned, as the API writes them. */
  const seed = async (): Promise<{ graphId: string; events: string[]; arcs: string[] }> => {
    const graphId = await newGraph(`parent-${Math.random().toString(36).slice(2)}`);
    const { eventRepository, arcRepository, causalService } = await container.graphScopedRepositories(graphId);
    const versioning = container.graphWriteVersioningService;
    const arcs: string[] = [];
    for (const [i, name] of ['Era', 'Epoch'].entries()) {
      const arc = await arcRepository.create({
        name,
        start_time: new Date(Date.UTC(1900, 0, 1)),
        end_time: new Date(Date.UTC(1999, 0, 1)),
        level: i + 1,
      });
      await versioning.recordArc(graphId, arc, 'create');
      arcs.push(arc.id);
    }
    const events = [];
    for (const year of [1910, 1920, 1930]) {
      const event = await eventRepository.create({ description: `in ${year}`, actor: 'A', target: 'B', timestamp: new Date(Date.UTC(year, 0, 1)) });
      await versioning.recordEvent(graphId, event, 'create');
      events.push(event);
    }
    for (const [cause, effect] of [[0, 1], [1, 2]] as const) {
      const link = await causalService.createCausalLink(events[cause]!, events[effect]!, {
        cause_event_id: events[cause]!.id,
        effect_event_id: events[effect]!.id,
        weight: 0.5,
        confidence: 0.7,
        evidence: 'because',
        relationship_type: 'direct',
      } as never);
      await versioning.recordRelationship(graphId, link, 'create');
    }
    return { graphId, events: events.map((e) => e.id), arcs };
  };

  const branch = async (parent: string): Promise<string> => {
    const created = await container.graphService.branchGraph(parent, { name: `branch-${Math.random().toString(36).slice(2)}` } as never);
    graphs.push(created.id);
    return created.id;
  };

  it('a branch holds the same events, arcs and links as its parent, under the same ids', async () => {
    const parent = await seed();
    const branchId = await branch(parent.graphId);

    const { eventRepository, arcRepository, causalService } = await container.graphScopedRepositories(branchId);
    const events = await eventRepository.findAll();
    expect(events.map((e) => e.id).sort()).toEqual([...parent.events].sort());
    const arcs = await arcRepository.findAll();
    expect(arcs.map((a) => a.id).sort()).toEqual([...parent.arcs].sort());
    expect(await causalService.getAllRelationships()).toHaveLength(2);

    // And the parent is as it was.
    const parentRepos = await container.graphScopedRepositories(parent.graphId);
    expect(await parentRepos.eventRepository.findAll()).toHaveLength(3);
    expect(await parentRepos.arcRepository.findAll()).toHaveLength(2);
    expect(await parentRepos.causalService.getAllRelationships()).toHaveLength(2);
  });

  it('editing and deleting an event in the branch leaves the parent’s event of that id alone, and the other way round', async () => {
    const parent = await seed();
    const branchId = await branch(parent.graphId);
    const shared = parent.events[0]!;
    const parentRepos = await container.graphScopedRepositories(parent.graphId);
    const branchRepos = await container.graphScopedRepositories(branchId);

    await branchRepos.eventRepository.update(shared, { description: 'edited in the branch' });
    expect((await parentRepos.eventRepository.findById(shared))?.description).toBe('in 1910');
    expect((await branchRepos.eventRepository.findById(shared))?.description).toBe('edited in the branch');

    await parentRepos.eventRepository.update(shared, { description: 'edited in the parent' });
    expect((await branchRepos.eventRepository.findById(shared))?.description).toBe('edited in the branch');

    expect(await branchRepos.eventRepository.delete(shared)).toBe(true);
    expect((await parentRepos.eventRepository.findById(shared))?.description).toBe('edited in the parent');
    // The parent's links on that event survive the branch's DETACH DELETE.
    expect(await parentRepos.causalService.getAllRelationships()).toHaveLength(2);
    expect(await branchRepos.causalService.getAllRelationships()).toHaveLength(1);

    expect(await parentRepos.eventRepository.delete(parent.events[2]!)).toBe(true);
    expect(await branchRepos.eventRepository.findById(parent.events[2]!)).not.toBeNull();
  });

  it('editing and deleting an arc in the branch leaves the parent’s arc of that id alone', async () => {
    const parent = await seed();
    const branchId = await branch(parent.graphId);
    const shared = parent.arcs[0]!;
    const parentRepos = await container.graphScopedRepositories(parent.graphId);
    const branchRepos = await container.graphScopedRepositories(branchId);

    await branchRepos.arcRepository.update(shared, { name: 'renamed in the branch' });
    expect((await parentRepos.arcRepository.findById(shared))?.name).toBe('Era');
    expect(await branchRepos.arcRepository.delete(shared)).toBe(true);
    expect((await parentRepos.arcRepository.findById(shared))?.name).toBe('Era');
  });

  it('a link made or deleted in the branch is not the parent’s link between the same two events', async () => {
    const parent = await seed();
    const branchId = await branch(parent.graphId);
    const parentRepos = await container.graphScopedRepositories(parent.graphId);
    const branchRepos = await container.graphScopedRepositories(branchId);
    const [a, b] = parent.events as [string, string, string];

    await branchRepos.causalService.deleteCausalLink(a, b);
    expect(await branchRepos.causalService.getAllRelationships()).toHaveLength(1);
    expect(await parentRepos.causalService.getAllRelationships()).toHaveLength(2);

    await parentRepos.causalService.updateCausalLink(a, b, { weight: 0.9 });
    expect((await parentRepos.causalService.getAllRelationships()).find((l) => l.cause_event_id === a)?.weight).toBe(0.9);
    expect((await branchRepos.causalService.getAllRelationships()).find((l) => l.cause_event_id === a)).toBeUndefined();
  });

  it('a copy that keeps ids writes them under the target graph, and its links join the copied events', async () => {
    const parent = await seed();
    const target = await newGraph(`copy-${Math.random().toString(36).slice(2)}`);
    const session = getDatabaseManager().getNeo4jSession();
    try {
      const result = await new GraphCopyService(session).copyFullGraph(parent.graphId, target, { preserveIds: true, validateIntegrity: false });
      expect(result.errors).toEqual([]);
      expect(result.copiedNodes).toBe(5);
      expect(result.copiedRelationships).toBe(2);
    } finally {
      await session.close();
    }
    const repos = await container.graphScopedRepositories(target);
    expect((await repos.eventRepository.findAll()).map((e) => e.id).sort()).toEqual([...parent.events].sort());
    expect(await repos.causalService.getAllRelationships()).toHaveLength(2);
  });

  it('refuses a second event or arc with the same id in one graph', async () => {
    const parent = await seed();
    const { eventRepository, arcRepository } = await container.graphScopedRepositories(parent.graphId);
    await expect(
      eventRepository.create({ id: parent.events[0]!, description: 'again', actor: 'A', target: 'B', timestamp: new Date(Date.UTC(1950, 0, 1)) })
    ).rejects.toThrow();
    await expect(
      arcRepository.create({ id: parent.arcs[0]!, name: 'again', start_time: new Date(Date.UTC(1900, 0, 1)), end_time: new Date(Date.UTC(1901, 0, 1)), level: 1 })
    ).rejects.toThrow(/already exists in this graph/);
  });
});
