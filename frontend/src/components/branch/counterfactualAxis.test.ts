import { describe, expect, it } from 'vitest'
import { instantScale } from '@/utils/timeScale'
import { counterfactualAxisTicks, formatTicks } from './counterfactualAxis'

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
