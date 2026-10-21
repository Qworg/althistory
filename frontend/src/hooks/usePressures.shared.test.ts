/**
 * The pressure visualisation's state is shared.
 *
 * It used to live in `usePressures`'s own `useState`, so the panel and the
 * timeline each had a copy: "Hide indicators" in the panel changed the panel's
 * own configuration and nothing else, and the confidence slider moved a
 * threshold the timeline never saw.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePressures } from './usePressures'
import { usePressureStore } from '@/stores/pressureStore'
import { DEFAULT_PRESSURE_COLORS } from '@/types/pressure'

const mockUseInferredPressures = vi.fn()
vi.mock('./useAPI', () => ({
  useInferredPressures: (...args: unknown[]) => mockUseInferredPressures(...args),
}))

import { vi } from 'vitest'

const resetStore = () =>
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

describe('the shared pressure state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
    mockUseInferredPressures.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
  })

  it('is shared between two hook instances', () => {
    const panel = renderHook(() => usePressures())
    const timeline = renderHook(() => usePressures())

    act(() => {
      panel.result.current.togglePressureIndicators()
    })

    // The timeline sees the panel's change.
    expect(timeline.result.current.visualConfig.showIndicators).toBe(false)
    expect(panel.result.current.visualConfig.showIndicators).toBe(false)
  })

  it('shares the confidence threshold', () => {
    const panel = renderHook(() => usePressures())
    const timeline = renderHook(() => usePressures())

    act(() => {
      panel.result.current.setConfidenceThreshold(0.7)
    })

    expect(timeline.result.current.visualConfig.confidenceThreshold).toBe(0.7)
  })

  it('does not send the threshold to the backend', () => {
    renderHook(() => usePressures())

    act(() => {
      usePressureStore.getState().setConfidenceThreshold(0.6)
    })

    // The threshold is applied to what came back, not sent: sending it made
    // every step of the slider refetch (and re-run the cluster analysis over
    // the graph's events) and the indicators disappeared between the answers.
    const calls = mockUseInferredPressures.mock.calls
    const lastCall = calls[calls.length - 1]
    expect(lastCall?.[0]?.minConfidence).toBeUndefined()
  })

  it('filters the visible pressures by the threshold', () => {
    mockUseInferredPressures.mockReturnValue({
      data: [
        { id: 'p1', description: 'High', confidence_score: 0.8, pressure_type: 'economic', evidence: [], evidence_event_ids: [] },
        { id: 'p2', description: 'Low', confidence_score: 0.4, pressure_type: 'social', evidence: [], evidence_event_ids: [] },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    const { result } = renderHook(() => usePressures())

    expect(result.current.visiblePressures).toHaveLength(2)

    act(() => {
      result.current.setConfidenceThreshold(0.6)
    })

    expect(result.current.visiblePressures).toHaveLength(1)
    expect(result.current.visiblePressures[0]?.id).toBe('p1')
  })
})
