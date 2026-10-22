import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { BrowserRouter } from 'react-router'
import { FilterPanel, FilterState } from './FilterPanel'

const mockFilters: FilterState = {
  dateRange: null,
  actors: [],
  targets: [],
  eventTypes: [],
  arcLevels: [],
  causalWeightRange: [0, 1],
  confidenceThreshold: 0,
  searchQuery: ''
}

const mockProps = {
  filters: mockFilters,
  onFiltersChange: vi.fn(),
  availableActors: ['Actor 1', 'Actor 2', 'Actor 3'],
  availableTargets: ['Target 1', 'Target 2'],

  timeRange: { start: '2020-01-01', end: '2023-12-31' }
}

const renderWithRouter = (component: React.ReactElement) => {
  return render(
    <BrowserRouter>
      {component}
    </BrowserRouter>
  )
}

describe('FilterPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders filter panel with all sections', () => {
    renderWithRouter(<FilterPanel {...mockProps} />)
    
    expect(screen.getByText('Filters')).toBeInTheDocument()
    expect(screen.getByLabelText('Search')).toBeInTheDocument()
    expect(screen.getByText('Date Range')).toBeInTheDocument()
    expect(screen.getByText('Actors (0 selected)')).toBeInTheDocument()
    expect(screen.getByText('Targets (0 selected)')).toBeInTheDocument()
    // There is no event-type section: `Event` has no type field, so the list
    // of types could only ever be empty and the section never rendered.
    expect(screen.queryByText(/Event Types/)).not.toBeInTheDocument()
  })

  it('shows active filter count', () => {
    const filtersWithActive = {
      ...mockFilters,
      searchQuery: 'test',
      actors: ['Actor 1']
    }
    
    renderWithRouter(
      <FilterPanel {...mockProps} filters={filtersWithActive} />
    )
    
    expect(screen.getByText('2')).toBeInTheDocument() // Active filter count badge
  })

  it('calls onFiltersChange when search input changes', async () => {
    renderWithRouter(<FilterPanel {...mockProps} />)
    
    const searchInput = screen.getByLabelText('Search')
    fireEvent.change(searchInput, { target: { value: 'test search' } })
    
    expect(mockProps.onFiltersChange).toHaveBeenCalledWith({
      ...mockFilters,
      searchQuery: 'test search'
    })
  })

  it('calls onFiltersChange when date range changes', () => {
    renderWithRouter(<FilterPanel {...mockProps} />)
    
    const startDateInput = screen.getByLabelText('Start date')
    fireEvent.change(startDateInput, { target: { value: '2022-01-01' } })
    
    expect(mockProps.onFiltersChange).toHaveBeenCalledWith({
      ...mockFilters,
      dateRange: { start: '2022-01-01', end: '' }
    })
  })

  it('handles actor selection', () => {
    renderWithRouter(<FilterPanel {...mockProps} />)
    
    const actorCheckbox = screen.getByRole('checkbox', { name: /Actor 1/ })
    fireEvent.click(actorCheckbox)
    
    expect(mockProps.onFiltersChange).toHaveBeenCalledWith({
      ...mockFilters,
      actors: ['Actor 1']
    })
  })

  it('handles target selection', () => {
    renderWithRouter(<FilterPanel {...mockProps} />)
    
    const targetCheckbox = screen.getByRole('checkbox', { name: /Target 1/ })
    fireEvent.click(targetCheckbox)
    
    expect(mockProps.onFiltersChange).toHaveBeenCalledWith({
      ...mockFilters,
      targets: ['Target 1']
    })
  })

  it('has no event type control to select', () => {
    // `Event` has no type field, so there is nothing to filter by. The
    // section was removed rather than wired to a list that is always empty.
    renderWithRouter(<FilterPanel {...mockProps} />)

    expect(screen.queryByRole('checkbox', { name: /Type A/ })).not.toBeInTheDocument()
  })

  it('handles confidence threshold changes', () => {
    renderWithRouter(<FilterPanel {...mockProps} />)
    
    const confidenceSlider = screen.getByLabelText(/Confidence Threshold/)
    fireEvent.change(confidenceSlider, { target: { value: '0.5' } })
    
    expect(mockProps.onFiltersChange).toHaveBeenCalledWith({
      ...mockFilters,
      confidenceThreshold: 0.5
    })
  })

  it('handles causal weight range changes', () => {
    renderWithRouter(<FilterPanel {...mockProps} />)
    
    const weightSliders = screen.getAllByRole('slider')
    // The causal weight sliders should be the last two sliders (after confidence)
    const minWeightSlider = weightSliders[weightSliders.length - 2]
    
    if (minWeightSlider) {
      fireEvent.change(minWeightSlider, { target: { value: '0.2' } })
    }
    
    expect(mockProps.onFiltersChange).toHaveBeenCalledWith({
      ...mockFilters,
      causalWeightRange: [0.2, 1]
    })
  })

  it('clears all filters when clear button is clicked', () => {
    const filtersWithActive = {
      ...mockFilters,
      searchQuery: 'test',
      actors: ['Actor 1']
    }
    
    renderWithRouter(
      <FilterPanel {...mockProps} filters={filtersWithActive} />
    )
    
    const clearButton = screen.getByText('Clear all')
    fireEvent.click(clearButton)
    
    expect(mockProps.onFiltersChange).toHaveBeenCalledWith(mockFilters)
  })

  it('toggles collapse state', () => {
    renderWithRouter(<FilterPanel {...mockProps} />)
    
    const collapseButton = screen.getByLabelText('Collapse filters')
    fireEvent.click(collapseButton)
    
    // After collapse, search input should not be visible
    expect(screen.queryByLabelText('Search')).not.toBeInTheDocument()
    
    // Button label should change
    expect(screen.getByLabelText('Expand filters')).toBeInTheDocument()
  })

  it('shows selected count for multi-select filters', () => {
    const filtersWithSelections = {
      ...mockFilters,
      actors: ['Actor 1', 'Actor 2'],
      targets: ['Target 1']
    }
    
    renderWithRouter(
      <FilterPanel {...mockProps} filters={filtersWithSelections} />
    )
    
    expect(screen.getByText('Actors (2 selected)')).toBeInTheDocument()
    expect(screen.getByText('Targets (1 selected)')).toBeInTheDocument()
  })

  it('does not render sections when no options available', () => {
    const propsWithoutOptions = {
      ...mockProps,
      availableActors: [],
      availableTargets: []
    }
    
    renderWithRouter(<FilterPanel {...propsWithoutOptions} />)
    
    expect(screen.queryByText('Actors')).not.toBeInTheDocument()
    expect(screen.queryByText('Targets')).not.toBeInTheDocument()
  })

  it('has proper accessibility attributes', () => {
    renderWithRouter(<FilterPanel {...mockProps} />)
    
    const searchInput = screen.getByLabelText('Search')
    expect(searchInput).toHaveAttribute('type', 'text')
    
    const startDateInput = screen.getByLabelText('Start date')
    expect(startDateInput).toHaveAttribute('type', 'date')
    
    const confidenceSlider = screen.getByLabelText(/Confidence Threshold/)
    expect(confidenceSlider).toHaveAttribute('type', 'range')
  })

  it('has no axe violations in the default state', async () => {
    const { container } = renderWithRouter(<FilterPanel {...mockProps} />)

    expect(await axe(container)).toHaveNoViolations()
  })

  it('has no axe violations with active selections', async () => {
    const { container } = renderWithRouter(
      <FilterPanel
        {...mockProps}
        filters={{
          ...mockFilters,
          actors: ['Actor 1'],
          targets: ['Target 1'],
          eventTypes: ['Type A'],
          searchQuery: 'test'
        }}
      />
    )

    expect(await axe(container)).toHaveNoViolations()
  })
})