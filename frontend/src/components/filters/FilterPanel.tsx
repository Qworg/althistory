import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { HistoricalDateInput } from './HistoricalDateInput'
import { parseHistoricalDate } from './filterUtils'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const dateHintId = useId()

  // The URL -> filters sync below needs the *current* filters and callback, but
  // must stay keyed on `searchParams` alone: listing them would make every filter
  // change re-hydrate from the URL, which feeds straight back into
  // onFiltersChange. Refs keep the effect reading fresh values without changing
  // when it runs.
  const filtersRef = useRef(filters)
  const onFiltersChangeRef = useRef(onFiltersChange)

  useEffect(() => {
    filtersRef.current = filters
    onFiltersChangeRef.current = onFiltersChange
  }, [filters, onFiltersChange])

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
      urlFilters.dateRange = {
        start: searchParams.get('startDate') ?? '',
        end: searchParams.get('endDate') ?? ''
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
    
    if (filters.dateRange?.start) newParams.set('startDate', filters.dateRange.start)
    if (filters.dateRange?.end) newParams.set('endDate', filters.dateRange.end)
    
    if (filters.confidenceThreshold > 0) {
      newParams.set('confidence', filters.confidenceThreshold.toString())
    }
    
    setSearchParams(newParams, { replace: true })
  }, [filters, setSearchParams])

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

  const startBound = filters.dateRange?.start ? parseHistoricalDate(filters.dateRange.start, 'start') : null
  const endBound = filters.dateRange?.end ? parseHistoricalDate(filters.dateRange.end, 'end') : null
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
                className="p-1 rounded-md text-ink-muted hover:text-ink hover:bg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
                className="w-full px-3 py-2 border border-line rounded-md bg-card text-ink shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                placeholder="1843"
              />
              <HistoricalDateInput
                id="endDate"
                label="End date"
                edge="end"
                value={filters.dateRange?.end || ''}
                onCommit={(value) => handleDateBoundChange('end', value)}
                hintId={dateHintId}
                placeholder="1843-11-20"
              />
            </div>
            <p id={dateHintId} className="mt-1.5 text-xs text-ink-muted">
              A year, year-month or full date, year first: 1843, 1843-11, 1843-11-20. Add BCE for earlier years (44 BCE). Each bound covers the whole period it names.
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
              <div className="max-h-32 overflow-y-auto border border-line rounded-md">
                {availableActors.map((actor) => (
                  <label
                    key={actor}
                    className="flex items-center px-3 py-2 hover:bg-subtle cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={filters.actors.includes(actor)}
                      onChange={(e) => handleMultiSelectChange('actors', actor, e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-line rounded"
                    />
                    <span className="ml-2 text-sm text-ink-secondary">{actor}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Targets */}
          {availableTargets.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-2">
                Targets ({filters.targets.length} selected)
              </label>
              <div className="max-h-32 overflow-y-auto border border-line rounded-md">
                {availableTargets.map((target) => (
                  <label
                    key={target}
                    className="flex items-center px-3 py-2 hover:bg-subtle cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={filters.targets.includes(target)}
                      onChange={(e) => handleMultiSelectChange('targets', target, e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-line rounded"
                    />
                    <span className="ml-2 text-sm text-ink-secondary">{target}</span>
                  </label>
                ))}
              </div>
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

          {/* Causal Weight Range */}
          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-2 tabular-nums">
              Causal Weight Range: {filters.causalWeightRange[0].toFixed(2)} - {filters.causalWeightRange[1].toFixed(2)}
            </label>
            <div className="space-y-2">
              <input
                type="range"
                aria-label="Minimum causal weight"
                min="0"
                max="1"
                step="0.01"
                value={filters.causalWeightRange[0]}
                onChange={(e) => handleFilterChange('causalWeightRange', [
                  parseFloat(e.target.value),
                  filters.causalWeightRange[1]
                ])}
                className="w-full h-2 bg-subtle rounded-lg appearance-none cursor-pointer slider"
              />
              <input
                type="range"
                aria-label="Maximum causal weight"
                min="0"
                max="1"
                step="0.01"
                value={filters.causalWeightRange[1]}
                onChange={(e) => handleFilterChange('causalWeightRange', [
                  filters.causalWeightRange[0],
                  parseFloat(e.target.value)
                ])}
                className="w-full h-2 bg-subtle rounded-lg appearance-none cursor-pointer slider"
              />
            </div>
            <div className="flex justify-between text-xs text-ink-muted mt-1 tabular-nums">
              <span>Min: 0.00</span>
              <span>Max: 1.00</span>
            </div>
          </div>
        </div>
    </div>
  )
}
