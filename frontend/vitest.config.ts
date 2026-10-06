import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      // `all` counts every source file that matches `include`, including ones
      // no test ever imports, so the baseline cannot be flattered by only
      // measuring files a test happened to touch.
      //
      // Caveat: with `all: true`, a file that no test imports reports 0/0
      // branches and 0/0 functions, and v8 scores an empty denominator as 100%.
      // The branch and function percentages are therefore flattered upward by
      // every never-loaded file; statements and lines are not. This is inherent
      // to v8's all:true mode, not a config error. The measured figures and this
      // caveat are recorded in impl/gap-remediation/phase6-results.md.
      all: true,
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      // The flat ESLint config only ignores `dist`, so a generated `coverage/`
      // directory would be linted (the v8 HTML reporter ships .js files with
      // eslint-disable comments, which surface as new warnings). Keep the
      // report under node_modules, which both ESLint and git ignore.
      reportsDirectory: './node_modules/.cache/vitest-coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/**/*.d.ts',
        // Test scaffolding: setup, mocks, fixtures, generators, helpers.
        'src/test/**',
        // Build/config files are not application behaviour.
        '**/*.config.{ts,js,mts,cts}',
        '**/dist/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve('./src'),
      '@/components': resolve('./src/components'),
      '@/hooks': resolve('./src/hooks'),
      '@/services': resolve('./src/services'),
      '@/types': resolve('./src/types'),
      '@/utils': resolve('./src/utils'),
      '@/stores': resolve('./src/stores'),
      '@/test': resolve('./src/test'),
    },
  },
})