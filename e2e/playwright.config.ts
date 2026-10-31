import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(here, '..', 'frontend')
const previewPort = 4173
const baseURL = `http://127.0.0.1:${previewPort}`

/**
 * End-to-end + visual-regression configuration.
 *
 * The suite runs against the REAL production bundle (`npm run build`) served by
 * `vite preview`, with every `/api/**` request intercepted by the fixtures in
 * `tests/support/api.ts`. It therefore exercises the real router, real React
 * tree, real HTTP client and real browser, with no backend and no network.
 *
 * Visual snapshots are platform-specific -- see `tests/visual.spec.ts` and
 * `e2e/README.md` before trusting or regenerating a baseline.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  expect: {
    toHaveScreenshot: {
      // Sparse screenshots make a percentage threshold easy to fool: 1% of the
      // 800x400 timeline is ~3200 pixels, which would hide a whole event marker
      // moving. 0.03% is 96 px on the timeline: same-machine runs are
      // deterministic (0 diff), while Playwright's perceptual comparator counts
      // ~143 px when a marker is deliberately moved ~200px (verified), so the
      // break is caught. Visual checks are excluded from CI; see
      // tests/visual.spec.ts for the platform caveat.
      maxDiffPixelRatio: 0.0003,
      animations: 'disabled',
    },
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // The app registers an app-shell service worker in production. A worker
    // can serve cached responses outside Playwright's route interception, so
    // block it: these tests must always see the stub, never a stale cache.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Build with a same-origin API base so the stub needs no CORS preflight.
    // Bind the address `baseURL` names: without `--host`, Vite listens on
    // whatever `localhost` resolves to first, which is `::1` on hosts that map
    // it to both (GitHub's Ubuntu runners), and the wait on 127.0.0.1 times out.
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${previewPort} --strictPort`,
    cwd: frontendDir,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      VITE_API_BASE_URL: '/api',
    },
  },
})
