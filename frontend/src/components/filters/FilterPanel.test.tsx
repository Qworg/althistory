import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
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

  describe('historical date bounds', () => {
    // The panel mirrors its filters into the URL, and jsdom keeps the URL
    // between tests.
    beforeEach(() => window.history.replaceState(null, '', '/'))

    /** A panel that keeps its own filters, as the container does. */
    function Stateful({ initial = mockFilters, onChange = vi.fn() }: { initial?: FilterState; onChange?: (f: FilterState) => void }) {
      const [filters, setFilters] = useState(initial)
      return (
        <FilterPanel
          {...mockProps}
          filters={filters}
          onFiltersChange={(next) => {
            onChange(next)
            setFilters(next)
          }}
        />
      )
    }

    it('accepts a year, a year-month and a full date, year first', () => {
      const onChange = vi.fn()
      renderWithRouter(<Stateful onChange={onChange} />)

      fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '1843' } })
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ dateRange: { start: '1843', end: '' } }))

      fireEvent.change(screen.getByLabelText('End date'), { target: { value: '1870-3' } })
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ dateRange: { start: '1843', end: '1870-03' } }))
    })

    it('reads BCE and a minus sign the same way, and shows how it read them', () => {
      const onChange = vi.fn()
      renderWithRouter(<Stateful onChange={onChange} />)
      const start = screen.getByLabelText('Start date')

      fireEvent.change(start, { target: { value: '-44' } })
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ dateRange: { start: '44 BCE', end: '' } }))
      fireEvent.blur(start)
      expect(start).toHaveValue('44 BCE')

      fireEvent.change(start, { target: { value: '44-03-15 bc' } })
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ dateRange: { start: '44-03-15 BCE', end: '' } }))
    })

    it('keeps a half-typed date as a draft, and explains an unreadable one when the field is left', () => {
      const onChange = vi.fn()
      renderWithRouter(<Stateful onChange={onChange} />)
      const start = screen.getByLabelText('Start date')

      fireEvent.change(start, { target: { value: '11/20/1843' } })
      expect(onChange).not.toHaveBeenCalled()
      expect(start).toHaveValue('11/20/1843')
      expect(start).not.toHaveAttribute('aria-invalid')

      fireEvent.blur(start)
      expect(start).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByText(/Write the year first/)).toBeInTheDocument()
    })

    it('names the impossible dates', () => {
      renderWithRouter(<Stateful />)
      const start = screen.getByLabelText('Start date')

      fireEvent.change(start, { target: { value: '0' } })
      fireEvent.blur(start)
      expect(screen.getByText(/There is no year 0/)).toBeInTheDocument()

      fireEvent.change(start, { target: { value: '1843-02-30' } })
      expect(screen.queryByText(/There is no year 0/)).not.toBeInTheDocument()
      fireEvent.keyDown(start, { key: 'Enter' })
      expect(screen.getByText(/no day 30/)).toBeInTheDocument()
    })

    it('drops the date filter when both bounds are cleared', () => {
      const onChange = vi.fn()
      renderWithRouter(<Stateful initial={{ ...mockFilters, dateRange: { start: '1843', end: '' } }} onChange={onChange} />)

      fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '' } })
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ dateRange: null }))
    })

    it('empties the fields when the filters are cleared from outside', () => {
      renderWithRouter(<Stateful initial={{ ...mockFilters, dateRange: { start: '1843', end: '1870' } }} />)
      expect(screen.getByLabelText('Start date')).toHaveValue('1843')

      fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))

      expect(screen.getByLabelText('Start date')).toHaveValue('')
      expect(screen.getByLabelText('End date')).toHaveValue('')
    })

    it('says when the start is after the end', () => {
      renderWithRouter(<FilterPanel {...mockProps} filters={{ ...mockFilters, dateRange: { start: '1870', end: '1843' } }} />)

      expect(screen.getByText(/start is after the end/)).toBeInTheDocument()
    })

    it('says so when the range is reversed by a millisecond past what a double holds', () => {
      renderWithRouter(
        <FilterPanel {...mockProps} filters={{ ...mockFilters, dateRange: { start: '+300000-06-02', end: '+300000-06-01' } }} />
      )

      expect(screen.getByText(/start is after the end/)).toBeInTheDocument()
    })

    it('has no axe violations with an unreadable date', async () => {
      const { container } = renderWithRouter(<Stateful />)
      const start = screen.getByLabelText('Start date')
      fireEvent.change(start, { target: { value: 'soon' } })
      fireEvent.blur(start)

      expect(await axe(container)).toHaveNoViolations()
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
    
    const confidenceSlider = screen.getByLabelText(/Minimum event confidence/)
    fireEvent.change(confidenceSlider, { target: { value: '0.5' } })
    
    expect(mockProps.onFiltersChange).toHaveBeenCalledWith({
      ...mockFilters,
      confidenceThreshold: 0.5
    })
  })

  it('handles causal weight range changes', () => {
    renderWithRouter(<FilterPanel {...mockProps} />)
    
    // One "at least this strong" slider for link strength.
    const minWeightSlider = screen.getByRole('slider', { name: /Links at least this strong/ })
    fireEvent.change(minWeightSlider, { target: { value: '0.2' } })
    
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

  it('has no collapse control that would leave an empty column open', () => {
    renderWithRouter(<FilterPanel {...mockProps} />)

    expect(screen.queryByLabelText('Collapse filters')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Expand filters')).not.toBeInTheDocument()
  })

  it('shows a Close button that calls onClose when one is given', () => {
    const onClose = vi.fn()
    renderWithRouter(<FilterPanel {...mockProps} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close filter panel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('omits the Close button without onClose', () => {
    renderWithRouter(<FilterPanel {...mockProps} />)

    expect(screen.queryByRole('button', { name: 'Close filter panel' })).not.toBeInTheDocument()
  })

  it('renders a supplied search element in place of the built-in field', () => {
    renderWithRouter(
      <FilterPanel {...mockProps} search={<input aria-label="Custom search" />} />
    )

    expect(screen.getByLabelText('Custom search')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search events, arcs, or descriptions...')).not.toBeInTheDocument()
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
    
    // Typed, not a native date picker: the picker shows the locale's order
    // (mm/dd/yyyy in the US) and cannot reach BCE.
    const startDateInput = screen.getByLabelText('Start date')
    expect(startDateInput).toHaveAttribute('type', 'text')
    const hint = document.getElementById(startDateInput.getAttribute('aria-describedby')!)
    expect(hint).toHaveTextContent(/1843, 1843-11, 1843-11-20/)
    expect(hint).toHaveTextContent(/BCE/)
    
    const confidenceSlider = screen.getByLabelText(/Minimum event confidence/)
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