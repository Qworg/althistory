import type { GraphCalendar } from '@/types'
import { formatHistoricalDate, historicalYear } from '@/utils/historicalTime'
import { axisTicks, isBareTime } from '@/utils/d3Calculations'
import { type InstantScale, usesArithmeticTicks } from '@/utils/timeScale'
import { type LabelAnchor, anchorInward, thinTickLabels } from '@/utils/axisLabelFit'
import { formatBoundAt } from '@althistory/calendar'

/** Advance of one character of the 12px monospace axis dates (0.6em). */
const TICK_CHAR_PX = 7.2
/** Clear space kept between two axis dates. */
const TICK_GAP_PX = 12

/**
 * Axis tick labels in the historical-date style used everywhere else. Ticks
 * that all fall on New Year's Day name the year alone; otherwise each tick is
 * a full UTC date ("May 10, 1940"), never shifted by the viewer's zone.
 */
export function formatTicks(dates: readonly Date[]): string[] {
  const allYearStarts = dates.every(
    d =>
      d.getUTCMonth() === 0 &&
      d.getUTCDate() === 1 &&
      d.getUTCHours() === 0 &&
      d.getUTCMinutes() === 0
  )
  // A set with any tick before 1 CE names its days as a person types them ("44-03-15 BCE"), as its years.
  const beforeCommonEra = dates.some(d => d.getUTCFullYear() <= 0)
  const labels = dates.map(d =>
    allYearStarts ? historicalYear(d, null) : beforeCommonEra ? formatBoundAt(d, 'day') : formatHistoricalDate(d, undefined, null)
  )
  // Ticks within a day would read the same: each names its UTC time too ("44-03-15 BCE 12:00").
  if (beforeCommonEra && new Set(labels).size !== labels.length) {
    return dates.map(d => `${formatBoundAt(d, 'day')} ${d.toISOString().slice(-13, -8)}`)
  }
  return labels
}

/**
 * The axis's ticks, labelled and fitted to the room. In a world calendar, its
 * own years, months and days, in its notation; beyond what a Date holds (or
 * before year -9999) the calendar package's; otherwise d3's, labelled by
 * {@link formatTicks}. d3 picks "nice" ticks for a count it treats as a hint,
 * so a narrow axis can get more than fit: an end date that would run off the
 * SVG is anchored inward, and ticks whose dates would overprint are thinned
 * to an even stride, keeping a date among times of day. A time of day
 * without a date names its day ("250000-03-15 BCE 13:00"), as the d3 path's
 * do.
 */
export function counterfactualAxisTicks(
  xScale: InstantScale,
  innerWidth: number,
  margin: { left: number; right: number },
  worldCalendar: GraphCalendar | null
): Array<{ date: Date; x: number; label: string; anchor: LabelAnchor }> {
  const count = Math.max(2, Math.min(6, Math.floor(innerWidth / 110)))
  const domain = xScale.domain()
  const ticks = worldCalendar || usesArithmeticTicks(domain[0]!, domain[domain.length - 1]!)
    ? axisTicks(domain, count, worldCalendar).map(({ date, label }) => ({
        date,
        label: !worldCalendar && isBareTime(label) ? `${formatBoundAt(date, 'day')} ${label}` : label,
      }))
    : (() => {
        const dates = xScale.ticks(count)
        const labels = formatTicks(dates)
        return dates.map((date, i) => ({ date, label: labels[i] ?? '' }))
      })()
  const placed = anchorInward(
    ticks.map(({ date, label }) => ({ date, x: xScale(date), label })),
    TICK_CHAR_PX,
    { left: -margin.left, right: innerWidth + margin.right }
  )
  return thinTickLabels(placed, { charPx: TICK_CHAR_PX, gapPx: TICK_GAP_PX })
}
