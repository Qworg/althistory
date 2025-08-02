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
      '**/*.integration.test.ts' // Exclude integration tests by default
    ]
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});