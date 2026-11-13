import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, act } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { renderWithProviders } from '../../test/utils'
import { ViewToolbar } from './ViewToolbar'
import { useGlobalStore } from '@/stores/globalStore'
import { resetLiveChangesStore, useLiveChangesStore } from '@/stores/liveChangesStore'
import { SHORTCUTS, formatCombo } from '@/components/help/shortcuts'

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
      causalWeightRange: [0, 1] as [number, number],
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
    // The graph-scoped actions wait for an active graph (see below).
    localStorage.setItem('active_graph_id', 'graph-1')
  })

  describe('without an active graph', () => {
    it('disables the actions that need one and says how to get one', () => {
      localStorage.removeItem('active_graph_id')
      renderWithProviders(<ViewToolbar viewMode="timeline" />)

      const create = screen.getByRole('button', { name: /create event/i })
      expect(create).toBeDisabled()
      expect(create).toHaveAttribute('title', expect.stringMatching(/choose a graph first/i))
      fireEvent.click(screen.getByRole('button', { name: 'Bring in history' }))
      expect(screen.getByRole('menuitem', { name: /^extract from text/i })).toHaveAttribute('aria-disabled', 'true')
      // Import can create a graph of its own
      expect(screen.getByRole('menuitem', { name: /^import an export file/i })).not.toHaveAttribute('aria-disabled')
    })
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
    // The canvas's layout panel is the one layout control and its Draw Link
    // (D) the one way to link events, so the toolbar repeats neither.
    it('carries no layout or link buttons of its own', () => {
      renderWithProviders(<ViewToolbar viewMode="causal" />)

      for (const name of [/force layout/i, /hierarchical layout/i, /circular layout/i, /create link/i]) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
      }
      // The shared actions are still there.
      expect(screen.getByRole('button', { name: 'Graph' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /hide filters/i })).toBeInTheDocument()
    })

    it('leaves the layout keys (1-3) and L to the canvas', () => {
      renderWithProviders(<ViewToolbar viewMode="causal" />)

      for (const key of ['1', '2', '3', 'l']) {
        const press = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        document.dispatchEvent(press)
        expect(press.defaultPrevented).toBe(false)
      }
      expect(mockStore.updateSessionData).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('Actor perspective view toolbar', () => {
    const actorStore = (layout: 'chronological' | 'thematic', showStats: boolean) => ({
      ...mockStore,
      sessionData: {
        viewportState: {
          ...mockStore.sessionData.viewportState,
          actorPerspective: { layout, showStats },
        },
      },
    })

    it('shows the statistics toggle as a pressed toggle, and no layout buttons', () => {
      mockUseGlobalStore.mockReturnValue(asStore(actorStore('chronological', true)))
      renderWithProviders(<ViewToolbar viewMode="actor-perspective" />)

      const stats = screen.getByRole('button', { name: 'Statistics' })
      expect(stats).toHaveAttribute('aria-pressed', 'true')
      expect(stats).not.toBeDisabled()
      // The layout is chosen in the view's own segmented control.
      expect(screen.queryByRole('button', { name: /chronological/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /thematic/i })).not.toBeInTheDocument()
    })

    it('defaults the statistics to shown, as the view does', () => {
      renderWithProviders(<ViewToolbar viewMode="actor-perspective" />)

      expect(screen.getByRole('button', { name: 'Statistics' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('toggles the statistics in the shared session state', () => {
      mockUseGlobalStore.mockReturnValue(asStore(actorStore('thematic', true)))
      renderWithProviders(<ViewToolbar viewMode="actor-perspective" />)

      fireEvent.click(screen.getByRole('button', { name: 'Statistics' }))

      expect(mockStore.updateSessionData).toHaveBeenCalledWith({
        viewportState: expect.objectContaining({
          actorPerspective: { layout: 'thematic', showStats: false },
        }),
      })
    })

    it('keeps C, T and S bound to the same layout and statistics state', () => {
      mockUseGlobalStore.mockReturnValue(asStore(actorStore('chronological', false)))
      renderWithProviders(<ViewToolbar viewMode="actor-perspective" />)

      fireEvent.keyDown(document, { key: 't' })
      expect(mockStore.updateSessionData).toHaveBeenLastCalledWith({
        viewportState: expect.objectContaining({
          actorPerspective: { layout: 'thematic', showStats: false },
        }),
      })

      fireEvent.keyDown(document, { key: 'c' })
      expect(mockStore.updateSessionData).toHaveBeenLastCalledWith({
        viewportState: expect.objectContaining({
          actorPerspective: { layout: 'chronological', showStats: false },
        }),
      })

      fireEvent.keyDown(document, { key: 's' })
      expect(mockStore.updateSessionData).toHaveBeenLastCalledWith({
        viewportState: expect.objectContaining({
          actorPerspective: { layout: 'chronological', showStats: true },
        }),
      })
    })

    it('never renders an option as disabled because it is the active one', () => {
      for (const viewMode of ['timeline', 'causal', 'actor-perspective'] as const) {
        const { unmount } = renderWithProviders(<ViewToolbar viewMode={viewMode} />)
        const toolbar = screen.getByRole('toolbar')
        // Only the state-dependent clears could be disabled, and those are hidden instead.
        expect(Array.from(toolbar.querySelectorAll('button:disabled'))).toEqual([])
        unmount()
      }
    })
  })

  describe('Common actions', () => {
    it('renders common actions for all views', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      expect(screen.getByRole('button', { name: /hide filters/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Compare branches' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Bring in history' })).toHaveAttribute('aria-haspopup', 'menu')
      expect(screen.getByRole('button', { name: 'Graph' })).toHaveAttribute('aria-haspopup', 'menu')
    })

    it('has one primary action: Create Event', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      expect(screen.getByRole('button', { name: 'Create Event' })).toHaveClass('text-baseline')
      expect(screen.getByRole('button', { name: 'Create Arc' })).not.toHaveClass('text-baseline')
      expect(screen.getByRole('button', { name: 'Compare branches' })).not.toHaveClass('bg-amber-50/80')
    })

    it('puts extraction first, then export files, under Bring in history', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      fireEvent.click(screen.getByRole('button', { name: 'Bring in history' }))
      expect(screen.getAllByRole('menuitem').map(item => item.getAttribute('aria-label'))).toEqual([
        'Extract from text or Wikipedia…',
        'Import an export file…',
      ])
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

    it('hides clear selection when there is no selection', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      expect(screen.queryByRole('button', { name: /clear selection/i })).not.toBeInTheDocument()
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

      // The filter chips under the header carry "Clear all"; the toolbar does
      // not repeat it as a button, but Shift+R still clears.
      expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()
      fireEvent.keyDown(document, { key: 'R', shiftKey: true })
      expect(mockStore.clearFilters).toHaveBeenCalled()
    })

    it('hides clear filters when no filters are active', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      
      expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()
    })

    it('treats a causal weight range narrower than the default as filtering', () => {
      const storeWithWeight = {
        ...mockStore,
        activeFilters: {
          ...mockStore.activeFilters,
          causalWeightRange: [0.2, 1] as [number, number]
        }
      }
      mockUseGlobalStore.mockReturnValue(asStore(storeWithWeight))

      renderWithProviders(<ViewToolbar viewMode="timeline" />)

      fireEvent.keyDown(document, { key: 'R', shiftKey: true })
      expect(mockStore.clearFilters).toHaveBeenCalled()
    })

    it('opens the ingestion wizard from the Ingest action (Req 19)', async () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)

      // The wizard is not mounted until the reachable entry point is used.
      expect(screen.queryByRole('dialog', { name: 'Bring in history' })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Bring in history' }))
      fireEvent.click(screen.getByRole('menuitem', { name: /^extract from text/i }))

      expect(await screen.findByRole('dialog', { name: 'Bring in history' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Wikipedia' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Wikidata' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Text' })).toBeInTheDocument()
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

    it('toggles filters on Shift+F without also firing the plain F (fit) shortcut', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)

      fireEvent.keyDown(document, { key: 'F', shiftKey: true })

      // The filter panel starts open, so Shift+F closes it
      expect(mockStore.setFilterPanelOpen).toHaveBeenCalledWith(false)
      // Fit to View writes a new fit trigger into the session; it must not run
      expect(mockStore.updateSessionData).not.toHaveBeenCalled()
    })

    it('leaves Ctrl+C (copy) alone in the actor view instead of switching layout', () => {
      renderWithProviders(<ViewToolbar viewMode="actor-perspective" />)

      const copy = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
      document.dispatchEvent(copy)

      expect(copy.defaultPrevented).toBe(false)
      expect(mockStore.updateSessionData).not.toHaveBeenCalled()
    })

    it('leaves the browser its Ctrl combinations (find, reload, new window, history)', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)

      for (const key of ['f', 'r', 'n', 'h']) {
        const combo = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true })
        document.dispatchEvent(combo)
        expect(combo.defaultPrevented).toBe(false)
      }
      expect(mockStore.setFilterPanelOpen).not.toHaveBeenCalled()
      expect(mockStore.updateSessionData).not.toHaveBeenCalled()
    })

    it('advertises no Ctrl or ⌘ shortcut in any view (browser/OS-reserved territory)', () => {
      for (const viewMode of ['timeline', 'causal', 'actor-perspective'] as const) {
        const { unmount } = renderWithProviders(<ViewToolbar viewMode={viewMode} />)
        const titles = Array.from(document.querySelectorAll('[title]')).map((el) => el.getAttribute('title') ?? '')
        expect(titles.filter((t) => /\((?:Ctrl|Cmd|Meta|⌘)\b/.test(t))).toEqual([])
        unmount()
      }
    })

    it('opens the create-event form on E', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      fireEvent.keyDown(document, { key: 'e' })

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('stands aside while a modal dialog is open (no F behind it, Escape does not clear the selection)', () => {
      mockUseGlobalStore.mockReturnValue(asStore({ ...mockStore, selectedEvents: ['event1'] }))
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      const save = document.createElement('button')
      dialog.appendChild(save)
      document.body.appendChild(dialog)
      save.focus()

      fireEvent.keyDown(save, { key: 'f' })
      fireEvent.keyDown(save, { key: 'Escape' })

      expect(mockStore.updateSessionData).not.toHaveBeenCalled()
      expect(mockStore.clearSelection).not.toHaveBeenCalled()
      dialog.remove()
    })

    it('does not fire plain-key shortcuts while Meta is held', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)

      fireEvent.keyDown(document, { key: 'f', metaKey: true })

      expect(mockStore.updateSessionData).not.toHaveBeenCalled()
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

  describe('Graph menu', () => {
    it('gives Versions its own icon, not the copies\' one', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      fireEvent.click(screen.getByRole('button', { name: 'Graph' }))

      const iconOf = (name: string) => screen.getByRole('menuitem', { name }).querySelector('svg')?.innerHTML
      expect(iconOf('Versions')).toBeTruthy()
      expect(iconOf('Versions')).not.toBe(iconOf('Recent copies'))
    })

    it('keeps every item label on one line', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      fireEvent.click(screen.getByRole('button', { name: 'Graph' }))

      expect(screen.getByRole('menu')).toHaveClass('w-max')
      expect(screen.getByText('Branch or copy…')).toHaveClass('whitespace-nowrap')
    })

    const graphActions = ['Branch or copy…', 'Simulate forward…', 'Versions', 'Export', 'Recent copies']

    it('collapses the graph-management actions behind a closed menu button', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)

      const trigger = screen.getByRole('button', { name: 'Graph' })
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      for (const name of graphActions) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
      }
    })

    it('opens a menu of the graph actions and focuses the first item', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)

      const trigger = screen.getByRole('button', { name: 'Graph' })
      fireEvent.click(trigger)

      expect(trigger).toHaveAttribute('aria-expanded', 'true')
      const menu = screen.getByRole('menu')
      expect(trigger).toHaveAttribute('aria-controls', menu.id)
      expect(screen.getAllByRole('menuitem').map(item => item.getAttribute('aria-label'))).toEqual(graphActions)
      expect(screen.getByRole('menuitem', { name: 'Branch or copy…' })).toHaveFocus()
    })

    it('moves between items with the arrow keys, Home and End', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      fireEvent.click(screen.getByRole('button', { name: 'Graph' }))
      const menu = screen.getByRole('menu')

      fireEvent.keyDown(menu, { key: 'ArrowDown' })
      expect(screen.getByRole('menuitem', { name: 'Simulate forward…' })).toHaveFocus()
      fireEvent.keyDown(menu, { key: 'End' })
      expect(screen.getByRole('menuitem', { name: 'Recent copies' })).toHaveFocus()
      fireEvent.keyDown(menu, { key: 'ArrowDown' })
      expect(screen.getByRole('menuitem', { name: 'Branch or copy…' })).toHaveFocus()
      fireEvent.keyDown(menu, { key: 'ArrowUp' })
      expect(screen.getByRole('menuitem', { name: 'Recent copies' })).toHaveFocus()
      fireEvent.keyDown(menu, { key: 'Home' })
      expect(screen.getByRole('menuitem', { name: 'Branch or copy…' })).toHaveFocus()
    })

    it('opens on ArrowUp with the last item focused', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      fireEvent.keyDown(screen.getByRole('button', { name: 'Graph' }), { key: 'ArrowUp' })

      expect(screen.getByRole('menuitem', { name: 'Recent copies' })).toHaveFocus()
    })

    it('closes on Escape, returns focus to the trigger, and does not clear the selection', () => {
      mockUseGlobalStore.mockReturnValue(asStore({ ...mockStore, selectedEvents: ['event1'] }))
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      const trigger = screen.getByRole('button', { name: 'Graph' })
      fireEvent.click(trigger)

      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
      expect(trigger).toHaveFocus()
      expect(mockStore.clearSelection).not.toHaveBeenCalled()
    })

    it('closes on a click outside', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      fireEvent.click(screen.getByRole('button', { name: 'Graph' }))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      fireEvent.mouseDown(document.body)

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('runs the chosen action, closes, and returns focus to the trigger', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      const trigger = screen.getByRole('button', { name: 'Graph' })
      fireEvent.click(trigger)

      fireEvent.click(screen.getByRole('menuitem', { name: 'Recent copies' }))

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'Recent copies' })).toBeInTheDocument()
    })

    it('keeps menu shortcuts working while the menu is closed', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()

      fireEvent.keyDown(document, { key: 'B', shiftKey: true })

      expect(screen.getByRole('dialog', { name: /branch or copy/i })).toBeInTheDocument()
    })

    it('leaves Shift+S and Shift+H free: the copy-job panels are a menu away', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)

      fireEvent.keyDown(document, { key: 'H', shiftKey: true })
      fireEvent.keyDown(document, { key: 'S', shiftKey: true })

      expect(screen.queryByRole('dialog', { name: /^cop(ies|y history)$/i })).not.toBeInTheDocument()
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

  describe('Accessibility (axe)', () => {
    it('timeline view has no axe violations', async () => {
      const { container } = renderWithProviders(<ViewToolbar viewMode="timeline" />)

      expect(await axe(container)).toHaveNoViolations()
    })

    it('causal view has no axe violations', async () => {
      const { container } = renderWithProviders(<ViewToolbar viewMode="causal" />)

      expect(await axe(container)).toHaveNoViolations()
    })
  })

  // The Help dialog's shortcut list (components/help/shortcuts.ts) is the
  // reference users read; every key a toolbar tooltip or Graph-menu keycap
  // advertises must appear there, so the two cannot drift apart.
  describe('Shortcut reference stays in step with the toolbar', () => {
    const documented = new Set(SHORTCUTS.flatMap((s) => s.combos.map(formatCombo)))
    // "(F)", "(Shift+F)", "(Escape)" -- not "(JSON/CSV)" or "(PoD explorer)".
    const advertisedIn = (text: string) =>
      [...text.matchAll(/\(([A-Za-z0-9]+(?:\+[A-Za-z0-9]+)*)\)/g)].map((m) => m[1]!)

    it.each(['timeline', 'causal', 'actor-perspective'] as const)('%s view', (viewMode) => {
      mockUseGlobalStore.mockReturnValue(asStore({ ...mockStore, selectedEvents: ['a'] }))
      renderWithProviders(<ViewToolbar viewMode={viewMode} />)
      fireEvent.click(screen.getByRole('button', { name: 'Graph' }))

      const advertised = [
        ...Array.from(document.querySelectorAll('[title]')).flatMap((el) => advertisedIn(el.getAttribute('title') ?? '')),
        ...screen.getAllByRole('menuitem').flatMap((item) => Array.from(item.querySelectorAll('kbd')).map((kbd) => kbd.textContent ?? '')),
      ].filter(Boolean)

      expect(advertised.length).toBeGreaterThan(0)
      for (const combo of advertised) {
        expect(documented, `${combo} is advertised in the toolbar but missing from the shortcut reference`).toContain(combo)
      }
    })
  })

  describe('Streaming status integration', () => {
    it('renders streaming status badge in the toolbar', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" />)
      expect(screen.getByRole('status', { name: /edits save as you go|live sync/i })).toBeInTheDocument()
    })

    describe('live sync', () => {
      beforeEach(() => {
        localStorage.clear()
        resetLiveChangesStore()
      })

      afterEach(() => {
        localStorage.clear()
        resetLiveChangesStore()
      })

      it('is on by default, and says so once the feed is connected', () => {
        renderWithProviders(<ViewToolbar viewMode="timeline" />)
        // Wanted and not yet connected: connecting, not "off".
        expect(screen.getByRole('status', { name: 'Live sync: connecting…' })).toBeInTheDocument()
        act(() => useLiveChangesStore.getState().setStatus('live'))
        expect(screen.getByRole('status', { name: 'Live sync on' })).toBeInTheDocument()
      })

      it('says when the connection dropped and is being reopened', () => {
        renderWithProviders(<ViewToolbar viewMode="timeline" />)
        act(() => useLiveChangesStore.getState().setStatus('reconnecting'))
        expect(screen.getByRole('status', { name: 'Live sync: reconnecting…' })).toBeInTheDocument()
      })

      it('turns off, and stays off the next time, from the badge', () => {
        renderWithProviders(<ViewToolbar viewMode="timeline" />)
        act(() => useLiveChangesStore.getState().setStatus('live'))
        fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
        expect(useLiveChangesStore.getState().enabled).toBe(false)
        expect(localStorage.getItem('althistory.liveSync')).toBe('off')
        expect(screen.getByRole('status', { name: 'Edits save as you go' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Live sync' }))
        expect(useLiveChangesStore.getState().enabled).toBe(true)
        expect(localStorage.getItem('althistory.liveSync')).toBeNull()
      })

      it('shows why it could not start, with a way to try again', () => {
        renderWithProviders(<ViewToolbar viewMode="timeline" />)
        act(() => useLiveChangesStore.getState().setStatus('error', 'Missing required permissions: read:events'))
        const badge = screen.getByRole('status', { name: "Couldn't start live sync" })
        expect(badge).toHaveAttribute('title', expect.stringContaining('read:events'))
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        // Trying again restarts the connection: the hook watches this count.
        expect(useLiveChangesStore.getState().retries).toBe(1)
        expect(useLiveChangesStore.getState().enabled).toBe(true)
      })
    })
  })

  describe('Compact (phone) toolbar', () => {
    it('keeps the view\'s primary actions and the filter controls, as 44px icon buttons', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" compact />)

      const toolbar = screen.getByRole('toolbar', { name: 'View toolbar' })
      for (const name of ['Fit to View', 'Create Event', 'Create Arc', 'Hide Filters']) {
        const button = screen.getByRole('button', { name })
        expect(button).toHaveClass('h-11', 'min-w-11')
        // Icon only: no visible label to wrap the row.
        expect(button.querySelector('span')).toBeNull()
      }
      expect(toolbar).not.toHaveClass('flex-wrap')
    })

    it('moves graph management and streaming off the toolbar', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" compact />)

      for (const name of ['Graph', 'Compare branches', 'Bring in history']) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
      }
      expect(screen.queryByRole('status', { name: /edits save as you go|live sync/i })).not.toBeInTheDocument()
    })

    it('keeps the graph shortcuts working without the menu', () => {
      renderWithProviders(<ViewToolbar viewMode="timeline" compact />)

      fireEvent.keyDown(document, { key: 'B', shiftKey: true })

      expect(screen.getByRole('dialog', { name: /branch or copy/i })).toBeInTheDocument()
    })
  })
})
