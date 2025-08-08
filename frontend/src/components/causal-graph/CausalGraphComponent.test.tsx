import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { CausalGraphComponent } from './CausalGraphComponent'
import { useGlobalStore } from '@/stores/globalStore'
import { Event, CausalRelationship } from '@/types'

// Mock Cytoscape
const mockElements = {
  remove: vi.fn()
}

const mockCytoscape = {
  on: vi.fn(),
  off: vi.fn(),
  nodes: vi.fn(() => ({
    forEach: vi.fn(),
    map: vi.fn(() => [])
  })),
  edges: vi.fn(() => ({
    map: vi.fn(() => [])
  })),
  elements: vi.fn(() => mockElements),
  add: vi.fn(),
  layout: vi.fn(() => ({
    run: vi.fn()
  })),
  fit: vi.fn(),
  animate: vi.fn(),
  getElementById: vi.fn(() => ({
    length: 1,
    select: vi.fn()
  })),
  destroy: vi.fn()
}

vi.mock('cytoscape', () => ({
  default: vi.fn(() => mockCytoscape)
}))

// Mock the global store
vi.mock('@/stores/globalStore', () => ({
  useGlobalStore: vi.fn()
}))

const mockUseGlobalStore = useGlobalStore as any

describe('CausalGraphComponent', () => {
  const mockEvents: Event[] = [
    {
      id: '1',
      description: 'Event 1',
      actor: 'Actor 1',
      target: 'Target 1',
      timestamp: '2023-01-01T00:00:00Z',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    },
    {
      id: '2',
      description: 'Event 2',
      actor: 'Actor 2',
      target: 'Target 2',
      timestamp: '2023-01-02T00:00:00Z',
      created_at: '2023-01-02T00:00:00Z',
      updated_at: '2023-01-02T00:00:00Z'
    }
  ]

  const mockCausalRelationships: CausalRelationship[] = [
    {
      id: 'rel1',
      cause_event_id: '1',
      effect_event_id: '2',
      weight: 0.8,
      evidence: 'Strong evidence',
      confidence: 0.9,
      relationship_type: 'direct',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    }
  ]

  const mockStoreState = {
    events: mockEvents,
    causalRelationships: mockCausalRelationships,
    selectedEvents: [],
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
    mockUseGlobalStore.mockReturnValue(mockStoreState)
    vi.clearAllMocks()
    // Reset mock elements
    mockElements.remove.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the causal graph container', async () => {
    render(<CausalGraphComponent />)
    
    // Check that the container is rendered
    const container = document.querySelector('.causal-graph-container')
    expect(container).toBeInTheDocument()
    
    // Wait for initialization
    await waitFor(() => {
      expect(mockCytoscape.add).toHaveBeenCalled()
    })
  })

  it('initializes Cytoscape with correct configuration', async () => {
    const cytoscape = await import('cytoscape')
    
    render(<CausalGraphComponent />)
    
    await waitFor(() => {
      expect(cytoscape.default).toHaveBeenCalledWith(
        expect.objectContaining({
          container: expect.any(HTMLElement),
          style: expect.any(Array),
          layout: expect.objectContaining({
            name: 'cose',
            animationDuration: 500,
            fit: true,
            padding: 50
          }),
          minZoom: 0.1,
          maxZoom: 3,
          wheelSensitivity: 0.2,
          motionBlur: true,
          selectionType: 'single',
          boxSelectionEnabled: false
        })
      )
    })
  })

  it('sets up event handlers for node and edge interactions', async () => {
    render(<CausalGraphComponent />)
    
    await waitFor(() => {
      expect(mockCytoscape.on).toHaveBeenCalledWith('tap', 'node', expect.any(Function))
      expect(mockCytoscape.on).toHaveBeenCalledWith('tap', 'edge', expect.any(Function))
      expect(mockCytoscape.on).toHaveBeenCalledWith('mouseover', 'node', expect.any(Function))
      expect(mockCytoscape.on).toHaveBeenCalledWith('mouseout', 'node', expect.any(Function))
      expect(mockCytoscape.on).toHaveBeenCalledWith('mouseover', 'edge', expect.any(Function))
      expect(mockCytoscape.on).toHaveBeenCalledWith('mouseout', 'edge', expect.any(Function))
      expect(mockCytoscape.on).toHaveBeenCalledWith('layoutstop', expect.any(Function))
    })
  })

  it('calls onNodeClick when a node is clicked', async () => {
    const onNodeClick = vi.fn()
    render(<CausalGraphComponent onNodeClick={onNodeClick} />)
    
    await waitFor(() => {
      expect(mockCytoscape.on).toHaveBeenCalledWith('tap', 'node', expect.any(Function))
    })
    
    // Simulate node click
    const nodeClickHandler = mockCytoscape.on.mock.calls.find(
      call => call[0] === 'tap' && call[1] === 'node'
    )?.[2]
    
    if (nodeClickHandler) {
      const mockEvent = {
        target: {
          data: () => ({
            id: '1',
            event: mockEvents[0]
          })
        }
      }
      nodeClickHandler(mockEvent)
      expect(onNodeClick).toHaveBeenCalledWith(mockEvents[0])
    }
  })

  it('calls onEdgeClick when an edge is clicked', async () => {
    const onEdgeClick = vi.fn()
    render(<CausalGraphComponent onEdgeClick={onEdgeClick} />)
    
    await waitFor(() => {
      expect(mockCytoscape.on).toHaveBeenCalledWith('tap', 'edge', expect.any(Function))
    })
    
    // Simulate edge click
    const edgeClickHandler = mockCytoscape.on.mock.calls.find(
      call => call[0] === 'tap' && call[1] === 'edge'
    )?.[2]
    
    if (edgeClickHandler) {
      const mockEvent = {
        target: {
          data: () => ({
            id: 'rel1',
            relationship: mockCausalRelationships[0]
          })
        }
      }
      edgeClickHandler(mockEvent)
      expect(onEdgeClick).toHaveBeenCalledWith(mockCausalRelationships[0])
    }
  })

  it('calls onNodeHover when a node is hovered', async () => {
    const onNodeHover = vi.fn()
    render(<CausalGraphComponent onNodeHover={onNodeHover} />)
    
    await waitFor(() => {
      expect(mockCytoscape.on).toHaveBeenCalledWith('mouseover', 'node', expect.any(Function))
    })
    
    // Simulate node hover
    const nodeHoverHandler = mockCytoscape.on.mock.calls.find(
      call => call[0] === 'mouseover' && call[1] === 'node'
    )?.[2]
    
    if (nodeHoverHandler) {
      const mockEvent = {
        target: {
          data: () => ({
            id: '1',
            event: mockEvents[0]
          }),
          addClass: vi.fn()
        }
      }
      nodeHoverHandler(mockEvent)
      expect(onNodeHover).toHaveBeenCalledWith(mockEvents[0])
      expect(mockEvent.target.addClass).toHaveBeenCalledWith('highlighted')
    }
  })

  it('calls onEdgeHover when an edge is hovered', async () => {
    const onEdgeHover = vi.fn()
    render(<CausalGraphComponent onEdgeHover={onEdgeHover} />)
    
    await waitFor(() => {
      expect(mockCytoscape.on).toHaveBeenCalledWith('mouseover', 'edge', expect.any(Function))
    })
    
    // Simulate edge hover
    const edgeHoverHandler = mockCytoscape.on.mock.calls.find(
      call => call[0] === 'mouseover' && call[1] === 'edge'
    )?.[2]
    
    if (edgeHoverHandler) {
      const mockEvent = {
        target: {
          data: () => ({
            id: 'rel1',
            relationship: mockCausalRelationships[0]
          }),
          addClass: vi.fn()
        }
      }
      edgeHoverHandler(mockEvent)
      expect(onEdgeHover).toHaveBeenCalledWith(mockCausalRelationships[0])
      expect(mockEvent.target.addClass).toHaveBeenCalledWith('highlighted show-label')
    }
  })

  it('updates graph data when events or relationships change', async () => {
    const { rerender } = render(<CausalGraphComponent />)
    
    // Wait for initial render
    await waitFor(() => {
      expect(mockCytoscape.add).toHaveBeenCalled()
    })
    
    // Clear previous calls
    vi.clearAllMocks()
    
    // Update store with new data
    const newEvents = [...mockEvents, {
      id: '3',
      description: 'Event 3',
      actor: 'Actor 3',
      target: 'Target 3',
      timestamp: '2023-01-03T00:00:00Z',
      created_at: '2023-01-03T00:00:00Z',
      updated_at: '2023-01-03T00:00:00Z'
    }]
    
    mockUseGlobalStore.mockReturnValue({
      ...mockStoreState,
      events: newEvents
    })
    
    rerender(<CausalGraphComponent />)
    
    await waitFor(() => {
      expect(mockCytoscape.elements().remove).toHaveBeenCalled()
      expect(mockCytoscape.add).toHaveBeenCalled()
    })
  })

  it('focuses on event when focusEventId prop changes', async () => {
    const { rerender } = render(<CausalGraphComponent />)
    
    await waitFor(() => {
      expect(mockCytoscape.add).toHaveBeenCalled()
    })
    
    // Focus on specific event
    rerender(<CausalGraphComponent focusEventId="1" />)
    
    await waitFor(() => {
      expect(mockCytoscape.getElementById).toHaveBeenCalledWith('1')
      expect(mockCytoscape.animate).toHaveBeenCalledWith(
        expect.objectContaining({
          zoom: 1.5
        }),
        expect.objectContaining({
          duration: 500
        })
      )
    })
  })

  it('applies custom className', () => {
    render(<CausalGraphComponent className="custom-class" />)
    
    const container = document.querySelector('.causal-graph-container')
    expect(container).toHaveClass('custom-class')
  })

  it('transforms data correctly for Cytoscape', async () => {
    render(<CausalGraphComponent />)
    
    await waitFor(() => {
      expect(mockCytoscape.add).toHaveBeenCalledWith(
        expect.arrayContaining([
          // Nodes
          expect.objectContaining({
            data: expect.objectContaining({
              id: '1',
              event: mockEvents[0],
              label: 'Actor 1 → Target 1',
              weight: 0.5,
              isSelected: false,
              isHighlighted: false
            })
          }),
          expect.objectContaining({
            data: expect.objectContaining({
              id: '2',
              event: mockEvents[1],
              label: 'Actor 2 → Target 2',
              weight: 0.5,
              isSelected: false,
              isHighlighted: false
            })
          }),
          // Edges
          expect.objectContaining({
            data: expect.objectContaining({
              id: 'rel1',
              source: '1',
              target: '2',
              relationship: mockCausalRelationships[0],
              weight: 0.8,
              label: '0.80 (0.90)',
              isSelected: false,
              isHighlighted: false
            })
          })
        ])
      )
    })
  })

  it('saves layout positions when layout stops', async () => {
    render(<CausalGraphComponent />)
    
    await waitFor(() => {
      expect(mockCytoscape.on).toHaveBeenCalledWith('layoutstop', expect.any(Function))
    })
    
    // Simulate layout stop
    const layoutStopHandler = mockCytoscape.on.mock.calls.find(
      call => call[0] === 'layoutstop'
    )?.[2]
    
    if (layoutStopHandler) {
      // Mock nodes with positions
      mockCytoscape.nodes.mockReturnValue({
        forEach: (callback: any) => {
          callback({
            id: () => '1',
            position: () => ({ x: 100, y: 200 })
          })
          callback({
            id: () => '2',
            position: () => ({ x: 300, y: 400 })
          })
        }
      })
      
      layoutStopHandler()
      
      expect(mockStoreState.updateSessionData).toHaveBeenCalledWith({
        viewportState: {
          ...mockStoreState.sessionData.viewportState,
          causalGraph: {
            ...mockStoreState.sessionData.viewportState.causalGraph,
            nodePositions: {
              '1': { x: 100, y: 200 },
              '2': { x: 300, y: 400 }
            }
          }
        }
      })
    }
  })

  it('cleans up Cytoscape instance on unmount', async () => {
    const { unmount } = render(<CausalGraphComponent />)
    
    await waitFor(() => {
      expect(mockCytoscape.add).toHaveBeenCalled()
    })
    
    unmount()
    
    expect(mockCytoscape.destroy).toHaveBeenCalled()
  })

  it('handles empty data gracefully', async () => {
    mockUseGlobalStore.mockReturnValue({
      ...mockStoreState,
      events: [],
      causalRelationships: []
    })
    
    render(<CausalGraphComponent />)
    
    await waitFor(() => {
      expect(mockCytoscape.add).toHaveBeenCalledWith([])
    })
  })

  it('respects maxDepth prop', async () => {
    render(<CausalGraphComponent maxDepth={5} />)
    
    // This would be tested more thoroughly when path exploration is implemented
    // For now, just ensure the prop is accepted without errors
    const container = document.querySelector('.causal-graph-container')
    expect(container).toBeInTheDocument()
    
    // Wait for initialization
    await waitFor(() => {
      expect(mockCytoscape.add).toHaveBeenCalled()
    })
  })
})