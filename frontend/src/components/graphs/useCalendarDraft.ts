import { useCallback, useMemo, useState } from 'react'
import type { GraphCalendar } from '@/types'
import {
  type WorldCalendarSet,
  type WorldDraft,
  type WorldDraftErrors,
  draftFromSet,
  newWorldDraft,
  readWorldDraft,
  sameCalendarSet,
  storedCalendarSet,
  worldDraftErrors,
} from '@althistory/calendar'

/** The state of a graph form's "World calendars" section (see WorldCalendarFields). */
export interface CalendarDraftState {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  draft: WorldDraft
  /** Change the draft: `change` returns the next one. */
  update: (change: (draft: WorldDraft) => WorldDraft) => void
  /** Replace the draft with a whole set (pasted as JSON, say). */
  replace: (set: WorldCalendarSet) => void
  /** The problems with the draft, by field (see `draftErrorAt`); empty while the section is off. */
  errors: WorldDraftErrors
  /** True once the form tried to submit, so an empty field is shown as missing. */
  submitted: boolean
  /** Whether the graph had a calendar when the form opened (so turning it off removes it). */
  hadCalendar: boolean
  /** Start over from a graph's calendars (or none). */
  reset: (calendar?: GraphCalendar | null) => void
  /**
   * What to send: a calendar set, `null` to remove the graph's, `undefined`
   * to leave it alone. `ok: false` (and the errors shown) when it is invalid.
   */
  resolve: () => { ok: true; calendar: WorldCalendarSet | null | undefined } | { ok: false }
}

function draftOf(calendar: GraphCalendar | null | undefined): WorldDraft {
  const set = storedCalendarSet(calendar)
  return set ? draftFromSet(set) : newWorldDraft()
}

export function useCalendarDraft(initial?: GraphCalendar | null): CalendarDraftState {
  const [original, setOriginal] = useState<GraphCalendar | null>(initial ?? null)
  const [enabled, setEnabled] = useState(Boolean(initial))
  const [draft, setDraft] = useState<WorldDraft>(() => draftOf(initial))
  const [submitted, setSubmitted] = useState(false)

  const errors = useMemo(() => (enabled ? worldDraftErrors(draft) : {}), [enabled, draft])

  const update = useCallback((change: (draft: WorldDraft) => WorldDraft) => setDraft(change), [])
  const replace = useCallback((set: WorldCalendarSet) => setDraft(draftFromSet(set)), [])

  const reset = useCallback((calendar?: GraphCalendar | null) => {
    setOriginal(calendar ?? null)
    setEnabled(Boolean(calendar))
    setDraft(draftOf(calendar))
    setSubmitted(false)
  }, [])

  const resolve = useCallback((): ReturnType<CalendarDraftState['resolve']> => {
    setSubmitted(true)
    if (!enabled) return { ok: true, calendar: original ? null : undefined }
    const read = readWorldDraft(draft)
    if (!read.ok) return { ok: false }
    return { ok: true, calendar: original && sameCalendarSet(original, read.set) ? undefined : read.set }
  }, [enabled, draft, original])

  return { enabled, setEnabled, draft, update, replace, errors, submitted, hadCalendar: original !== null, reset, resolve }
}
