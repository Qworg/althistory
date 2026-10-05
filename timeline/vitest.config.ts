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
    // Skip integration tests if databases are not available
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/integration/**', // Exclude integration tests by default
      '**/tests/e2e/**', // Exclude e2e tests by default
      '**/*.load.test.ts', // Exclude load tests by default
      'src/utils/database.test.ts', // Exclude database tests (requires Neo4j)
      'src/repositories/EventRepository.test.ts', // Integration test, use EventRepository.unit.test.ts
      'src/repositories/ArcRepository.test.ts', // Integration test, use ArcRepository.unit.test.ts
      'src/services/GraphCopyService.test.ts' // Integration test, use GraphCopyService.unit.test.ts
    ]
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});