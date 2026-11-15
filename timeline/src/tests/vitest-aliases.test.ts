import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { aliases } from '../../vitest.aliases';

/**
 * Vite does not read tsconfig's `paths`, so a path tsc resolves and a vitest
 * config does not only fails when a suite imports it. The cloud config once
 * lacked `@althistory/calendar`, and every cloud suite that loads a model
 * failed to start, in CI only.
 */
describe('the vitest configs', () => {
  const tsconfig = fs.readFileSync(path.resolve(__dirname, '../../tsconfig.json'), 'utf8');
  // The bare (non-wildcard) path keys, such as `@althistory/calendar`; the
  // `@/...` wildcards are all covered by the `@` alias.
  const bare = [...tsconfig.matchAll(/"([^"*]+)":\s*\[/g)].map((match) => match[1]).filter((key) => key.startsWith('@') && !key.startsWith('@/'));

  it('alias every bare path tsconfig maps', () => {
    expect(bare).toContain('@althistory/calendar');
    for (const key of bare) expect(Object.keys(aliases), key).toContain(key);
  });

  // Read as text, not imported: importing a vitest config into the program
  // would type-check it against a second copy of Vite's types.
  it('both use the shared aliases', () => {
    for (const file of ['vitest.config.ts', 'vitest.cloud.config.ts']) {
      const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
      expect(source, file).toMatch(/import \{ aliases \} from '\.\/vitest\.aliases'/);
      expect(source, file).toMatch(/alias: (aliases|\{\s*\.\.\.aliases,?\s*\})/);
    }
  });
});
