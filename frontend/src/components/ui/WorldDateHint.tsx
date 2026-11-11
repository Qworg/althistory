import { useWorldCalendar } from '@/stores/worldCalendarStore'
import { formatHistoricalTimestamp } from '@/utils/historicalTime'

interface WorldDateHintProps {
  /** A `datetime-local` value (YYYY-MM-DDTHH:mm), read as UTC as the forms read it. */
  value: string
  id?: string
}

/**
 * Under a stored-date field, in a graph with a world calendar: the date the
 * value shows as ("= Mar 4, 312 AR"). The field itself takes the stored
 * (Gregorian) date; nothing is shown without a calendar or a readable value.
 */
export function WorldDateHint({ value, id }: WorldDateHintProps) {
  const calendar = useWorldCalendar()
  if (!calendar || !value) return null
  const hasZone = /(Z|[+-]\d\d:\d\d)$/.test(value)
  const date = new Date(hasZone ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return null
  return (
    <p id={id} className="mt-1 text-xs text-ink-muted">
      = {formatHistoricalTimestamp(date, undefined, calendar)}
    </p>
  )
}
