import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActiveFilters } from './ActiveFilters'
import { FilterState } from './FilterPanel'

const mockProps = {
  onRemoveFilter: vi.fn(),
  onClearAll: vi.fn()
}

describe('ActiveFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when no filters are active', () => {
    const emptyFilters: FilterState = {
      dateRange: null,
      actors: [],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0,
      searchQuery: ''
    }

    const { container } = render(
      <ActiveFilters {...mockProps} filters={emptyFilters} />
    )

    expect(container.firstChild).toBeNull()
  })

  it('displays search query filter', () => {
    const filters: FilterState = {
      dateRange: null,
      actors: [],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0,
      searchQuery: 'test search'
    }

    render(<ActiveFilters {...mockProps} filters={filters} />)

    expect(screen.getByText('Search: "test search"')).toBeInTheDocument()
  })

  it('displays date range filter', () => {
    const filters: FilterState = {
      dateRange: { start: '2022-01-01', end: '2022-12-31' },
      actors: [],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0,
      searchQuery: ''
    }

    render(<ActiveFilters {...mockProps} filters={filters} />)

    expect(screen.getByText('Date: 2022-01-01 to 2022-12-31')).toBeInTheDocument()
  })

  it('displays partial date range filters', () => {
    const filtersStartOnly: FilterState = {
      dateRange: { start: '2022-01-01', end: '' },
      actors: [],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0,
      searchQuery: ''
    }

    render(<ActiveFilters {...mockProps} filters={filtersStartOnly} />)

    expect(screen.getByText('Date: from 2022-01-01')).toBeInTheDocument()
  })

  it('displays actor filters', () => {
    const filters: FilterState = {
      dateRange: null,
      actors: ['Actor 1', 'Actor 2'],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0,
      searchQuery: ''
    }

    render(<ActiveFilters {...mockProps} filters={filters} />)

    expect(screen.getByText('Actor: Actor 1')).toBeInTheDocument()
    expect(screen.getByText('Actor: Actor 2')).toBeInTheDocument()
  })

  it('displays target filters', () => {
    const filters: FilterState = {
      dateRange: null,
      actors: [],
      targets: ['Target 1'],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0,
      searchQuery: ''
    }

    render(<ActiveFilters {...mockProps} filters={filters} />)

    expect(screen.getByText('Target: Target 1')).toBeInTheDocument()
  })

  it('displays event type filters', () => {
    const filters: FilterState = {
      dateRange: null,
      actors: [],
      targets: [],
      eventTypes: ['Type A', 'Type B'],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0,
      searchQuery: ''
    }

    render(<ActiveFilters {...mockProps} filters={filters} />)

    expect(screen.getByText('Type: Type A')).toBeInTheDocument()
    expect(screen.getByText('Type: Type B')).toBeInTheDocument()
  })

  it('displays confidence threshold filter', () => {
    const filters: FilterState = {
      dateRange: null,
      actors: [],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0.75,
      searchQuery: ''
    }

    render(<ActiveFilters {...mockProps} filters={filters} />)

    expect(screen.getByText('Confidence: ≥0.75')).toBeInTheDocument()
  })

  it('displays causal weight range filter', () => {
    const filters: FilterState = {
      dateRange: null,
      actors: [],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0.2, 0.8],
      confidenceThreshold: 0,
      searchQuery: ''
    }

    render(<ActiveFilters {...mockProps} filters={filters} />)

    expect(screen.getByText('Weight: 0.20 - 0.80')).toBeInTheDocument()
  })

  it('calls onRemoveFilter when filter tag remove button is clicked', () => {
    const filters: FilterState = {
      dateRange: null,
      actors: ['Actor 1'],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0,
      searchQuery: 'test'
    }

    render(<ActiveFilters {...mockProps} filters={filters} />)

    const removeButtons = screen.getAllByLabelText(/Remove filter/)
    fireEvent.click(removeButtons[0]) // Remove search filter

    expect(mockProps.onRemoveFilter).toHaveBeenCalledWith('searchQuery')
  })

  it('calls onRemoveFilter with value for array filters', () => {
    const filters: FilterState = {
      dateRange: null,
      actors: ['Actor 1', 'Actor 2'],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0,
      searchQuery: ''
    }

    render(<ActiveFilters {...mockProps} filters={filters} />)

    const removeButton = screen.getByLabelText('Remove filter: Actor: Actor 1')
    fireEvent.click(removeButton)

    expect(mockProps.onRemoveFilter).toHaveBeenCalledWith('actors', 'Actor 1')
  })

  it('shows clear all button when multiple filters are active', () => {
    const filters: FilterState = {
      dateRange: null,
      actors: ['Actor 1'],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0,
      searchQuery: 'test'
    }

    render(<ActiveFilters {...mockProps} filters={filters} />)

    expect(screen.getByText('Clear all')).toBeInTheDocument()
  })

  it('calls onClearAll when clear all button is clicked', () => {
    const filters: FilterState = {
      dateRange: null,
      actors: ['Actor 1'],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0,
      searchQuery: 'test'
    }

    render(<ActiveFilters {...mockProps} filters={filters} />)

    const clearAllButton = screen.getByText('Clear all')
    fireEvent.click(clearAllButton)

    expect(mockProps.onClearAll).toHaveBeenCalled()
  })

  it('does not show clear all button with only one filter', () => {
    const filters: FilterState = {
      dateRange: null,
      actors: [],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0,
      searchQuery: 'test'
    }

    render(<ActiveFilters {...mockProps} filters={filters} />)

    expect(screen.queryByText('Clear all')).not.toBeInTheDocument()
  })

  it('has proper accessibility attributes', () => {
    const filters: FilterState = {
      dateRange: null,
      actors: ['Actor 1'],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1],
      confidenceThreshold: 0,
      searchQuery: ''
    }

    render(<ActiveFilters {...mockProps} filters={filters} />)

    const removeButton = screen.getByLabelText('Remove filter: Actor: Actor 1')
    expect(removeButton).toHaveAttribute('aria-label', 'Remove filter: Actor: Actor 1')
  })
})