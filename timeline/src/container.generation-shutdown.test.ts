/**
 * Shutting the container down stops the generation jobs first (issue 23).
 *
 * A job writes to a graph's live store and then commits a version. If cleanup
 * flushed and evicted the stores while a job still ran, the job could write to a
 * store nothing would flush again. This fails if `cleanup` does not stop the
 * jobs before the stores, or if a job can still start afterwards.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { Container } from '@/container';
import { GenerationLimitError } from '@/services/GenerationJobService';

describe('Container.cleanup and generation jobs', () => {
  const dataDir = path.join(os.tmpdir(), `container-generation-shutdown-${process.pid}-${Date.now()}`);

  afterAll(async () => {
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('cancels a running job, lets it unwind, and takes no job afterwards', async () => {
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = dataDir;
    process.env.LOCAL_GRAPH_FILE = 'container-generation-shutdown.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    await fs.mkdir(path.join(dataDir, 'graphs'), { recursive: true });
    const config = loadConfig();
    const container = new Container(initializeDatabaseManager(config.database), config);
    await container.initialize();

    const jobs = container.generationJobService;
    const job = jobs.start(
      { kind: 'timeline', options: { premise: 'A tide that never turned', divergencePoint: 'The wall holds', eventCount: 40 } },
      { keyId: 'key-1', name: 'agent' }
    );
    await container.cleanup();

    expect(jobs.get(job.id, 'key-1')?.status).toBe('cancelled');
    // Nothing is still unwinding once cleanup has returned.
    await jobs.idle();
    const written = jobs.get(job.id, 'key-1')?.written;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(jobs.get(job.id, 'key-1')?.written).toEqual(written);
    expect(() => jobs.start({ kind: 'timeline', options: { premise: 'x', eventCount: 3 } }, { keyId: 'key-1' })).toThrow(
      GenerationLimitError
    );
  });
});
