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
/** A fraction of a focus region, for a detail inside it (0..1 on each axis). */
interface Part {
  x0: number
  x1: number
  y0: number
  y1: number
}

interface Crop {
  focus: string
  pad: number
  part?: Part
}

interface SiteImage extends Crop {
  shot: string
  name: string
  /** A tighter crop for phones: the one detail the paragraph claims. */
  detail?: Crop
}

export const SITE_IMAGES: SiteImage[] = [
  { shot: 'ingest-review', name: 'ingest-review', focus: 'dialog', pad: 0, detail: { focus: 'table', pad: 0, part: { x0: 0, x1: 0.56, y0: 0, y1: 1 } } },
  { shot: 'timeline', name: 'timeline', focus: 'timeline', pad: 12, detail: { focus: 'timeline', pad: 0, part: { x0: 0.14, x1: 0.7, y0: 0.2, y1: 0.84 } } },
  {
    shot: 'causal-graph',
    name: 'causal-graph',
    focus: 'graph',
    pad: 12,
    detail: { focus: 'graph', pad: 0, part: { x0: 0.4, x1: 0.94, y0: 0.22, y1: 0.8 } },
  },
  { shot: 'branch', name: 'branch', focus: 'view', pad: 12, detail: { focus: 'view', pad: 0, part: { x0: 0.45, x1: 1, y0: 0.07, y1: 1 } } },
]

/** Width of the phone detail crops (about 2x a 360px column). */
export const SITE_DETAIL_WIDTH = 720

function regionOf(shot: Shot, crop: Crop): Rect {
  const rect = shot.focus[crop.focus]
  if (!rect) throw new Error(`Shot "${shot.id}" has no focus region "${crop.focus}"`)
  if (!crop.part) return rect
  const { x0, x1, y0, y1 } = crop.part
  return {
    x: rect.x + rect.width * x0,
    y: rect.y + rect.height * y0,
    width: rect.width * (x1 - x0),
    height: rect.height * (y1 - y0),
  }
}

/** Widths written for each site image; the largest is about 2x its shown size. */
export const SITE_WIDTHS = [720, 1440]

const SITE_DIR = path.join(paths.readmeImages, 'site')

const webpArgs = ['-c:v', 'libwebp', '-quality', '82', '-compression_level', '6']

export async function writeSiteImages(): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(paths.shots, 'manifest.json'), 'utf8')) as Manifest
  await mkdir(SITE_DIR, { recursive: true })
  const sizes: Record<string, { widths: number[]; width: number; height: number; detail?: { width: number; height: number } }> = {}
  for (const image of SITE_IMAGES) {
    const shot = manifest.shots[image.shot]
    if (!shot) throw new Error(`Site image ${image.name} needs shot "${image.shot}", which the tour did not capture`)
    const box = cropBox(regionOf(shot, image), image.pad, manifest, shot.size)
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
    if (image.detail) {
      const d = cropBox(regionOf(shot, image.detail), image.detail.pad, manifest, shot.size)
      const width = Math.min(SITE_DETAIL_WIDTH, d.w)
      await ffmpegRun([
        '-i',
        path.join(paths.shots, shot.file),
        '-vf',
        `crop=${d.w}:${d.h}:${d.x}:${d.y},scale=${width}:-2:flags=lanczos`,
        ...webpArgs,
        path.join(SITE_DIR, `${image.name}-detail-${SITE_DETAIL_WIDTH}.webp`),
      ])
      sizes[image.name].detail = { width, height: Math.round((d.h * width) / d.w / 2) * 2 }
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
