import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CausalGraphLayoutManager } from './CausalGraphLayoutManager'
import { useGlobalStore } from '@/stores/globalStore'

// Mock the global store
vi.mock('@/stores/globalStore')
const mockUseGlobalStore = vi.mocked(useGlobalStore)

// Mock Cytoscape
const mockCytoscapeInstance = {
  layout: vi.fn().mockReturnValue({
    run: vi.fn(),
    on: vi.fn()
  }),
  fit: vi.fn(),
  zoom: vi.fn(),
  center: vi.fn(),
  nodes: vi.fn().mockReturnValue({
    forEach: vi.fn()
  })
}

describe('CausalGraphLayoutManager', () => {
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
    mockUseGlobalStore.mockReturnValue(mockStore as any)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const renderLayoutManager = (props = {}) => {
    return render(
      <CausalGraphLayoutManager
        cytoscapeInstance={mockCytoscapeInstance as any}
        {...props}
      />
    )
  }

  it('renders layout categories and options', () => {
    renderLayoutManager()
    
    expect(screen.getByText('Graph Layout')).toBeInTheDocument()
    expect(screen.getByText('FORCE-BASED')).toBeInTheDocument()
    expect(screen.getByText('HIERARCHICAL')).toBeInTheDocument()
    expect(screen.getByText('CIRCULAR')).toBeInTheDocument()
    expect(screen.getByText('GRID-BASED')).toBeInTheDocument()
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
    fireEvent.click(hierarchicalButton)
    
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
    renderLayoutManager({ cytoscapeInstance: null })
    
    const hierarchicalButton = screen.getByRole('button', { name: /hierarchical/i })
    fireEvent.click(hierarchicalButton)
    
    expect(mockCytoscapeInstance.layout).not.toHaveBeenCalled()
  })

  it('groups layouts by category correctly', () => {
    renderLayoutManager()
    
    // Check that layouts are grouped under correct categories
    const forceSection = screen.getByText('FORCE-BASED').closest('div')
    const hierarchicalSection = screen.getByText('HIERARCHICAL').closest('div')
    const circularSection = screen.getByText('CIRCULAR').closest('div')
    const gridSection = screen.getByText('GRID-BASED').closest('div')
    
    expect(forceSection).toContainElement(screen.getByRole('button', { name: /force-directed/i }))
    expect(hierarchicalSection).toContainElement(screen.getByRole('button', { name: /hierarchical/i }))
    expect(circularSection).toContainElement(screen.getByRole('button', { name: /circular/i }))
    expect(gridSection).toContainElement(screen.getByRole('button', { name: /grid/i }))
  })
})