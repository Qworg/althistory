import { create } from 'zustand'
import type { GraphCalendar } from '@/types'
import { isUsableCalendar, sameCalendar } from '@/utils/worldCalendar'

/**
 * The calendar of the graph on screen, or null when it has none.
 *
 * Why a store, read two ways:
 * - The date formatters (`utils/historicalTime.ts`, the axis labels in
 *   `utils/d3Calculations.ts`) are plain functions called from ~30 components,
 *   memoised D3 calculations and non-React helpers. They read the calendar
 *   synchronously with `getActiveCalendar()`, so none of their call sites has
 *   to thread it through.
 * - Reading module state does not re-render anything, so React subscribes with
 *   `useWorldCalendar()`. The views do not each subscribe: `MainLayout` wraps
 *   them in `WorldCalendarBoundary`, which is keyed by the calendar and so
 *   remounts them when it changes. That also recomputes every `useMemo` that
 *   baked a label in (tick labels, Cytoscape node labels), which a re-render
 *   alone would not. The calendar changes only on a graph switch (which
 *   replaces the data anyway) or a calendar edit, so the remount is rare.
 *   Components outside the boundary (the graph selector, the filter rail's
 *   inputs, the date hints in forms) subscribe with the hook themselves.
 *
 * `useWorldCalendarSync` (hooks/useWorldCalendar.ts) keeps it equal to the
 * active graph's calendar.
 */
interface WorldCalendarState {
  calendar: GraphCalendar | null
  setCalendar: (calendar: GraphCalendar | null | undefined) => void
}

export const useWorldCalendarStore = create<WorldCalendarState>()((set, get) => ({
  calendar: null,
  setCalendar: (calendar) => {
    const next = isUsableCalendar(calendar) ? calendar : null
    // Same labels, same object: an unchanged calendar must not remount the views.
    if (sameCalendar(get().calendar, next)) return
    set({ calendar: next })
  },
}))

/** The active calendar, for code outside React's render (formatters, D3 helpers). */
export function getActiveCalendar(): GraphCalendar | null {
  return useWorldCalendarStore.getState().calendar
}

/** The active calendar, re-rendering the caller when it changes. */
export function useWorldCalendar(): GraphCalendar | null {
  return useWorldCalendarStore((state) => state.calendar)
}

/** A string that changes exactly when the labels change: the boundary's key. */
export function calendarKey(calendar: GraphCalendar | null): string {
  if (!calendar) return 'gregorian'
  return `world:${calendar.epochYear}:${calendar.eraLabel?.trim() ?? ''}`
}
