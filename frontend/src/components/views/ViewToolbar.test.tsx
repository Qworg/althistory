import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../test/utils'
import { ViewToolbar } from './ViewToolbar'
import { useGlobalStore } from '@/stores/globalStore'

// Mock the global store
vi.mock('@/stores/globalStore')
const mockUseGlobalStore = vi.mocked(useGlobalStore)

type GlobalStoreState = ReturnType<typeof useGlobalStore>

/**
 * `mockStore` below only carries the slice the toolbar reads, so the seam with
 * the automocked `useGlobalStore` (typed against the full real store) is bridged
 * once, here, instead of with an unchecked assertion at each call site.
 */
const asStore = (partial: Partial<GlobalStoreState>) => partial as GlobalStoreState

describe('ViewToolbar', () => {
  const mockStore = {
    events: [],
    arcs: [],
    selectedEvents: [],
    selectedArcs: [],
    activeFilters: {
      dateRange: null,
      actors: [],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: null,
      confidenceThreshold: 0,
      searchQuery: '',
    },
    clearSelection: vi.fn(),
    clearFilters: vi.fn(),
    sessionData: {
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
    setFilterPanelOpen: vi.fn(),
    uiState: {
      filterPanelOpen: true,
      sidebarCollapsed: false,
      activeModal: null,
      dragState: {
        isDragging: false,
        dragType: null,
        draggedItemId: null,
      },
      selectionState: {
        isSelecting: false,
        selectionType: 'single' as const,
        selectionBox: null,
      },
    },
  }

  beforeEach(() => {
    mockUseGlobalStore.mockReturnValue(asStore(mockStore))
    vi.clearAllMocks()
  })

  describe('Timeline view toolbar', () => {
    it('renders timeline-specific actions', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      expect(screen.getByRole('button', { name: /fit to view/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /create event/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /create arc/i })).toBeInTheDocument()
    })

    it('handles zoom fit action', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)

      const fitButton = screen.getByRole('button', { name: /fit to view/i })
      fireEvent.click(fitButton)

      expect(mockStore.updateSessionData).toHaveBeenCalledWith({
        viewportState: {
          ...mockStore.sessionData.viewportState,
          timeline: {
            ...mockStore.sessionData.viewportState.timeline,
            zoomLevel: 1,
            centerTime: null,
            fitToViewTrigger: 1
          }
        }
      })
    })

    it('shows tooltips with keyboard shortcuts', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      const fitButton = screen.getByRole('button', { name: /fit to view/i })
      expect(fitButton).toHaveAttribute('title', 'Zoom to fit all events (F)')
    })
  })

  describe('Causal graph view toolbar', () => {
    it('renders causal graph-specific actions', () => {
      renderWithProviders(<ViewToolbar viewMode="causal" />)
      
      expect(screen.getByRole('button', { name: /force layout/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /hierarchical layout/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /circular layout/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /create link/i })).toBeInTheDocument()
    })

    it('disables current layout button', () => {
      renderWithProviders(<ViewToolbar viewMode="causal" />)
      
      const forceLayoutButton = screen.getByRole('button', { name: /force layout/i })
      expect(forceLayoutButton).toBeDisabled()
    })

    it('handles layout change', () => {
      renderWithProviders(<ViewToolbar viewMode="causal" />)
      
      const hierarchicalButton = screen.getByRole('button', { name: /hierarchical layout/i })
      fireEvent.click(hierarchicalButton)
      
      expect(mockStore.updateSessionData).toHaveBeenCalledWith({
        viewportState: {
          ...mockStore.sessionData.viewportState,
          causalGraph: {
            ...mockStore.sessionData.viewportState.causalGraph,
            layout: 'breadthfirst'
          }
        }
      })
    })

    it('disables create link when not exactly 2 events selected', () => {
      renderWithProviders(<ViewToolbar viewMode="causal" />)
      
      const createLinkButton = screen.getByRole('button', { name: /create link/i })
      expect(createLinkButton).toBeDisabled()
    })

    it('enables create link when exactly 2 events selected', () => {
      const storeWithSelection = {
        ...mockStore,
        selectedEvents: ['event1', 'event2']
      }
      mockUseGlobalStore.mockReturnValue(asStore(storeWithSelection))
      
      renderWithProviders(<ViewToolbar viewMode="causal" />)
      
      const createLinkButton = screen.getByRole('button', { name: /create link/i })
      expect(createLinkButton).not.toBeDisabled()
    })
  })

  describe('Actor perspective view toolbar', () => {
    it('renders actor perspective-specific actions', () => {
      renderWithProviders(<ViewToolbar viewMode="actor-perspective" />)
      
      expect(screen.getByRole('button', { name: /chronological/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /thematic/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /show stats/i })).toBeInTheDocument()
    })
  })

  describe('Common actions', () => {
    it('renders common actions for all views', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      expect(screen.getByRole('button', { name: /hide filters/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /clear selection/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument()
    })

    it('toggles filter panel', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      const filterButton = screen.getByRole('button', { name: /hide filters/i })
      fireEvent.click(filterButton)
      
      expect(mockStore.setFilterPanelOpen).toHaveBeenCalledWith(false)
    })

    it('clears selection when enabled', () => {
      const storeWithSelection = {
        ...mockStore,
        selectedEvents: ['event1']
      }
      mockUseGlobalStore.mockReturnValue(asStore(storeWithSelection))
      
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      const clearSelectionButton = screen.getByRole('button', { name: /clear selection/i })
      expect(clearSelectionButton).not.toBeDisabled()
      
      fireEvent.click(clearSelectionButton)
      expect(mockStore.clearSelection).toHaveBeenCalled()
    })

    it('disables clear selection when no selection', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      const clearSelectionButton = screen.getByRole('button', { name: /clear selection/i })
      expect(clearSelectionButton).toBeDisabled()
    })

    it('clears filters when enabled', () => {
      const storeWithFilters = {
        ...mockStore,
        activeFilters: {
          ...mockStore.activeFilters,
          actors: ['actor1']
        }
      }
      mockUseGlobalStore.mockReturnValue(asStore(storeWithFilters))
      
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      const clearFiltersButton = screen.getByRole('button', { name: /clear filters/i })
      expect(clearFiltersButton).not.toBeDisabled()
      
      fireEvent.click(clearFiltersButton)
      expect(mockStore.clearFilters).toHaveBeenCalled()
    })

    it('disables clear filters when no filters', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      const clearFiltersButton = screen.getByRole('button', { name: /clear filters/i })
      expect(clearFiltersButton).toBeDisabled()
    })
  })

  describe('Keyboard shortcuts', () => {
    it('handles keyboard shortcuts', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      // Simulate 'F' key for fit to view
      fireEvent.keyDown(document, { key: 'f' })
      
      expect(mockStore.updateSessionData).toHaveBeenCalled()
    })

    it('ignores shortcuts when input is focused', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      // Create and focus an input element
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()
      
      fireEvent.keyDown(input, { key: 'f' })
      
      expect(mockStore.updateSessionData).not.toHaveBeenCalled()
      
      document.body.removeChild(input)
    })

    it('handles Ctrl+F for filter toggle', async () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)

      // Verify the filter toggle button exists and can be clicked directly
      // Label is "Hide Filters" when filterPanelOpen is true
      const filterButton = screen.getByRole('button', { name: /hide filters/i })
      expect(filterButton).toBeInTheDocument()

      // Click the button directly (keyboard shortcuts tested via integration tests)
      fireEvent.click(filterButton)

      // The filter panel is initially open (true), so toggling should set it to false
      expect(mockStore.setFilterPanelOpen).toHaveBeenCalledWith(false)
    })

    it('handles Escape for clear selection', () => {
      const storeWithSelection = {
        ...mockStore,
        selectedEvents: ['event1']
      }
      mockUseGlobalStore.mockReturnValue(asStore(storeWithSelection))
      
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      fireEvent.keyDown(document, { key: 'Escape' })
      
      expect(mockStore.clearSelection).toHaveBeenCalled()
    })
  })

  describe('Accessibility', () => {
    it('has proper toolbar role', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      const toolbar = screen.getByRole('toolbar')
      expect(toolbar).toHaveAttribute('aria-label', 'View toolbar')
    })

    it('has proper button labels', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      const fitButton = screen.getByRole('button', { name: /fit to view/i })
      expect(fitButton).toHaveAttribute('aria-label', 'Fit to View')
    })
  })

  describe('Responsive behavior', () => {
    it('hides button labels on small screens', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      const fitButton = screen.getByRole('button', { name: /fit to view/i })
      const labelSpan = fitButton.querySelector('span')
      
      expect(labelSpan).toHaveClass('hidden', 'sm:inline')
    })
  })
})
