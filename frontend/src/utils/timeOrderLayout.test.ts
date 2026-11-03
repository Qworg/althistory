import { describe, it, expect } from 'vitest'
import { timeOrderPositions } from './timeOrderLayout'

describe('timeOrderPositions', () => {
  it('places events left to right by date, the same way every time', () => {
    const nodes = [
      { id: 'late', time: 300 },
      { id: 'early', time: 100 },
      { id: 'mid', time: 200 },
    ]
    const a = timeOrderPositions(nodes, { width: 1000 })
    const b = timeOrderPositions([...nodes].reverse(), { width: 1000 })
    expect(a.get('early')!.x).toBeLessThan(a.get('mid')!.x)
    expect(a.get('mid')!.x).toBeLessThan(a.get('late')!.x)
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort())
  })

  it('stacks events too close to share a row, alternating above and below', () => {
    const nodes = [
      { id: 'a', time: 0 },
      { id: 'b', time: 1 },
      { id: 'c', time: 2 },
      { id: 'd', time: 1000 },
    ]
    const p = timeOrderPositions(nodes, { width: 1000, minGap: 150, rowPitch: 100 })
    expect(p.get('a')!.y).toBe(0)
    expect(p.get('b')!.y).toBe(-100)
    expect(p.get('c')!.y).toBe(100)
    // Far enough along to go back to the first row
    expect(p.get('d')!.y).toBe(0)
  })

  it('puts events without a usable date after the rest', () => {
    const p = timeOrderPositions([{ id: 'dated', time: 5 }, { id: 'undated', time: Number.NaN }], { width: 500 })
    expect(p.get('undated')!.x).toBeGreaterThan(p.get('dated')!.x)
  })
})
