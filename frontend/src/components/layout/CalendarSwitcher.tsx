import { useId } from 'react'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'

/**
 * Which of a world's calendars its dates are shown in, when it keeps more
 * than one (docs/specs/world-calendars.md, Req 11): every date on screen,
 * the timeline's axis and the date fields follow it. Nothing is shown for a
 * graph with one calendar or none.
 */
export function CalendarSwitcher({ className = '' }: { className?: string }) {
  const set = useWorldCalendarStore((state) => state.set)
  const shown = useWorldCalendarStore((state) => state.calendar?.primary ?? null)
  const showCalendar = useWorldCalendarStore((state) => state.showCalendar)
  const id = useId()
  if (!set || set.calendars.length < 2) return null
  return (
    <div className={`flex items-center gap-1.5 min-w-0 ${className}`}>
      <label htmlFor={id} className="text-xs text-ink-muted whitespace-nowrap">
        Calendar
      </label>
      <select
        id={id}
        value={shown ?? set.primary}
        onChange={(event) => showCalendar(event.target.value === set.primary ? null : event.target.value)}
        className="min-w-0 max-w-[12rem] truncate rounded-md border border-line bg-card px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-selected"
      >
        {set.calendars.map((calendar) => (
          <option key={calendar.id} value={calendar.id}>
            {calendar.name}
          </option>
        ))}
      </select>
    </div>
  )
}
