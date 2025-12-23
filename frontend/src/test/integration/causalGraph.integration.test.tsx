import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import { CausalGraphLayoutManager } from '@/components/causal-graph/CausalGraphLayoutManager'
import { CausalSuggestionManager } from '@/components/causal-graph/CausalSuggestionManager'
import { useGlobalStore } from '@/stores/globalStore'
import { createMockCytoscape } from '@/test/__mocks__/cytoscape'
import {
  generateEventSequence,
  generateSuggestion,
  generateSuggestions,
  generateTestScenario,
  resetIdCounter
} from '@/test/generators/causalDataGenerators'

// Mock the global store
vi.mock('@/stores/globalStore')
const mockUseGlobalStore = vi.mocked(useGlobalStore)

// Mock the API client - use inline mock to avoid hoisting issues
vi.mock('@/services/api', () => ({
  apiClient: {
    causal: {
      findChain: vi.fn().mockResolvedValue([]),
      getSuggestions: vi.fn().mockResolvedValue([]),
      createLink: vi.fn().mockResolvedValue({}),
      updateLink: vi.fn().mockResolvedValue({}),
      deleteLink: vi.fn().mockResolvedValue(undefined),
      getRelationships: vi.fn().mockResolvedValue([])
    }
  }
}))

// Test providers wrapper
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false }
    }
  })

function TestProviders({ children }: { children: React.ReactNode }) {
  const queryClient = createTestQueryClient()
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  )
}

describe('Causal Graph Integration Tests', () => {
  beforeEach(() => {
    resetIdCounter()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Layout Manager Integration', () => {
    let mockCytoscapeInstance: ReturnType<typeof createMockCytoscape>

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
      mockCytoscapeInstance = createMockCytoscape()
      mockUseGlobalStore.mockReturnValue(mockStore as any)
    })

    it('renders layout manager with all categories', () => {
      render(
        <TestProviders>
          <CausalGraphLayoutManager cytoscapeInstance={mockCytoscapeInstance as any} />
        </TestProviders>
      )

      expect(screen.getByText('Graph Layout')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /force-based/i })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /hierarchical/i })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /circular/i })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /grid-based/i })).toBeInTheDocument()
    })

    it('changes layout on button click', async () => {
      const onLayoutChange = vi.fn()

      render(
        <TestProviders>
          <CausalGraphLayoutManager
            cytoscapeInstance={mockCytoscapeInstance as any}
            onLayoutChange={onLayoutChange}
          />
        </TestProviders>
      )

      const hierarchicalButton = screen.getByRole('button', { name: /hierarchical/i })
      await act(async () => {
        fireEvent.click(hierarchicalButton)
      })

      await waitFor(() => {
        expect(mockCytoscapeInstance.layout).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'breadthfirst' })
        )
        expect(onLayoutChange).toHaveBeenCalledWith('breadthfirst')
      })
    })

    it('responds to layout keyboard shortcuts', async () => {
      render(
        <TestProviders>
          <CausalGraphLayoutManager cytoscapeInstance={mockCytoscapeInstance as any} />
        </TestProviders>
      )

      // Test layout shortcut
      fireEvent.keyDown(document, { key: '3' })
      expect(mockCytoscapeInstance.layout).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'circle' })
      )
    })

    it('responds to fit keyboard shortcut', async () => {
      render(
        <TestProviders>
          <CausalGraphLayoutManager cytoscapeInstance={mockCytoscapeInstance as any} />
        </TestProviders>
      )

      // Test fit shortcut
      fireEvent.keyDown(document, { key: 'f' })
      expect(mockCytoscapeInstance.fit).toHaveBeenCalled()
    })

    it('responds to reset keyboard shortcut', async () => {
      render(
        <TestProviders>
          <CausalGraphLayoutManager cytoscapeInstance={mockCytoscapeInstance as any} />
        </TestProviders>
      )

      // Test reset shortcut
      fireEvent.keyDown(document, { key: 'r' })
      expect(mockCytoscapeInstance.zoom).toHaveBeenCalledWith(1)
      expect(mockCytoscapeInstance.center).toHaveBeenCalled()
    })

    it('shows loading state during layout transition', async () => {
      render(
        <TestProviders>
          <CausalGraphLayoutManager cytoscapeInstance={mockCytoscapeInstance as any} />
        </TestProviders>
      )

      fireEvent.click(screen.getByRole('button', { name: /circular/i }))

      expect(screen.getByText('Applying layout...')).toBeInTheDocument()
    })
  })

  describe('Suggestion Manager Integration', () => {
    const testEvents = generateEventSequence(5)

    const mockStore = {
      events: testEvents,
      causalRelationships: [],
      addCausalRelationship: vi.fn(),
      addError: vi.fn()
    }

    beforeEach(() => {
      mockUseGlobalStore.mockReturnValue(mockStore as any)
    })

    it('does not render when no focus event is provided', () => {
      render(
        <TestProviders>
          <CausalSuggestionManager />
        </TestProviders>
      )

      expect(screen.queryByText('AI Suggestions')).not.toBeInTheDocument()
    })

    it('renders suggestion header when suggestions are loaded', async () => {
      const { apiClient } = await import('@/services/api')
      const suggestions = generateSuggestions(3)

      // Make suggestions use events from our test events
      suggestions.forEach((s, i) => {
        s.cause_event_id = testEvents[i]!.id
        s.effect_event_id = testEvents[i + 1]!.id
      })

      ;(apiClient.causal.getSuggestions as ReturnType<typeof vi.fn>).mockResolvedValue(suggestions)

      render(
        <TestProviders>
          <CausalSuggestionManager focusEventId={testEvents[0]!.id} />
        </TestProviders>
      )

      await waitFor(() => {
        expect(screen.getByText('AI Suggestions')).toBeInTheDocument()
      })
    })
  })

  describe('Test Data Generators', () => {
    it('generates consistent event sequences', () => {
      const events = generateEventSequence(5)

      expect(events).toHaveLength(5)
      events.forEach((event, i) => {
        expect(event.id).toBeDefined()
        expect(event.description).toContain('Sequential Event')
        if (i > 0) {
          // Each event should have a timestamp after the previous
          const prevDate = new Date(events[i - 1]!.timestamp)
          const currDate = new Date(event.timestamp)
          expect(currDate.getTime()).toBeGreaterThan(prevDate.getTime())
        }
      })
    })

    it('generates complete test scenarios', () => {
      const scenario = generateTestScenario({
        eventCount: 10,
        relationshipCount: 5,
        pathCount: 3,
        suggestionCount: 4
      })

      expect(scenario.events).toHaveLength(10)
      expect(scenario.relationships.length).toBeLessThanOrEqual(5)
      expect(scenario.paths).toHaveLength(3)
      expect(scenario.suggestions.length).toBeLessThanOrEqual(4)

      // Verify relationships reference valid events
      scenario.relationships.forEach(rel => {
        const causeExists = scenario.events.some(e => e.id === rel.cause_event_id)
        const effectExists = scenario.events.some(e => e.id === rel.effect_event_id)
        expect(causeExists).toBe(true)
        expect(effectExists).toBe(true)
      })
    })

    it('generates suggestions with varying confidence levels', () => {
      const suggestions = [
        generateSuggestion({ confidence: 0.9 }),
        generateSuggestion({ confidence: 0.6 }),
        generateSuggestion({ confidence: 0.3 })
      ]

      const highConfidence = suggestions.filter(s => s.confidence >= 0.8)
      const mediumConfidence = suggestions.filter(s => s.confidence >= 0.5 && s.confidence < 0.8)
      const lowConfidence = suggestions.filter(s => s.confidence < 0.5)

      expect(highConfidence).toHaveLength(1)
      expect(mediumConfidence).toHaveLength(1)
      expect(lowConfidence).toHaveLength(1)
    })
  })

  describe('Utility Functions Integration', () => {
    it('causal path calculations work with generated data', async () => {
      const { calculateCumulativeStrength, transformPathToSteps } = await import(
        '@/utils/causalPathCalculations'
      )
      const { generateCausalPath } = await import('@/test/generators/causalDataGenerators')

      const path = generateCausalPath(4)
      const strength = calculateCumulativeStrength(path.relationships)
      const steps = transformPathToSteps(path)

      expect(strength).toBeGreaterThan(0)
      expect(strength).toBeLessThanOrEqual(1)
      expect(steps).toHaveLength(4)
      expect(steps[0]!.cumulativeWeight).toBe(1)
      expect(steps[steps.length - 1]!.cumulativeWeight).toBeLessThanOrEqual(1)
    })

    it('suggestion utilities work with generated data', async () => {
      const {
        getConfidenceStyle,
        sortSuggestionsByConfidence,
        filterSuggestionsByMinConfidence
      } = await import('@/utils/suggestionManagerUtils')
      const { generateSuggestions } = await import('@/test/generators/causalDataGenerators')

      const suggestions = generateSuggestions(10)

      // Test sorting
      const sorted = sortSuggestionsByConfidence(suggestions)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i - 1]!.confidence).toBeGreaterThanOrEqual(sorted[i]!.confidence)
      }

      // Test filtering
      const filtered = filterSuggestionsByMinConfidence(suggestions, 0.7)
      filtered.forEach(s => {
        expect(s.confidence).toBeGreaterThanOrEqual(0.7)
      })

      // Test styling
      suggestions.forEach(s => {
        const style = getConfidenceStyle(s.confidence)
        expect(style.bgColor).toBeDefined()
        expect(style.textColor).toBeDefined()
        expect(style.label).toBeDefined()
      })
    })

    it('layout utilities work correctly', async () => {
      const {
        getLayoutFromShortcut,
        getShortcutForLayout,
        isValidLayoutName,
        getDefaultLayoutOptions
      } = await import('@/utils/layoutManagerUtils')

      // Test shortcut mapping
      expect(getLayoutFromShortcut('1')).toBe('cose')
      expect(getLayoutFromShortcut('2')).toBe('breadthfirst')
      expect(getShortcutForLayout('cose')).toBe('1')

      // Test layout validation
      expect(isValidLayoutName('cose')).toBe(true)
      expect(isValidLayoutName('invalid')).toBe(false)

      // Test default options
      const options = getDefaultLayoutOptions('cose')
      expect(options.name).toBe('cose')
      expect(options.fit).toBe(true)
    })
  })
})
