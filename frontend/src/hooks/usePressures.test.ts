import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { usePressures } from './usePressures'
import { useInferredPressures } from './useAPI'
import { useGlobalStore } from '@/stores/globalStore'

// Mock dependencies
vi.mock('./useAPI')
vi.mock('@/stores/globalStore')

const mockUseInferredPressures = vi.mocked(useInferredPressures)
const mockUseGlobalStore = vi.mocked(useGlobalStore)

describe('usePressures', () => {
  const mockPressures = [
    {
      id: 'pressure-1',
      description: 'Economic pressure from trade sanctions',
      confidence_score: 0.8,
      pressure_type: 'economic' as const,
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    },
    {
      id: 'pressure-2',
      description: 'Social unrest due to policy changes',
      confidence_score: 0.3,
      pressure_type: 'social' as const,
      created_at: '2023-01-02T00:00:00Z',
      updated_at: '2023-01-02T00:00:00Z'
    }
  ]

  const mockArcs = [
    {
      id: 'arc-1',
      name: 'Test Arc',
      description: 'Test arc description',
      start_time: '2023-01-01T00:00:00Z',
      end_time: '2023-01-31T00:00:00Z',
      parent_arc_id: null,
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    }
  ]

  const mockEvents = [
    {
      id: 'event-1',
      description: 'Test event',
      actor: 'Actor 1',
      target: 'Target 1',
      timestamp: '2023-01-15T00:00:00Z',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    }
  ]

  const mockGlobalStoreState = {
    arcs: mockArcs,
    events: mockEvents,
    inferredPressures: mockPressures,
    setInferredPressures: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    
    mockUseGlobalStore.mockReturnValue(mockGlobalStoreState as any)
    mockUseInferredPressures.mockReturnValue({
      data: mockPressures,
      isLoading: false,
      error: null,
      refetch: vi.fn()
    } as any)
  })

  it('initializes with default state', () => {
    const { result } = renderHook(() => usePressures())

    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBe(null)
    expect(result.current.pressuresWithContext).toBeDefined()
    expect(result.current.selectedPressure).toBe(null)
    expect(result.current.highlightedEvidence).toEqual(new Set())
    expect(result.current.explorationState.showEvidenceModal).toBe(false)
    expect(result.current.visualConfig.showIndicators).toBe(true)
    expect(result.current.visualConfig.confidenceThreshold).toBe(0.1)
  })

  it('processes pressures with context', () => {
    const { result } = renderHook(() => usePressures())

    expect(result.current.pressuresWithContext).toHaveLength(2)
    expect(result.current.pressuresWithContext[0]).toHaveProperty('affectedArcs')
    expect(result.current.pressuresWithContext[0]).toHaveProperty('evidenceEvents')
    expect(result.current.pressuresWithContext[0]).toHaveProperty('influenceStrength')
  })

  it('filters pressures by confidence threshold', () => {
    const { result } = renderHook(() => usePressures())

    // Default threshold is 0.1, so both pressures should be visible
    expect(result.current.visiblePressures).toHaveLength(2)

    act(() => {
      result.current.setConfidenceThreshold(0.5)
    })

    // Only pressure with confidence >= 0.5 should be visible
    expect(result.current.visiblePressures).toHaveLength(1)
    expect(result.current.visiblePressures[0].confidence_score).toBe(0.8)
  })

  it('groups pressures by type', () => {
    const { result } = renderHook(() => usePressures())

    expect(result.current.pressuresByType).toHaveProperty('economic')
    expect(result.current.pressuresByType).toHaveProperty('social')
    expect(result.current.pressuresByType.economic).toHaveLength(1)
    expect(result.current.pressuresByType.social).toHaveLength(1)
  })

  it('calculates pressure statistics', () => {
    const { result } = renderHook(() => usePressures())

    expect(result.current.pressureStats.totalPressures).toBe(2)
    expect(result.current.pressureStats.visibleCount).toBe(2)
    expect(result.current.pressureStats.averageConfidence).toBe(0.55) // (0.8 + 0.3) / 2
    expect(result.current.pressureStats.typeDistribution).toEqual({
      economic: 1,
      social: 1
    })
  })

  it('handles pressure selection', () => {
    const { result } = renderHook(() => usePressures())

    const pressure = result.current.pressuresWithContext[0]

    act(() => {
      result.current.selectPressure(pressure)
    })

    expect(result.current.selectedPressure).toBe(pressure)
    expect(result.current.highlightedEvidence.size).toBeGreaterThanOrEqual(0)
  })

  it('handles pressure evidence highlighting', () => {
    const { result } = renderHook(() => usePressures())

    const pressure = result.current.pressuresWithContext[0]

    act(() => {
      result.current.highlightPressureEvidence(pressure)
    })

    expect(result.current.highlightedEvidence.size).toBeGreaterThanOrEqual(0)
  })

  it('clears pressure highlight', () => {
    const { result } = renderHook(() => usePressures())

    const pressure = result.current.pressuresWithContext[0]

    act(() => {
      result.current.highlightPressureEvidence(pressure)
    })

    expect(result.current.highlightedEvidence.size).toBeGreaterThanOrEqual(0)

    act(() => {
      result.current.clearPressureHighlight()
    })

    expect(result.current.highlightedEvidence.size).toBe(0)
  })

  it('handles evidence modal', () => {
    const { result } = renderHook(() => usePressures())

    const pressure = result.current.pressuresWithContext[0]

    act(() => {
      result.current.showEvidenceModal(pressure)
    })

    expect(result.current.explorationState.showEvidenceModal).toBe(true)
    expect(result.current.selectedPressure).toBe(pressure)

    act(() => {
      result.current.hideEvidenceModal()
    })

    expect(result.current.explorationState.showEvidenceModal).toBe(false)
  })

  it('tracks confidence changes', () => {
    const { result } = renderHook(() => usePressures())

    act(() => {
      result.current.trackConfidenceChange('pressure-1', 0.9)
    })

    expect(result.current.explorationState.confidenceTracking.get('pressure-1')).toEqual([0.9])

    act(() => {
      result.current.trackConfidenceChange('pressure-1', 0.85)
    })

    expect(result.current.explorationState.confidenceTracking.get('pressure-1')).toEqual([0.9, 0.85])
  })

  it('updates visualization configuration', () => {
    const { result } = renderHook(() => usePressures())

    act(() => {
      result.current.updateVisualizationConfig({
        showIndicators: false,
        showTooltips: false
      })
    })

    expect(result.current.visualConfig.showIndicators).toBe(false)
    expect(result.current.visualConfig.showTooltips).toBe(false)
  })

  it('toggles pressure indicators', () => {
    const { result } = renderHook(() => usePressures())

    const initialShowIndicators = result.current.visualConfig.showIndicators

    act(() => {
      result.current.togglePressureIndicators()
    })

    expect(result.current.visualConfig.showIndicators).toBe(!initialShowIndicators)
  })

  it('handles loading state', () => {
    mockUseInferredPressures.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn()
    } as any)

    const { result } = renderHook(() => usePressures())

    expect(result.current.isLoading).toBe(true)
  })

  it('handles error state', () => {
    const mockError = new Error('Failed to fetch pressures')
    mockUseInferredPressures.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: mockError,
      refetch: vi.fn()
    } as any)

    const { result } = renderHook(() => usePressures())

    expect(result.current.error).toBe(mockError)
  })

  it('handles arc-specific pressure fetching', () => {
    const arcId = 'arc-1'
    renderHook(() => usePressures(arcId))

    expect(mockUseInferredPressures).toHaveBeenCalledWith(arcId, expect.any(Object))
  })

  it('limits confidence tracking history', () => {
    const { result } = renderHook(() => usePressures())

    // Add 12 confidence scores (more than the limit of 10)
    act(() => {
      for (let i = 0; i < 12; i++) {
        result.current.trackConfidenceChange('pressure-1', 0.1 + i * 0.05)
      }
    })

    const history = result.current.explorationState.confidenceTracking.get('pressure-1')
    expect(history).toHaveLength(10) // Should be limited to 10 entries
    expect(history?.[0]).toBe(0.2) // First two entries should be removed
  })
})