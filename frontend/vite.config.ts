import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: process.env.VITE_HOST || (process.env.TAILSCALE === 'true' ? '0.0.0.0' : undefined),
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.BACKEND_PROXY_URL || 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('cose-bilkent')) {
              return 'vendor-cose-bilkent'
            }
            if (id.includes('dagre')) {
              return 'vendor-dagre'
            }
            if (id.includes('cytoscape')) {
              return 'vendor-cytoscape'
            }
            if (id.includes('d3')) {
              return 'vendor-d3'
            }
            if (id.includes('@tanstack/react-query') || id.includes('@tanstack/query-devtools')) {
              return 'vendor-query'
            }
            if (id.includes('axios')) {
              return 'vendor-axios'
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router') || id.includes('zustand')) {
              return 'vendor-react'
            }
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/components': path.resolve(__dirname, './src/components'),
      '@/hooks': path.resolve(__dirname, './src/hooks'),
      '@/services': path.resolve(__dirname, './src/services'),
      '@/types': path.resolve(__dirname, './src/types'),
      '@/utils': path.resolve(__dirname, './src/utils'),
      '@/stores': path.resolve(__dirname, './src/stores'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})