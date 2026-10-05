import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFilters } from './useFilters'

describe('useFilters', () => {
  it('initializes with default filters', () => {
    const { result } = renderHook(() => useFilters())

    expect(result.current.filters).toEqual({
      dateRange: null,
      actors: [],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0,
      searchQuery: ''
    })
    expect(result.current.hasActiveFilters).toBe(false)
    expect(result.current.activeFilterCount).toBe(0)
  })

  it('initializes with provided initial filters', () => {
    const initialFilters = {
      searchQuery: 'test',
      actors: ['Actor 1']
    }

    const { result } = renderHook(() => useFilters(initialFilters))

    expect(result.current.filters.searchQuery).toBe('test')
    expect(result.current.filters.actors).toEqual(['Actor 1'])
    expect(result.current.hasActiveFilters).toBe(true)
    expect(result.current.activeFilterCount).toBe(2)
  })

  it('updates filters correctly', () => {
    const { result } = renderHook(() => useFilters())

    const newFilters = {
      ...result.current.filters,
      searchQuery: 'new search'
    }

    act(() => {
      result.current.updateFilters(newFilters)
    })

    expect(result.current.filters.searchQuery).toBe('new search')
  })

  it('updates individual filter correctly', () => {
    const { result } = renderHook(() => useFilters())

    act(() => {
      result.current.updateFilter('searchQuery', 'test search')
    })

    expect(result.current.filters.searchQuery).toBe('test search')
  })

  it('clears all filters', () => {
    const initialFilters = {
      searchQuery: 'test',
      actors: ['Actor 1'],
      confidenceThreshold: 0.5
    }

    const { result } = renderHook(() => useFilters(initialFilters))

    expect(result.current.hasActiveFilters).toBe(true)

    act(() => {
      result.current.clearFilters()
    })

    expect(result.current.filters).toEqual({
      dateRange: null,
      actors: [],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0,
      searchQuery: ''
    })
    expect(result.current.hasActiveFilters).toBe(false)
  })

  it('adds filter to array correctly', () => {
    const { result } = renderHook(() => useFilters())

    act(() => {
      result.current.addFilter('actors', 'Actor 1')
    })

    expect(result.current.filters.actors).toEqual(['Actor 1'])

    act(() => {
      result.current.addFilter('actors', 'Actor 2')
    })

    expect(result.current.filters.actors).toEqual(['Actor 1', 'Actor 2'])
  })

  it('removes filter from array correctly', () => {
    const initialFilters = {
      actors: ['Actor 1', 'Actor 2', 'Actor 3']
    }

    const { result } = renderHook(() => useFilters(initialFilters))

    act(() => {
      result.current.removeFilter('actors', 'Actor 2')
    })

    expect(result.current.filters.actors).toEqual(['Actor 1', 'Actor 3'])
  })

  it('calculates active filter count correctly', () => {
    const { result } = renderHook(() => useFilters())

    expect(result.current.activeFilterCount).toBe(0)

    act(() => {
      result.current.updateFilter('searchQuery', 'test')
    })

    expect(result.current.activeFilterCount).toBe(1)

    act(() => {
      result.current.updateFilter('dateRange', { start: '2022-01-01', end: '2022-12-31' })
    })

    expect(result.current.activeFilterCount).toBe(2)

    act(() => {
      result.current.addFilter('actors', 'Actor 1')
    })

    expect(result.current.activeFilterCount).toBe(3)
  })

  it('detects active filters correctly', () => {
    const { result } = renderHook(() => useFilters())

    expect(result.current.hasActiveFilters).toBe(false)

    act(() => {
      result.current.updateFilter('searchQuery', 'test')
    })

    expect(result.current.hasActiveFilters).toBe(true)

    act(() => {
      result.current.clearFilters()
    })

    expect(result.current.hasActiveFilters).toBe(false)
  })

  it('detects causal weight range changes as active filter', () => {
    const { result } = renderHook(() => useFilters())

    expect(result.current.hasActiveFilters).toBe(false)

    act(() => {
      result.current.updateFilter('causalWeightRange', [0.2, 1])
    })

    expect(result.current.hasActiveFilters).toBe(true)
    expect(result.current.activeFilterCount).toBe(1)

    act(() => {
      result.current.updateFilter('causalWeightRange', [0, 0.8])
    })

    expect(result.current.hasActiveFilters).toBe(true)
    expect(result.current.activeFilterCount).toBe(1)
  })

  it('detects confidence threshold changes as active filter', () => {
    const { result } = renderHook(() => useFilters())

    expect(result.current.hasActiveFilters).toBe(false)

    act(() => {
      result.current.updateFilter('confidenceThreshold', 0.5)
    })

    expect(result.current.hasActiveFilters).toBe(true)
    expect(result.current.activeFilterCount).toBe(1)
  })
})