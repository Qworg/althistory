/**
 * Rewrites the landing page's pictures (docs/images/site/) from the last
 * capture, without capturing again:
 *
 *   npm run site-images
 */
import { writeSiteImages } from './images.js'

writeSiteImages().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
