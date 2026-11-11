import { useWorldCalendar } from '@/stores/worldCalendarStore'
import { worldDateOf } from '@/utils/worldDateHint'

interface WorldDateHintProps {
  /** A `datetime-local` or `date` value, read as UTC as the forms read it. */
  value: string
  /**
   * The hint's id. The field names it in `aria-describedby` when the hint is
   * shown: `describedBy(…, worldDateOf(value, calendar) && id)`.
   */
  id: string
}

/**
 * Under a stored-date field, in a graph with a world calendar: the date the
 * value shows as ("= Mar 4, 312 AR"). The field itself takes the stored
 * (Gregorian) date; nothing is shown without a calendar or a readable value.
 */
export function WorldDateHint({ value, id }: WorldDateHintProps) {
  const world = worldDateOf(value, useWorldCalendar())
  if (!world) return null
  return (
    <p id={id} className="mt-1 text-xs text-ink-muted">
      = {world}
    </p>
  )
}
