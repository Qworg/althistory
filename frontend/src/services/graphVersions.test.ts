import { describe, it, expect } from 'vitest'
import { toGraphVersion } from './graphVersions'

describe('toGraphVersion', () => {
  it('maps the server version record onto the panel fields', () => {
    const version = toGraphVersion({
      graphId: 'g1',
      version: 46,
      timestamp: '2026-10-31T18:28:19.370Z',
      parentVersion: 45,
      operation: 'create',
      description: 'create relationship r1',
      userId: 'key-1',
      changes: {
        added: [
          { type: 'relationship', id: 'r1' },
          { type: 'event', id: 'e1' },
          { type: 'event', id: 'e2' },
        ],
        modified: [{ type: 'arc', id: 'a1' }],
        deleted: [{ type: 'event', id: 'e3' }],
      },
      treeHash: 'abc',
    })

    expect(version).toMatchObject({
      version: 46,
      commitHash: 'abc',
      message: 'create relationship r1',
      operation: 'create',
      author: 'key-1',
    })
    expect(version.changes).toEqual({
      eventsAdded: 2,
      eventsModified: 0,
      eventsDeleted: 1,
      arcsAdded: 0,
      arcsModified: 1,
      arcsDeleted: 0,
      relationshipsAdded: 1,
      relationshipsModified: 0,
      relationshipsDeleted: 0,
    })
  })

  it('counts nothing for a record without changes', () => {
    const version = toGraphVersion({ version: 0, timestamp: '2026-10-31T00:00:00Z' })
    expect(Object.values(version.changes).every((n) => n === 0)).toBe(true)
    expect(version.message).toBe('')
  })
})
