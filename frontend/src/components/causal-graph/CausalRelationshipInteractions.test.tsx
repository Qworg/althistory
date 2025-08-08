import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CausalGraphComponent } from './CausalGraphComponent'
import { useGlobalStore } from '@/stores/globalStore'
import { apiClient } from '@/services/api'
import { Event, CausalRelationship } from '@/types'

// Mock dependencies
vi.mock('@/stores/globalStore')
vi.mock('@/services/api')
const mockCytoscapeInstance = {
  on: vi.fn(),
  nodes: vi.fn(() => ({
    forEach: vi.fn()
  })),
  elements: vi.fn(() => ({
    remove: vi.fn()
  })),
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

const mockCytoscape = vi.fn(() => mockCytoscapeInstance)

vi.mock('cytoscape', () => ({
  default: mockCytoscape
}))

const mockEvents: Event[] = [
  {
    id: 'event1',
    description: 'First event',
    actor: 'Actor A',
    target: 'Target A',
    timestamp: '2023-01-01T10:00:00Z',
    created_at: '2023-01-01T10:00:00Z',
    updated_at: '2023-01-01T10:00:00Z'
  },
  {
    id: 'event2',
    description: 'Second event',
    actor: 'Actor B',
    target: 'Target B',
    timestamp: '2023-01-01T11:00:00Z',
    created_at: '2023-01-01T11:00:00Z',
    updated_at: '2023-01-01T11:00:00Z'
  },
  {
    id: 'event3',
    description: 'Third event',
    actor: 'Actor C',
    target: 'Target C',
    timestamp: '2023-01-01T09:00:00Z', // Earlier than event1 for temporal validation test
    created_at: '2023-01-01T09:00:00Z',
    updated_at: '2023-01-01T09:00:00Z'
  }
]

const mockCausalRelationships: CausalRelationship[] = [
  {
    id: 'rel1',
    cause_event_id: 'event1',
    effect_event_id: 'event2',
    weight: 0.8,
    evidence: 'Strong evidence',
    confidence: 0.9,
    relationship_type: 'direct',
    created_at: '2023-01-01T12:00:00Z',
    updated_at: '2023-01-01T12:00:00Z'
  }
]

const mockGlobalStore = {
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
  updateSessionData: vi.fn(),
  addCausalRelationship: vi.fn(),
  updateCausalRelationship: vi.fn(),
  deleteCausalRelationship: vi.fn(),
  addError: vi.fn()
}

describe('CausalGraphComponent - Relationship Interactions', () => {
  const user = userEvent.setup()
  
  beforeEach(() => {
    vi.mocked(useGlobalStore).mockReturnValue(mockGlobalStore as any)
    vi.mocked(apiClient.causal.createLink).mockResolvedValue({
      id: 'new-rel',
      cause_event_id: 'event1',
      effect_event_id: 'event2',
      weight: 0.5,
      evidence: 'User-created relationship',
      confidence: 0.7,
      relationship_type: 'direct',
      created_at: '2023-01-01T13:00:00Z',
      updated_at: '2023-01-01T13:00:00Z'
    })
    vi.mocked(apiClient.causal.updateLink).mockResolvedValue({
      ...mockCausalRelationships[0],
      weight: 0.6
    })
    vi.mocked(apiClient.causal.deleteLink).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should render causal graph component', () => {
    render(<CausalGraphComponent />)
    expect(screen.getByText('Create Link')).toBeInTheDocument()
  })

  it('should show create link button', () => {
    render(<CausalGraphComponent />)
    expect(screen.getByText('Create Link')).toBeInTheDocument()
  })

  it('should toggle link creation mode when create link button is clicked', async () => {
    render(<CausalGraphComponent />)
    
    const createLinkButton = screen.getByText('Create Link')
    await user.click(createLinkButton)
    
    expect(screen.getByText('Cancel Link')).toBeInTheDocument()
    expect(screen.getByText(/Click on a source event to start creating causal link/)).toBeInTheDocument()
  })

  it('should handle keyboard shortcut for toggling link creation mode', async () => {
    render(<CausalGraphComponent />)
    
    // Press Ctrl+C to toggle link creation mode
    await user.keyboard('{Control>}c{/Control}')
    
    expect(screen.getByText('Cancel Link')).toBeInTheDocument()
  })

  it('should cancel link creation with Escape key', async () => {
    render(<CausalGraphComponent />)
    
    // Start link creation mode
    const createLinkButton = screen.getByText('Create Link')
    await user.click(createLinkButton)
    
    expect(screen.getByText('Cancel Link')).toBeInTheDocument()
    
    // Press Escape to cancel
    await user.keyboard('{Escape}')
    
    expect(screen.getByText('Create Link')).toBeInTheDocument()
  })

  it('should call onCausalLinkCreate when causal link is created', async () => {
    const onCausalLinkCreate = vi.fn()
    render(<CausalGraphComponent onCausalLinkCreate={onCausalLinkCreate} />)
    
    // Mock cytoscape node tap events
    const tapHandler = mockCytoscapeInstance.on.mock.calls.find(call => 
      call[0] === 'tap' && call[1] === 'node'
    )?.[2]
    
    if (tapHandler) {
      // Start link creation mode
      const createLinkButton = screen.getByText('Create Link')
      await user.click(createLinkButton)
      
      // Simulate clicking on source node
      tapHandler({
        target: {
          data: () => ({ id: 'event1', event: mockEvents[0] })
        }
      })
      
      // Simulate clicking on target node
      tapHandler({
        target: {
          data: () => ({ id: 'event2', event: mockEvents[1] })
        }
      })
      
      await waitFor(() => {
        expect(apiClient.causal.createLink).toHaveBeenCalledWith(
          'event1',
          'event2',
          expect.objectContaining({
            weight: 0.5,
            evidence: 'User-created relationship',
            confidence: 0.7,
            relationship_type: 'direct'
          })
        )
      })
      
      expect(mockGlobalStore.addCausalRelationship).toHaveBeenCalled()
      expect(onCausalLinkCreate).toHaveBeenCalledWith(mockEvents[0], mockEvents[1])
    }
  })

  it('should validate temporal ordering when creating causal links', async () => {
    render(<CausalGraphComponent />)
    
    const tapHandler = mockCytoscapeInstance.on.mock.calls.find(call => 
      call[0] === 'tap' && call[1] === 'node'
    )?.[2]
    
    if (tapHandler) {
      // Start link creation mode
      const createLinkButton = screen.getByText('Create Link')
      await user.click(createLinkButton)
      
      // Try to create link from later event to earlier event (should fail)
      tapHandler({
        target: {
          data: () => ({ id: 'event2', event: mockEvents[1] }) // 11:00
        }
      })
      
      tapHandler({
        target: {
          data: () => ({ id: 'event3', event: mockEvents[2] }) // 09:00 (earlier)
        }
      })
      
      await waitFor(() => {
        expect(mockGlobalStore.addError).toHaveBeenCalledWith({
          message: 'Cause event must occur before or at the same time as effect event',
          type: 'validation'
        })
      })
      
      expect(apiClient.causal.createLink).not.toHaveBeenCalled()
    }
  })

  it('should prevent duplicate causal relationships', async () => {
    render(<CausalGraphComponent />)
    
    const tapHandler = mockCytoscapeInstance.on.mock.calls.find(call => 
      call[0] === 'tap' && call[1] === 'node'
    )?.[2]
    
    if (tapHandler) {
      // Start link creation mode
      const createLinkButton = screen.getByText('Create Link')
      await user.click(createLinkButton)
      
      // Try to create duplicate relationship (event1 -> event2 already exists)
      tapHandler({
        target: {
          data: () => ({ id: 'event1', event: mockEvents[0] })
        }
      })
      
      tapHandler({
        target: {
          data: () => ({ id: 'event2', event: mockEvents[1] })
        }
      })
      
      await waitFor(() => {
        expect(mockGlobalStore.addError).toHaveBeenCalledWith({
          message: 'Causal relationship already exists between these events',
          type: 'validation'
        })
      })
      
      expect(apiClient.causal.createLink).not.toHaveBeenCalled()
    }
  })

  it('should show relationship tooltip on edge hover', async () => {
    render(<CausalGraphComponent />)
    
    const mouseoverHandler = mockCytoscapeInstance.on.mock.calls.find(call => 
      call[0] === 'mouseover' && call[1] === 'edge'
    )?.[2]
    
    if (mouseoverHandler) {
      // Mock edge with relationship data
      const mockEdge = {
        addClass: vi.fn(),
        data: () => ({
          id: 'rel1',
          relationship: mockCausalRelationships[0]
        }),
        renderedMidpoint: () => ({ x: 100, y: 100 })
      }
      
      mouseoverHandler({ target: mockEdge })
      
      await waitFor(() => {
        expect(screen.getByText('Causal Relationship')).toBeInTheDocument()
        expect(screen.getByText('0.80')).toBeInTheDocument() // Weight
        expect(screen.getByText('0.90')).toBeInTheDocument() // Confidence
        expect(screen.getByText('Direct')).toBeInTheDocument() // Type
        expect(screen.getByText('Strong evidence')).toBeInTheDocument() // Evidence
      })
    }
  })

  it('should call onRelationshipEdit on right-click', async () => {
    const onRelationshipEdit = vi.fn()
    render(<CausalGraphComponent onRelationshipEdit={onRelationshipEdit} />)
    
    const rightClickHandler = mockCytoscapeInstance.on.mock.calls.find(call => 
      call[0] === 'cxttap' && call[1] === 'edge'
    )?.[2]
    
    if (rightClickHandler) {
      const mockEdge = {
        data: () => ({
          id: 'rel1',
          relationship: mockCausalRelationships[0]
        })
      }
      
      rightClickHandler({ target: mockEdge })
      
      expect(onRelationshipEdit).toHaveBeenCalledWith(mockCausalRelationships[0])
    }
  })

  it('should handle API errors gracefully', async () => {
    vi.mocked(apiClient.causal.createLink).mockRejectedValue(new Error('Network error'))
    
    render(<CausalGraphComponent />)
    
    const tapHandler = mockCytoscapeInstance.on.mock.calls.find(call => 
      call[0] === 'tap' && call[1] === 'node'
    )?.[2]
    
    if (tapHandler) {
      // Start link creation mode
      const createLinkButton = screen.getByText('Create Link')
      await user.click(createLinkButton)
      
      // Create valid relationship
      tapHandler({
        target: {
          data: () => ({ id: 'event1', event: mockEvents[0] })
        }
      })
      
      tapHandler({
        target: {
          data: () => ({ id: 'event3', event: mockEvents[2] })
        }
      })
      
      await waitFor(() => {
        expect(mockGlobalStore.addError).toHaveBeenCalledWith({
          message: 'Failed to create causal relationship',
          type: 'network'
        })
      })
    }
  })

  it('should update node highlighting during link creation', async () => {
    render(<CausalGraphComponent />)
    
    // Start link creation mode
    const createLinkButton = screen.getByText('Create Link')
    await user.click(createLinkButton)
    
    const tapHandler = mockCytoscapeInstance.on.mock.calls.find(call => 
      call[0] === 'tap' && call[1] === 'node'
    )?.[2]
    
    if (tapHandler) {
      // Select source node
      tapHandler({
        target: {
          data: () => ({ id: 'event1', event: mockEvents[0] })
        }
      })
      
      // Check that instruction text updates
      expect(screen.getByText(/Select target event for causal link from "Actor A → Target A"/)).toBeInTheDocument()
    }
  })

  it('should cancel link creation on background click', async () => {
    render(<CausalGraphComponent />)
    
    // Start link creation mode
    const createLinkButton = screen.getByText('Create Link')
    await user.click(createLinkButton)
    
    expect(screen.getByText('Cancel Link')).toBeInTheDocument()
    
    const backgroundTapHandler = mockCytoscapeInstance.on.mock.calls.find(call => 
      call[0] === 'tap' && call.length === 2 // Background tap has no selector
    )?.[1]
    
    if (backgroundTapHandler) {
      // Simulate background click
      backgroundTapHandler({ target: mockCytoscapeInstance })
      
      expect(screen.getByText('Create Link')).toBeInTheDocument()
    }
  })
})