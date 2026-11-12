import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { HistoricalDateInput } from './HistoricalDateInput'
import { boundFromUrl, boundToUrl, readDateBound } from './filterUtils'
import { useWorldCalendar } from '@/stores/worldCalendarStore'
import { worldBoundExamples } from '@althistory/calendar'

export interface FilterState {
  dateRange: {
    start: string
    end: string
  } | null
  actors: string[]
  targets: string[]
  eventTypes: string[]
  arcLevels: number[]
  causalWeightRange: [number, number]
  confidenceThreshold: number
  searchQuery: string
}

interface FilterPanelProps {
  filters: FilterState
  onFiltersChange: (filters: FilterState) => void
  availableActors: string[]
  availableTargets: string[]
  timeRange: { start: string; end: string }
  hideSearch?: boolean
  /**
   * Replaces the built-in search field (e.g. with a SearchInterface that has
   * suggestions). Rendered at the top of the panel body.
   */
  search?: ReactNode
  /**
   * Closes the panel. When given, a Close button is shown in the header at
   * every breakpoint; it is the panel's only dismiss control.
   */
  onClose?: () => void
  className?: string
}

const DEFAULT_FILTERS: FilterState = {
  dateRange: null,
  actors: [],
  targets: [],
  eventTypes: [],
  arcLevels: [],
  causalWeightRange: [0, 1],
  confidenceThreshold: 0,
  searchQuery: ''
}

/** Actors and targets listed before "Show all". */
const LIST_PREVIEW = 8

export function FilterPanel({
  filters,
  onFiltersChange,
  availableActors = [],
  availableTargets = [],
  hideSearch = false,
  search,
  onClose,
  className = ''
}: FilterPanelProps) {
  const [showAll, setShowAll] = useState({ actors: false, targets: false })
  const [searchParams, setSearchParams] = useSearchParams()
  const dateHintId = useId()
  const worldCalendar = useWorldCalendar()

  // The URL -> filters sync below needs the *current* filters and callback, but
  // must stay keyed on `searchParams` alone: listing them would make every filter
  // change re-hydrate from the URL, which feeds straight back into
  // onFiltersChange. Refs keep the effect reading fresh values without changing
  // when it runs.
  const filtersRef = useRef(filters)
  const onFiltersChangeRef = useRef(onFiltersChange)
  const calendarRef = useRef(worldCalendar)

  useEffect(() => {
    filtersRef.current = filters
    onFiltersChangeRef.current = onFiltersChange
    calendarRef.current = worldCalendar
  }, [filters, onFiltersChange, worldCalendar])

  // Sync filters with URL parameters
  useEffect(() => {
    const urlFilters: Partial<FilterState> = {}
    
    if (searchParams.get('search')) {
      urlFilters.searchQuery = searchParams.get('search')!
    }
    
    if (searchParams.get('actors')) {
      urlFilters.actors = searchParams.get('actors')!.split(',')
    }
    
    if (searchParams.get('targets')) {
      urlFilters.targets = searchParams.get('targets')!.split(',')
    }
    
    if (searchParams.get('eventTypes')) {
      urlFilters.eventTypes = searchParams.get('eventTypes')!.split(',')
    }
    
    // Either bound alone is a filter (an open-ended range).
    if (searchParams.get('startDate') || searchParams.get('endDate')) {
      // In a world a link holds instants; the panel writes them in the calendar shown.
      urlFilters.dateRange = {
        start: boundFromUrl(searchParams.get('startDate') ?? '', 'start', calendarRef.current),
        end: boundFromUrl(searchParams.get('endDate') ?? '', 'end', calendarRef.current)
      }
    }
    
    if (searchParams.get('confidence')) {
      urlFilters.confidenceThreshold = parseFloat(searchParams.get('confidence')!)
    }
    
    if (Object.keys(urlFilters).length > 0) {
      onFiltersChangeRef.current({ ...filtersRef.current, ...urlFilters })
    }
  }, [searchParams])

  // Update URL when filters change
  useEffect(() => {
    const newParams = new URLSearchParams()
    
    if (filters.searchQuery) {
      newParams.set('search', filters.searchQuery)
    }
    
    if (filters.actors.length > 0) {
      newParams.set('actors', filters.actors.join(','))
    }
    
    if (filters.targets.length > 0) {
      newParams.set('targets', filters.targets.join(','))
    }
    
    if (filters.eventTypes.length > 0) {
      newParams.set('eventTypes', filters.eventTypes.join(','))
    }
    
    if (filters.dateRange?.start) newParams.set('startDate', boundToUrl(filters.dateRange.start, 'start', worldCalendar))
    if (filters.dateRange?.end) newParams.set('endDate', boundToUrl(filters.dateRange.end, 'end', worldCalendar))
    
    if (filters.confidenceThreshold > 0) {
      newParams.set('confidence', filters.confidenceThreshold.toString())
    }
    
    setSearchParams(newParams, { replace: true })
  }, [filters, setSearchParams, worldCalendar])

  const handleFilterChange = (key: keyof FilterState, value: unknown) => {
    onFiltersChange({
      ...filters,
      [key]: value
    })
  }

  const handleMultiSelectChange = (key: keyof FilterState, value: string, checked: boolean) => {
    const currentValues = filters[key] as string[]
    const newValues = checked
      ? [...currentValues, value]
      : currentValues.filter(v => v !== value)
    
    handleFilterChange(key, newValues)
  }

  /** One bound changed; with both bounds empty there is no date filter. */
  const handleDateBoundChange = (edge: 'start' | 'end', value: string) => {
    const start = edge === 'start' ? value : filters.dateRange?.start ?? ''
    const end = edge === 'end' ? value : filters.dateRange?.end ?? ''
    handleFilterChange('dateRange', start === '' && end === '' ? null : { start, end })
  }

  const startBound = filters.dateRange?.start ? readDateBound(filters.dateRange.start, 'start', worldCalendar) : null
  const endBound = filters.dateRange?.end ? readDateBound(filters.dateRange.end, 'end', worldCalendar) : null
  const examples = worldCalendar ? worldBoundExamples(worldCalendar) : null
  const dateRangeInverted =
    startBound?.ok === true && endBound?.ok === true && startBound.date.getTime() > endBound.date.getTime()

  const clearFilters = () => {
    onFiltersChange(DEFAULT_FILTERS)
  }

  const getActiveFilterCount = () => {
    let count = 0
    if (filters.searchQuery) count++
    if (filters.dateRange) count++
    if (filters.actors.length > 0) count++
    if (filters.targets.length > 0) count++
    if (filters.eventTypes.length > 0) count++
    if (filters.arcLevels.length > 0) count++
    if (filters.causalWeightRange[0] > 0 || filters.causalWeightRange[1] < 1) count++
    if (filters.confidenceThreshold > 0) count++
    return count
  }

  const activeFilterCount = getActiveFilterCount()

  return (
    <div className={`bg-card text-ink ${className}`}>
      <div className="p-4 border-b border-line">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h3 className="font-display text-xl font-semibold text-ink">Filters</h3>
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                {activeFilterCount}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-sm text-ink-muted hover:text-ink underline"
              >
                Clear all
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-md text-ink-muted hover:text-ink hover:bg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
                aria-label="Close filter panel"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6">
          {search}

          {/* Search (hidden when the parent supplies its own search) */}
          {!hideSearch && !search && (
            <div>
              <label htmlFor="search" className="block text-sm font-medium text-ink-secondary mb-2">
                Search
              </label>
              <input
                type="text"
                id="search"
                value={filters.searchQuery}
                onChange={(e) => handleFilterChange('searchQuery', e.target.value)}
                placeholder="Search events, arcs, or descriptions..."
                className="w-full px-3 py-2 border border-line rounded-md bg-card text-ink shadow-sm focus:outline-none focus:ring-2 focus:ring-selected focus:border-selected"
              />
            </div>
          )}

          {/* Date Range: typed, year first, so it reads the same in every
              locale and reaches BCE (a native date picker does neither). */}
          <fieldset>
            <legend className="block text-sm font-medium text-ink-secondary mb-2">
              Date Range
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <HistoricalDateInput
                id="startDate"
                label="Start date"
                edge="start"
                value={filters.dateRange?.start || ''}
                onCommit={(value) => handleDateBoundChange('start', value)}
                hintId={dateHintId}
                // A state, not an example: an example date in the empty field
                // read as a range already set. The examples are in the hint.
                placeholder="Any date"
              />
              <HistoricalDateInput
                id="endDate"
                label="End date"
                edge="end"
                value={filters.dateRange?.end || ''}
                onCommit={(value) => handleDateBoundChange('end', value)}
                hintId={dateHintId}
                placeholder="Any date"
              />
            </div>
            <p id={dateHintId} className="mt-1.5 text-xs text-ink-muted">
              {examples ? (
                <>
                  A year, month or day in this world’s calendar: {examples.year}, {examples.month}, {examples.day}.
                </>
              ) : (
                <>A year, year-month or full date, year first: 1843, 1843-11, 1843-11-20. Add BCE for earlier years (44 BCE).</>
              )}{' '}
              Each bound covers the whole period it names.
            </p>
            {dateRangeInverted && (
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300" role="status">
                The start is after the end, so no event matches.
              </p>
            )}
          </fieldset>

          {/* Actors */}
          {availableActors.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-2">
                Actors ({filters.actors.length} selected)
              </label>
              {/* No scroll box inside the scrolling panel: the first
                  {LIST_PREVIEW} and "Show all". */}
              <div className="border border-line rounded-md">
                {(showAll.actors ? availableActors : availableActors.slice(0, LIST_PREVIEW)).map((actor) => (
                  <label
                    key={actor}
                    className="flex items-center px-3 py-2 hover:bg-subtle cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={filters.actors.includes(actor)}
                      onChange={(e) => handleMultiSelectChange('actors', actor, e.target.checked)}
                      className="h-4 w-4 text-baseline focus:ring-selected border-line rounded"
                    />
                    <span className="ml-2 text-sm text-ink-secondary">{actor}</span>
                  </label>
                ))}
              </div>
              {availableActors.length > LIST_PREVIEW && (
                <button
                  type="button"
                  onClick={() => setShowAll((prev) => ({ ...prev, actors: !prev.actors }))}
                  className="mt-1 text-xs font-medium text-baseline hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected rounded-sm"
                >
                  {showAll.actors ? 'Show fewer' : `Show all ${availableActors.length}`}
                </button>
              )}
            </div>
          )}

          {/* Targets */}
          {availableTargets.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-2">
                Targets ({filters.targets.length} selected)
              </label>
              {/* No scroll box inside the scrolling panel: the first
                  {LIST_PREVIEW} and "Show all". */}
              <div className="border border-line rounded-md">
                {(showAll.targets ? availableTargets : availableTargets.slice(0, LIST_PREVIEW)).map((target) => (
                  <label
                    key={target}
                    className="flex items-center px-3 py-2 hover:bg-subtle cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={filters.targets.includes(target)}
                      onChange={(e) => handleMultiSelectChange('targets', target, e.target.checked)}
                      className="h-4 w-4 text-baseline focus:ring-selected border-line rounded"
                    />
                    <span className="ml-2 text-sm text-ink-secondary">{target}</span>
                  </label>
                ))}
              </div>
              {availableTargets.length > LIST_PREVIEW && (
                <button
                  type="button"
                  onClick={() => setShowAll((prev) => ({ ...prev, targets: !prev.targets }))}
                  className="mt-1 text-xs font-medium text-baseline hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected rounded-sm"
                >
                  {showAll.targets ? 'Show fewer' : `Show all ${availableTargets.length}`}
                </button>
              )}
            </div>
          )}

          {/* Minimum event confidence (distinct from the pressure panel's threshold) */}
          <div>
            <label htmlFor="confidence" className="block text-sm font-medium text-ink-secondary mb-2 tabular-nums">
              Minimum event confidence: {filters.confidenceThreshold.toFixed(2)}
            </label>
            <input
              type="range"
              id="confidence"
              min="0"
              max="1"
              step="0.01"
              value={filters.confidenceThreshold}
              onChange={(e) => handleFilterChange('confidenceThreshold', parseFloat(e.target.value))}
              className="w-full h-2 bg-subtle rounded-lg appearance-none cursor-pointer slider"
            />
            <div className="flex justify-between text-xs text-ink-muted mt-1 tabular-nums">
              <span>0.00</span>
              <span>1.00</span>
            </div>
          </div>

          {/* Link strength: one "at least this strong" slider, in the words
              the legend uses ("thicker = stronger"). Two stacked sliders for a
              minimum and a maximum asked for a choice no one makes: hiding
              the strongest links. A maximum set elsewhere still applies. */}
          <div>
            <label htmlFor="link-strength" className="block text-sm font-medium text-ink-secondary tabular-nums">
              Links at least this strong: <span className="font-mono-code">{filters.causalWeightRange[0].toFixed(2)}</span>
            </label>
            <p id="link-strength-hint" className="mb-2 text-xs text-ink-muted">How strongly a cause influences its effect, from 0 (negligible) to 1 (decisive).</p>
            <input
              id="link-strength"
              type="range"
              min="0"
              max="1"
              step="0.01"
              aria-describedby="link-strength-hint"
              value={filters.causalWeightRange[0]}
              onChange={(e) => handleFilterChange('causalWeightRange', [
                parseFloat(e.target.value),
                filters.causalWeightRange[1]
              ])}
              className="w-full h-2 bg-subtle rounded-lg appearance-none cursor-pointer slider"
            />
            <div className="flex justify-between text-xs text-ink-muted mt-1 tabular-nums">
              <span>all links</span>
              <span>only decisive</span>
            </div>
          </div>
        </div>
    </div>
  )
}
