/**
 * Acceptance tests for merge semantics (gap-remediation Phase 2.4).
 *
 * Two behaviours are covered here, both of which were absent:
 *
 * 1. `keep-source` and `keep-target` must resolve every conflict under that
 *    strategy without the caller supplying a manual resolution for each
 *    conflict. Before the fix, `GraphService.mergeGraph` required
 *    `manualResolutions` to be as long as the conflict list even for the
 *    uniform strategies, so the uniform branch in `calculateMergeChanges` was
 *    unreachable.
 *
 * 2. A merge commit must record that it had two parents. Version numbers are
 *    per-graph, so each parent is a (graph id, version) pair. The target's own
 *    predecessor is `parentVersion`; the merged-in source head is
 *    `mergeParent`. Both must be recoverable from the version history.
 *
 * These run against the real file-backed container (real VersionRepository,
 * real GraphRepository) rather than mocks, so the assertions cover persistence
 * and not just argument passing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { EntityChanges } from '@/repositories/VersionRepository';
import { IGraph, MergeResult } from '@/models/Graph';

const ENTITY_ID = 'event-conflict';

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

describe('Merge semantics (local execution)', () => {
  let container: Container;
  let testDataDir: string;

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

  describe('merges without conflicts', () => {
    it('keep-source still applies source-only additions and commits a two-parent merge', async () => {
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
});
