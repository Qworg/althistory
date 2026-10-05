import { useState, useCallback } from 'react'
import { FilterState } from '@/components/filters/FilterPanel'

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

export function useFilters(initialFilters: Partial<FilterState> = {}) {
  const [filters, setFilters] = useState<FilterState>({
    ...DEFAULT_FILTERS,
    ...initialFilters
  })

  const updateFilters = useCallback((newFilters: FilterState) => {
    setFilters(newFilters)
  }, [])

  const updateFilter = useCallback(<K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => {
    setFilters(prev => ({
      ...prev,
      [key]: value
    }))
  }, [])

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS)
  }, [])

  const addFilter = useCallback(<K extends keyof FilterState>(
    key: K,
    value: FilterState[K] extends Array<infer T> ? T : never
  ) => {
    setFilters(prev => {
      const currentValue = prev[key]
      if (Array.isArray(currentValue)) {
        return {
          ...prev,
          [key]: [...currentValue, value]
        }
      }
      return prev
    })
  }, [])

  const removeFilter = useCallback(<K extends keyof FilterState>(
    key: K,
    value: FilterState[K] extends Array<infer T> ? T : never
  ) => {
    setFilters(prev => {
      const currentValue = prev[key]
      if (Array.isArray(currentValue)) {
        return {
          ...prev,
          [key]: currentValue.filter(item => item !== value)
        }
      }
      return prev
    })
  }, [])

  const hasActiveFilters = useCallback(() => {
    return (
      filters.searchQuery !== '' ||
      filters.dateRange !== null ||
      filters.actors.length > 0 ||
      filters.targets.length > 0 ||
      filters.eventTypes.length > 0 ||
      filters.arcLevels.length > 0 ||
      filters.causalWeightRange[0] > 0 ||
      filters.causalWeightRange[1] < 1 ||
      filters.confidenceThreshold > 0
    )
  }, [filters])

  const getActiveFilterCount = useCallback(() => {
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
  }, [filters])

  return {
    filters,
    updateFilters,
    updateFilter,
    clearFilters,
    addFilter,
    removeFilter,
    hasActiveFilters: hasActiveFilters(),
    activeFilterCount: getActiveFilterCount()
  }
}