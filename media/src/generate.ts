/**
 * Regenerates the README screenshots and the walkthrough video from the real
 * product.
 *
 *   npm run generate              build, seed, capture, write images, render video
 *   npm run generate -- --skip-build   reuse the last backend/frontend build
 *   npm run capture               everything except the video
 *   npm run video                 re-render the video from the last capture
 */
import { mkdir } from 'node:fs/promises'
import { captureTour } from './capture/tour.js'
import { writeReadmeImages } from './images.js'
import { paths } from './paths.js'
import { seed } from './seed/seed.js'
import { buildProduct, startStack } from './stack.js'

const args = new Set(process.argv.slice(2))
const skipBuild = args.has('--skip-build')
const skipVideo = args.has('--skip-video')
const videoOnly = args.has('--video-only')

function log(message: string): void {
  process.stderr.write(`[generate] ${message}\n`)
}

async function capture(): Promise<void> {
  if (!skipBuild) await buildProduct()
  const stack = await startStack()
  const stopOnSignal = () => {
    void stack.stop().finally(() => process.exit(130))
  }
  process.once('SIGINT', stopOnSignal)
  process.once('SIGTERM', stopOnSignal)
  try {
    log('Seeding the demo graph')
    const seeded = await seed(stack.apiUrl, stack.apiKey)
    log('Capturing the tour')
    const manifest = await captureTour(stack.appUrl, stack.apiKey, seeded, paths.shots)
    log(`Captured ${Object.keys(manifest.shots).length} shots into ${paths.shots}`)
  } finally {
    await stack.stop()
    process.off('SIGINT', stopOnSignal)
    process.off('SIGTERM', stopOnSignal)
  }
  await mkdir(paths.readmeImages, { recursive: true })
  await writeReadmeImages()
}

async function main(): Promise<void> {
  if (!videoOnly) await capture()
  if (!skipVideo) {
    const { renderWalkthrough } = await import('./video/render.js')
    await renderWalkthrough()
  }
  log('Done')
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  process.exit(1)
})
