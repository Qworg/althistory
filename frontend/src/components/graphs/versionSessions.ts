import type { GraphVersion } from '@/types'
import { describeVersionChanges } from './versionSummary'

/** Edits closer together than this belong to one working session. */
export const SESSION_GAP_MS = 10 * 60 * 1000

export interface VersionSession {
  /** Newest first, like the list. */
  versions: GraphVersion[]
  start: Date
  end: Date
}

/**
 * Group a newest-first version list into working sessions: runs of versions
 * saved within SESSION_GAP_MS of each other. A named version always starts a
 * session of its own: the author marked it as a place to come back to, so it
 * is never folded away inside a run of autosaves.
 */
export function groupVersionSessions(versions: readonly GraphVersion[], gapMs = SESSION_GAP_MS): VersionSession[] {
  const sessions: VersionSession[] = []
  let current: VersionSession | null = null
  for (const version of versions) {
    const at = new Date(version.timestamp)
    const time = Number.isNaN(at.getTime()) ? 0 : at.getTime()
    const startsNew =
      current === null ||
      Boolean(version.label) ||
      Boolean(current.versions[current.versions.length - 1]?.label) ||
      current.start.getTime() - time > gapMs
    if (startsNew) {
      current = { versions: [version], start: at, end: at }
      sessions.push(current)
    } else if (current) {
      current.versions.push(version)
      current.start = at
    }
  }
  return sessions
}

/**
 * What restoring `target` would do, from the versions saved after it: what
 * comes back (what they deleted) and what goes (what they added).
 * "Brings back 2 events · Removes 3 links".
 */
export function describeRestore(versions: readonly GraphVersion[], target: number): string[] {
  const after = versions.filter((v) => v.version > target)
  if (after.length === 0) return []
  const sum = (key: keyof GraphVersion['changes']) => after.reduce((n, v) => n + (Number(v.changes?.[key]) || 0), 0)
  const removes = describeVersionChanges({
    eventsAdded: sum('eventsAdded'),
    arcsAdded: sum('arcsAdded'),
    relationshipsAdded: sum('relationshipsAdded'),
    eventsModified: 0,
    arcsModified: 0,
    relationshipsModified: 0,
    eventsDeleted: 0,
    arcsDeleted: 0,
    relationshipsDeleted: 0,
  }).map((part) => part.replace(/ added$/, ''))
  const restores = describeVersionChanges({
    eventsAdded: sum('eventsDeleted'),
    arcsAdded: sum('arcsDeleted'),
    relationshipsAdded: sum('relationshipsDeleted'),
    eventsModified: 0,
    arcsModified: 0,
    relationshipsModified: 0,
    eventsDeleted: 0,
    arcsDeleted: 0,
    relationshipsDeleted: 0,
  }).map((part) => part.replace(/ added$/, ''))
  const reverts = sum('eventsModified') + sum('arcsModified') + sum('relationshipsModified')
  return [
    ...(restores.length ? [`Brings back ${restores.join(', ')}`] : []),
    ...(removes.length ? [`Removes ${removes.join(', ')}`] : []),
    ...(reverts ? [`Undoes ${reverts} ${reverts === 1 ? 'edit' : 'edits'} to what remains`] : []),
  ]
}
