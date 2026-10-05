import React, { useState, useCallback, useEffect } from 'react'
import { TimeRange } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'

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
  
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Update local state when value changes
  useEffect(() => {
    if (value) {
      setStartDate(value.start.toISOString().slice(0, 16))
      setEndDate(value.end.toISOString().slice(0, 16))
    } else {
      setStartDate('')
      setEndDate('')
    }
  }, [value])

  // Calculate date range from events
  const eventDateRange = React.useMemo(() => {
    if (events.length === 0) return null
    
    const dates = events.map(e => new Date(e.timestamp))
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())))
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())))
    
    return { min: minDate, max: maxDate }
  }, [events])

  const handleDateChange = useCallback(() => {
    if (startDate && endDate) {
      const start = new Date(startDate)
      const end = new Date(endDate)
      
      if (start <= end) {
        onChange({ start, end })
      } else {
        // Swap dates if start is after end
        onChange({ start: end, end: start })
      }
    } else if (!startDate && !endDate) {
      onChange(null)
    }
  }, [startDate, endDate, onChange])

  // Apply date changes when inputs change
  useEffect(() => {
    handleDateChange()
  }, [handleDateChange])

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
          const midpoint = new Date((eventDateRange.min.getTime() + eventDateRange.max.getTime()) / 2)
          end = midpoint
        }
        break
      case 'second_half':
        {
          const midpoint2 = new Date((eventDateRange.min.getTime() + eventDateRange.max.getTime()) / 2)
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
    onChange(null)
  }, [onChange])

  const formatDateForDisplay = (date: Date) => {
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Date Inputs */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-1">
            Start Date & Time
          </label>
          <input
            id="startDate"
            type="datetime-local"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={disabled}
            min={eventDateRange?.min.toISOString().slice(0, 16)}
            max={eventDateRange?.max.toISOString().slice(0, 16)}
          />
        </div>
        <div>
          <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-1">
            End Date & Time
          </label>
          <input
            id="endDate"
            type="datetime-local"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={disabled}
            min={eventDateRange?.min.toISOString().slice(0, 16)}
            max={eventDateRange?.max.toISOString().slice(0, 16)}
          />
        </div>
      </div>

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
              className="text-blue-600 hover:text-blue-800 text-sm underline"
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
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Quick Presets
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handlePresetSelect('all_events')}
              className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              disabled={disabled}
            >
              All Events
            </button>
            <button
              onClick={() => handlePresetSelect('first_half')}
              className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              disabled={disabled}
            >
              First Half
            </button>
            <button
              onClick={() => handlePresetSelect('second_half')}
              className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              disabled={disabled}
            >
              Second Half
            </button>
            <button
              onClick={() => handlePresetSelect('last_year')}
              className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              disabled={disabled}
            >
              Last Year
            </button>
          </div>
        </div>
      )}

      {/* Data Range Info */}
      {eventDateRange && (
        <div className="text-xs text-gray-500 p-2 bg-gray-50 rounded">
          <strong>Available Data Range:</strong><br />
          {formatDateForDisplay(eventDateRange.min)} → {formatDateForDisplay(eventDateRange.max)}
          <br />
          <span className="text-gray-400">({events.length} events total)</span>
        </div>
      )}
    </div>
  )
}
