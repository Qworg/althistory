import type { GraphCalendar } from '@/types'
import { formatHistoricalDate, formatHistoricalTimestamp } from '@/utils/historicalTime'

/**
 * What a stored-date field's value reads as in a world calendar ("Mar 4,
 * 312 AR"), or null when there is no calendar or nothing readable to show.
 *
 * `value` is what a date field holds: a `datetime-local` value
 * (YYYY-MM-DDTHH:mm) or a `date` value (YYYY-MM-DD), both read as UTC, as the
 * forms read them.
 */
export function worldDateOf(value: string | null | undefined, calendar: GraphCalendar | null): string | null {
  if (!calendar || !value) return null
  const dateOnly = /^\d{4,}-\d{2}-\d{2}$/.test(value)
  const hasZone = /(Z|[+-]\d\d:\d\d)$/.test(value)
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : hasZone ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return null
  return dateOnly ? formatHistoricalDate(date, undefined, calendar) : formatHistoricalTimestamp(date, undefined, calendar)
}

/** An `aria-describedby` from the ids that apply, or undefined when none do. */
export function describedBy(...ids: Array<string | false | null | undefined>): string | undefined {
  const list = ids.filter((id): id is string => Boolean(id))
  return list.length > 0 ? list.join(' ') : undefined
}
