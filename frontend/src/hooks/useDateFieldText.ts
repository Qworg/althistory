import { useCallback, useRef } from 'react'
import { type DateBoundEdge, isoOfAxisTime, toAxisTime } from '@althistory/calendar'
import type { GraphCalendar } from '@/types'
import { useWorldCalendar } from '@/stores/worldCalendarStore'
import { type DateFieldKind, dateFieldIso, dateFieldValue } from '@/utils/dateField'

type Shown = { text: string; iso: string } | null

/**
 * The text of a form's date fields, for the world calendar shown.
 *
 * A field's text names a whole day (or minute) in the calendar shown, not the
 * instant it was filled from: an arc that ends a second before a day's end
 * shows as that day. So a field left as it was shown sends the instant it was
 * filled from, and only an edited field is read. When another calendar is
 * shown, `takeSwitch` says which calendar the fields were written in, and
 * `rewrite` writes each in the new one (an edited field by what it read as).
 */
export function useDateFieldText(kind: DateFieldKind) {
  const calendar = useWorldCalendar()
  const fieldCalendar = useRef<GraphCalendar | null>(calendar)
  const shown = useRef<Record<DateBoundEdge, Shown>>({ start: null, end: null })

  /** The field's text for an instant, remembered as shown. */
  const fill = useCallback(
    (iso: string | Date | null | undefined, edge: DateBoundEdge): string => {
      const text = dateFieldValue(iso, kind, { calendar: fieldCalendar.current, edge })
      const time = iso === null || iso === undefined || iso === '' ? null : toAxisTime(iso)
      shown.current[edge] = text && time !== null ? { text, iso: isoOfAxisTime(time) } : null
      return text
    },
    [kind]
  )

  /** The instant to send: the one the field was filled from while it is unchanged. '' when it names none. */
  const toIso = useCallback((text: string, edge: DateBoundEdge): string => {
    const was = shown.current[edge]
    if (was && was.text === text) return was.iso
    return dateFieldIso(text, { calendar: fieldCalendar.current, edge })
  }, [])

  /** When the calendar shown has changed since the fields were written: the one they were written in. */
  const takeSwitch = useCallback((): { from: GraphCalendar | null } | null => {
    if (fieldCalendar.current === calendar) return null
    const from = fieldCalendar.current
    fieldCalendar.current = calendar
    return { from }
  }, [calendar])

  /** A field's text in the calendar now shown (see `takeSwitch`). */
  const rewrite = useCallback(
    (text: string, edge: DateBoundEdge, from: GraphCalendar | null): string => {
      const was = shown.current[edge]
      if (was && was.text === text) return fill(was.iso, edge)
      const iso = dateFieldIso(text, { calendar: from, edge })
      return iso ? dateFieldValue(iso, kind, { calendar: fieldCalendar.current, edge }) : text
    },
    [fill, kind]
  )

  return { calendar, fill, toIso, takeSwitch, rewrite }
}
