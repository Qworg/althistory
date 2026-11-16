import { describe, it, expect } from 'vitest'
import {
  computeRipple,
  computeReach,
  reachRadius,
  restingLinkOpacity,
  MARK_RADIUS_MIN,
  MARK_RADIUS_MAX,
  linkPath,
  linkSpansInBands,
  linkStrokeWidth,
  RIPPLE_DEPTH,
  type TimelineLink,
} from './timelineLinks'

const link = (id: string, causeId: string, effectId: string): TimelineLink => ({
  id,
  causeId,
  effectId,
  type: 'direct',
  weight: 0.5,
})

// a → b → c → d → e, and x → b
const chain = [link('ab', 'a', 'b'), link('bc', 'b', 'c'), link('cd', 'c', 'd'), link('de', 'd', 'e'), link('xb', 'x', 'b')]

describe('computeRipple', () => {
  it('is empty with nothing selected', () => {
    const ripple = computeRipple(null, chain)
    expect(ripple.causes.size).toBe(0)
    expect(ripple.effects.size).toBe(0)
    expect(ripple.links.size).toBe(0)
  })

  it('takes the direct causes, and the effects up to RIPPLE_DEPTH steps on', () => {
    const ripple = computeRipple('b', chain)
    expect([...ripple.causes].sort()).toEqual(['a', 'x'])
    expect(Object.fromEntries(ripple.effects)).toEqual({ c: 1, d: 2, e: 3 })
    expect(RIPPLE_DEPTH).toBe(3)
    expect(ripple.links.get('ab')).toBe('cause')
    expect(ripple.links.get('xb')).toBe('cause')
    expect(ripple.links.get('de')).toBe(3)
  })

  it('stops at RIPPLE_DEPTH', () => {
    const ripple = computeRipple('a', chain)
    expect(ripple.effects.has('d')).toBe(true)
    expect(ripple.effects.has('e')).toBe(false)
    expect(ripple.links.has('de')).toBe(false)
  })

  it('gives an event reached by two paths its nearest step', () => {
    const ripple = computeRipple('a', [...chain, link('ac', 'a', 'c')])
    expect(ripple.effects.get('c')).toBe(1)
  })

  it('does not loop back through the selection', () => {
    const ripple = computeRipple('a', [link('ab', 'a', 'b'), link('ba', 'b', 'a')])
    expect(ripple.effects.has('a')).toBe(false)
  })
})

describe('linkPath', () => {
  /** y of the curve's control points (its lowest point is 3/4 of the way there). */
  const controlY = (d: string) => Number(/C -?[\d.]+ (-?[\d.]+)/.exec(d)![1])
  const lowest = (d: string) => 50 + (controlY(d) - 50) * 0.75

  it('hangs a longer link deeper, never past the band', () => {
    const short = linkPath(100, 140, 50, 120, 1000)
    const long = linkPath(0, 1000, 50, 120, 1000)
    expect(lowest(long)).toBeGreaterThan(lowest(short))
    expect(lowest(long)).toBeLessThanOrEqual(50 + 120)
  })

  it('draws a small loop between simultaneous events', () => {
    expect(linkPath(200, 200, 50, 120, 1000)).toMatch(/^M 200 50 C 190/)
  })
})

describe('linkSpansInBands', () => {
  /** The cubic linkPath draws, as dense points (x, y below the band's top). */
  const curve = (x1: number, x2: number, depth: number, plot: number) => {
    const m = /^M (-?[\d.]+) 0 C (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) 0$/.exec(linkPath(x1, x2, 0, depth, plot))!
    const [p0, c1x, c1y, c2x, c2y, p3] = m.slice(1).map(Number) as [number, number, number, number, number, number]
    return Array.from({ length: 4001 }, (_, i) => {
      const t = i / 4000
      const u = 1 - t
      return { x: u * u * u * p0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * p3, y: 3 * u * u * t * c1y + 3 * u * t * t * c2y }
    })
  }

  it('covers every point of a link\'s curve that passes through a band, and nothing is missed', () => {
    const links = [
      { x1: 100, x2: 140 },
      { x1: 100, x2: 900 },
      { x1: 400, x2: 400 },
      { x1: 700, x2: 250 },
    ]
    const bands: Array<[number, number]> = [[2, 20], [16, 34], [40, 60]]
    // With the default padding, which absorbs the bulge of the curve beyond its sampled chords.
    const spans = linkSpansInBands(links, 120, 1000, bands)
    links.forEach((l) => {
      for (const { x, y } of curve(l.x1, l.x2, 120, 1000)) {
        bands.forEach(([from, to], index) => {
          if (y >= from && y <= to) expect(spans[index]!.some(([left, right]) => x >= left && x <= right), `${x},${y} in ${from}..${to}`).toBe(true)
        })
      }
    })
  })

  it('leaves a band free where no link comes near, and pads each span', () => {
    const [free, used] = linkSpansInBands([{ x1: 100, x2: 100 }], 120, 1000, [[60, 80], [0, 10]], 4)
    expect(free).toEqual([])
    expect(used!.length).toBe(1)
    expect(used![0]![0]).toBeLessThan(100 - 4 + 1)
    expect(used![0]![1]).toBeGreaterThan(100 + 4 - 1)
  })
})

describe('linkStrokeWidth', () => {
  it('grows with weight and tolerates a missing one', () => {
    expect(linkStrokeWidth(1)).toBeGreaterThan(linkStrokeWidth(0))
    expect(linkStrokeWidth(Number.NaN)).toBe(linkStrokeWidth(0.5))
  })
})

describe('computeReach', () => {
  it('counts what each event sets in motion, the way the ripple does', () => {
    // a → b → c → d → e: a reaches b, c, d (three steps), not e.
    const links = [link('1', 'a', 'b'), link('2', 'b', 'c'), link('3', 'c', 'd'), link('4', 'd', 'e')]
    const reach = computeReach(links)
    expect(reach.get('a')).toBe(3)
    expect(reach.get('d')).toBe(1)
    expect(reach.has('e')).toBe(false)
  })

  it('sizes marks from small (no reach) to the largest (most reach)', () => {
    expect(reachRadius(0, 10)).toBe(MARK_RADIUS_MIN)
    expect(reachRadius(10, 10)).toBe(MARK_RADIUS_MAX)
    expect(reachRadius(3, 10)).toBeGreaterThan(MARK_RADIUS_MIN)
    expect(reachRadius(3, 10)).toBeLessThan(reachRadius(6, 10))
  })

  it('draws links out of far-reaching events darker at rest', () => {
    expect(restingLinkOpacity(10, 10)).toBeGreaterThan(restingLinkOpacity(1, 10))
  })
})
