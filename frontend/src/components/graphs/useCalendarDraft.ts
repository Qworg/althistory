import { useCallback, useMemo, useState } from 'react'
import type { GraphCalendar } from '@/types'
import {
  EMPTY_CALENDAR_DRAFT,
  calendarDraftErrors,
  calendarRequest,
  draftFromCalendar,
  type CalendarDraft,
  type CalendarDraftErrors,
} from '@/utils/worldCalendar'

/** The state of a graph form's "World calendar" section (see WorldCalendarFields). */
export interface CalendarDraftState {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  draft: CalendarDraft
  setField: (field: keyof CalendarDraft, value: string) => void
  /** The problems with the draft; empty while the section is off. */
  errors: CalendarDraftErrors
  /** True once the form tried to submit, so an empty epoch year is shown as missing. */
  submitted: boolean
  /** Whether the graph had a calendar when the form opened (so turning it off removes it). */
  hadCalendar: boolean
  /** Start over from a graph's calendar (or none). */
  reset: (calendar?: GraphCalendar | null) => void
  /**
   * What to send: a calendar to set, `null` to remove the graph's, `undefined`
   * to leave it alone. `ok: false` (and the errors shown) when it is invalid.
   */
  resolve: () => ReturnType<typeof calendarRequest>
}

export function useCalendarDraft(initial?: GraphCalendar | null): CalendarDraftState {
  const [original, setOriginal] = useState<GraphCalendar | null>(initial ?? null)
  const [enabled, setEnabled] = useState(Boolean(initial))
  const [draft, setDraft] = useState<CalendarDraft>(() => draftFromCalendar(initial))
  const [submitted, setSubmitted] = useState(false)

  const errors = useMemo(() => (enabled ? calendarDraftErrors(draft) : {}), [enabled, draft])

  const setField = useCallback((field: keyof CalendarDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }, [])

  const reset = useCallback((calendar?: GraphCalendar | null) => {
    setOriginal(calendar ?? null)
    setEnabled(Boolean(calendar))
    setDraft(calendar ? draftFromCalendar(calendar) : EMPTY_CALENDAR_DRAFT)
    setSubmitted(false)
  }, [])

  const resolve = useCallback(() => {
    setSubmitted(true)
    return calendarRequest(enabled, draft, original)
  }, [enabled, draft, original])

  return { enabled, setEnabled, draft, setField, errors, submitted, hadCalendar: original !== null, reset, resolve }
}
