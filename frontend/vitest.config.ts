import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
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