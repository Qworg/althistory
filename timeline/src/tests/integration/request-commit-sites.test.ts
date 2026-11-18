/**
 * Every durable step that is the first write of a request marks the request
 * committed (the point of no return, `utils/requestBudget.ts`), so a timeout
 * after it lets the request finish instead of answering 408 over a write that
 * stays. One case per site: graph metadata, the graph index, a graph's version
 * data and labels, the API-key store, and the local store's own mutators.
 *
 * Also: a request that has finished does not leave its timer running.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { getDatabaseManager, LocalDatabaseManager } from '@/utils/database';
import { RequestBudget, runWithBudget } from '@/utils/requestBudget';
import type { VersionRepository } from '@/repositories/VersionRepository';

describe('the point of no return', () => {
  let container: Container;
  let dir: string;

  beforeAll(async () => {
    dir = path.join(os.tmpdir(), `request-commit-sites-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = dir;
    process.env.LOCAL_GRAPH_FILE = 'request-commit-sites.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    await fs.mkdir(dir, { recursive: true });
    const config = loadConfig();
    container = initializeContainer(initializeDatabaseManager(config.database), config);
    await container.initialize();
  });

  afterAll(async () => {
    await cleanupContainer();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  /** Run `work` as a request; say whether it ended committed. */
  async function committedBy(work: () => Promise<unknown>): Promise<boolean> {
    const budget = new RequestBudget(60_000, () => undefined);
    budget.start();
    expect(budget.isCommitted).toBe(false);
    try {
      await runWithBudget(budget, work);
    } finally {
      budget.dispose();
    }
    return budget.isCommitted;
  }

  const versions = (): VersionRepository => (container.graphRepository as unknown as { versionRepository: VersionRepository }).versionRepository;

  it('a graph rename (its metadata)', async () => {
    const graph = await container.graphService.createGraph({ name: 'Sites' });
    expect(await committedBy(() => container.graphRepository.update(graph.id, { name: 'Sites renamed' }))).toBe(true);
  });

  it('activating a graph (the index)', async () => {
    const graph = await container.graphService.createGraph({ name: 'Activate me' });
    expect(await committedBy(() => container.graphRepository.setActiveGraph(graph.id))).toBe(true);
  });

  it("a graph's version data being initialised, labelled and deleted", async () => {
    const graph = await container.graphService.createGraph({ name: 'Version data' });
    expect(await committedBy(() => versions().initializeGraph(graph.id))).toBe(true);
    expect(await committedBy(() => versions().setVersionLabel(graph.id, 0, 'named'))).toBe(true);
    expect(await committedBy(() => versions().deleteGraph(graph.id))).toBe(true);
  });

  it('the API-key writes: create, update, revoke, delete', async () => {
    const keys = container.apiKeyRepository;
    let id = '';
    expect(
      await committedBy(async () => {
        id = (await keys.create({ name: 'Sites key', permissions: ['read:graphs'] })).id;
      })
    ).toBe(true);
    expect(await committedBy(() => keys.updateById(id, { name: 'Renamed key' }))).toBe(true);
    expect(await committedBy(() => keys.revoke(id))).toBe(true);
    expect(await committedBy(() => keys.delete(id))).toBe(true);
  });

  it('a key that is only used (lastUsedAt) is not a write of the request', async () => {
    const created = await container.apiKeyRepository.create({ name: 'Used key', permissions: ['read:graphs'] });
    const stored = (await container.apiKeyRepository.findById(created.id))!;
    expect(await committedBy(() => container.apiKeyRepository.update(stored))).toBe(false);
  });

  it('each local store mutator, and a parsed write query', async () => {
    const store = (getDatabaseManager() as unknown as LocalDatabaseManager).getGraphStore();
    let nodeId = '';
    expect(await committedBy(async () => { nodeId = (await store.createNode(['Site'], { name: 'n' })).id; })).toBe(true);
    expect(await committedBy(() => store.updateNode(nodeId, { name: 'm' }))).toBe(true);
    const other = (await store.createNode(['Site'], { name: 'o' })).id;
    let relId = '';
    expect(await committedBy(async () => { relId = (await store.createRelationship(nodeId, other, 'LINKS', {}))!.id; })).toBe(true);
    expect(await committedBy(() => store.updateRelationship(relId, { w: 1 }))).toBe(true);
    expect(await committedBy(() => store.deleteRelationship(relId))).toBe(true);
    expect(await committedBy(() => store.deleteNode(other))).toBe(true);
    expect(await committedBy(() => store.executeQuery('CREATE (n:Site {id: $id, name: "q"}) RETURN n', { id: 'q-site' }))).toBe(true);
    // A read is not a commit.
    expect(await committedBy(() => store.executeQuery('MATCH (n:Site) RETURN n LIMIT 1'))).toBe(false);
  });

  it('a finished request leaves no timer to re-arm', () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const budget = new RequestBudget(50, expired);
    budget.start();
    budget.markCommitted();
    vi.advanceTimersByTime(60); // re-armed once: a committed request keeps its timer
    budget.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(expired).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
