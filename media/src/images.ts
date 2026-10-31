/**
 * Turns the full-resolution captures into the images the README embeds:
 * downscaled to a size GitHub displays well, and cropped where a whole screen
 * would bury the point.
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import type { Manifest, Rect, Shot } from './manifest.js'
import { paths } from './paths.js'

interface ReadmeImage {
  shot: string
  file: string
  /** Crop to this focus rectangle (plus padding) before scaling. */
  crop?: { focus: string; pad: number }
  width: number
}

export const README_IMAGES: ReadmeImage[] = [
  { shot: 'overview', file: 'workspace.png', width: 1600 },
  { shot: 'timeline', file: 'timeline.png', width: 1600 },
  { shot: 'ingest-text', file: 'ingestion-text.png', crop: { focus: 'dialog', pad: 24 }, width: 1200 },
  { shot: 'causal-graph', file: 'causal-graph.png', crop: { focus: 'graph', pad: 16 }, width: 1000 },
  { shot: 'actor', file: 'actor-perspective.png', width: 1600 },
  { shot: 'ingest-review', file: 'ingestion-review.png', crop: { focus: 'dialog', pad: 24 }, width: 1200 },
  { shot: 'pressures', file: 'pressure-analysis.png', crop: { focus: 'panel', pad: 12 }, width: 1200 },
  { shot: 'graphs', file: 'graphs-and-branches.png', width: 1600 },
]

function ffmpegRun(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let err = ''
    child.stderr.on('data', (c) => (err += c))
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err}`))))
  })
}

function cropFilter(rect: Rect, pad: number, manifest: Manifest, size: Shot['size']): string {
  const s = manifest.deviceScaleFactor
  const maxW = size.width
  const maxH = size.height
  const x = Math.max(0, rect.x - pad)
  const y = Math.max(0, rect.y - pad)
  const w = Math.min(maxW - x, rect.width + pad * 2)
  const h = Math.min(maxH - y, rect.height + pad * 2)
  // Even sizes keep every encoder and scaler happy.
  const even = (n: number) => Math.floor((n * s) / 2) * 2
  return `crop=${even(w)}:${even(h)}:${even(x)}:${even(y)}`
}

export async function writeReadmeImages(): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(paths.shots, 'manifest.json'), 'utf8')) as Manifest
  for (const image of README_IMAGES) {
    const shot = manifest.shots[image.shot]
    if (!shot) throw new Error(`README image ${image.file} needs shot "${image.shot}", which the tour did not capture`)
    const filters: string[] = []
    if (image.crop) {
      const rect = shot.focus[image.crop.focus]
      if (!rect) throw new Error(`Shot "${image.shot}" has no focus region "${image.crop.focus}"`)
      filters.push(cropFilter(rect, image.crop.pad, manifest, shot.size))
    }
    // Never upscale a crop that is already smaller than the target width.
    filters.push(`scale='min(${image.width},iw)':-2:flags=lanczos`)
    await ffmpegRun([
      '-i',
      path.join(paths.shots, shot.file),
      '-vf',
      filters.join(','),
      '-compression_level',
      '9',
      path.join(paths.readmeImages, image.file),
    ])
    process.stderr.write(`[images] docs/images/${image.file}\n`)
  }
}
