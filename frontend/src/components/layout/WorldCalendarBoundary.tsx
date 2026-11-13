import { Fragment, type ReactNode } from 'react'
import { calendarKey, useWorldCalendar } from '@/stores/worldCalendarStore'

/**
 * Remounts its children when the active world calendar changes, so every date
 * under it -- including labels baked into memoised D3 and Cytoscape
 * calculations -- is formatted again in the new calendar. See the note in
 * stores/worldCalendarStore.ts for why a remount rather than a subscription in
 * each of the ~30 components that format dates. What a viewer is in the middle
 * of survives the remount: a view keeps its undo history (`useEditHistory`'s
 * `keepAs`) and its selection (`useKeptState`).
 */
export function WorldCalendarBoundary({ children }: { children: ReactNode }) {
  const calendar = useWorldCalendar()
  return <Fragment key={calendarKey(calendar)}>{children}</Fragment>
}
