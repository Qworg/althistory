import { describe, it, expect } from 'vitest'
import { buildGraphTree, branchLabel } from './graphTree'
import type { Graph } from '@/types'

function graph(id: string, name: string, parentGraphId?: string): Graph {
  return {
    id,
    name,
    status: 'active',
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
    parentGraphId,
  }
}

describe('buildGraphTree', () => {
  it('places branches (and branches of branches) under their parent, depth-first', () => {
    const tree = buildGraphTree([
      graph('b2', 'B2', 'b1'),
      graph('root', 'Root'),
      graph('b1', 'B1', 'root'),
      graph('other', 'Other'),
    ])
    expect(tree.map((n) => [n.graph.id, n.depth, n.parent?.id ?? null])).toEqual([
      ['root', 0, null],
      ['b1', 1, 'root'],
      ['b2', 2, 'b1'],
      ['other', 0, null],
    ])
  })

  it('lists a branch whose parent is not in the list as a root', () => {
    const tree = buildGraphTree([graph('b1', 'B1', 'missing')])
    expect(tree).toEqual([expect.objectContaining({ depth: 0, parent: null })])
  })

  it('does not lose graphs in a parent cycle', () => {
    const tree = buildGraphTree([graph('a', 'A', 'b'), graph('b', 'B', 'a')])
    expect(tree.map((n) => n.graph.id).sort()).toEqual(['a', 'b'])
  })
})

describe('branchLabel', () => {
  const parent = graph('p', 'The Engine Age')
  it.each([
    ['The Engine Age — Clerks Prevail', 'Clerks Prevail'],
    ['The Engine Age - Clerks Prevail', 'Clerks Prevail'],
    ['The Engine Age: Clerks Prevail', 'Clerks Prevail'],
    ['The Engine Ageless', 'The Engine Ageless'],
    ['Clerks Prevail', 'Clerks Prevail'],
    ['The Engine Age', 'The Engine Age'],
  ])('%j under "The Engine Age" reads %j', (name, expected) => {
    expect(branchLabel(graph('b', name, 'p'), parent)).toBe(expected)
  })

  it('returns the whole name without a parent', () => {
    expect(branchLabel(graph('b', 'The Engine Age — Clerks Prevail'), null)).toBe('The Engine Age — Clerks Prevail')
  })
})
