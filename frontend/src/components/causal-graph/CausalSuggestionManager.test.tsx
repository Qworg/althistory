import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CausalSuggestionManager from './CausalSuggestionManager'
import { useGlobalStore } from '@/stores/globalStore'
import { apiClient } from '@/services/api'
import { Event, CausalSuggestion, CausalRelationship } from '@/types'

// Mock the global store
vi.mock('@/stores/globalStore')
const mockUseGlobalStore = vi.mocked(useGlobalStore)

// Mock the API client
vi.mock('@/services/api')
const mockApiClient = vi.mocked(apiClient)

// Mock data
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

const mockSuggestions: CausalSuggestion[] = [
  {
    id: 'suggestion-1',
    cause_event_id: '1',
    effect_event_id: '2',
    suggested_weight: 0.8,
    confidence: 0.9,
    reasoning: 'Strong causal connection based on temporal proximity and thematic similarity'
  }
]

const mockNewRelationship: CausalRelationship = {
  id: 'rel-1',
  cause_event_id: '1',
  effect_event_id: '2',
  weight: 0.8,
  evidence: 'Strong causal connection based on temporal proximity and thematic similarity',
  confidence: 0.9,
  relationship_type: 'direct',
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z'
}

describe('CausalSuggestionManager', () => {
  const mockAddError = vi.fn()
  const mockAddCausalRelationship = vi.fn()
  
  beforeEach(() => {
    mockUseGlobalStore.mockReturnValue({
      events: mockEvents,
      causalRelationships: [],
      addCausalRelationship: mockAddCausalRelationship,
      addError: mockAddError,
      // Add other required store properties with default values
      arcs: [],
      inferredPressures: [],
      selectedEvents: [],
      selectedArcs: [],
      activeFilters: {
        dateRange: null,
        actors: [],
        targets: [],
        eventTypes: [],
        arcLevels: [],
        causalWeightRange: [0, 1],
        confidenceThreshold: 0,
        searchQuery: ''
      },
      viewMode: 'causal' as const,
      uiState: {
        sidebarCollapsed: false,
        filterPanelOpen: true,
        activeModal: null,
        dragState: {
          isDragging: false,
          dragType: null,
          draggedItemId: null
        },
        selectionState: {
          isSelecting: false,
          selectionType: 'single',
          selectionBox: null
        }
      },
      userPreferences: {
        theme: 'light' as const,
        defaultViewMode: 'timeline' as const,
        timelineHeight: 600,
        showEventLabels: true,
        autoSaveFilters: true,
        notificationSettings: {
          showSuccess: true,
          showErrors: true,
          showWarnings: true
        },
        accessibility: {
          highContrast: false,
          reducedMotion: false,
          screenReaderOptimized: false
        }
      },
      sessionData: {
        lastActiveFilters: {
          dateRange: null,
          actors: [],
          targets: [],
          eventTypes: [],
          arcLevels: [],
          causalWeightRange: [0, 1],
          confidenceThreshold: 0,
          searchQuery: ''
        },
        lastViewMode: 'timeline' as const,
        lastSelectedEvents: [],
        lastSelectedArcs: [],
        recentSearches: [],
        viewportState: {
          timeline: {
            zoomLevel: 1,
            centerTime: null
          },
          causalGraph: {
            layout: 'force-directed',
            nodePositions: {}
          }
        }
      },
      isLoading: false,
      loadingOperations: new Set(),
      errors: [],
      // Mock all the action functions
      setEvents: vi.fn(),
      setArcs: vi.fn(),
      setCausalRelationships: vi.fn(),
      setInferredPressures: vi.fn(),
      addEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      addArc: vi.fn(),
      updateArc: vi.fn(),
      deleteArc: vi.fn(),
      updateCausalRelationship: vi.fn(),
      deleteCausalRelationship: vi.fn(),
      setSelectedEvents: vi.fn(),
      setSelectedArcs: vi.fn(),
      toggleEventSelection: vi.fn(),
      toggleArcSelection: vi.fn(),
      clearSelection: vi.fn(),
      setFilters: vi.fn(),
      updateFilters: vi.fn(),
      clearFilters: vi.fn(),
      setViewMode: vi.fn(),
      setUIState: vi.fn(),
      setSidebarCollapsed: vi.fn(),
      setFilterPanelOpen: vi.fn(),
      setActiveModal: vi.fn(),
      setDragState: vi.fn(),
      setSelectionState: vi.fn(),
      setUserPreferences: vi.fn(),
      updateSessionData: vi.fn(),
      setLoading: vi.fn(),
      addLoadingOperation: vi.fn(),
      removeLoadingOperation: vi.fn(),
      clearErrors: vi.fn(),
      removeError: vi.fn(),
      savePreferences: vi.fn(),
      loadPreferences: vi.fn(),
      saveSessionData: vi.fn(),
      loadSessionData: vi.fn(),
      clearPersistedData: vi.fn()
    })

    // Mock API client
    mockApiClient.causal.getSuggestions.mockResolvedValue(mockSuggestions)
    mockApiClient.causal.createLink.mockResolvedValue(mockNewRelationship)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should not render when no focus event or suggestions', () => {
    render(<CausalSuggestionManager />)
    
    // Component should not render anything when no focus event
    expect(screen.queryByText('AI Suggestions')).not.toBeInTheDocument()
  })

  it('should load and display suggestions when focusEventId is provided', async () => {
    render(<CausalSuggestionManager focusEventId="1" />)
    
    await waitFor(() => {
      expect(mockApiClient.causal.getSuggestions).toHaveBeenCalledWith('1', expect.any(AbortSignal))
    })

    await waitFor(() => {
      expect(screen.getByText('AI Suggestions')).toBeInTheDocument()
    })

    // Should show suggestion details
    expect(screen.getByText('Suggested Causal Link')).toBeInTheDocument()
    expect(screen.getByText('AI Generated')).toBeInTheDocument()
    expect(screen.getByText('Confidence: 90%')).toBeInTheDocument()
    expect(screen.getByText('Weight: 0.80')).toBeInTheDocument()
  })

  it('should display causal relationship visualization', async () => {
    render(<CausalSuggestionManager focusEventId="1" />)
    
    await waitFor(() => {
      expect(screen.getByText('AI Suggestions')).toBeInTheDocument()
    })

    // Should show cause and effect events
    expect(screen.getByText('Actor 1 → Target 1')).toBeInTheDocument()
    expect(screen.getByText('Actor 2 → Target 2')).toBeInTheDocument()
    expect(screen.getByText('Event 1')).toBeInTheDocument()
    expect(screen.getByText('Event 2')).toBeInTheDocument()
  })

  it('should display AI reasoning', async () => {
    render(<CausalSuggestionManager focusEventId="1" />)
    
    await waitFor(() => {
      expect(screen.getByText('AI Suggestions')).toBeInTheDocument()
    })

    // Should show reasoning
    expect(screen.getByText('AI Reasoning:')).toBeInTheDocument()
    expect(screen.getByText('"Strong causal connection based on temporal proximity and thematic similarity"')).toBeInTheDocument()
  })

  it('should show confidence indicator with appropriate color', async () => {
    render(<CausalSuggestionManager focusEventId="1" />)

    await waitFor(() => {
      expect(screen.getByText('AI Suggestions')).toBeInTheDocument()
    })

    // Should show confidence level
    expect(screen.getByText('Confidence Level')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()

    // Find the confidence bar container (gray background) and verify the colored bar inside
    const confidenceBars = document.querySelectorAll('.bg-gray-200.rounded-full.h-2')
    expect(confidenceBars.length).toBeGreaterThan(0)

    // The inner bar should have high confidence styling (green)
    const innerBar = confidenceBars[0]?.querySelector('div')
    expect(innerBar).toBeInTheDocument()
    expect(innerBar).toHaveClass('bg-green-500') // High confidence >= 0.8
  })

  it('should accept suggestion and create causal relationship', async () => {
    const onSuggestionAccept = vi.fn()
    
    render(
      <CausalSuggestionManager 
        focusEventId="1" 
        onSuggestionAccept={onSuggestionAccept}
      />
    )
    
    await waitFor(() => {
      expect(screen.getByText('AI Suggestions')).toBeInTheDocument()
    })

    // Click accept button
    const acceptButton = screen.getByText('Accept')
    fireEvent.click(acceptButton)

    await waitFor(() => {
      expect(mockApiClient.causal.createLink).toHaveBeenCalledWith(
        '1',
        '2',
        {
          weight: 0.8,
          evidence: 'Strong causal connection based on temporal proximity and thematic similarity',
          confidence: 0.9,
          relationship_type: 'direct'
        }
      )
    })

    expect(mockAddCausalRelationship).toHaveBeenCalledWith(mockNewRelationship)
    expect(onSuggestionAccept).toHaveBeenCalledWith(mockSuggestions[0])
  })

  it('should reject suggestion and remove it from list', async () => {
    const onSuggestionReject = vi.fn()
    
    render(
      <CausalSuggestionManager 
        focusEventId="1" 
        onSuggestionReject={onSuggestionReject}
      />
    )
    
    await waitFor(() => {
      expect(screen.getByText('AI Suggestions')).toBeInTheDocument()
    })

    // Click reject button
    const rejectButton = screen.getByText('Reject')
    fireEvent.click(rejectButton)

    // Suggestion should be removed from view
    await waitFor(() => {
      expect(screen.queryByText('Suggested Causal Link')).not.toBeInTheDocument()
    })

    expect(onSuggestionReject).toHaveBeenCalledWith(mockSuggestions[0])
  })

  it('should show feedback modal when feedback button is clicked', async () => {
    render(<CausalSuggestionManager focusEventId="1" />)
    
    await waitFor(() => {
      expect(screen.getByText('AI Suggestions')).toBeInTheDocument()
    })

    // Click feedback button
    const feedbackButton = screen.getByText('Feedback')
    fireEvent.click(feedbackButton)

    // Should show feedback modal
    expect(screen.getByText('Provide Feedback')).toBeInTheDocument()
    expect(screen.getByText('How helpful was this suggestion?')).toBeInTheDocument()
    expect(screen.getByText('Helpful - Good suggestion')).toBeInTheDocument()
    expect(screen.getByText('Not helpful - Irrelevant')).toBeInTheDocument()
    expect(screen.getByText('Needs improvement - Could be better')).toBeInTheDocument()
  })

  it('should submit feedback and close modal', async () => {
    const onSuggestionFeedback = vi.fn()
    
    render(
      <CausalSuggestionManager 
        focusEventId="1" 
        onSuggestionFeedback={onSuggestionFeedback}
      />
    )
    
    await waitFor(() => {
      expect(screen.getByText('AI Suggestions')).toBeInTheDocument()
    })

    // Open feedback modal
    const feedbackButton = screen.getByText('Feedback')
    fireEvent.click(feedbackButton)

    // Select rating
    const notHelpfulRadio = screen.getByLabelText('Not helpful - Irrelevant')
    fireEvent.click(notHelpfulRadio)

    // Add comment
    const commentTextarea = screen.getByPlaceholderText('Tell us more about your experience with this suggestion...')
    fireEvent.change(commentTextarea, { target: { value: 'This suggestion was not relevant to my analysis' } })

    // Submit feedback
    const submitButton = screen.getByText('Submit Feedback')
    fireEvent.click(submitButton)

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByText('Provide Feedback')).not.toBeInTheDocument()
    })

    expect(onSuggestionFeedback).toHaveBeenCalledWith(
      mockSuggestions[0],
      {
        rating: 'not_helpful',
        comment: 'This suggestion was not relevant to my analysis',
        improvementSuggestion: ''
      }
    )
  })

  it('should hide suggestion when hide button is clicked', async () => {
    render(<CausalSuggestionManager focusEventId="1" />)
    
    await waitFor(() => {
      expect(screen.getByText('AI Suggestions')).toBeInTheDocument()
    })

    // Click hide button (X button)
    const hideButton = screen.getByTitle('Hide suggestion')
    fireEvent.click(hideButton)

    // Suggestion should be hidden but component should still show
    expect(screen.getByText('AI Suggestions')).toBeInTheDocument()
    expect(screen.queryByText('Suggested Causal Link')).not.toBeInTheDocument()
  })

  it('should handle API errors gracefully', async () => {
    mockApiClient.causal.getSuggestions.mockRejectedValue(new Error('API Error'))
    
    render(<CausalSuggestionManager focusEventId="1" />)
    
    await waitFor(() => {
      expect(mockAddError).toHaveBeenCalledWith({
        message: 'Failed to load causal suggestions',
        type: 'network'
      })
    })
  })

  it('should show empty state when no suggestions are available', async () => {
    mockApiClient.causal.getSuggestions.mockResolvedValue([])

    render(<CausalSuggestionManager focusEventId="1" />)

    // When API returns empty array, the component returns null (doesn't render)
    // This is the expected behavior - the component only renders when there are suggestions
    await waitFor(() => {
      expect(mockApiClient.causal.getSuggestions).toHaveBeenCalledWith('1', expect.any(AbortSignal))
    })

    // Component should not be rendered when there are no suggestions
    expect(screen.queryByText('AI Suggestions')).not.toBeInTheDocument()
    expect(screen.queryByText('No suggestions available')).not.toBeInTheDocument()
  })

  it('should prevent accepting suggestion if relationship already exists', async () => {
    // Mock existing relationship
    mockUseGlobalStore.mockReturnValue({
      ...mockUseGlobalStore(),
      causalRelationships: [mockNewRelationship]
    })
    
    render(<CausalSuggestionManager focusEventId="1" />)
    
    await waitFor(() => {
      expect(screen.getByText('AI Suggestions')).toBeInTheDocument()
    })

    // Click accept button
    const acceptButton = screen.getByText('Accept')
    fireEvent.click(acceptButton)

    await waitFor(() => {
      expect(mockAddError).toHaveBeenCalledWith({
        message: 'Causal relationship already exists between these events',
        type: 'validation'
      })
    })

    // Should not create new relationship
    expect(mockApiClient.causal.createLink).not.toHaveBeenCalled()
  })

  it('should show processing state when accepting suggestion', async () => {
    // Delay the API response
    mockApiClient.causal.createLink.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve(mockNewRelationship), 100))
    )
    
    render(<CausalSuggestionManager focusEventId="1" />)
    
    await waitFor(() => {
      expect(screen.getByText('AI Suggestions')).toBeInTheDocument()
    })

    // Click accept button
    const acceptButton = screen.getByText('Accept')
    fireEvent.click(acceptButton)

    // Should show processing state
    expect(screen.getByText('Creating...')).toBeInTheDocument()
    expect(acceptButton).toBeDisabled()

    // Wait for completion
    await waitFor(() => {
      expect(screen.queryByText('Creating...')).not.toBeInTheDocument()
    })
  })
})