import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      // `all` counts every source file that matches `include`, including ones
      // no test ever imports, so the baseline cannot be flattered by only
      // measuring files a test happened to touch.
      //
      // Caveat: with `all: true`, a file that no test imports reports 0/0
      // branches and 0/0 functions, and v8 scores an empty or near-empty
      // denominator as 100%. The branch and function percentages are therefore
      // flattered upward by every never-loaded file; statements and lines are
      // not. This is inherent to v8's all:true mode, not a config error. The
      // measured figures and this caveat are recorded in
      // impl/gap-remediation/phase6-results.md.
      all: true,
      // Must match the frontend's effective value or the two packages count
      // different things. Vitest 1 defaults this to false, which turned every
      // physical line -- blank and comment-only lines included -- into a
      // statement: the backend's statement total (31050) was exactly the
      // physical line count of the 70 files the report covered. Vitest 3 (the
      // frontend) defaults it to true, so blank and comment-only lines are
      // dropped from the denominator. Setting it to true here drops the
      // backend's denominator to 18834 executable lines, the same kind of
      // denominator the frontend already counts.
      ignoreEmptyLines: true,
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      // Must cover `.tsx` as well as `.ts`: TimelineVisualization,
      // CausalGraphVisualization and the integrated containers are non-test
      // application code. A `.ts`-only glob silently omitted them and made this
      // figure incomparable to the frontend one (which already includes tsx).
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.load.test.ts',
        'src/**/*.d.ts',
        // Test scaffolding.
        'src/test-setup.ts',
        'src/tests/**',
        'src/utils/test-utils.ts',
        // Build/config files are not application behaviour.
        '**/*.config.{ts,js,mts,cts}',
        '**/dist/**',
      ],
    },
    testTimeout: 30000, // Increase timeout for database operations
    hookTimeout: 30000, // Increase hook timeout
    teardownTimeout: 30000, // Increase teardown timeout
    // Integration and e2e suites run as part of the default test run. They
    // exercise local-execution mode (file-backed graph store) or boot the app
    // in-process via supertest, so they need no external services.
    //
    // Still excluded: suites that genuinely require a running Neo4j/Redis (the
    // database suite and the three repository/service suites that each have a
    // *.unit.test.ts sibling covering the same code), and the load tests, which
    // are run separately via `npm run test:load`.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.load.test.ts', // Load tests: run via `npm run test:load`
      'src/utils/database.test.ts', // Requires Neo4j
      'src/repositories/EventRepository.test.ts', // Requires Neo4j; see EventRepository.unit.test.ts
      'src/repositories/ArcRepository.test.ts', // Requires Neo4j; see ArcRepository.unit.test.ts
      'src/services/GraphCopyService.test.ts' // Requires Neo4j; see GraphCopyService.unit.test.ts
    ]
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});