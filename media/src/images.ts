/**
 * Turns the full-resolution captures into the images the README embeds:
 * downscaled to a size GitHub displays well, and cropped where a whole screen
 * would bury the point.
 */
import { spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
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

/** The crop, in device pixels of the capture. */
function cropBox(rect: Rect, pad: number, manifest: Manifest, size: Shot['size']) {
  const s = manifest.deviceScaleFactor
  const x = Math.max(0, rect.x - pad)
  const y = Math.max(0, rect.y - pad)
  const w = Math.min(size.width - x, rect.width + pad * 2)
  const h = Math.min(size.height - y, rect.height + pad * 2)
  // Even sizes keep every encoder and scaler happy.
  const even = (n: number) => Math.floor((n * s) / 2) * 2
  return { w: even(w), h: even(h), x: even(x), y: even(y) }
}

function cropFilter(rect: Rect, pad: number, manifest: Manifest, size: Shot['size']): string {
  const box = cropBox(rect, pad, manifest, size)
  return `crop=${box.w}:${box.h}:${box.x}:${box.y}`
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

/**
 * The landing page's pictures (site/): each cropped tight to what its
 * paragraph describes, as WebP at two widths for `srcset`, plus a manifest of
 * their sizes that site/build.mjs uses to fill in each `<img>`'s srcset,
 * width and height. Kept apart from the README images, which GitHub shows as
 * PNG at fixed sizes.
 */
interface SiteImage {
  shot: string
  name: string
  focus: string
  pad: number
}

export const SITE_IMAGES: SiteImage[] = [
  { shot: 'ingest-review', name: 'ingest-review', focus: 'dialog', pad: 0 },
  { shot: 'timeline', name: 'timeline', focus: 'timeline', pad: 12 },
  { shot: 'causal-graph', name: 'causal-graph', focus: 'graph', pad: 12 },
  { shot: 'branch', name: 'branch', focus: 'view', pad: 12 },
]

/** Widths written for each site image; the largest is about 2x its shown size. */
export const SITE_WIDTHS = [720, 1440]

const SITE_DIR = path.join(paths.readmeImages, 'site')

const webpArgs = ['-c:v', 'libwebp', '-quality', '82', '-compression_level', '6']

export async function writeSiteImages(): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(paths.shots, 'manifest.json'), 'utf8')) as Manifest
  await mkdir(SITE_DIR, { recursive: true })
  const sizes: Record<string, { widths: number[]; width: number; height: number }> = {}
  for (const image of SITE_IMAGES) {
    const shot = manifest.shots[image.shot]
    if (!shot) throw new Error(`Site image ${image.name} needs shot "${image.shot}", which the tour did not capture`)
    const rect = shot.focus[image.focus]
    if (!rect) throw new Error(`Shot "${image.shot}" has no focus region "${image.focus}"`)
    const box = cropBox(rect, image.pad, manifest, shot.size)
    const widths = SITE_WIDTHS.map((w) => Math.min(w, box.w))
    for (const width of new Set(widths)) {
      await ffmpegRun([
        '-i',
        path.join(paths.shots, shot.file),
        '-vf',
        `crop=${box.w}:${box.h}:${box.x}:${box.y},scale=${width}:-2:flags=lanczos`,
        ...webpArgs,
        path.join(SITE_DIR, `${image.name}-${width}.webp`),
      ])
    }
    const largest = Math.max(...widths)
    sizes[image.name] = {
      widths: [...new Set(widths)],
      width: largest,
      height: Math.round((box.h * largest) / box.w / 2) * 2,
    }
    process.stderr.write(`[images] docs/images/site/${image.name}-{${[...new Set(widths)].join(',')}}.webp\n`)
  }

  // The walkthrough's poster, lighter than the PNG the README uses.
  const poster = path.join(paths.readmeImages, 'walkthrough-poster.png')
  try {
    await access(poster)
    await ffmpegRun(['-i', poster, ...webpArgs, path.join(SITE_DIR, 'walkthrough-poster.webp')])
    process.stderr.write('[images] docs/images/site/walkthrough-poster.webp\n')
  } catch {
    process.stderr.write('[images] no walkthrough poster yet; render the video first\n')
  }

  await writeFile(path.join(SITE_DIR, 'manifest.json'), JSON.stringify(sizes, null, 2) + '\n')
}
