import { describe, it, expect } from 'vitest'
import { timeOrderPositions, timeOrderPositionsForViewport } from './timeOrderLayout'

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

describe('timeOrderPositionsForViewport', () => {
  // Nineteen events clustered as the demo's are: bunches a few years apart.
  const nodes = Array.from({ length: 19 }, (_, i) => ({ id: `e${i}`, time: Math.floor(i / 3) * 5 + (i % 3) }))
  const aspectOf = (p: Map<string, { x: number; y: number }>) => {
    const xs = [...p.values()].map((v) => v.x)
    const ys = [...p.values()].map((v) => v.y)
    return (Math.max(...xs) - Math.min(...xs) + 150) / (Math.max(...ys) - Math.min(...ys) + 96)
  }

  it('shapes the graph toward a wide canvas and toward a tall one', () => {
    const wide = timeOrderPositionsForViewport(nodes, { width: 1000, height: 560 })
    const tall = timeOrderPositionsForViewport(nodes, { width: 360, height: 640 })
    expect(aspectOf(wide)).toBeGreaterThan(aspectOf(tall))
    expect(aspectOf(wide)).toBeGreaterThan(1.2)
    expect(aspectOf(tall)).toBeLessThan(1.2)
  })

  it('never spreads wider than the fit can show at a legible label size', () => {
    const p = timeOrderPositionsForViewport(nodes, { width: 600, height: 100 })
    const xs = [...p.values()].map((v) => v.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(600 / 0.6)
  })

  it('keeps causes left of effects whatever the shape', () => {
    const p = timeOrderPositionsForViewport(nodes, { width: 360, height: 640 })
    for (let i = 1; i < nodes.length; i++) {
      if (nodes[i]!.time > nodes[i - 1]!.time) expect(p.get(`e${i}`)!.x).toBeGreaterThan(p.get(`e${i - 1}`)!.x)
    }
  })
})
