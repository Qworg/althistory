import { describe, it, expect } from 'vitest'
import { computeRipple, linkPath, linkStrokeWidth, RIPPLE_DEPTH, type TimelineLink } from './timelineLinks'

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

describe('linkStrokeWidth', () => {
  it('grows with weight and tolerates a missing one', () => {
    expect(linkStrokeWidth(1)).toBeGreaterThan(linkStrokeWidth(0))
    expect(linkStrokeWidth(Number.NaN)).toBe(linkStrokeWidth(0.5))
  })
})
