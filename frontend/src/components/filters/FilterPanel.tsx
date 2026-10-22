import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'

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
  className = ''
}: FilterPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()

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
    
    if (searchParams.get('startDate') && searchParams.get('endDate')) {
      urlFilters.dateRange = {
        start: searchParams.get('startDate')!,
        end: searchParams.get('endDate')!
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
    
    if (filters.dateRange) {
      newParams.set('startDate', filters.dateRange.start)
      newParams.set('endDate', filters.dateRange.end)
    }
    
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
    <div className={`bg-white border-l shadow-sm ${className}`}>
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h3 className="text-lg font-medium text-gray-900">Filters</h3>
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                {activeFilterCount}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Clear all
              </button>
            )}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label={isCollapsed ? 'Expand filters' : 'Collapse filters'}
            >
              <svg
                className={`w-5 h-5 transition-transform duration-200 ${
                  isCollapsed ? 'rotate-180' : ''
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-4 space-y-6 max-h-96 overflow-y-auto">
          {/* Search */}
          <div>
            <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-2">
              Search
            </label>
            <input
              type="text"
              id="search"
              value={filters.searchQuery}
              onChange={(e) => handleFilterChange('searchQuery', e.target.value)}
              placeholder="Search events, arcs, or descriptions..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Date Range */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Date Range
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="startDate" className="sr-only">Start date</label>
                <input
                  type="date"
                  id="startDate"
                  value={filters.dateRange?.start || ''}
                  onChange={(e) => handleFilterChange('dateRange', {
                    start: e.target.value,
                    end: filters.dateRange?.end || ''
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label htmlFor="endDate" className="sr-only">End date</label>
                <input
                  type="date"
                  id="endDate"
                  value={filters.dateRange?.end || ''}
                  onChange={(e) => handleFilterChange('dateRange', {
                    start: filters.dateRange?.start || '',
                    end: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Actors */}
          {availableActors.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Actors ({filters.actors.length} selected)
              </label>
              <div className="max-h-32 overflow-y-auto border border-gray-300 rounded-md">
                {availableActors.map((actor) => (
                  <label
                    key={actor}
                    className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={filters.actors.includes(actor)}
                      onChange={(e) => handleMultiSelectChange('actors', actor, e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-700">{actor}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Targets */}
          {availableTargets.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Targets ({filters.targets.length} selected)
              </label>
              <div className="max-h-32 overflow-y-auto border border-gray-300 rounded-md">
                {availableTargets.map((target) => (
                  <label
                    key={target}
                    className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={filters.targets.includes(target)}
                      onChange={(e) => handleMultiSelectChange('targets', target, e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-700">{target}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Confidence Threshold */}
          <div>
            <label htmlFor="confidence" className="block text-sm font-medium text-gray-700 mb-2">
              Confidence Threshold: {filters.confidenceThreshold.toFixed(2)}
            </label>
            <input
              type="range"
              id="confidence"
              min="0"
              max="1"
              step="0.01"
              value={filters.confidenceThreshold}
              onChange={(e) => handleFilterChange('confidenceThreshold', parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>0.00</span>
              <span>1.00</span>
            </div>
          </div>

          {/* Causal Weight Range */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
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
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
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
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Min: 0.00</span>
              <span>Max: 1.00</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
