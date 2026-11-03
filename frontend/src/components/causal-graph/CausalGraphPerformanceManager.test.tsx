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
import { render, screen, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Core } from 'cytoscape'
import { CausalGraphPerformanceManager } from './CausalGraphPerformanceManager'
import { Event } from '@/types'
import { GRAPH_STYLESHEET_REPLACED_EVENT } from './causalGraphStylesheet'

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

  describe('style ownership', () => {
    function spyCore(zoom: number) {
      const base: Array<{ selector: string; style: Record<string, unknown> }> = [{ selector: 'node.label-culled', style: { 'text-opacity': 0 } }]
      const builder = {
        selector: vi.fn(() => builder),
        style: vi.fn(() => builder),
        update: vi.fn(() => builder),
        json: vi.fn(() => base),
        fromJson: vi.fn(() => builder),
      }
      const handlers = new Map<string, () => void>()
      const core = {
        on: vi.fn((name: string, fn: () => void) => handlers.set(name, fn)),
        off: vi.fn(),
        style: () => builder,
        zoom: () => zoom,
        batch: (fn: () => void) => fn(),
        nodes: () => ({ length: 2 }),
        edges: () => ({ length: 0 }),
        elements: () => ({ length: 2, remove: vi.fn() }),
      } as unknown as Core
      return { core, builder, base, handlers }
    }

    it('never appends blanket node rules for an ordinary graph, so per-node styling survives zooming', () => {
      const { core, builder, handlers } = spyCore(1.2)
      render(
        <CausalGraphPerformanceManager cytoscapeInstance={core} events={[makeEvent('e1'), makeEvent('e2')]} causalRelationships={[]} />
      )

      handlers.get('zoom')?.()

      // "Full detail" used to append node { text-opacity: 1; border-width: 2 }
      // on every zoom, overriding label culling and the selected border.
      expect(builder.selector).not.toHaveBeenCalledWith('node')
      expect(builder.fromJson).not.toHaveBeenCalled()
    })

    it('reduces detail on top of the graph stylesheet, then restores that stylesheet exactly', () => {
      const events = Array.from({ length: 120 }, (_, i) => makeEvent(`e${i}`))
      const zoomedOut = spyCore(0.3)
      render(
        <CausalGraphPerformanceManager cytoscapeInstance={zoomedOut.core} events={events} causalRelationships={[]} levelOfDetailThreshold={50} />
      )
      zoomedOut.handlers.get('zoom')?.()

      // Reduced detail starts from the captured base, not from accumulated rules
      expect(zoomedOut.builder.json).toHaveBeenCalled()
      expect(zoomedOut.builder.fromJson).toHaveBeenCalledWith(zoomedOut.base)
      expect(zoomedOut.builder.selector).toHaveBeenCalledWith('node')
    })

    it('takes a fresh snapshot after a theme change replaces the stylesheet', () => {
      const events = Array.from({ length: 120 }, (_, i) => makeEvent(`e${i}`))
      const zoomedOut = spyCore(0.3)
      render(
        <CausalGraphPerformanceManager cytoscapeInstance={zoomedOut.core} events={events} causalRelationships={[]} levelOfDetailThreshold={50} />
      )
      zoomedOut.handlers.get('zoom')?.()
      expect(zoomedOut.builder.json).toHaveBeenCalledTimes(1)

      // The canvas replaced its stylesheet for the new theme: the snapshot
      // holds the old colours, so it is retaken and detail reduced again
      const themed = [{ selector: 'edge', style: { 'line-color': '#60a5fa' } }]
      zoomedOut.builder.json.mockReturnValue(themed)
      zoomedOut.builder.fromJson.mockClear()
      zoomedOut.handlers.get(GRAPH_STYLESHEET_REPLACED_EVENT)?.()

      expect(zoomedOut.builder.json).toHaveBeenCalledTimes(2)
      expect(zoomedOut.builder.fromJson).toHaveBeenCalledWith(themed)
      expect(zoomedOut.builder.fromJson).not.toHaveBeenCalledWith(zoomedOut.base)
    })
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

    // The diagnostics are collapsed until asked for.
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /performance/i }))
    })
    const cleanup = screen.getByRole('button', { name: /cleanup/i })
    await act(async () => {
      await user.click(cleanup)
    })

    expect(removed).toEqual([])
  })

  it('is a collapsed section under a heading, not a card, until expanded', async () => {
    const user = userEvent.setup()
    const { core } = makeCore()

    const { container } = render(
      <CausalGraphPerformanceManager
        cytoscapeInstance={core}
        events={[makeEvent('e1')]}
        causalRelationships={[]}
      />
    )

    const heading = screen.getByRole('heading', { level: 3, name: /performance/i })
    const toggle = within(heading).getByRole('button', { name: /performance/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /cleanup/i })).not.toBeInTheDocument()
    expect(container.querySelector('.shadow-sm, .bg-white')).toBeNull()

    await act(async () => {
      await user.click(toggle)
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'none' })).toHaveAttribute('aria-pressed', 'true')
    // No frame rate has been measured yet: it is not reported as "poor".
    expect(heading).not.toHaveTextContent(/poor/i)
  })
})
