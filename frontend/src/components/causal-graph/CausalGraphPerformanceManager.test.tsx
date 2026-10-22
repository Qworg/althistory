/**
 * The performance overlay must not change the graph it is watching.
 *
 * `CausalGraphPerformanceManager` is mounted next to a live Cytoscape
 * instance. It used to remove every node with no edges -- on unmount, and
 * from its "Cleanup" button. An event that has no causal link yet is exactly
 * a node with no edges, so that deleted the user's data. These tests pin the
 * rule that the manager releases only its own allocations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Core } from 'cytoscape'
import { CausalGraphPerformanceManager } from './CausalGraphPerformanceManager'
import { Event } from '@/types'

function makeEvent(id: string): Event {
  return {
    id,
    description: `Event ${id}`,
    actor: 'A',
    target: 'B',
    timestamp: '1776-07-04T00:00:00.000Z',
    created_at: '1776-07-04T00:00:00.000Z',
    updated_at: '1776-07-04T00:00:00.000Z',
  }
}

/**
 * The minimum of a Cytoscape core this manager touches.
 *
 * `elements()` is the only accessor the manager used for removal, so it is
 * the one that matters: the test can then see whether anything was removed.
 */
function makeCore(): { core: Core; removed: string[] } {
  const removed: string[] = []

  const element = (id: string) => ({
    id: () => id,
    isNode: () => true,
    degree: () => 0,
    remove: () => {
      removed.push(id)
    },
  })

  const elements = Object.assign(
    () => [element('isolated-1'), element('isolated-2')],
    { forEach: (fn: (el: ReturnType<typeof element>) => void) => {
      for (const el of [element('isolated-1'), element('isolated-2')]) fn(el)
    } }
  )

  // `style()` returns a chainable style builder: selector -> style -> update.
  const styleBuilder = {
    selector: () => styleBuilder,
    style: () => styleBuilder,
    update: () => styleBuilder,
    removeStyle: () => styleBuilder,
  }

  const core = {
    elements,
    on: vi.fn(),
    off: vi.fn(),
    style: () => styleBuilder,
    zoom: () => 1,
    batch: (fn: () => void) => fn(),
    nodes: () => ({ length: 2 }),
    edges: () => ({ length: 0 }),
  } as unknown as Core

  return { core, removed }
}

describe('CausalGraphPerformanceManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not remove isolated nodes when it unmounts', () => {
    const { core, removed } = makeCore()

    const { unmount } = render(
      <CausalGraphPerformanceManager
        cytoscapeInstance={core}
        events={[makeEvent('e1'), makeEvent('e2')]}
        causalRelationships={[]}
      />
    )

    unmount()

    // An event with no causal link yet is a node with degree 0; removing it
    // deleted the graph's own data.
    expect(removed).toEqual([])
  })

  it('does not remove isolated nodes when cleanup is clicked', async () => {
    const user = userEvent.setup()
    const { core, removed } = makeCore()

    render(
      <CausalGraphPerformanceManager
        cytoscapeInstance={core}
        events={[makeEvent('e1')]}
        causalRelationships={[]}
      />
    )

    const cleanup = screen.getByRole('button', { name: /cleanup/i })
    await act(async () => {
      await user.click(cleanup)
    })

    expect(removed).toEqual([])
  })
})
