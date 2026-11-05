import { describe, it, expect } from 'vitest'
import { groupVersionSessions } from './versionSessions'
import type { GraphVersion } from '@/types'

const at = (version: number, minutesAgo: number, label?: string): GraphVersion => ({
  version,
  commitHash: String(version),
  timestamp: new Date(Date.UTC(2026, 10, 4, 12, 0) - minutesAgo * 60_000).toISOString(),
  message: '',
  ...(label ? { label } : {}),
  changes: {
    eventsAdded: 0, eventsModified: 0, eventsDeleted: 0,
    arcsAdded: 0, arcsModified: 0, arcsDeleted: 0,
    relationshipsAdded: 1, relationshipsModified: 0, relationshipsDeleted: 0,
  },
})

describe('groupVersionSessions', () => {
  it('runs edits saved close together into one session and splits at a pause', () => {
    const sessions = groupVersionSessions([at(5, 0), at(4, 2), at(3, 5), at(2, 60), at(1, 62)])
    expect(sessions.map((s) => s.versions.map((v) => v.version))).toEqual([[5, 4, 3], [2, 1]])
  })

  it('keeps a named version on its own so it is never folded away', () => {
    const sessions = groupVersionSessions([at(4, 0), at(3, 1, 'Before the strike'), at(2, 2), at(1, 3)])
    expect(sessions.map((s) => s.versions.map((v) => v.version))).toEqual([[4], [3], [2, 1]])
  })
})
