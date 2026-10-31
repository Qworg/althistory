/**
 * Renders the walkthrough with Revideo from the last capture, then derives a
 * poster frame for the README from the finished video.
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import type { Manifest } from '../manifest.js'
import { paths } from '../paths.js'

// Revideo's renderer reports anonymous usage unless this is set.
process.env.DISABLE_TELEMETRY = 'true'

function log(message: string): void {
  process.stderr.write(`[video] ${message}\n`)
}

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

export async function renderWalkthrough(): Promise<void> {
  const manifestPath = path.join(paths.shots, 'manifest.json')
  let manifest: Manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest
  } catch {
    throw new Error(`No capture to render from (${manifestPath}). Run \`npm run capture\` first.`)
  }

  await mkdir(paths.video, { recursive: true })
  // The renderer resolves the project file and serves the screenshots
  // (`/out/shots/...`) relative to the working directory.
  process.chdir(paths.mediaRoot)
  const { renderVideo } = await import('@revideo/renderer')

  log('Rendering (this takes a few minutes)')
  // Revideo leaves its intermediates (per-worker video, audio track) beside
  // its output, so it renders into the ignored `out/` and only the final
  // encode goes into docs/.
  const workDir = path.join(paths.mediaRoot, 'out')
  const raw = 'walkthrough.raw.mp4'
  let lastReported = -1
  await renderVideo({
    projectFile: './src/video/project.ts',
    variables: { manifest },
    settings: {
      outFile: raw,
      outDir: workDir,
      logProgress: false,
      progressCallback: (_worker, progress) => {
        const pct = Math.floor(progress * 10) * 10
        if (pct > lastReported) {
          lastReported = pct
          log(`${pct}%`)
        }
      },
    },
  })

  // The wasm exporter favours speed over size. A walkthrough is mostly still
  // frames, so a slower x264 pass makes it several times smaller without a
  // visible loss, and `faststart` lets a browser play it while it downloads.
  const rawPath = path.join(workDir, raw)
  const finalPath = path.join(paths.video, 'walkthrough.mp4')
  log('Compressing')
  await ffmpegRun([
    '-i', rawPath,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-tune', 'stillimage',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    finalPath,
  ])

  // A poster for the README link: the first beat, once it has faded in.
  await ffmpegRun([
    '-ss', '5', '-i', finalPath, '-frames:v', '1',
    '-vf', 'scale=1280:-2:flags=lanczos', '-compression_level', '9',
    path.join(paths.readmeImages, 'walkthrough-poster.png'),
  ])

  const size = (await stat(finalPath)).size
  log(`docs/media/walkthrough.mp4 (${(size / 1024 / 1024).toFixed(1)} MB)`)
  log('docs/images/walkthrough-poster.png')
}
