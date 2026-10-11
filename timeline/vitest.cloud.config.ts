import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Cloud integration test configuration.
 *
 * The default `vitest.config.ts` excludes the suites that need a real Neo4j
 * and Redis, because those services are not present on a developer machine or
 * in the default CI gate. This config does the opposite: it runs *only* those
 * suites, against the services named by the environment, so the cloud stack can
 * be verified for real.
 *
 * Run it through `npm run test:cloud` (which needs NEO4J_URI/REDIS_HOST set) or
 * through the `cloud-tests` docker-compose profile, which supplies them.
 */
export default defineConfig({
  test: {
    globals: true,
    // Database drivers, not a browser: the jsdom environment the default config
    // uses would only add noise here.
    environment: 'node',
    include: [
      'src/utils/database.test.ts',
      'src/repositories/EventRepository.test.ts',
      'src/repositories/ArcRepository.test.ts',
      'src/services/GraphCopyService.test.ts',
    ],
    // These suites share one Neo4j instance and clean up `test_`-prefixed data
    // in their own hooks, so running the files concurrently makes them race.
    // One file at a time also keeps the schema-drop suite (database.test.ts,
    // which sorts last) from pulling constraints out from under the others.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
    teardownTimeout: 60000,
    // Never silently pass by running nothing: an empty match is a failure.
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
