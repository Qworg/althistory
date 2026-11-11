/**
 * WebVTT captions for the walkthrough (docs/media/walkthrough.vtt), so the
 * site's player can offer the narration as text without depending on the
 * captions burned into the frames.
 *
 *   npm run captions      from the last capture and the rendered video
 *
 * The scene (walkthrough.tsx) runs on fixed durations: fades, camera travel,
 * holds, pointer moves. `cues` replays the same arithmetic over the
 * storyboard, and `writeCaptions` refuses to write the file if the total
 * disagrees with the rendered video's length, so a change to the scene that
 * is not mirrored here fails loudly instead of drifting.
 */
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import type { Manifest } from '../manifest.js'
import { paths } from '../paths.js'
import { beats, intro, outro, type Beat } from './storyboard.js'

export interface Cue {
  start: number
  end: number
  text: string
}

/** The time one move takes in `playMove`. */
function moveDuration(move: Beat['moves'][number], hasPointer: boolean): number {
  const travel = move.travel ?? 1
  const outlines = move.highlight?.length ?? 0
  const outlinesIn = outlines ? 0.15 * (outlines - 1) + 0.35 : 0
  const pointer = move.pointer && hasPointer ? 0.9 + (move.pointer === 'click' ? 0.5 : 0) : 0
  const fadeOut = outlines ? 0.25 : 0.2
  return (travel > 0 ? travel : 0) + Math.max(outlinesIn, pointer, move.hold) + fadeOut
}

export function cues(manifest: Manifest): { cues: Cue[]; total: number } {
  const list: Cue[] = []
  let t = 0

  // titleCard: shown for 3.3 s, then a 0.5 s fade.
  list.push({ start: 0, end: 3.8, text: `${intro.title}: ${intro.subtitle}.\n${intro.premise}` })
  t = 3.8

  // playBeat: 0.5 s fade in; the moves; the caption fades out over 0.35 s
  // while the stage takes 0.45 s.
  for (const beat of beats) {
    const shot = manifest.shots[beat.shot]
    if (!shot) throw new Error(`Captions: no captured shot "${beat.shot}"`)
    const start = t
    t += 0.5
    for (const move of beat.moves) t += moveDuration(move, Boolean(shot.pointer))
    list.push({ start, end: t + 0.35, text: `${beat.chapter}. ${beat.caption}` })
    t += 0.45
  }

  // cliCard: 0.5 s fade in, the command lines 0.35 s apart (0.3 s each), a
  // 3.2 s hold and a 0.6 s fade.
  const start = t
  t += 0.5 + 0.35 * (outro.commands.length - 1) + 0.3 + 3.2 + 0.6
  list.push({ start, end: t, text: `${outro.title}. ${outro.caption}` })

  return { cues: list, total: t }
}

function stamp(seconds: number): string {
  const ms = Math.round(seconds * 1000)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`
}

/** The video's length, from ffmpeg's banner (`Duration: 00:01:02.40`). */
function videoDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg.path, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (c) => (err += c))
    child.on('error', reject)
    child.on('exit', () => {
      const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err)
      if (!match) return reject(new Error(`Could not read the duration of ${file}`))
      resolve(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]))
    })
  })
}

export async function writeCaptions(): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(paths.shots, 'manifest.json'), 'utf8')) as Manifest
  const { cues: list, total } = cues(manifest)
  const duration = await videoDuration(path.join(paths.video, 'walkthrough.mp4'))
  if (Math.abs(duration - total) > 0.25) {
    throw new Error(
      `Captions: the storyboard adds up to ${total.toFixed(2)} s but the video is ${duration.toFixed(2)} s; ` +
        'mirror the scene change in src/video/captions.ts'
    )
  }
  const body = list.map((cue, i) => `${i + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}`).join('\n\n')
  await writeFile(path.join(paths.video, 'walkthrough.vtt'), `WEBVTT\n\n${body}\n`)
  process.stderr.write(`[captions] docs/media/walkthrough.vtt (${list.length} cues, ${total.toFixed(1)} s)\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  writeCaptions().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
