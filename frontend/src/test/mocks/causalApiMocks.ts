import { vi } from 'vitest'
import { CausalRelationship, CausalPath, CausalSuggestion, CausalRelationshipData } from '@/types'
import {
  generateCausalPath,
  generateSuggestions
} from '../generators/causalDataGenerators'

/**
 * Mock causal API client interface
 */
export interface MockCausalApi {
  findChain: ReturnType<typeof vi.fn>
  getSuggestions: ReturnType<typeof vi.fn>
  createLink: ReturnType<typeof vi.fn>
  updateLink: ReturnType<typeof vi.fn>
  deleteLink: ReturnType<typeof vi.fn>
  getRelationships: ReturnType<typeof vi.fn>
}

/**
 * Create a mock causal API client with default implementations
 */
export function createMockCausalApi(): MockCausalApi {
  return {
    findChain: vi.fn().mockResolvedValue([generateCausalPath()]),

    getSuggestions: vi.fn().mockResolvedValue(generateSuggestions(3)),

    createLink: vi.fn().mockImplementation(
      async (
        causeId: string,
        effectId: string,
        data: CausalRelationshipData
      ): Promise<CausalRelationship> => ({
        id: `rel-${causeId}-${effectId}`,
        cause_event_id: causeId,
        effect_event_id: effectId,
        weight: data.weight,
        confidence: data.confidence,
        evidence: data.evidence,
        relationship_type: data.relationship_type,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    ),

    updateLink: vi.fn().mockImplementation(
      async (
        relationshipId: string,
        data: Partial<CausalRelationshipData>
      ): Promise<CausalRelationship> => ({
        id: relationshipId,
        cause_event_id: 'event-1',
        effect_event_id: 'event-2',
        weight: data.weight ?? 0.8,
        confidence: data.confidence ?? 0.9,
        evidence: data.evidence ?? 'Updated evidence',
        relationship_type: data.relationship_type ?? 'direct',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    ),

    deleteLink: vi.fn().mockResolvedValue(undefined),

    getRelationships: vi.fn().mockResolvedValue([])
  }
}

/**
 * Setup mock causal API with vi.mock
 * Call this in your test file's top-level or in beforeEach
 */
export function setupCausalApiMock(): MockCausalApi {
  const mock = createMockCausalApi()

  vi.mock('@/services/api', () => ({
    apiClient: {
      causal: mock
    }
  }))

  return mock
}

/**
 * Configure mock to return specific paths
 */
export function mockFindChainToReturn(
  mock: MockCausalApi,
  paths: CausalPath[]
): void {
  mock.findChain.mockResolvedValue(paths)
}

/**
 * Configure mock to return empty paths
 */
export function mockFindChainEmpty(mock: MockCausalApi): void {
  mock.findChain.mockResolvedValue([])
}

/**
 * Configure mock to throw an error
 */
export function mockFindChainToFail(
  mock: MockCausalApi,
  error: Error = new Error('Failed to find chain')
): void {
  mock.findChain.mockRejectedValue(error)
}

/**
 * Configure mock to return specific suggestions
 */
export function mockGetSuggestionsToReturn(
  mock: MockCausalApi,
  suggestions: CausalSuggestion[]
): void {
  mock.getSuggestions.mockResolvedValue(suggestions)
}

/**
 * Configure mock to return empty suggestions
 */
export function mockGetSuggestionsEmpty(mock: MockCausalApi): void {
  mock.getSuggestions.mockResolvedValue([])
}

/**
 * Configure mock to throw an error for suggestions
 */
export function mockGetSuggestionsToFail(
  mock: MockCausalApi,
  error: Error = new Error('Failed to get suggestions')
): void {
  mock.getSuggestions.mockRejectedValue(error)
}

/**
 * Configure createLink to succeed
 */
export function mockCreateLinkToSucceed(
  mock: MockCausalApi,
  relationship?: CausalRelationship
): void {
  if (relationship) {
    mock.createLink.mockResolvedValue(relationship)
  }
  // Default implementation already returns a valid relationship
}

/**
 * Configure createLink to fail
 */
export function mockCreateLinkToFail(
  mock: MockCausalApi,
  error: Error = new Error('Failed to create link')
): void {
  mock.createLink.mockRejectedValue(error)
}

/**
 * Configure mock to return specific relationships
 */
export function mockGetRelationshipsToReturn(
  mock: MockCausalApi,
  relationships: CausalRelationship[]
): void {
  mock.getRelationships.mockResolvedValue(relationships)
}

/**
 * Reset all mock implementations
 */
export function resetCausalApiMock(mock: MockCausalApi): void {
  mock.findChain.mockReset()
  mock.getSuggestions.mockReset()
  mock.createLink.mockReset()
  mock.updateLink.mockReset()
  mock.deleteLink.mockReset()
  mock.getRelationships.mockReset()

  // Re-apply defaults
  mock.findChain.mockResolvedValue([generateCausalPath()])
  mock.getSuggestions.mockResolvedValue(generateSuggestions(3))
  mock.createLink.mockImplementation(
    async (causeId: string, effectId: string, data: CausalRelationshipData) => ({
      id: `rel-${causeId}-${effectId}`,
      cause_event_id: causeId,
      effect_event_id: effectId,
      ...data,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  )
  mock.deleteLink.mockResolvedValue(undefined)
  mock.getRelationships.mockResolvedValue([])
}

/**
 * Create mock with specific delay for async testing
 */
export function createDelayedMockCausalApi(delayMs: number = 100): MockCausalApi {
  const mock = createMockCausalApi()

  const addDelay = <T>(promise: Promise<T>): Promise<T> =>
    new Promise(resolve => setTimeout(() => promise.then(resolve), delayMs))

  mock.findChain.mockImplementation(() => addDelay(Promise.resolve([generateCausalPath()])))
  mock.getSuggestions.mockImplementation(() => addDelay(Promise.resolve(generateSuggestions(3))))
  mock.createLink.mockImplementation((causeId: string, effectId: string, data: CausalRelationshipData) =>
    addDelay(
      Promise.resolve({
        id: `rel-${causeId}-${effectId}`,
        cause_event_id: causeId,
        effect_event_id: effectId,
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    )
  )

  return mock
}

/**
 * Helper to create a mock that supports abort signals
 */
export function createAbortableMockCausalApi(): MockCausalApi {
  const mock = createMockCausalApi()

  mock.getSuggestions.mockImplementation((_eventId: string, signal?: AbortSignal) => {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }

      const abortHandler = () => {
        reject(new DOMException('Aborted', 'AbortError'))
      }

      signal?.addEventListener('abort', abortHandler)

      setTimeout(() => {
        signal?.removeEventListener('abort', abortHandler)
        resolve(generateSuggestions(3))
      }, 50)
    })
  })

  return mock
}

/**
 * Assertion helpers for mock verification
 */
export const mockAssertions = {
  /**
   * Assert createLink was called with specific event IDs
   */
  assertCreateLinkCalledWith(
    mock: MockCausalApi,
    causeEventId: string,
    effectEventId: string
  ): void {
    expect(mock.createLink).toHaveBeenCalledWith(
      causeEventId,
      effectEventId,
      expect.any(Object)
    )
  },

  /**
   * Assert getSuggestions was called for specific event
   */
  assertGetSuggestionsCalledFor(mock: MockCausalApi, eventId: string): void {
    expect(mock.getSuggestions).toHaveBeenCalledWith(eventId, expect.anything())
  },

  /**
   * Assert findChain was called for specific event
   */
  assertFindChainCalledFor(mock: MockCausalApi, eventId: string): void {
    expect(mock.findChain).toHaveBeenCalledWith(eventId)
  },

  /**
   * Assert no API calls were made
   */
  assertNoCallsMade(mock: MockCausalApi): void {
    expect(mock.findChain).not.toHaveBeenCalled()
    expect(mock.getSuggestions).not.toHaveBeenCalled()
    expect(mock.createLink).not.toHaveBeenCalled()
    expect(mock.updateLink).not.toHaveBeenCalled()
    expect(mock.deleteLink).not.toHaveBeenCalled()
    expect(mock.getRelationships).not.toHaveBeenCalled()
  }
}
