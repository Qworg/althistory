/**
 * Tests for useImport hook
 * CRITICAL #4: Frontend useImport hook tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  useValidateImport,
  usePreviewImport,
  useExecuteImport,
  importReducer,
  initialImportState,
  ExecuteImportResult,
  ImportWizardState,
  ImportAction,
} from './useImport'
import { apiClient } from '@/services/api'
import { AlthistoryExport, ImportValidationResult, ImportPreview, ImportResult } from '@/types'

// Mock the API client
vi.mock('@/services/api', () => ({
  apiClient: {
    import: {
      validate: vi.fn(),
      preview: vi.fn(),
      execute: vi.fn(),
    },
  },
  APIError: class APIError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'APIError'
    }
  },
}))

// Typed handles for the mocked API methods. `vi.mocked(apiClient)` only mocks
// the top-level methods of the client, so `mocked.apiClient.import.validate`
// stays a bare function type; going through the individual methods keeps the
// MockInstance (mockResolvedValue / mockRejectedValue) in the type.
const mockedValidate = vi.mocked(apiClient.import.validate)
const mockedPreview = vi.mocked(apiClient.import.preview)
const mockedExecute = vi.mocked(apiClient.import.execute)

/**
 * Narrows an execute mutation payload to its synchronous ImportResult shape.
 * The endpoint only resolves a job acknowledgement for async imports, and every
 * test below mocks the sync path, so an unexpected payload fails loudly instead
 * of silently skipping the assertions that follow.
 */
function expectSyncImportResult(data: ExecuteImportResult | undefined): ImportResult {
  if (data === undefined || !('success' in data)) {
    throw new Error(`expected a synchronous ImportResult, got ${JSON.stringify(data)}`)
  }
  return data
}

// Helper to create a valid export structure
const createValidExport = (): AlthistoryExport => ({
  version: '1.0',
  metadata: {
    graphId: 'test-graph-id',
    graphName: 'Test Graph',
    description: 'A test graph',
    exportedAt: new Date().toISOString(),
    sourceVersion: '1.0.0',
    graphVersion: 1,
    checksum: '',
  },
  data: {
    events: [
      {
        id: 'event-1',
        description: 'Test event',
        actor: 'Actor A',
        target: 'Target B',
        timestamp: '2023-01-01T00:00:00Z',
      },
    ],
    arcs: [],
    causalRelationships: [],
    inferredPressures: [],
  },
})

// Helper to create a test wrapper with QueryClient
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useImport hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('useValidateImport', () => {
    it('should validate import data successfully', async () => {
      const mockValidationResult: ImportValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
        summary: {
          eventCount: 1,
          arcCount: 0,
          relationshipCount: 0,
          pressureCount: 0,
          crossRefCount: 0,
          actors: ['Actor A'],
        },
      }

      mockedValidate.mockResolvedValue(mockValidationResult)

      const { result } = renderHook(() => useValidateImport(), {
        wrapper: createWrapper(),
      })

      const exportData = createValidExport()

      act(() => {
        result.current.mutate({ data: exportData })
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data).toEqual(mockValidationResult)
      expect(mockedValidate).toHaveBeenCalledWith(exportData)
    })

    it('should handle validation errors', async () => {
      const mockValidationResult: ImportValidationResult = {
        valid: false,
        errors: [
          {
            path: '$.data.events[0]',
            message: 'Missing required field',
            code: 'MISSING_FIELD',
          },
        ],
        warnings: [],
        summary: {
          eventCount: 0,
          arcCount: 0,
          relationshipCount: 0,
          pressureCount: 0,
          crossRefCount: 0,
          actors: [],
        },
      }

      mockedValidate.mockResolvedValue(mockValidationResult)

      const { result } = renderHook(() => useValidateImport(), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.mutate({ data: createValidExport() })
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data?.valid).toBe(false)
      expect(result.current.data?.errors).toHaveLength(1)
    })

    it('should handle API errors', async () => {
      mockedValidate.mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useValidateImport(), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.mutate({ data: createValidExport() })
      })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect(result.current.error?.message).toBe('Network error')
    })
  })

  describe('usePreviewImport', () => {
    it('should generate import preview successfully', async () => {
      const mockPreview: ImportPreview = {
        toCreate: { events: 1, arcs: 0, relationships: 0, pressures: 0 },
        toUpdate: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
        toDelete: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
        conflicts: [],
        warnings: [],
      }

      mockedPreview.mockResolvedValue(mockPreview)

      const { result } = renderHook(() => usePreviewImport(), {
        wrapper: createWrapper(),
      })

      const exportData = createValidExport()

      act(() => {
        result.current.mutate({ data: exportData, mode: 'create-new' })
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data).toEqual(mockPreview)
      expect(mockedPreview).toHaveBeenCalledWith(
        exportData,
        undefined,
        'create-new'
      )
    })

    it('should include target graph ID when provided', async () => {
      const mockPreview: ImportPreview = {
        toCreate: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
        toUpdate: { events: 1, arcs: 0, relationships: 0, pressures: 0 },
        toDelete: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
        conflicts: [],
        warnings: [],
      }

      mockedPreview.mockResolvedValue(mockPreview)

      const { result } = renderHook(() => usePreviewImport(), {
        wrapper: createWrapper(),
      })

      const exportData = createValidExport()

      act(() => {
        result.current.mutate({
          data: exportData,
          targetGraphId: 'existing-graph',
          mode: 'merge',
        })
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(mockedPreview).toHaveBeenCalledWith(
        exportData,
        'existing-graph',
        'merge'
      )
    })
  })

  describe('useExecuteImport', () => {
    it('should execute import successfully', async () => {
      const mockResult: ImportResult = {
        success: true,
        graphId: 'new-graph-123',
        graphVersion: 1,
        imported: { events: 1, arcs: 0, relationships: 0, pressures: 0 },
        skipped: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
        deleted: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
        errors: [],
        warnings: [],
      }

      mockedExecute.mockResolvedValue(mockResult)

      const { result } = renderHook(() => useExecuteImport(), {
        wrapper: createWrapper(),
      })

      const exportData = createValidExport()

      act(() => {
        result.current.mutate({
          data: exportData,
          mode: 'create-new',
          conflictResolution: 'skip',
        })
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data).toEqual(mockResult)
      expect(expectSyncImportResult(result.current.data).success).toBe(true)
    })

    it('should handle manual conflict resolution', async () => {
      const mockResult: ImportResult = {
        success: true,
        graphId: 'graph-123',
        graphVersion: 2,
        imported: { events: 2, arcs: 0, relationships: 0, pressures: 0 },
        skipped: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
        deleted: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
        errors: [],
        warnings: [],
      }

      mockedExecute.mockResolvedValue(mockResult)

      const { result } = renderHook(() => useExecuteImport(), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.mutate({
          data: createValidExport(),
          targetGraphId: 'graph-123',
          mode: 'merge',
          conflictResolution: 'manual',
          manualResolutions: {
            'conflict-1': 'skip',
            'conflict-2': 'overwrite',
          },
        })
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(mockedExecute).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          conflictResolution: 'manual',
          manualResolutions: {
            'conflict-1': 'skip',
            'conflict-2': 'overwrite',
          },
        })
      )
    })

    it('should handle import failure', async () => {
      const mockResult: ImportResult = {
        success: false,
        graphId: '',
        graphVersion: 0,
        imported: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
        skipped: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
        deleted: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
        errors: [
          {
            path: '$',
            message: 'Import failed due to validation error',
            code: 'INVALID_FORMAT',
          },
        ],
        warnings: [],
      }

      mockedExecute.mockResolvedValue(mockResult)

      const { result } = renderHook(() => useExecuteImport(), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.mutate({
          data: createValidExport(),
          mode: 'create-new',
          conflictResolution: 'skip',
        })
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      const data = expectSyncImportResult(result.current.data)
      expect(data.success).toBe(false)
      expect(data.errors).toHaveLength(1)
    })
  })
})

describe('importReducer', () => {
  it('should return initial state', () => {
    expect(initialImportState).toEqual({
      step: 'upload',
      data: null,
      validation: null,
      preview: null,
      resolutions: {},
      result: null,
      mode: 'create-new',
      targetGraphId: undefined,
      error: null,
    })
  })

  it('should handle SET_DATA action', () => {
    const exportData = createValidExport()
    const action: ImportAction = { type: 'SET_DATA', payload: exportData }
    
    const newState = importReducer(initialImportState, action)
    
    expect(newState.data).toEqual(exportData)
    expect(newState.error).toBeNull()
  })

  it('should handle SET_VALIDATION action', () => {
    const validation: ImportValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      summary: {
        eventCount: 1,
        arcCount: 0,
        relationshipCount: 0,
        pressureCount: 0,
        crossRefCount: 0,
        actors: [],
      },
    }
    const action: ImportAction = { type: 'SET_VALIDATION', payload: validation }
    
    const newState = importReducer(initialImportState, action)
    
    expect(newState.validation).toEqual(validation)
  })

  it('should handle SET_PREVIEW action', () => {
    const preview: ImportPreview = {
      toCreate: { events: 1, arcs: 0, relationships: 0, pressures: 0 },
      toUpdate: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
      toDelete: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
      conflicts: [],
      warnings: [],
    }
    const action: ImportAction = { type: 'SET_PREVIEW', payload: preview }
    
    const newState = importReducer(initialImportState, action)
    
    expect(newState.preview).toEqual(preview)
  })

  it('should handle SET_RESOLUTION action', () => {
    const action: ImportAction = {
      type: 'SET_RESOLUTION',
      payload: { conflictId: 'conflict-1', resolution: 'skip' },
    }
    
    const newState = importReducer(initialImportState, action)
    
    expect(newState.resolutions['conflict-1']).toBe('skip')
  })

  it('should handle SET_ALL_RESOLUTIONS action', () => {
    const resolutions = {
      'conflict-1': 'skip' as const,
      'conflict-2': 'overwrite' as const,
    }
    const action: ImportAction = { type: 'SET_ALL_RESOLUTIONS', payload: resolutions }
    
    const newState = importReducer(initialImportState, action)
    
    expect(newState.resolutions).toEqual(resolutions)
  })

  it('should handle SET_RESULT action', () => {
    const result: ImportResult = {
      success: true,
      graphId: 'graph-123',
      graphVersion: 1,
      imported: { events: 1, arcs: 0, relationships: 0, pressures: 0 },
      skipped: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
      deleted: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
      errors: [],
      warnings: [],
    }
    const action: ImportAction = { type: 'SET_RESULT', payload: result }
    
    const newState = importReducer(initialImportState, action)
    
    expect(newState.result).toEqual(result)
  })

  it('should handle SET_MODE action', () => {
    const action: ImportAction = { type: 'SET_MODE', payload: 'merge' }
    
    const newState = importReducer(initialImportState, action)
    
    expect(newState.mode).toBe('merge')
  })

  it('should handle SET_TARGET_GRAPH action', () => {
    const action: ImportAction = { type: 'SET_TARGET_GRAPH', payload: 'graph-123' }
    
    const newState = importReducer(initialImportState, action)
    
    expect(newState.targetGraphId).toBe('graph-123')
  })

  it('should handle SET_STEP action', () => {
    const action: ImportAction = { type: 'SET_STEP', payload: 'preview' }
    
    const newState = importReducer(initialImportState, action)
    
    expect(newState.step).toBe('preview')
  })

  it('should handle SET_ERROR action', () => {
    const action: ImportAction = { type: 'SET_ERROR', payload: 'Something went wrong' }
    
    const newState = importReducer(initialImportState, action)
    
    expect(newState.error).toBe('Something went wrong')
  })

  it('should handle RESET action', () => {
    const modifiedState: ImportWizardState = {
      ...initialImportState,
      step: 'complete',
      data: createValidExport(),
      error: 'Some error',
    }
    
    const action: ImportAction = { type: 'RESET' }
    const newState = importReducer(modifiedState, action)
    
    expect(newState).toEqual(initialImportState)
  })

  it('should preserve other state fields when setting resolution', () => {
    const stateWithData: ImportWizardState = {
      ...initialImportState,
      step: 'conflicts',
      mode: 'merge',
      resolutions: { 'existing-conflict': 'skip' },
    }
    
    const action: ImportAction = {
      type: 'SET_RESOLUTION',
      payload: { conflictId: 'new-conflict', resolution: 'overwrite' },
    }
    
    const newState = importReducer(stateWithData, action)
    
    expect(newState.step).toBe('conflicts')
    expect(newState.mode).toBe('merge')
    expect(newState.resolutions).toEqual({
      'existing-conflict': 'skip',
      'new-conflict': 'overwrite',
    })
  })
})
