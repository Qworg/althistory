import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { act } from 'react'
import type { Core } from 'cytoscape'
import { CausalGraphLayoutManager } from './CausalGraphLayoutManager'
import { useGlobalStore } from '@/stores/globalStore'
import {
  createMockCytoscape,
  MockCytoscape
} from '@/test/__mocks__/cytoscape'
import {
  FIT_PADDING,
  DEFAULT_ZOOM,
  DEFAULT_LAYOUT_OPTIONS,
  LAYOUT_SHORTCUTS
} from '@/utils/layoutManagerUtils'

// Mock the global store
vi.mock('@/stores/globalStore')
const mockUseGlobalStore = vi.mocked(useGlobalStore)

type GlobalStoreState = ReturnType<typeof useGlobalStore>

/**
 * `createMockCytoscape()` is a loose `vi.fn()`-based test double, not a real
 * Cytoscape `Core`, and `mockStore` only carries the two members this component
 * touches. Both seams are bridged once, explicitly and with the reason, rather
 * than sprinkling unchecked assertions at every use site.
 */
const asCore = (mock: MockCytoscape) => mock as unknown as Core
const asStore = (partial: Partial<GlobalStoreState>) => partial as GlobalStoreState

describe('CausalGraphLayoutManager', () => {
  let mockCytoscapeInstance: MockCytoscape

  const mockStore = {
    sessionData: {
      viewportState: {
        causalGraph: {
          layout: 'cose',
          nodePositions: {}
        }
      }
    },
    updateSessionData: vi.fn()
  }

  beforeEach(() => {
    // Create a fresh mock instance for each test
    mockCytoscapeInstance = createMockCytoscape()
    mockUseGlobalStore.mockReturnValue(asStore(mockStore))
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const renderLayoutManager = (props = {}) => {
    return render(
      <CausalGraphLayoutManager
        cytoscapeInstance={asCore(mockCytoscapeInstance)}
        {...props}
      />
    )
  }

  it('shows the three most useful layouts, time order first, with the rest behind "More layouts"', () => {
    renderLayoutManager()

    expect(screen.getByRole('heading', { level: 3, name: 'Graph Layout' })).toBeInTheDocument()
    const primary = screen.getByRole('group', { name: 'Layout' })
    expect(within(primary).getAllByRole('button').map(b => b.textContent)).toEqual([
      'Time order',
      'Clusters',
      'Cause to effect'
    ])
    // The panel is a section of the surface it sits on, not a card of its own.
    expect(primary.closest('.causal-graph-layout-manager')?.className).not.toMatch(/shadow|bg-white/)

    const more = screen.getByRole('button', { name: 'More layouts' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /^ring/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /random/i })).not.toBeInTheDocument()

    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    const extra = screen.getByRole('group', { name: 'More layouts' })
    for (const name of ['Tree', 'Tight clusters', 'Ring', 'Hubs at centre', 'Grid', 'Scatter']) {
      expect(within(extra).getByRole('button', { name: new RegExp(name) })).toBeInTheDocument()
    }
  })

  it('opens "More layouts" when the saved layout is one of them', () => {
    mockUseGlobalStore.mockReturnValue(asStore({
      ...mockStore,
      sessionData: { viewportState: { causalGraph: { layout: 'circle', nodePositions: {} } } }
    } as unknown as Partial<GlobalStoreState>))
    renderLayoutManager()

    expect(screen.getByRole('button', { name: 'More layouts' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /^ring/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows current active layout', () => {
    renderLayoutManager()

    const forceDirectedButton = screen.getByRole('button', { name: /^clusters/i })
    expect(forceDirectedButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^cause to effect/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('applies layout when button is clicked', async () => {
    const onLayoutChange = vi.fn()
    renderLayoutManager({ onLayoutChange })

    const hierarchicalButton = screen.getByRole('button', { name: /^cause to effect/i })

    await act(async () => {
      fireEvent.click(hierarchicalButton)
    })

    await waitFor(() => {
      expect(mockCytoscapeInstance.layout).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'dagre' })
      )
      expect(mockStore.updateSessionData).toHaveBeenCalled()
      expect(onLayoutChange).toHaveBeenCalledWith('dagre')
    })
  })

  it('shows loading state during transition', async () => {
    renderLayoutManager()

    const directedButton = screen.getByRole('button', { name: /cause to effect/i })
    fireEvent.click(directedButton)

    expect(screen.getByText('Applying layout...')).toBeInTheDocument()
  })

  it('handles keyboard shortcuts', () => {
    renderLayoutManager()

    // Simulate pressing '2' for hierarchical layout
    fireEvent.keyDown(document, { key: '2' })

    expect(mockCytoscapeInstance.layout).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'breadthfirst' })
    )
  })

  it('ignores keyboard shortcuts when input is focused', () => {
    renderLayoutManager()

    // Create and focus an input element
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    fireEvent.keyDown(input, { key: '2' })

    expect(mockCytoscapeInstance.layout).not.toHaveBeenCalled()

    document.body.removeChild(input)
  })

  it('handles fit to view shortcut', () => {
    renderLayoutManager()

    fireEvent.keyDown(document, { key: 'f' })

    expect(mockCytoscapeInstance.fit).toHaveBeenCalledWith(undefined, FIT_PADDING)
  })

  it('handles reset zoom shortcut', () => {
    renderLayoutManager()

    fireEvent.keyDown(document, { key: 'r' })

    expect(mockCytoscapeInstance.zoom).toHaveBeenCalledWith(1)
    expect(mockCytoscapeInstance.center).toHaveBeenCalled()
  })

  it('leaves modified keys alone (Ctrl+R reload, Shift+R/Shift+F filters, Alt+2 view switch)', () => {
    renderLayoutManager()

    const reload = new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(reload)
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
    fireEvent.keyDown(document, { key: '2', altKey: true })
    fireEvent.keyDown(document, { key: 'f', metaKey: true })
    fireEvent.keyDown(document, { key: 'R', shiftKey: true })
    fireEvent.keyDown(document, { key: 'F', shiftKey: true })

    expect(reload.defaultPrevented).toBe(false)
    expect(mockCytoscapeInstance.zoom).not.toHaveBeenCalled()
    expect(mockCytoscapeInstance.fit).not.toHaveBeenCalled()
    expect(mockCytoscapeInstance.layout).not.toHaveBeenCalled()
  })

  it('shows layout description for current layout', () => {
    renderLayoutManager()

    expect(screen.getByText(/linked events pull together/i)).toBeInTheDocument()
  })

  it('names the layout keys once, as keys, and on each option for assistive tech', () => {
    renderLayoutManager()

    // A digit at the end of each option read as a count; the keys are said
    // once, under the options.
    const forceDirectedButton = screen.getByRole('button', { name: /^clusters/i })
    expect(within(forceDirectedButton).queryByText('1')).not.toBeInTheDocument()
    expect(screen.getByText('Switch with the keys').parentElement).toHaveTextContent(/9.*1.*6/)
    expect(forceDirectedButton).toHaveAttribute('aria-keyshortcuts', '1')
    expect(screen.getByRole('button', { name: /cause to effect/i })).toHaveAttribute('aria-keyshortcuts', '6')
  })

  it('provides quick action buttons', () => {
    renderLayoutManager()

    const fitButton = screen.getByRole('button', { name: /fit \(f\)/i })
    const resetButton = screen.getByRole('button', { name: /reset \(r\)/i })

    expect(fitButton).toBeInTheDocument()
    expect(resetButton).toBeInTheDocument()

    fireEvent.click(fitButton)
    expect(mockCytoscapeInstance.fit).toHaveBeenCalled()

    fireEvent.click(resetButton)
    expect(mockCytoscapeInstance.zoom).toHaveBeenCalledWith(1)
    expect(mockCytoscapeInstance.center).toHaveBeenCalled()
  })

  it('marks the other layouts unavailable while one is applied, never the current choice disabled', async () => {
    renderLayoutManager()

    const hierarchicalButton = screen.getByRole('button', { name: /^cause to effect/i })
    fireEvent.click(hierarchicalButton)

    // The current choice reads as chosen, not as unavailable
    const current = screen.getByRole('button', { name: /^clusters/i })
    expect(current).toHaveAttribute('aria-pressed', 'true')
    expect(current).not.toBeDisabled()
    expect(current).not.toHaveAttribute('aria-disabled')
    // The rest stay focusable but say they cannot be used just now
    expect(hierarchicalButton).not.toBeDisabled()
    expect(hierarchicalButton).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('group', { name: 'Layout' })).toHaveAttribute('aria-busy', 'true')

    // A second choice while the first is applied is ignored
    mockCytoscapeInstance.layout.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /cause to effect/i }))
    expect(mockCytoscapeInstance.layout).not.toHaveBeenCalled()
  })

  it('draws the layout choices as a list on the panel, not a bordered box', () => {
    renderLayoutManager()
    const group = screen.getByRole('group', { name: 'Layout' })
    expect(group.className).not.toMatch(/\bborder\b|rounded-md|divide-y/)
    // Never `disabled` for the current choice, at rest either
    for (const button of within(group).getAllByRole('button')) {
      expect(button).not.toBeDisabled()
    }
  })

  it('uses the shared, tuned layout options', async () => {
    renderLayoutManager()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^cause to effect/i }))
    })
    expect(mockCytoscapeInstance.layout).toHaveBeenCalledWith(
      expect.objectContaining({ ...DEFAULT_LAYOUT_OPTIONS.dagre })
    )
  })

  it('shows tooltips with layout descriptions', () => {
    renderLayoutManager()

    const forceDirectedButton = screen.getByRole('button', { name: /^clusters/i })
    expect(forceDirectedButton).toHaveAttribute('title', expect.stringContaining('Linked events pull together'))
  })

  it('handles preview mode when enabled', () => {
    renderLayoutManager({ showLayoutPreview: true })

    const hierarchicalButton = screen.getByRole('button', { name: /^cause to effect/i })

    // Mouse enter should trigger preview
    fireEvent.mouseEnter(hierarchicalButton)

    expect(mockCytoscapeInstance.layout).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'dagre',
        animationDuration: 300,
        fit: false
      })
    )
  })

  it('cancels preview on mouse leave', () => {
    renderLayoutManager({ showLayoutPreview: true })

    const hierarchicalButton = screen.getByRole('button', { name: /^cause to effect/i })

    fireEvent.mouseEnter(hierarchicalButton)
    fireEvent.mouseLeave(hierarchicalButton)

    // Should restore original layout
    expect(mockCytoscapeInstance.layout).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'cose' })
    )
  })

  it('does not apply layout when cytoscape instance is null', () => {
    render(
      <CausalGraphLayoutManager
        cytoscapeInstance={null}
      />
    )

    const hierarchicalButton = screen.getByRole('button', { name: /^cause to effect/i })
    fireEvent.click(hierarchicalButton)

    expect(mockCytoscapeInstance.layout).not.toHaveBeenCalled()
  })

  it('applies a layout from "More layouts"', async () => {
    renderLayoutManager()

    fireEvent.click(screen.getByRole('button', { name: 'More layouts' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^ring/i }))
    })

    expect(mockCytoscapeInstance.layout).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'circle' })
    )
  })

  it('names the current layout alongside its description', () => {
    renderLayoutManager()

    expect(screen.getByText('Clusters:')).toBeInTheDocument()
  })

  describe('Utility Constants Integration', () => {
    it('uses FIT_PADDING constant for fit operations', () => {
      renderLayoutManager()

      fireEvent.keyDown(document, { key: 'f' })

      expect(mockCytoscapeInstance.fit).toHaveBeenCalledWith(undefined, FIT_PADDING)
    })

    it('uses DEFAULT_ZOOM constant for reset operations', () => {
      renderLayoutManager()

      fireEvent.keyDown(document, { key: 'r' })

      expect(mockCytoscapeInstance.zoom).toHaveBeenCalledWith(DEFAULT_ZOOM)
    })

    it('supports all layout shortcuts from LAYOUT_SHORTCUTS', async () => {
      renderLayoutManager()

      // Test a subset of layout shortcuts (can't test all in sequence due to transition state)
      // Test first shortcut
      fireEvent.keyDown(document, { key: '1' })
      expect(mockCytoscapeInstance.layout).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'cose' })
      )

      // Verify the shortcuts mapping is correct
      expect(LAYOUT_SHORTCUTS['1']).toBe('cose')
      expect(LAYOUT_SHORTCUTS['2']).toBe('breadthfirst')
      expect(LAYOUT_SHORTCUTS['3']).toBe('circle')
      expect(LAYOUT_SHORTCUTS['4']).toBe('grid')
      expect(LAYOUT_SHORTCUTS['5']).toBe('concentric')
      expect(LAYOUT_SHORTCUTS['6']).toBe('dagre')
      expect(LAYOUT_SHORTCUTS['7']).toBe('cose-bilkent')
      expect(LAYOUT_SHORTCUTS['8']).toBe('random')
    })

    it('handles uppercase action shortcuts', () => {
      renderLayoutManager()

      fireEvent.keyDown(document, { key: 'F' })
      expect(mockCytoscapeInstance.fit).toHaveBeenCalledWith(undefined, FIT_PADDING)

      vi.clearAllMocks()

      fireEvent.keyDown(document, { key: 'R' })
      expect(mockCytoscapeInstance.zoom).toHaveBeenCalledWith(DEFAULT_ZOOM)
    })
  })

  describe('Textarea and Select Focus Handling', () => {
    it('ignores keyboard shortcuts when textarea is focused', () => {
      renderLayoutManager()

      const textarea = document.createElement('textarea')
      document.body.appendChild(textarea)
      textarea.focus()

      fireEvent.keyDown(textarea, { key: '2' })

      expect(mockCytoscapeInstance.layout).not.toHaveBeenCalled()

      document.body.removeChild(textarea)
    })

    it('ignores keyboard shortcuts when select is focused', () => {
      renderLayoutManager()

      const select = document.createElement('select')
      document.body.appendChild(select)
      select.focus()

      fireEvent.keyDown(select, { key: '2' })

      expect(mockCytoscapeInstance.layout).not.toHaveBeenCalled()

      document.body.removeChild(select)
    })
  })
})
