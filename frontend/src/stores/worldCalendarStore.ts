import { create } from 'zustand'
import { type WorldCalendarSet, storedCalendarSet } from '@althistory/calendar'

/**
 * The world calendars of the graph on screen, and the one its dates are shown in.
 *
 * Why a store, read two ways:
 * - The date formatters (`utils/historicalTime.ts`, the timeline axes) are
 *   plain functions called from ~30 components, memoised D3 calculations and
 *   non-React helpers. They read the calendar synchronously with
 *   `getActiveCalendar()`, so none of their call sites has to thread it
 *   through.
 * - Reading module state does not re-render anything, so React subscribes with
 *   `useWorldCalendar()`. The views do not each subscribe: `MainLayout` wraps
 *   them in `WorldCalendarBoundary`, which is keyed by the calendar and so
 *   remounts them when it changes, recomputing every `useMemo` that baked a
 *   label in. The calendar changes only on a graph switch, a calendar edit, or
 *   the viewer picking another of the world's calendars, so the remount is rare.
 *
 * What the formatters read is a *view*: the graph's set with the calendar the
 * viewer picked as its primary, so they always write dates in "the primary".
 *
 * `useWorldCalendarSync` (hooks/useWorldCalendar.ts) keeps it equal to the
 * active graph's calendar.
 */
interface WorldCalendarState {
  /** The graph's calendar set as read (either stored form), or null when it has none. */
  set: WorldCalendarSet | null
  /** The calendar the viewer picked to see dates in, or null for the set's own primary. */
  shown: string | null
  /** The view the formatters read: `set` with `shown` as its primary. */
  calendar: WorldCalendarSet | null
  /** The graph the calendars are, when known: the choice of calendar is that graph's. */
  owner: string | null
  /**
   * The open graph's calendars (either stored form). The calendar picked
   * stays picked while the same graph is open, and goes with it: another
   * world's calendar with the same id is not the same calendar.
   */
  setCalendar: (calendar: unknown, owner?: string | null) => void
  showCalendar: (id: string | null) => void
}

/** The set as the formatters see it: with the shown calendar (when it is one of the set's) as primary. */
function viewOf(set: WorldCalendarSet | null, shown: string | null): WorldCalendarSet | null {
  if (!set || !shown || shown === set.primary || !set.calendars.some((calendar) => calendar.id === shown)) return set
  return { ...set, primary: shown }
}

export const useWorldCalendarStore = create<WorldCalendarState>()((set, get) => ({
  set: null,
  shown: null,
  calendar: null,
  owner: null,
  setCalendar: (value, owner) => {
    const next = storedCalendarSet(value)
    const sameOwner = owner === undefined || owner === get().owner
    // Same graph and calendars, same object: an unchanged calendar must not remount the views.
    if (sameOwner && calendarKey(get().set) === calendarKey(next)) return
    const kept = sameOwner ? get().shown : null
    const shown = next && next.calendars.some((calendar) => calendar.id === kept) ? kept : null
    set({ set: next, shown, calendar: viewOf(next, shown), ...(owner !== undefined ? { owner } : {}) })
  },
  showCalendar: (id) => {
    const { set: current, shown } = get()
    if (id === shown) return
    set({ shown: id, calendar: viewOf(current, id) })
  },
}))

/** The active view, for code outside React's render (formatters, D3 helpers). */
export function getActiveCalendar(): WorldCalendarSet | null {
  return useWorldCalendarStore.getState().calendar
}

/** The active view, re-rendering the caller when it changes. */
export function useWorldCalendar(): WorldCalendarSet | null {
  return useWorldCalendarStore((state) => state.calendar)
}

/** A string that changes exactly when the dates shown change: the boundary's key. */
export function calendarKey(calendar: WorldCalendarSet | null): string {
  return calendar ? `world:${JSON.stringify(calendar)}` : 'gregorian'
}
