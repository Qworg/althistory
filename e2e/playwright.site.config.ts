import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The GitHub Pages site's own pages (site/), built by site/build.mjs and
 * served as static files, as Pages serves them. Guards for what review can
 * miss: unreadable text and sideways scrolling.
 *
 *   npx playwright test -c playwright.site.config.ts
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const port = 4176
const baseURL = `http://127.0.0.1:${port}/althistory/`

export default defineConfig({
  testDir: './site',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: { baseURL, trace: 'on-first-retry', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node site/build.mjs e2e/.site/althistory && python3 -m http.server ${port} --bind 127.0.0.1 --directory e2e/.site`,
    cwd: root,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
