/**
 * Renders the 1280×640 social preview card: the image GitHub shows when the
 * repository is shared (Settings → Social preview) and the site's og:image.
 *
 *   npm run social
 *
 * The card is a page of the site (`site/src/social.html`) carrying the same
 * forking timeline as the landing page, drawn from the seed; this builds the
 * site and screenshots that page into docs/images/social-preview.png.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { paths } from './paths.js'

const OUT = path.join(paths.readmeImages, 'social-preview.png')

function buildSite(outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(paths.repoRoot, 'site/build.mjs'), outDir], { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`site/build.mjs exited ${code}`))))
  })
}

async function main(): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'althistory-social-'))
  try {
    await buildSite(dir)
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 640 },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
        colorScheme: 'light',
      })
      await page.goto(pathToFileURL(path.join(dir, 'social.html')).href, { waitUntil: 'networkidle' })
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: OUT })
      process.stderr.write(`[social] wrote ${path.relative(paths.repoRoot, OUT)}\n`)
    } finally {
      await browser.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  process.exit(1)
})
