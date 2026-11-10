import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The GitHub Pages demo (frontend `npm run build:demo`), served as the static
 * files Pages serves. Unlike the main suite there is no API stub: the demo
 * answers its own API in the browser, and these tests check that it does,
 * with nothing leaving the page.
 *
 *   npx playwright test -c playwright.demo.config.ts
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(here, '..', 'frontend')
const port = 4174
const baseURL = `http://127.0.0.1:${port}/`

export default defineConfig({
  testDir: './demo',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build:demo && npx vite preview --outDir dist-demo --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: frontendDir,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
