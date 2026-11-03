import { describe, it, expect } from 'vitest'
import type { GraphVersion } from '@/types'
import { buildVersionNameLookup, describeVersionChanges, summarizeVersion, containsRawId } from './versionSummary'

const changes: GraphVersion['changes'] = {
  eventsAdded: 0,
  eventsModified: 0,
  eventsDeleted: 0,
  arcsAdded: 0,
  arcsModified: 0,
  arcsDeleted: 0,
  relationshipsAdded: 0,
  relationshipsModified: 0,
  relationshipsDeleted: 0,
}

const version = (overrides: Partial<GraphVersion>): GraphVersion => ({
  version: 5,
  commitHash: 'h',
  timestamp: '2024-01-01T00:00:00Z',
  message: '',
  changes,
  ...overrides,
})

const empty = buildVersionNameLookup()

describe('summarizeVersion', () => {
  it('never passes a message with an internal id through', () => {
    const summary = summarizeVersion(
      version({ message: 'Linked graph_1793671184808_b9lc7s7co', operation: 'update', changes: { ...changes, eventsModified: 2 } }),
      empty
    )
    expect(summary).toBe('2 events changed')
    expect(containsRawId(summary)).toBe(false)
  })

  it('names the operation when nothing else is known', () => {
    expect(summarizeVersion(version({ operation: 'import' }), empty)).toBe('Imported history')
    expect(summarizeVersion(version({ version: 1 }), empty)).toBe('Created the graph')
  })

  it('names an arc by its name', () => {
    const lookup = buildVersionNameLookup([], [
      { id: 'arc_17936600000_x', name: 'The Calculating Offices', description: '', start_time: '', end_time: '', level: 1, parent_arc_id: null, created_at: '', updated_at: '' },
    ])
    expect(summarizeVersion(version({ message: 'create arc arc_17936600000_x' }), lookup)).toBe(
      'Added arc “The Calculating Offices”'
    )
  })
})

describe('describeVersionChanges', () => {
  it('pluralises and orders events, arcs, then links', () => {
    expect(describeVersionChanges({ ...changes, eventsAdded: 1, relationshipsDeleted: 2, arcsModified: 1 })).toEqual([
      '1 event added',
      '1 arc changed',
      '2 links deleted',
    ])
  })

  it('treats missing counts as no change', () => {
    expect(describeVersionChanges({} as GraphVersion['changes'])).toEqual([])
  })
})
