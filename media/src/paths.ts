import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mediaRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(mediaRoot, '..')

export const paths = {
  repoRoot,
  mediaRoot,
  timeline: path.join(repoRoot, 'timeline'),
  frontend: path.join(repoRoot, 'frontend'),
  /** Private production build of the frontend (never `frontend/dist`). */
  frontendBuild: path.join(mediaRoot, '.build', 'frontend'),
  /** Full-resolution captures and their manifest: the video's input. */
  shots: path.join(mediaRoot, 'out', 'shots'),
  /** Committed outputs. */
  readmeImages: path.join(repoRoot, 'docs', 'images'),
  video: path.join(repoRoot, 'docs', 'media'),
}
