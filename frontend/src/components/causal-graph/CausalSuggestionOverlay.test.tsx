import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import type { Core } from 'cytoscape'
import { CausalSuggestionOverlay } from './CausalSuggestionOverlay'
import type { CausalSuggestion } from '@/types'

/**
 * A minimal Cytoscape double: two nodes, and whatever edges the overlay adds.
 * Each added edge records the styles applied to it.
 */
function createCy() {
  const edges = new Map<string, { data: Record<string, unknown>; styles: Array<Record<string, unknown>> }>()
  const element = (id: string) => {
    if (id === 'a' || id === 'b') return { length: 1 }
    const edge = edges.get(id)
    if (!edge) return { length: 0 }
    return {
      length: 1,
      data: () => edge.data,
      style: (s: Record<string, unknown>) => { edge.styles.push(s) },
      remove: () => { edges.delete(id) }
    }
  }
  const cy = {
    getElementById: vi.fn(element),
    edges: () => ({ filter: () => ({ length: 0 }) }),
    add: vi.fn(({ data }: { data: Record<string, unknown> }) => {
      const id = data.id as string
      edges.set(id, { data, styles: [] })
      return {
        style: (s: Record<string, unknown>) => { edges.get(id)?.styles.push(s) },
        on: vi.fn()
      }
    }),
    batch: vi.fn((fn: () => void) => fn())
  }
  return { cy: cy as unknown as Core, edges }
}

const suggestion: CausalSuggestion = {
  id: 's1',
  cause_event_id: 'a',
  effect_event_id: 'b',
  suggested_weight: 0.6,
  confidence: 0.7,
  reasoning: 'Shared actors'
}

/** Opacity-only restyles are the pulse; the initial styling sets many keys. */
const pulseStyles = (styles: Array<Record<string, unknown>>) =>
  styles.filter(s => Object.keys(s).length === 1 && 'opacity' in s)

describe('CausalSuggestionOverlay animation', () => {
  let frames: Array<FrameRequestCallback>
  let raf: ReturnType<typeof vi.fn>
  let caf: ReturnType<typeof vi.fn>
  const originalMatchMedia = window.matchMedia

  const setReducedMotion = (reduce: boolean) => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn()
    })) as unknown as typeof window.matchMedia
  }

  /** Runs the pending animation frame at time `now`. */
  const runFrame = (now: number) => {
    const pending = frames
    frames = []
    pending.forEach(cb => cb(now))
  }

  beforeEach(() => {
    frames = []
    let nextId = 1
    raf = vi.fn((cb: FrameRequestCallback) => { frames.push(cb); return nextId++ })
    caf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    vi.stubGlobal('cancelAnimationFrame', caf)
    setReducedMotion(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.matchMedia = originalMatchMedia
  })

  it('does not animate when the viewer prefers reduced motion', () => {
    setReducedMotion(true)
    const { cy, edges } = createCy()
    render(<CausalSuggestionOverlay cytoscapeInstance={cy} suggestions={[suggestion]} />)

    expect(edges.has('suggestion-s1')).toBe(true)
    expect(raf).not.toHaveBeenCalled()
    expect(pulseStyles(edges.get('suggestion-s1')!.styles)).toHaveLength(0)
  })

  it('pulses on animation frames at a coarse cadence, not every frame', () => {
    const { cy, edges } = createCy()
    render(<CausalSuggestionOverlay cytoscapeInstance={cy} suggestions={[suggestion]} />)
    expect(raf).toHaveBeenCalledTimes(1)

    // Frames 16ms apart: only those at least 250ms after the last restyle count.
    for (let t = 0; t <= 1000; t += 16) runFrame(t)

    const pulses = pulseStyles(edges.get('suggestion-s1')!.styles)
    expect(pulses.length).toBeGreaterThanOrEqual(3)
    expect(pulses.length).toBeLessThanOrEqual(5)
  })

  it('does not start when there are no suggestion edges', () => {
    const { cy } = createCy()
    render(<CausalSuggestionOverlay cytoscapeInstance={cy} suggestions={[]} />)
    expect(raf).not.toHaveBeenCalled()
  })

  it('stops when the suggestions are removed and on unmount', () => {
    const { cy } = createCy()
    const { rerender, unmount } = render(
      <CausalSuggestionOverlay cytoscapeInstance={cy} suggestions={[suggestion]} />
    )
    expect(raf).toHaveBeenCalledTimes(1)

    rerender(<CausalSuggestionOverlay cytoscapeInstance={cy} suggestions={[]} />)
    expect(caf).toHaveBeenCalled()

    // A frame that was already queued finds no edges and does not reschedule.
    const before = raf.mock.calls.length
    runFrame(500)
    expect(raf.mock.calls.length).toBe(before)

    unmount()
  })

  it('animates without error where matchMedia is unavailable', () => {
    // @ts-expect-error -- simulating an environment without matchMedia
    window.matchMedia = undefined
    const { cy } = createCy()
    expect(() =>
      render(<CausalSuggestionOverlay cytoscapeInstance={cy} suggestions={[suggestion]} />)
    ).not.toThrow()
    expect(raf).toHaveBeenCalledTimes(1)
  })

  it('does not animate when animateSuggestions is false', () => {
    const { cy } = createCy()
    render(
      <CausalSuggestionOverlay cytoscapeInstance={cy} suggestions={[suggestion]} animateSuggestions={false} />
    )
    expect(raf).not.toHaveBeenCalled()
  })
})
