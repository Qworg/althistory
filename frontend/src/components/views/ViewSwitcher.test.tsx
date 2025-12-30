import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { ViewSwitcher } from './ViewSwitcher'
import { useGlobalStore } from '@/stores/globalStore'

// Mock the global store
vi.mock('@/stores/globalStore')
const mockUseGlobalStore = vi.mocked(useGlobalStore)

// Mock react-router
const mockNavigate = vi.fn()
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/timeline' })
  }
})

describe('ViewSwitcher', () => {
  const mockStore = {
    viewMode: 'timeline' as const,
    setViewMode: vi.fn(),
    selectedEvents: [],
    selectedArcs: [],
    activeFilters: {
      dateRange: null,
      actors: [],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1] as [number, number],
      confidenceThreshold: 0,
      searchQuery: '',
    },
    sessionData: {
      lastActiveFilters: {
        dateRange: null,
        actors: [],
        targets: [],
        eventTypes: [],
        arcLevels: [],
        causalWeightRange: [0, 1] as [number, number],
        confidenceThreshold: 0,
        searchQuery: '',
      },
      lastViewMode: 'timeline' as const,
      lastSelectedEvents: [],
      lastSelectedArcs: [],
      recentSearches: [],
      viewportState: {
        timeline: {
          zoomLevel: 1,
          centerTime: null,
        },
        causalGraph: {
          layout: 'cose',
          nodePositions: {},
        },
      },
    },
    updateSessionData: vi.fn(),
  }

  beforeEach(() => {
    mockUseGlobalStore.mockReturnValue(mockStore as any)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const renderViewSwitcher = (props = {}) => {
    return render(
      <BrowserRouter>
        <ViewSwitcher {...props} />
      </BrowserRouter>
    )
  }

  it('renders all view options', () => {
    renderViewSwitcher()
    
    expect(screen.getByRole('tab', { name: /timeline/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /causal graph/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /actor perspective/i })).toBeInTheDocument()
  })

  it('highlights the current active view', () => {
    renderViewSwitcher()
    
    const timelineButton = screen.getByRole('tab', { name: /timeline/i })
    expect(timelineButton).toHaveClass('bg-blue-100', 'text-blue-700')
  })

  it('switches views when clicked', async () => {
    renderViewSwitcher()
    
    const causalGraphButton = screen.getByRole('tab', { name: /causal graph/i })
    fireEvent.click(causalGraphButton)
    
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/causal-graph', { replace: false })
      expect(mockStore.setViewMode).toHaveBeenCalledWith('causal')
    })
  })

  it('does not switch when clicking the current view', () => {
    renderViewSwitcher()
    
    const timelineButton = screen.getByRole('tab', { name: /timeline/i })
    fireEvent.click(timelineButton)
    
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('shows labels when showLabels is true', () => {
    renderViewSwitcher({ showLabels: true })
    
    expect(screen.getByText('Timeline')).toBeInTheDocument()
    expect(screen.getByText('Causal Graph')).toBeInTheDocument()
    expect(screen.getByText('Actor Perspective')).toBeInTheDocument()
  })

  it('hides labels when showLabels is false', () => {
    renderViewSwitcher({ showLabels: false })
    
    expect(screen.queryByText('Timeline')).not.toBeInTheDocument()
    expect(screen.queryByText('Causal Graph')).not.toBeInTheDocument()
    expect(screen.queryByText('Actor Perspective')).not.toBeInTheDocument()
  })

  it('applies vertical orientation classes', () => {
    renderViewSwitcher({ orientation: 'vertical' })
    
    const container = screen.getByRole('tablist')
    expect(container).toHaveClass('flex-col', 'space-y-1')
  })

  it('applies horizontal orientation classes', () => {
    renderViewSwitcher({ orientation: 'horizontal' })
    
    const container = screen.getByRole('tablist')
    expect(container).toHaveClass('flex', 'items-center', 'space-x-1')
  })

  it('handles keyboard shortcuts', async () => {
    renderViewSwitcher()
    
    // Simulate Alt+2 for causal graph
    fireEvent.keyDown(document, { key: '2', altKey: true })
    
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/causal-graph', { replace: false })
    })
  })

  it('ignores keyboard shortcuts when input is focused', () => {
    renderViewSwitcher()
    
    // Create and focus an input element
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    
    fireEvent.keyDown(input, { key: '2', altKey: true })
    
    expect(mockNavigate).not.toHaveBeenCalled()
    
    document.body.removeChild(input)
  })

  it('shows keyboard shortcut hints on hover', async () => {
    renderViewSwitcher()
    
    const timelineButton = screen.getByRole('tab', { name: /timeline/i })
    fireEvent.mouseEnter(timelineButton)
    
    await waitFor(() => {
      expect(screen.getByText('Alt+1')).toBeInTheDocument()
    })
  })

  it('saves current state before switching views', async () => {
    const storeWithSelections = {
      ...mockStore,
      selectedEvents: ['event1', 'event2'],
      selectedArcs: ['arc1'],
    }
    mockUseGlobalStore.mockReturnValue(storeWithSelections as any)
    
    renderViewSwitcher()
    
    const causalGraphButton = screen.getByRole('tab', { name: /causal graph/i })
    fireEvent.click(causalGraphButton)
    
    await waitFor(() => {
      expect(mockStore.updateSessionData).toHaveBeenCalled()
    })
  })

  it('has proper accessibility attributes', () => {
    renderViewSwitcher()
    
    const container = screen.getByRole('tablist')
    expect(container).toHaveAttribute('aria-label', 'View switcher')
    
    const timelineButton = screen.getByRole('tab', { name: /timeline/i })
    expect(timelineButton).toHaveAttribute('aria-selected', 'true')
    expect(timelineButton).toHaveAttribute('aria-controls', 'timeline-panel')
    
    const causalButton = screen.getByRole('tab', { name: /causal graph/i })
    expect(causalButton).toHaveAttribute('aria-selected', 'false')
  })

  it('shows tooltips with descriptions and shortcuts', () => {
    renderViewSwitcher()
    
    const timelineButton = screen.getByRole('tab', { name: /timeline/i })
    expect(timelineButton).toHaveAttribute('title', 'Chronological view of events and arcs (Alt+1)')
  })
})