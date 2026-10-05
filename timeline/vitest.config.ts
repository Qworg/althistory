import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
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