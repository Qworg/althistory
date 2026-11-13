import React, { useState, useCallback, useEffect, useRef } from 'react'
import { TimeRange } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'
import { formatHistoricalTimestamp } from '@/utils/historicalTime'
import { DateField } from '@/components/ui/DateField'
import { useWorldCalendar } from '@/stores/worldCalendarStore'
import { dateFieldIso, dateFieldValue } from '@/utils/dateField'
import { toInstant } from '@althistory/calendar'
import { instantOfMs } from '@/utils/timeScale'

interface TimeRangeSelectorProps {
  value: TimeRange | null
  onChange: (range: TimeRange | null) => void
  className?: string
  disabled?: boolean
  showPresets?: boolean
}

export const TimeRangeSelector: React.FC<TimeRangeSelectorProps> = ({
  value,
  onChange,
  className = '',
  disabled = false,
  showPresets = true
}) => {
  const { events } = useGlobalStore()
  // The open graph's world calendar, subscribed so the range and hints follow it.
  const worldCalendar = useWorldCalendar()
  
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [rangeError, setRangeError] = useState<string | null>(null)
  // The range these fields last sent: when it comes back as `value`, the
  // fields already say it, as typed, and are not written over.
  const sentRef = useRef<TimeRange | null | undefined>(undefined)
  const shownCalendarRef = useRef(worldCalendar)

  // Update local state when value changes: a UTC picker's value, or the
  // world's notation in the calendar shown.
  useEffect(() => {
    const calendarChanged = shownCalendarRef.current !== worldCalendar
    shownCalendarRef.current = worldCalendar
    if (!calendarChanged && value === sentRef.current) return
    sentRef.current = undefined
    setRangeError(null)
    if (value) {
      setStartDate(dateFieldValue(value.start, 'datetime', { calendar: worldCalendar, edge: 'start' }))
      setEndDate(dateFieldValue(value.end, 'datetime', { calendar: worldCalendar, edge: 'end' }))
    } else {
      setStartDate('')
      setEndDate('')
    }
  }, [value, worldCalendar])

  // Calculate date range from events
  const eventDateRange = React.useMemo(() => {
    if (events.length === 0) return null
    
    const dates = events.map(e => toInstant(e.timestamp))
    const minDate = instantOfMs(Math.min(...dates.map(d => d.getTime())))
    const maxDate = instantOfMs(Math.max(...dates.map(d => d.getTime())))
    
    return { min: minDate, max: maxDate }
  }, [events])

  // Sent when the user changes a field, never when the fields are filled
  // from `value` (which would send it straight back).
  const send = useCallback((range: TimeRange | null) => {
    sentRef.current = range
    onChange(range)
  }, [onChange])

  const commit = useCallback((startText: string, endText: string) => {
    setRangeError(null)
    if (startText && endText) {
      // The fields hold UTC wall-clock times, as every historical date is
      // (read in the browser's zone they moved by its offset on each round
      // trip through `value`), or dates in the world's notation. A value
      // that is not a real date sends no range, rather than an invalid one
      // or (in Chrome) the day it rolls over into.
      const startIso = dateFieldIso(startText, { calendar: worldCalendar, edge: 'start' })
      const endIso = dateFieldIso(endText, { calendar: worldCalendar, edge: 'end' })
      if (!startIso || !endIso) return
      const start = toInstant(startIso)
      const end = toInstant(endIso)
      // Each field names its own edge (a start's first moment, an end's
      // last), so a reversed range is said, not swapped: the user may be
      // part-way through typing the end.
      if (start > end) {
        setRangeError('The end is before the start.')
        return
      }
      send({ start, end })
    } else if (!startText && !endText) {
      send(null)
    }
  }, [send, worldCalendar])

  const handlePresetSelect = useCallback((preset: string) => {
    if (!eventDateRange) return

    const now = new Date()
    let start: Date
    let end: Date = now

    switch (preset) {
      case 'last_week':
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'last_month':
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case 'last_year':
        start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        break
      case 'all_events':
        start = eventDateRange.min
        end = eventDateRange.max
        break
      case 'first_half':
        start = eventDateRange.min
        {
          const midpoint = instantOfMs((eventDateRange.min.getTime() + eventDateRange.max.getTime()) / 2)
          end = midpoint
        }
        break
      case 'second_half':
        {
          const midpoint2 = instantOfMs((eventDateRange.min.getTime() + eventDateRange.max.getTime()) / 2)
          start = midpoint2
        }
        end = eventDateRange.max
        break
      default:
        return
    }

    onChange({ start, end })
  }, [eventDateRange, onChange])

  const handleClear = useCallback(() => {
    setStartDate('')
    setEndDate('')
    setRangeError(null)
    onChange(null)
  }, [onChange])

  // A historical range: in UTC, and in the graph's world calendar when it has one.
  const formatDateForDisplay = (date: Date) => formatHistoricalTimestamp(date, undefined, worldCalendar)

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Date Inputs */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="startDate" className="block text-sm font-medium text-ink-secondary mb-1">
            Start Date & Time
          </label>
          <DateField
            id="startDate"
            kind="datetime"
            edge="start"
            value={startDate}
            onChange={(text) => {
              setStartDate(text)
              commit(text, endDate)
            }}
            aria-describedby={rangeError ? 'timeRangeError' : undefined}
            className="w-full px-3 py-2 border border-line bg-card text-ink rounded-md focus:outline-none focus:ring-2 focus:ring-selected focus:border-transparent"
            disabled={disabled}
            min={eventDateRange?.min.toISOString().slice(0, 16)}
            max={eventDateRange?.max.toISOString().slice(0, 16)}
          />
        </div>
        <div>
          <label htmlFor="endDate" className="block text-sm font-medium text-ink-secondary mb-1">
            End Date & Time
          </label>
          <DateField
            id="endDate"
            kind="datetime"
            edge="end"
            value={endDate}
            onChange={(text) => {
              setEndDate(text)
              commit(startDate, text)
            }}
            aria-invalid={rangeError ? true : undefined}
            aria-describedby={rangeError ? 'timeRangeError' : undefined}
            className="w-full px-3 py-2 border border-line bg-card text-ink rounded-md focus:outline-none focus:ring-2 focus:ring-selected focus:border-transparent"
            disabled={disabled}
            min={eventDateRange?.min.toISOString().slice(0, 16)}
            max={eventDateRange?.max.toISOString().slice(0, 16)}
          />
        </div>
      </div>

      {rangeError && (
        <p id="timeRangeError" role="alert" className="text-sm text-red-600 dark:text-red-400">
          {rangeError}
        </p>
      )}

      {/* Current Selection Display */}
      {value && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex justify-between items-center">
            <div className="text-sm text-blue-800">
              <strong>Selected Range:</strong><br />
              {formatDateForDisplay(value.start)} → {formatDateForDisplay(value.end)}
            </div>
            <button
              onClick={handleClear}
              className="text-baseline hover:text-blue-800 text-sm underline"
              disabled={disabled}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Preset Buttons */}
      {showPresets && eventDateRange && (
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-2">
            Quick Presets
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handlePresetSelect('all_events')}
              className="px-3 py-2 text-sm bg-subtle text-ink-secondary hover:text-ink hover:bg-line rounded-md transition-colors"
              disabled={disabled}
            >
              All Events
            </button>
            <button
              onClick={() => handlePresetSelect('first_half')}
              className="px-3 py-2 text-sm bg-subtle text-ink-secondary hover:text-ink hover:bg-line rounded-md transition-colors"
              disabled={disabled}
            >
              First Half
            </button>
            <button
              onClick={() => handlePresetSelect('second_half')}
              className="px-3 py-2 text-sm bg-subtle text-ink-secondary hover:text-ink hover:bg-line rounded-md transition-colors"
              disabled={disabled}
            >
              Second Half
            </button>
            <button
              onClick={() => handlePresetSelect('last_year')}
              className="px-3 py-2 text-sm bg-subtle text-ink-secondary hover:text-ink hover:bg-line rounded-md transition-colors"
              disabled={disabled}
            >
              Last Year
            </button>
          </div>
        </div>
      )}

      {/* Data Range Info */}
      {eventDateRange && (
        <div className="text-xs text-ink-muted p-2 bg-subtle rounded">
          <strong>Available Data Range:</strong><br />
          {formatDateForDisplay(eventDateRange.min)} → {formatDateForDisplay(eventDateRange.max)}
          <br />
          <span className="text-ink-muted">({events.length} events total)</span>
        </div>
      )}
    </div>
  )
}
