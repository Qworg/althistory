/**
 * Acceptance tests for merge semantics.
 *
 * SCOPE OF THE MERGE ITSELF: it is a TWO-WAY diff of the source tree against
 * the target tree, not a three-way merge. `branchGraph` records the fork point
 * (`IGraph.branchPoint`) so a three-way merge is possible later, and a merge
 * commit records both parents exactly, but the diff has no common-ancestor base:
 * an entity changed on one side is reported as a conflict, a target-side
 * deletion is re-added, and a source-side deletion does not apply. These tests
 * assert that behaviour rather than claiming more.
 *
 * Covered here:
 *
 * 1. `keep-source` and `keep-target` resolve every conflict without a manual
 *    map.
 * 2. A merge commit records both parents: `parentVersion` (the target head, the
 *    first parent) and `mergeParent` (the source head, the second parent), both
 *    recoverable from the version history.
 * 3. `manualResolutions` are validated by VALUE, not just presence: `null`,
 *    `''` and `'garbage'` are rejected instead of falling through to the
 *    keep-target default.
 * 4. A merge with no conflicts needs no strategy at all.
 * 5. The branch fork point is recorded and recoverable.
 * 6. A commit whose expected parent no longer matches the head is refused
 *    (`StaleVersionError`) and the merge recomputes instead of recording a
 *    parent it did not diff.
 *
 * These run against the real file-backed container (real VersionRepository,
 * real GraphRepository) rather than mocks, so the assertions cover persistence
 * and not just argument passing.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { GraphService } from '@/services/GraphService';
import { EntityChanges, StaleVersionError, VersionRepository } from '@/repositories/VersionRepository';
import { IGraph, MergeGraphRequest, MergeResult } from '@/models/Graph';
import { ValidationError } from '@/utils/errors';

const ENTITY_ID = 'event-conflict';
const SECOND_ENTITY_ID = 'event-conflict-second';

/** A commit that adds the shared entity with the given description. */
function addEvent(description: string): EntityChanges {
  return {
    added: [{ type: 'event', id: ENTITY_ID, data: { id: ENTITY_ID, description } }],
    modified: [],
    deleted: [],
  };
}

/** A commit that rewrites the shared entity's description. */
function modifyEvent(description: string): EntityChanges {
  return {
    added: [],
    modified: [{ type: 'event', id: ENTITY_ID, data: { id: ENTITY_ID, description } }],
    deleted: [],
  };
}

/**
 * `manualResolutions` is typed `Record<string, 'keep-source' | 'keep-target'>`,
 * but it arrives as untyped JSON. The validation tests deliberately send values
 * the type says are impossible, so the request is built through `unknown`
 * rather than silencing the checker.
 */
function manualRequest(sourceGraphId: string, manualResolutions: unknown): MergeGraphRequest {
  return {
    sourceGraphId,
    conflictResolution: 'manual',
    manualResolutions,
  } as unknown as MergeGraphRequest;
}

/**
 * A second GraphService over the same data directory. The service's merge rate
 * limiter is per instance (10 merges/minute) and this suite makes more than ten
 * merge calls, so tests that only exercise the validation path use this
 * instance rather than exhausting the shared container's budget.
 */
async function createIsolatedService(dataDir: string): Promise<GraphService> {
  const service = new GraphService({ dataDir });
  await service.initialize();
  return service;
}

describe('Merge semantics (local execution)', () => {
  let container: Container;
  let testDataDir: string;
  let isolatedService: GraphService;

  beforeAll(async () => {
    testDataDir = path.join(os.tmpdir(), `merge-semantics-test-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'merge-semantics-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    // config.ts rejects anything below 64 MB
    process.env.LOCAL_MAX_MEMORY_MB = '64';

    await fs.mkdir(testDataDir, { recursive: true });

    const config = loadConfig();
    const dbManager = initializeDatabaseManager(config.database);
    container = initializeContainer(dbManager, config);
    await container.initialize();

    isolatedService = await createIsolatedService(testDataDir);
  });

  afterAll(async () => {
    await cleanupContainer();
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Cleanup is best-effort.
    }
  });

  /**
   * Build a target and a source graph that both start from the same entity and
   * then diverge, so a merge of the two necessarily conflicts.
   *
   *   target: v0 "event-conflict" = "base"  ->  v1 = "target value"
   *   source: v0 "event-conflict" = "base"  ->  v1 = "source value"
   */
  async function seedConflictingPair(): Promise<{ target: IGraph; source: IGraph }> {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const target = await container.graphService.createGraph({ name: `merge-target-${suffix}` });
    const source = await container.graphService.createGraph({ name: `merge-source-${suffix}` });

    await container.graphRepository.commitChanges(target.id, addEvent('base'), 'create', 'base');
    await container.graphRepository.commitChanges(source.id, addEvent('base'), 'create', 'base');
    await container.graphRepository.commitChanges(target.id, modifyEvent('target value'), 'update', 'target edit');
    await container.graphRepository.commitChanges(source.id, modifyEvent('source value'), 'update', 'source edit');

    return { target, source };
  }

  /**
   * Build a target and a source graph that each hold the SAME two entities with
   * different values, so a merge of the two has exactly two conflicts. Used to
   * distinguish "wrong keys" from "wrong count" and to exercise a pair of
   * valid per-conflict resolutions.
   */
  async function seedTwoConflictingEntities(): Promise<{ target: IGraph; source: IGraph }> {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const target = await container.graphService.createGraph({ name: `merge2-target-${suffix}` });
    const source = await container.graphService.createGraph({ name: `merge2-source-${suffix}` });

    const add = (first: string, second: string): EntityChanges => ({
      added: [
        { type: 'event', id: ENTITY_ID, data: { id: ENTITY_ID, description: first } },
        { type: 'event', id: SECOND_ENTITY_ID, data: { id: SECOND_ENTITY_ID, description: second } },
      ],
      modified: [],
      deleted: [],
    });

    await container.graphRepository.commitChanges(target.id, add('base', 'base'), 'create', 'base');
    await container.graphRepository.commitChanges(source.id, add('base', 'base'), 'create', 'base');
    await container.graphRepository.commitChanges(target.id, add('target first', 'target second'), 'update', 'target edit');
    await container.graphRepository.commitChanges(source.id, add('source first', 'source second'), 'update', 'source edit');

    return { target, source };
  }

  describe('uniform resolution strategies', () => {
    it('keep-source resolves a conflict to the source value with no manual map', async () => {
      const { target, source } = await seedConflictingPair();

      const result: MergeResult = await container.graphService.mergeGraph(target.id, {
        sourceGraphId: source.id,
        conflictResolution: 'keep-source',
      });

      expect(result.success).toBe(true);
      expect(result.newVersion).toBe(2);

      const merged = await container.graphService.getGraphData(target.id);
      expect(merged.events[ENTITY_ID].description).toBe('source value');
    });

    it('keep-target resolves a conflict to the target value with no manual map', async () => {
      const { target, source } = await seedConflictingPair();

      const result: MergeResult = await container.graphService.mergeGraph(target.id, {
        sourceGraphId: source.id,
        conflictResolution: 'keep-target',
      });

      expect(result.success).toBe(true);
      expect(result.newVersion).toBe(2);

      const merged = await container.graphService.getGraphData(target.id);
      expect(merged.events[ENTITY_ID].description).toBe('target value');
    });
  });

  describe('merge commit parents', () => {
    it('records both parents and lets both sides be recovered', async () => {
      const { target, source } = await seedConflictingPair();

      const result = await container.graphService.mergeGraph(target.id, {
        sourceGraphId: source.id,
        conflictResolution: 'keep-source',
      });
      expect(result.success).toBe(true);
      const mergeVersion = result.newVersion;
      expect(mergeVersion).toBeDefined();

      const mergeRef = await container.graphRepository.getVersion(target.id, mergeVersion as number);
      expect(mergeRef).not.toBeNull();
      expect(mergeRef?.operation).toBe('merge');
      // First parent: the target graph's own head before the merge.
      expect(mergeRef?.parentVersion).toBe(1);
      // Second parent: the source graph's head that was merged in.
      expect(mergeRef?.mergeParent).toEqual({ graphId: source.id, version: 1 });

      // Both sides of the merge are recoverable from the recorded parents alone.
      const targetSide = await container.graphService.getGraphData(target.id, mergeRef?.parentVersion ?? -1);
      expect(targetSide.events[ENTITY_ID].description).toBe('target value');

      const sourceSide = await container.graphService.getGraphData(
        mergeRef?.mergeParent?.graphId ?? '',
        mergeRef?.mergeParent?.version ?? -1
      );
      expect(sourceSide.events[ENTITY_ID].description).toBe('source value');

      // A linear commit is unchanged: it has a first parent and no merge parent.
      const baseRef = await container.graphRepository.getVersion(target.id, 0);
      expect(baseRef?.parentVersion).toBeNull();
      expect(baseRef?.mergeParent).toBeUndefined();
    });

    it('rolling back to the merge first parent undoes the merge and records a linear rollback commit', async () => {
      const { target, source } = await seedConflictingPair();

      const result = await container.graphService.mergeGraph(target.id, {
        sourceGraphId: source.id,
        conflictResolution: 'keep-source',
      });
      expect(result.success).toBe(true);
      const mergeRef = await container.graphRepository.getVersion(target.id, result.newVersion as number);
      expect(mergeRef?.mergeParent).toBeDefined();

      // Undoing a merge means restoring the tree the target had before the merge,
      // i.e. rolling back to the merge commit's first parent. The merge itself
      // stays in the history as the record that it happened.
      const rollbackRef = await container.graphRepository.rollback(target.id, mergeRef?.parentVersion ?? -1);

      expect(rollbackRef.operation).toBe('rollback');
      expect(rollbackRef.mergeParent).toBeUndefined();

      const afterRollback = await container.graphService.getGraphData(target.id);
      expect(afterRollback.events[ENTITY_ID].description).toBe('target value');

      // The merge commit is still present and still names both parents.
      const stillThere = await container.graphRepository.getVersion(target.id, mergeRef?.version ?? -1);
      expect(stillThere?.operation).toBe('merge');
      expect(stillThere?.mergeParent).toEqual({ graphId: source.id, version: 1 });
    });
  });

  describe('manual resolution', () => {
    it('is refused when the map does not cover every conflict', async () => {
      const { target, source } = await seedConflictingPair();

      const result = await container.graphService.mergeGraph(target.id, {
        sourceGraphId: source.id,
        conflictResolution: 'manual',
        manualResolutions: {},
      });

      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(1);

      // Nothing was committed: the target is still at version 1.
      const latest = await container.graphRepository.getLatestVersion(target.id);
      expect(latest?.version).toBe(1);
    });

    it('applies the per-conflict choices when the map is complete', async () => {
      const { target, source } = await seedConflictingPair();

      const result = await container.graphService.mergeGraph(target.id, {
        sourceGraphId: source.id,
        conflictResolution: 'manual',
        manualResolutions: { [`event:${ENTITY_ID}`]: 'keep-source' },
      });

      expect(result.success).toBe(true);
      const merged = await container.graphService.getGraphData(target.id);
      expect(merged.events[ENTITY_ID].description).toBe('source value');
    });
  });

  describe('conflicting adds on both sides', () => {
    it('keep-source resolves the conflict and commits a two-parent merge', async () => {
      const target = await container.graphService.createGraph({
        name: `no-conflict-target-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      const source = await container.graphService.createGraph({
        name: `no-conflict-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });

      await container.graphRepository.commitChanges(target.id, addEvent('target only'), 'create', 'seed target');
      await container.graphRepository.commitChanges(source.id, addEvent('source only'), 'create', 'seed source');

      const result = await container.graphService.mergeGraph(target.id, {
        sourceGraphId: source.id,
        conflictResolution: 'keep-source',
      });

      expect(result.success).toBe(true);

      const merged = await container.graphService.getGraphData(target.id);
      expect(merged.events[ENTITY_ID].description).toBe('source only');

      const mergeRef = await container.graphRepository.getVersion(target.id, result.newVersion as number);
      expect(mergeRef?.operation).toBe('merge');
      expect(mergeRef?.mergeParent).toEqual({ graphId: source.id, version: 0 });
    });
  });

  describe('manual resolution value validation', () => {
    it('rejects a null value instead of coercing it to keep-target', async () => {
      const { target, source } = await seedConflictingPair();

      await expect(
        isolatedService.mergeGraph(
          target.id,
          manualRequest(source.id, { [`event:${ENTITY_ID}`]: null })
        )
      ).rejects.toThrow(ValidationError);

      // Nothing was committed: the target is still at version 1.
      expect((await container.graphRepository.getLatestVersion(target.id))?.version).toBe(1);
    });

    it('rejects an empty string value instead of coercing it to keep-target', async () => {
      const { target, source } = await seedConflictingPair();

      await expect(
        isolatedService.mergeGraph(
          target.id,
          manualRequest(source.id, { [`event:${ENTITY_ID}`]: '' })
        )
      ).rejects.toThrow(ValidationError);

      expect((await container.graphRepository.getLatestVersion(target.id))?.version).toBe(1);
    });

    it('rejects an unrecognized string value instead of coercing it to keep-target', async () => {
      const { target, source } = await seedConflictingPair();

      await expect(
        isolatedService.mergeGraph(
          target.id,
          manualRequest(source.id, { [`event:${ENTITY_ID}`]: 'garbage' })
        )
      ).rejects.toThrow(ValidationError);

      expect((await container.graphRepository.getLatestVersion(target.id))?.version).toBe(1);
    });

    it('rejects a manualResolutions value that is not a resolution string', async () => {
      const { target, source } = await seedConflictingPair();

      await expect(
        isolatedService.mergeGraph(
          target.id,
          manualRequest(source.id, { [`event:${ENTITY_ID}`]: ['keep-source'] })
        )
      ).rejects.toThrow(ValidationError);

      expect((await container.graphRepository.getLatestVersion(target.id))?.version).toBe(1);
    });

    it('rejects a map with the right number of entries but the wrong keys', async () => {
      const { target, source } = await seedTwoConflictingEntities();

      const result = await isolatedService.mergeGraph(
        target.id,
        manualRequest(source.id, {
          'event:not-a-real-entity': 'keep-source',
          'event:also-not-real': 'keep-target',
        })
      );

      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(2);
      expect((await container.graphRepository.getLatestVersion(target.id))?.version).toBe(1);
    });

    it('applies a valid pair of per-conflict resolutions', async () => {
      const { target, source } = await seedTwoConflictingEntities();

      const result = await isolatedService.mergeGraph(
        target.id,
        manualRequest(source.id, {
          [`event:${ENTITY_ID}`]: 'keep-source',
          [`event:${SECOND_ENTITY_ID}`]: 'keep-target',
        })
      );

      expect(result.success).toBe(true);

      const merged = await isolatedService.getGraphData(target.id);
      expect(merged.events[ENTITY_ID].description).toBe('source first');
      expect(merged.events[SECOND_ENTITY_ID].description).toBe('target second');
    });
  });

  describe('merges without conflicts', () => {
    it('proceeds with no strategy supplied and commits a two-parent merge', async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const targetOnlyId = 'event-target-only';
      const sourceOnlyId = 'event-source-only';
      const target = await container.graphService.createGraph({ name: `clean-target-${suffix}` });
      const source = await container.graphService.createGraph({ name: `clean-source-${suffix}` });

      await container.graphRepository.commitChanges(
        target.id,
        {
          added: [{ type: 'event', id: targetOnlyId, data: { id: targetOnlyId, description: 'target only' } }],
          modified: [],
          deleted: [],
        },
        'create',
        'seed target'
      );
      await container.graphRepository.commitChanges(
        source.id,
        {
          added: [{ type: 'event', id: sourceOnlyId, data: { id: sourceOnlyId, description: 'source only' } }],
          modified: [],
          deleted: [],
        },
        'create',
        'seed source'
      );

      // No `conflictResolution` at all: the service contract says a merge with
      // no conflicts proceeds because there is nothing to resolve. The old test
      // claimed this path while actually sending a conflicting entity.
      const result = await container.graphService.mergeGraph(target.id, {
        sourceGraphId: source.id,
      });

      expect(result.success).toBe(true);
      expect(result.conflicts).toEqual([]);

      const merged = await container.graphService.getGraphData(target.id);
      expect(merged.events[targetOnlyId].description).toBe('target only');
      expect(merged.events[sourceOnlyId].description).toBe('source only');

      const mergeRef = await container.graphRepository.getVersion(target.id, result.newVersion as number);
      expect(mergeRef?.operation).toBe('merge');
      expect(mergeRef?.parentVersion).toBe(0);
      expect(mergeRef?.mergeParent).toEqual({ graphId: source.id, version: 0 });
    });
  });

  describe('branch fork point (merge-base enabler)', () => {
    it('records the source version the branch forked from and that version is recoverable', async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const parent = await container.graphService.createGraph({ name: `fork-parent-${suffix}` });

      await container.graphRepository.commitChanges(parent.id, addEvent('base'), 'create', 'base');
      await container.graphRepository.commitChanges(parent.id, modifyEvent('fork value'), 'update', 'second');

      const parentHead = await container.graphRepository.getLatestVersion(parent.id);
      expect(parentHead?.version).toBe(1);

      // The metadata `version` counter is 2 at this point even though the
      // version repository only holds 0 and 1. The recorded fork point must
      // come from the version repository, not that counter.
      const parentMetadata = await container.graphService.getGraph(parent.id);
      expect(parentMetadata.version).toBe(2);

      const branch = await container.graphService.branchGraph(parent.id, {
        name: `fork-branch-${suffix}`,
      });
      const reloaded = await container.graphService.getGraph(branch.id);

      expect(reloaded.parentGraphId).toBe(parent.id);
      expect(reloaded.branchPoint).toBe(1);

      // Recoverable and real: the parent tree at the fork point is a version,
      // and the branch's initial tree is exactly that tree.
      const forkRef = await container.graphRepository.getVersion(parent.id, reloaded.branchPoint as number);
      expect(forkRef).not.toBeNull();

      const base = await container.graphService.getGraphData(parent.id, reloaded.branchPoint as number);
      expect(base.events[ENTITY_ID].description).toBe('fork value');

      const branchData = await container.graphService.getGraphData(branch.id);
      expect(branchData.events[ENTITY_ID]).toEqual(base.events[ENTITY_ID]);
    });
  });

  describe('parent recording under concurrent commits', () => {
    it('refuses a commit whose expected first parent is no longer the head', async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const target = await container.graphService.createGraph({ name: `stale-target-${suffix}` });
      const source = await container.graphService.createGraph({ name: `stale-source-${suffix}` });

      await container.graphRepository.commitChanges(target.id, addEvent('base'), 'create', 'base');
      const head = await container.graphRepository.getLatestVersion(target.id);
      expect(head?.version).toBe(0);

      // A concurrent commit lands after the caller read version 0.
      await container.graphRepository.commitChanges(target.id, modifyEvent('raced'), 'update', 'raced');

      await expect(
        container.graphRepository.commitChanges(
          target.id,
          addEvent('never committed'),
          'merge',
          'stale merge',
          undefined,
          { graphId: source.id, version: 0 },
          head?.version ?? null
        )
      ).rejects.toThrow(StaleVersionError);

      // The refused call committed nothing.
      expect((await container.graphRepository.getLatestVersion(target.id))?.version).toBe(1);
    });

    it('recomputes the merge when its first parent changed instead of recording the wrong parent', async () => {
      const { target, source } = await seedConflictingPair();
      // The container's GraphService builds its own GraphRepository (and so its
      // own VersionRepository), so the stale failure is injected at the
      // prototype both repositories share, not on `container.graphRepository`.
      const commitSpy = vi.spyOn(VersionRepository.prototype, 'commit');
      commitSpy.mockImplementationOnce(async () => {
        throw new StaleVersionError(target.id, 1, 2);
      });

      try {
        const result = await container.graphService.mergeGraph(target.id, {
          sourceGraphId: source.id,
          conflictResolution: 'keep-source',
        });

        expect(result.success).toBe(true);
        // First attempt refused, second committed.
        expect(commitSpy).toHaveBeenCalledTimes(2);

        const mergeRef = await container.graphRepository.getVersion(target.id, result.newVersion as number);
        expect(mergeRef?.operation).toBe('merge');
        expect(mergeRef?.parentVersion).toBe(1);
        expect(mergeRef?.mergeParent).toEqual({ graphId: source.id, version: 1 });

        const merged = await container.graphService.getGraphData(target.id);
        expect(merged.events[ENTITY_ID].description).toBe('source value');
      } finally {
        commitSpy.mockRestore();
      }
    });
  });
});
