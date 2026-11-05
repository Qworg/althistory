import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VersionRepository } from './VersionRepository';

/** Version names (labels.json beside the version records), on a real directory. */
describe('VersionRepository version labels', () => {
  let dir: string;
  let repository: VersionRepository;

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'version-labels-'));
    repository = new VersionRepository({ dataDir: dir });
    await repository.initializeGraph('g1');
    await repository.commit(
      'g1',
      { added: [{ type: 'event', id: 'e1', data: { description: 'Babbage' } }], modified: [], deleted: [] },
      'create',
      'Added event'
    );
  });

  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('names a version, lists the name with it, and clears it again', async () => {
    const [head] = (await repository.getVersionHistory('g1')).versions;
    expect(head?.label).toBeUndefined();

    await repository.setVersionLabel('g1', head!.version, 'Before the strike');
    const named = (await repository.getVersionHistory('g1')).versions.find((v) => v.version === head!.version);
    expect(named?.label).toBe('Before the strike');
    // The content-addressed record itself is not rewritten.
    expect((await repository.getVersionRef('g1', head!.version))?.label).toBeUndefined();

    await repository.setVersionLabel('g1', head!.version, null);
    const cleared = (await repository.getVersionHistory('g1')).versions.find((v) => v.version === head!.version);
    expect(cleared?.label).toBeUndefined();
  });
});
