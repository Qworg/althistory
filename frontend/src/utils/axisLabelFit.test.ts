import { describe, expect, it } from 'vitest'
import { thinTickLabels } from './axisLabelFit'

const LONG = '9000-03-01 BCE' // 14 characters: 100.8 px at 7.2 px each
const fit = { charPx: 7.2, gapPx: 4 }

const overprints = (ticks: ReadonlyArray<{ x: number; label: string }>) =>
  ticks.some((tick, i) => i > 0 && tick.x - ticks[i - 1]!.x < ((tick.label.length + ticks[i - 1]!.label.length) * fit.charPx) / 2 + fit.gapPx)

describe('thinning tick labels that would overprint', () => {
  it('keeps the first and the last tick, and a regular stride between them', () => {
    const ticks = Array.from({ length: 14 }, (_, i) => ({ x: i * 87, label: LONG }))
    const kept = thinTickLabels(ticks, fit)
    expect(kept[0]).toBe(ticks[0])
    expect(kept[kept.length - 1]).toBe(ticks[13])
    expect(overprints(kept)).toBe(false)
    const indices = kept.map((tick) => ticks.indexOf(tick))
    const steps = indices.slice(1).map((index, i) => index - indices[i]!)
    // Every step the same, but the last, which reaches the end in less than two.
    expect(new Set(steps.slice(0, -1)).size).toBeLessThanOrEqual(1)
    expect(steps[steps.length - 1]!).toBeLessThan(2 * steps[0]!)
  })

  it('keeps the last tick where keeping from the left alone would drop it', () => {
    const ticks = [
      { x: 0, label: '44-03-01 BCE' },
      { x: 100, label: '44-03-02 BCE' },
      { x: 150, label: '44-03-03 BCE' },
    ]
    expect(thinTickLabels(ticks, fit)).toEqual([ticks[0], ticks[2]])
  })

  it('keeps every tick that fits, two that fit, and one only when two cannot', () => {
    const roomy = [0, 200, 400].map((x) => ({ x, label: LONG }))
    expect(thinTickLabels(roomy, fit)).toEqual(roomy)
    const two = [0, 60, 120].map((x) => ({ x, label: LONG }))
    expect(thinTickLabels(two, fit)).toEqual([two[0], two[2]])
    const cramped = [
      { x: 0, label: LONG },
      { x: 50, label: LONG },
    ]
    expect(thinTickLabels(cramped, fit)).toEqual([cramped[0]])
    expect(thinTickLabels([], fit)).toEqual([])
  })
})
