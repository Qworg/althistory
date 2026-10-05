import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

  it('renders layout categories and options', () => {
    renderLayoutManager()

    expect(screen.getByText('Graph Layout')).toBeInTheDocument()
    // CSS uppercase class makes text appear uppercase, but actual DOM text is title case
    // Use h4 selector since category headers use h4 elements
    expect(screen.getByRole('heading', { name: /force-based/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /hierarchical/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /circular/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /grid-based/i })).toBeInTheDocument()
  })

  it('shows current active layout', () => {
    renderLayoutManager()

    const forceDirectedButton = screen.getByRole('button', { name: /force-directed/i })
    expect(forceDirectedButton).toHaveClass('bg-blue-100', 'text-blue-700')
  })

  it('applies layout when button is clicked', async () => {
    const onLayoutChange = vi.fn()
    renderLayoutManager({ onLayoutChange })

    const hierarchicalButton = screen.getByRole('button', { name: /hierarchical/i })

    await act(async () => {
      fireEvent.click(hierarchicalButton)
    })

    await waitFor(() => {
      expect(mockCytoscapeInstance.layout).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'breadthfirst' })
      )
      expect(mockStore.updateSessionData).toHaveBeenCalled()
      expect(onLayoutChange).toHaveBeenCalledWith('breadthfirst')
    })
  })

  it('shows loading state during transition', async () => {
    renderLayoutManager()

    const circularButton = screen.getByRole('button', { name: /circular/i })
    fireEvent.click(circularButton)

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

    expect(mockCytoscapeInstance.fit).toHaveBeenCalledWith(undefined, 50)
  })

  it('handles reset zoom shortcut', () => {
    renderLayoutManager()

    fireEvent.keyDown(document, { key: 'r' })

    expect(mockCytoscapeInstance.zoom).toHaveBeenCalledWith(1)
    expect(mockCytoscapeInstance.center).toHaveBeenCalled()
  })

  it('shows layout description for current layout', () => {
    renderLayoutManager()

    expect(screen.getByText(/physics-based layout with node repulsion/i)).toBeInTheDocument()
  })

  it('shows keyboard shortcut hints on hover', async () => {
    renderLayoutManager()

    const forceDirectedButton = screen.getByRole('button', { name: /force-directed/i })
    fireEvent.mouseEnter(forceDirectedButton)

    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument()
    })
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

  it('disables buttons during transition', async () => {
    renderLayoutManager()

    const hierarchicalButton = screen.getByRole('button', { name: /hierarchical/i })
    fireEvent.click(hierarchicalButton)

    // All buttons should be disabled during transition
    const buttons = screen.getAllByRole('button')
    buttons.forEach(button => {
      if (button.textContent?.includes('Hierarchical') ||
          button.textContent?.includes('Force-Directed') ||
          button.textContent?.includes('Circular')) {
        expect(button).toBeDisabled()
      }
    })
  })

  it('shows tooltips with layout descriptions', () => {
    renderLayoutManager()

    const forceDirectedButton = screen.getByRole('button', { name: /force-directed/i })
    expect(forceDirectedButton).toHaveAttribute('title', expect.stringContaining('Physics-based layout'))
  })

  it('handles preview mode when enabled', () => {
    renderLayoutManager({ showLayoutPreview: true })

    const hierarchicalButton = screen.getByRole('button', { name: /hierarchical/i })

    // Mouse enter should trigger preview
    fireEvent.mouseEnter(hierarchicalButton)

    expect(mockCytoscapeInstance.layout).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'breadthfirst',
        animationDuration: 300,
        fit: false
      })
    )
  })

  it('cancels preview on mouse leave', () => {
    renderLayoutManager({ showLayoutPreview: true })

    const hierarchicalButton = screen.getByRole('button', { name: /hierarchical/i })

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

    const hierarchicalButton = screen.getByRole('button', { name: /hierarchical/i })
    fireEvent.click(hierarchicalButton)

    expect(mockCytoscapeInstance.layout).not.toHaveBeenCalled()
  })

  it('groups layouts by category correctly', () => {
    renderLayoutManager()

    // Check that layouts are grouped under correct categories
    // Use heading role to distinguish category headers from button labels
    const forceSection = screen.getByRole('heading', { name: /force-based/i }).closest('div')
    const hierarchicalSection = screen.getByRole('heading', { name: /hierarchical/i }).closest('div')
    const circularSection = screen.getByRole('heading', { name: /circular/i }).closest('div')
    const gridSection = screen.getByRole('heading', { name: /grid-based/i }).closest('div')

    expect(forceSection).toContainElement(screen.getByRole('button', { name: /force-directed/i }))
    expect(hierarchicalSection).toContainElement(screen.getByRole('button', { name: /hierarchical/i }))
    expect(circularSection).toContainElement(screen.getByRole('button', { name: /circular/i }))
    expect(gridSection).toContainElement(screen.getByRole('button', { name: /grid/i }))
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
