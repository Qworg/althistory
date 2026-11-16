import { describe, expect, it } from 'vitest'
import { anchorInward, labelExtent, thinTickLabels } from './axisLabelFit'

const LONG = '9000-03-01 BCE' // 14 characters: 100.8 px at 7.2 px each
const fit = { charPx: 7.2, gapPx: 4 }

const overprints = (ticks: ReadonlyArray<{ x: number; label: string; anchor?: 'start' | 'middle' | 'end' }>) =>
  ticks.some((tick, i) => i > 0 && labelExtent(tick, fit.charPx)[0] - labelExtent(ticks[i - 1]!, fit.charPx)[1] < fit.gapPx)

const stepsOf = <T,>(all: readonly T[], kept: readonly T[]) => {
  const indices = kept.map((tick) => all.indexOf(tick))
  return indices.slice(1).map((index, i) => index - indices[i]!)
}

describe('thinning tick labels that would overprint', () => {
  it('keeps a regular stride from the first tick, so the gaps stay even', () => {
    const ticks = Array.from({ length: 14 }, (_, i) => ({ x: i * 87, label: LONG }))
    const kept = thinTickLabels(ticks, fit)
    expect(kept[0]).toBe(ticks[0])
    expect(overprints(kept)).toBe(false)
    expect(new Set(stepsOf(ticks, kept)).size).toBe(1)
  })

  it('drops the last tick when it crowds its neighbour, keeping the stride, while two remain', () => {
    const ticks = [
      { x: 0, label: '44-03-01 BCE' },
      { x: 100, label: '44-03-02 BCE' },
      { x: 150, label: '44-03-03 BCE' },
    ]
    expect(thinTickLabels(ticks, fit)).toEqual([ticks[0], ticks[1]])
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

  it('always keeps a tick that must stay, counting the stride from it', () => {
    const labels = ['23:57:30', '23:58:00', '23:58:30', '23:59:00', '23:59:30', '44-03-15 BCE', '00:00:30', '00:01:00', '00:01:30', '00:02:00']
    const ticks = labels.map((label, i) => ({ x: i * 50, label }))
    const kept = thinTickLabels(ticks, fit, (tick) => tick.label.includes('BCE'))
    expect(kept).toContain(ticks[5])
    expect(overprints(kept)).toBe(false)
    expect(new Set(stepsOf(ticks, kept)).size).toBe(1)
  })

  it('measures a label anchored inward from its tick, not around it', () => {
    const ticks = anchorInward([{ x: 0, label: LONG }, { x: 80, label: '12:00' }, { x: 300, label: LONG }], fit.charPx, { left: -40, right: 316 })
    expect(ticks.map((tick) => tick.anchor)).toEqual(['start', 'middle', 'end'])
    expect(labelExtent(ticks[0]!, fit.charPx)).toEqual([0, 100.8])
    // Centred, the first label would end at 50 and leave room for the second; anchored, it reaches 100.8 and does not.
    const kept = thinTickLabels(ticks, fit)
    expect(overprints(kept)).toBe(false)
    expect(kept).toHaveLength(2)
    expect(kept.includes(ticks[0]!) && kept.includes(ticks[1]!)).toBe(false)
  })
})
