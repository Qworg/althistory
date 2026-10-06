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
      all: true,
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
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