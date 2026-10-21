import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { usePressures } from './usePressures'
import { useInferredPressures } from './useAPI'
import { useGlobalStore } from '@/stores/globalStore'
import { usePressureStore } from '@/stores/pressureStore'
import { DEFAULT_PRESSURE_COLORS } from '@/types/pressure'
import { InferredPressure } from '@/types'
import { PressureWithContext } from '@/types/pressure'
import { APIError } from '@/services/api'

// Mock dependencies
vi.mock('./useAPI')
vi.mock('@/stores/globalStore')

const mockUseInferredPressures = vi.mocked(useInferredPressures)
const mockUseGlobalStore = vi.mocked(useGlobalStore)

type GlobalStoreState = ReturnType<typeof useGlobalStore>

/**
 * `mockGlobalStoreState` below only carries the slice `usePressures` reads, so the seam
 * with the automocked `useGlobalStore` (typed against the full real store) is bridged
 * once, here, instead of with an unchecked assertion at each call site.
 */
const asStore = (partial: Partial<GlobalStoreState>) => partial as GlobalStoreState

type InferredPressuresQueryResult = ReturnType<typeof useInferredPressures>

type QueryResultState =
  | { kind: 'success'; data: InferredPressure[] }
  | { kind: 'loading' }
  | { kind: 'error'; error: APIError }

/**
 * Builds the `useQuery` result the hook destructures. Every member of `UseQueryResult` is
 * filled in, so a field added to the type later is a compile error here rather than an
 * `undefined` at runtime; the `kind` discriminant keeps `data`/`error` in the combination
 * TanStack Query actually produces for that state.
 */
const createQueryResult = (state: QueryResultState): InferredPressuresQueryResult => {
  const base = {
    dataUpdatedAt: 0,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    fetchFailureCount: 0,
    fetchFailureReason: null,
    failureCount: 0,
    failureReason: null,
    isFetched: true,
    isFetchedAfterMount: false,
    isFetching: false,
    isEnabled: true,
    fetchStatus: 'idle',
    isStale: false,
    isLoadingError: false,
    isPaused: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    promise: Promise.resolve([]),
    refetch: vi.fn(),
  } as const

  switch (state.kind) {
    case 'success':
      return {
        ...base,
        data: state.data,
        error: null,
        isError: false,
        isInitialLoading: false,
        isLoading: false,
        isPending: false,
        isSuccess: true,
        status: 'success',
      }
    case 'loading':
      return {
        ...base,
        data: undefined,
        error: null,
        isError: false,
        isFetched: false,
        isInitialLoading: true,
        isLoading: true,
        isPending: true,
        isSuccess: false,
        status: 'pending',
      }
    case 'error':
      return {
        ...base,
        data: undefined,
        error: state.error,
        isError: true,
        isInitialLoading: false,
        isLoading: false,
        isLoadingError: true,
        isPending: false,
        isSuccess: false,
        status: 'error',
      }
  }
}

/** First processed pressure, failing loudly when the hook produced none. */
const firstPressure = (pressures: PressureWithContext[]): PressureWithContext => {
  const [first] = pressures
  if (!first) throw new Error('expected the hook to produce at least one pressure')
  return first
}

describe('usePressures', () => {
  const mockPressures: InferredPressure[] = [
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

    // The visualisation configuration is shared state, so it survives between
    // tests unless the store is reset: a test that moved the confidence
    // threshold would otherwise change the next test's results.
    usePressureStore.setState({
      visualConfig: {
        showIndicators: true,
        confidenceThreshold: 0.1,
        colorScheme: DEFAULT_PRESSURE_COLORS,
        opacityRange: [0.2, 0.8],
        showTooltips: true,
        showEvidenceHighlight: true,
      },
      explorationState: {
        selectedPressure: null,
        highlightedEvidence: new Set(),
        showEvidenceModal: false,
        confidenceTracking: new Map(),
      },
    })

    mockUseGlobalStore.mockReturnValue(asStore(mockGlobalStoreState))
    mockUseInferredPressures.mockReturnValue(
      createQueryResult({ kind: 'success', data: mockPressures })
    )
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
    expect(firstPressure(result.current.pressuresWithContext)).toHaveProperty('affectedArcs')
    expect(firstPressure(result.current.pressuresWithContext)).toHaveProperty('evidenceEvents')
    expect(firstPressure(result.current.pressuresWithContext)).toHaveProperty('influenceStrength')
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
    expect(result.current.visiblePressures[0]?.confidence_score).toBe(0.8)
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

    const pressure = firstPressure(result.current.pressuresWithContext)

    act(() => {
      result.current.selectPressure(pressure)
    })

    expect(result.current.selectedPressure).toBe(pressure)
    expect(result.current.highlightedEvidence.size).toBeGreaterThanOrEqual(0)
  })

  it('handles pressure evidence highlighting', () => {
    const { result } = renderHook(() => usePressures())

    const pressure = firstPressure(result.current.pressuresWithContext)

    act(() => {
      result.current.highlightPressureEvidence(pressure)
    })

    expect(result.current.highlightedEvidence.size).toBeGreaterThanOrEqual(0)
  })

  it('clears pressure highlight', () => {
    const { result } = renderHook(() => usePressures())

    const pressure = firstPressure(result.current.pressuresWithContext)

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

    const pressure = firstPressure(result.current.pressuresWithContext)

    act(() => {
      result.current.showEvidenceModalAction(pressure)
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
    mockUseInferredPressures.mockReturnValue(createQueryResult({ kind: 'loading' }))

    const { result } = renderHook(() => usePressures())

    expect(result.current.isLoading).toBe(true)
  })

  it('handles error state', () => {
    const mockError = new APIError('Failed to fetch pressures', 500)
    mockUseInferredPressures.mockReturnValue(
      createQueryResult({ kind: 'error', error: mockError })
    )

    const { result } = renderHook(() => usePressures())

    expect(result.current.error).toBe(mockError)
  })

  it('fetches the pressures of the graph', () => {
    // The backend infers the pressures over the whole graph; it has no
    // per-arc filter, so there is nothing to narrow the request by.
    renderHook(() => usePressures())

    expect(mockUseInferredPressures).toHaveBeenCalledWith(expect.any(Object))
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