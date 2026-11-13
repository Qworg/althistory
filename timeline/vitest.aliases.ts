import { resolve } from 'path';

/**
 * The module aliases every vitest config in this package uses (the default
 * and the cloud one). Vite does not read tsconfig's `paths`, so each alias
 * there needs one here; keeping them in one place stops a config from
 * missing one, as the cloud config once missed `@althistory/calendar` and
 * could not load any suite that imports a model.
 */
export const aliases = {
  '@': resolve(__dirname, './src'),
  // The shared date and calendar package, read from source (see calendar/README.md).
  '@althistory/calendar': resolve(__dirname, '../calendar/src/index.ts'),
};
