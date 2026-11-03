import { describe, it, expect } from 'vitest'
import { tooltipPlacement } from './tooltipPlacement'

const margin = { left: 56, top: 16 }

describe('tooltipPlacement', () => {
  it('opens an event tooltip above its mark, so it never covers the time axis below', () => {
    const style = tooltipPlacement({ kind: 'event', x: 100, y: 200 }, margin, 1000)
    expect(style.transform).toBe('translateY(-100%)')
    expect(style.top).toBe(16 + 200 - 14)
  })

  it('opens an arc tooltip below the arc bar (arcs sit at the top of the plot)', () => {
    const style = tooltipPlacement({ kind: 'arc', x: 100, y: 10 }, margin, 1000)
    expect(style.transform).toBeUndefined()
    expect(style.top).toBe(16 + 10 + 22)
  })

  it('anchors by the left edge in the left half and by the right edge in the right half', () => {
    expect(tooltipPlacement({ kind: 'event', x: 100, y: 200 }, margin, 1000)).toMatchObject({ left: 56 + 100 + 8 })
    const right = tooltipPlacement({ kind: 'event', x: 800, y: 200 }, margin, 1000)
    expect(right.left).toBeUndefined()
    expect(right.right).toBe(1000 - (56 + 800) + 8)
  })
})
