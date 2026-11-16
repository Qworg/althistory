import { describe, expect, it } from 'vitest'
import { readDateBound, toAxisTime } from '@althistory/calendar'
import { VAEL } from '@/test/fixtures/worldCalendars'
import { instantScale } from '@/utils/timeScale'
import { axisTicks } from '@/utils/d3Calculations'
import { labelExtent } from '@/utils/axisLabelFit'
import { counterfactualAxisTicks, counterfactualMargin, counterfactualTickCount, formatTicks } from './counterfactualAxis'

/**
 * What the canvas kept before: left to right, each tick whose centred date
 * cleared the last kept one by 12 px; then an end date that ran off the SVG
 * anchored inward, which could bring it within 12 px of its neighbour, or over it.
 */
function keptOnMain(
  ticks: ReadonlyArray<{ x: number; label: string }>,
  room: { left: number; right: number }
): { count: number; overprints: boolean; even: boolean } {
  const kept: Array<{ left: number; right: number }> = []
  const indices: number[] = []
  let lastRight = -Infinity
  for (const [index, tick] of ticks.entries()) {
    const half = (tick.label.length * 7.2) / 2
    if (tick.x - half < lastRight + 12) continue
    lastRight = tick.x + half
    indices.push(index)
    const width = half * 2
    kept.push(tick.x + half > room.right ? { left: tick.x - width, right: tick.x } : tick.x - half < room.left ? { left: tick.x, right: tick.x + width } : { left: tick.x - half, right: tick.x + half })
  }
  // Kept apart by its own 12 px, or not.
  return {
    count: kept.length,
    overprints: kept.some((extent, i) => i > 0 && extent.left < kept[i - 1]!.right + 12),
    even: new Set(indices.slice(1).map((index, i) => index - indices[i]!)).size <= 1,
  }
}

const domains: Array<[string, string]> = [
  ['1939-09-01T00:00:00Z', '1945-09-02T00:00:00Z'],
  ['1940-05-01T00:00:00Z', '1940-07-01T00:00:00Z'],
  ['1940-05-01T00:00:00Z', '1940-05-20T00:00:00Z'],
  ['1914-06-28T00:00:00Z', '1918-11-11T00:00:00Z'],
  ['1789-01-01T00:00:00Z', '1815-01-01T00:00:00Z'],
  ['1066-09-01T00:00:00Z', '1066-12-31T00:00:00Z'],
  ['1940-05-10T00:00:00Z', '1940-05-13T00:00:00Z'],
  ['1861-04-12T00:00:00Z', '1865-04-09T00:00:00Z'],
  ['1962-10-14T00:00:00Z', '1962-10-29T00:00:00Z'],
  ['1999-12-01T00:00:00Z', '2000-03-01T00:00:00Z'],
]

describe('the counterfactual axis on a real history', () => {
  it('keeps at least as many ticks as it did before, with even gaps between them', () => {
    for (const [a, b] of domains) {
      for (const width of [320, 400, 480, 560, 640, 760, 900, 1100]) {
        const margin = width < 560 ? { left: 96, right: 16 } : { left: 140, right: 32 }
        const innerWidth = Math.max(100, width - margin.left - margin.right)
        const xScale = instantScale(true).domain([new Date(a), new Date(b)]).range([0, innerWidth])
        const all = counterfactualAxisTicks(xScale, innerWidth, margin, null)
        // Before thinning: every tick d3 gave, with the same labels.
        const count = Math.max(2, Math.min(6, Math.floor(innerWidth / 110)))
        const dates = xScale.ticks(count)
        const labels = formatTicks(dates)
        const unthinned = dates.map((date, i) => ({ x: xScale(date), label: labels[i]! }))
        const where = `${a.slice(0, 10)}..${b.slice(0, 10)} at ${width}`
        // As many as before, where what was kept before had even gaps and kept its own 12 px.
        // (Where it did not, an even stride may keep fewer: 1940-05-01..20 at 1100 px kept
        // May 2, 4, 6, 8, 10, 14 and 18 before, and keeps May 2, 6, 10, 14 and 18 now.)
        const before = keptOnMain(unthinned, { left: -margin.left, right: innerWidth + margin.right })
        if (!before.overprints && before.even) {
          expect(all.length, `${where}: ${JSON.stringify(all.map((t) => t.label))} of ${JSON.stringify(labels)}`).toBeGreaterThanOrEqual(before.count)
        }
        const indices = all.map((tick) => dates.findIndex((date) => +date === +tick.date))
        const steps = new Set(indices.slice(1).map((index, i) => index - indices[i]!))
        expect(steps.size, `${where}: ${JSON.stringify(all.map((t) => t.label))}`).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('the counterfactual axis in a world calendar', () => {
  const worldDomains: Array<[string, string]> = [
    ['1000-01-01T00:00:00Z', '1300-01-01T00:00:00Z'],
    ['1200-03-01T00:00:00Z', '1201-03-01T00:00:00Z'],
    ['1200-03-01T00:00:00Z', '1200-05-01T00:00:00Z'],
    ['1200-03-01T00:00:00Z', '1200-03-09T00:00:00Z'],
    ['1200-03-01T06:00:00Z', '1200-03-02T06:00:00Z'],
    ['-000500-01-01T00:00:00Z', '0500-01-01T00:00:00Z'],
  ]

  it('keeps even gaps, no overprinting and labels that read back, at every width', () => {
    for (const [a, b] of worldDomains) {
      for (const width of [320, 400, 560, 760, 1100]) {
        const margin = width < 560 ? { left: 96, right: 16 } : { left: 140, right: 32 }
        const innerWidth = Math.max(100, width - margin.left - margin.right)
        const xScale = instantScale(true).domain([new Date(a), new Date(b)]).range([0, innerWidth])
        const where = `${a.slice(0, 10)}..${b.slice(0, 10)} at ${width}`
        const kept = counterfactualAxisTicks(xScale, innerWidth, margin, VAEL)
        expect(kept.length, where).toBeGreaterThan(0)
        const count = Math.max(2, Math.min(6, Math.floor(innerWidth / 110)))
        const all = axisTicks(xScale.domain(), count, VAEL)
        const indices = kept.map((tick) => all.findIndex((t) => +t.date === +tick.date))
        expect(indices.every((index) => index >= 0), where).toBe(true)
        expect(new Set(indices.slice(1).map((index, i) => index - indices[i]!)).size, where).toBeLessThanOrEqual(1)
        for (const [i, tick] of kept.entries()) {
          if (i > 0) expect(labelExtent(tick, 7.2)[0] - labelExtent(kept[i - 1]!, 7.2)[1], `${where} "${tick.label}"`).toBeGreaterThanOrEqual(12)
          expect(labelExtent(tick, 7.2)[0], where).toBeGreaterThanOrEqual(-margin.left - 0.5)
          expect(labelExtent(tick, 7.2)[1], where).toBeLessThanOrEqual(innerWidth + margin.right + 0.5)
          // A world's time of day alone ("12:00") names no day, as on the main axis; the rest read back.
          if (/^\d+:\d+/.test(tick.label)) continue
          const read = readDateBound(tick.label, 'start', VAEL)
          expect(read.ok && read.time, `${where} "${tick.label}"`).toBe(toAxisTime(tick.date))
        }
      }
    }
  })
})
