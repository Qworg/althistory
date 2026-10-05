import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useGraphCopy } from './useGraphCopy'
import { apiClient } from '@/services/api'
import { useGlobalStore } from '@/stores/globalStore'
import { TimeRange, EntityFilter, CopyResult } from '@/types'

// Mock the API client
vi.mock('@/services/api', () => ({
  apiClient: {
    graph: {
      copyFull: vi.fn(),
      copyByTimeRange: vi.fn(),
      copyByFilter: vi.fn(),
      getCopyStatus: vi.fn()
    }
  }
}))

// Mock the global store
vi.mock('@/stores/globalStore', () => ({
  useGlobalStore: vi.fn()
}))

const mockAddError = vi.fn()
const mockAddLoadingOperation = vi.fn()
const mockRemoveLoadingOperation = vi.fn()

const mockStoreReturn = {
  addError: mockAddError,
  addLoadingOperation: mockAddLoadingOperation,
  removeLoadingOperation: mockRemoveLoadingOperation
}

const mockUseGlobalStore = vi.mocked(useGlobalStore)

type GlobalStoreState = ReturnType<typeof useGlobalStore>

/**
 * `mockStoreReturn` only carries the three store actions `useGraphCopy` calls, so the seam
 * with the automocked `useGlobalStore` (typed against the full real store) is bridged once,
 * here, instead of with an unchecked assertion at each call site.
 */
const asStore = (partial: Partial<GlobalStoreState>) => partial as GlobalStoreState

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })
  
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

describe('useGraphCopy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGlobalStore.mockReturnValue(asStore(mockStoreReturn))
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('should initialize with empty state', () => {
    const { result } = renderHook(() => useGraphCopy(), {
      wrapper: createWrapper()
    })

    expect(result.current.copyState).toEqual({
      activeOperations: [],
      completedOperations: [],
      selectedTimeRange: null,
      selectedFilter: null,
      copyName: '',
      isCreatingCopy: false
    })
    expect(result.current.isCreatingCopy).toBe(false)
  })

  it('should update copy name', () => {
    const { result } = renderHook(() => useGraphCopy(), {
      wrapper: createWrapper()
    })

    act(() => {
      result.current.setCopyName('Test Copy')
    })

    expect(result.current.copyState.copyName).toBe('Test Copy')
  })

  it('should update selected time range and clear filter', () => {
    const { result } = renderHook(() => useGraphCopy(), {
      wrapper: createWrapper()
    })

    const timeRange: TimeRange = {
      start: new Date('2023-01-01'),
      end: new Date('2023-12-31')
    }

    // First set a filter
    act(() => {
      result.current.setSelectedFilter({ actors: ['test'] })
    })

    expect(result.current.copyState.selectedFilter).toEqual({ actors: ['test'] })

    // Then set time range - should clear filter
    act(() => {
      result.current.setSelectedTimeRange(timeRange)
    })

    expect(result.current.copyState.selectedTimeRange).toEqual(timeRange)
    expect(result.current.copyState.selectedFilter).toBeNull()
  })

  it('should update selected filter and clear time range', () => {
    const { result } = renderHook(() => useGraphCopy(), {
      wrapper: createWrapper()
    })

    const timeRange: TimeRange = {
      start: new Date('2023-01-01'),
      end: new Date('2023-12-31')
    }

    const filter: EntityFilter = {
      actors: ['actor1', 'actor2'],
      targets: ['target1'],
      confidence_threshold: 0.8
    }

    // First set time range
    act(() => {
      result.current.setSelectedTimeRange(timeRange)
    })

    expect(result.current.copyState.selectedTimeRange).toEqual(timeRange)

    // Then set filter - should clear time range
    act(() => {
      result.current.setSelectedFilter(filter)
    })

    expect(result.current.copyState.selectedFilter).toEqual(filter)
    expect(result.current.copyState.selectedTimeRange).toBeNull()
  })

  it('should create full copy successfully', async () => {
    const mockCopyResult: CopyResult = {
      id: 'copy-123',
      name: 'Test Full Copy',
      status: 'pending',
      progress: 0,
      created_at: '2023-01-01T00:00:00Z'
    }

    vi.mocked(apiClient.graph.copyFull).mockResolvedValue(mockCopyResult)

    const { result } = renderHook(() => useGraphCopy(), {
      wrapper: createWrapper()
    })

    // Set copy name
    act(() => {
      result.current.setCopyName('Test Full Copy')
    })

    // Create copy
    await act(async () => {
      await result.current.createFullCopy()
    })

    expect(apiClient.graph.copyFull).toHaveBeenCalledWith('Test Full Copy')
    expect(mockAddLoadingOperation).toHaveBeenCalledWith('create-copy')
    expect(mockRemoveLoadingOperation).toHaveBeenCalledWith('create-copy')
    
    expect(result.current.copyState.activeOperations).toHaveLength(1)
    expect(result.current.copyState.activeOperations[0]).toMatchObject({
      id: 'copy-123',
      name: 'Test Full Copy',
      type: 'full',
      status: 'pending'
    })
  })

  it('should create time range copy successfully', async () => {
    const mockCopyResult: CopyResult = {
      id: 'copy-456',
      name: 'Test Time Range Copy',
      status: 'pending',
      progress: 0,
      created_at: '2023-01-01T00:00:00Z'
    }

    const timeRange: TimeRange = {
      start: new Date('2023-01-01'),
      end: new Date('2023-12-31')
    }

    vi.mocked(apiClient.graph.copyByTimeRange).mockResolvedValue(mockCopyResult)

    const { result } = renderHook(() => useGraphCopy(), {
      wrapper: createWrapper()
    })

    // Set copy name and time range
    act(() => {
      result.current.setCopyName('Test Time Range Copy')
      result.current.setSelectedTimeRange(timeRange)
    })

    // Create copy
    await act(async () => {
      await result.current.createTimeRangeCopy()
    })

    expect(apiClient.graph.copyByTimeRange).toHaveBeenCalledWith(timeRange, 'Test Time Range Copy')
    
    expect(result.current.copyState.activeOperations).toHaveLength(1)
    expect(result.current.copyState.activeOperations[0]).toMatchObject({
      id: 'copy-456',
      name: 'Test Time Range Copy',
      type: 'time_range',
      status: 'pending'
    })
  })

  it('should create filtered copy successfully', async () => {
    const mockCopyResult: CopyResult = {
      id: 'copy-789',
      name: 'Test Filtered Copy',
      status: 'pending',
      progress: 0,
      created_at: '2023-01-01T00:00:00Z'
    }

    const filter: EntityFilter = {
      actors: ['actor1'],
      targets: ['target1'],
      confidence_threshold: 0.7
    }

    vi.mocked(apiClient.graph.copyByFilter).mockResolvedValue(mockCopyResult)

    const { result } = renderHook(() => useGraphCopy(), {
      wrapper: createWrapper()
    })

    // Set copy name and filter
    act(() => {
      result.current.setCopyName('Test Filtered Copy')
      result.current.setSelectedFilter(filter)
    })

    // Create copy
    await act(async () => {
      await result.current.createFilteredCopy()
    })

    expect(apiClient.graph.copyByFilter).toHaveBeenCalledWith(filter, 'Test Filtered Copy')
    
    expect(result.current.copyState.activeOperations).toHaveLength(1)
    expect(result.current.copyState.activeOperations[0]).toMatchObject({
      id: 'copy-789',
      name: 'Test Filtered Copy',
      type: 'filtered',
      status: 'pending'
    })
  })

  it('should handle validation errors for missing copy name', async () => {
    const { result } = renderHook(() => useGraphCopy(), {
      wrapper: createWrapper()
    })

    // Try to create copy without name
    await act(async () => {
      await result.current.createFullCopy()
    })

    expect(mockAddError).toHaveBeenCalledWith({
      message: 'Please provide a name for the copy',
      type: 'validation'
    })
    expect(apiClient.graph.copyFull).not.toHaveBeenCalled()
  })

  it('should handle validation errors for missing time range', async () => {
    const { result } = renderHook(() => useGraphCopy(), {
      wrapper: createWrapper()
    })

    // Set copy name but no time range
    act(() => {
      result.current.setCopyName('Test Copy')
    })

    // Try to create time range copy
    await act(async () => {
      await result.current.createTimeRangeCopy()
    })

    expect(mockAddError).toHaveBeenCalledWith({
      message: 'Please select a time range for the copy',
      type: 'validation'
    })
    expect(apiClient.graph.copyByTimeRange).not.toHaveBeenCalled()
  })

  it('should handle validation errors for missing filter', async () => {
    const { result } = renderHook(() => useGraphCopy(), {
      wrapper: createWrapper()
    })

    // Set copy name but no filter
    act(() => {
      result.current.setCopyName('Test Copy')
    })

    // Try to create filtered copy
    await act(async () => {
      await result.current.createFilteredCopy()
    })

    expect(mockAddError).toHaveBeenCalledWith({
      message: 'Please configure filters for the copy',
      type: 'validation'
    })
    expect(apiClient.graph.copyByFilter).not.toHaveBeenCalled()
  })

  it('should handle API errors', async () => {
    const error = new Error('API Error')
    vi.mocked(apiClient.graph.copyFull).mockRejectedValue(error)

    const { result } = renderHook(() => useGraphCopy(), {
      wrapper: createWrapper()
    })

    // Set copy name
    act(() => {
      result.current.setCopyName('Test Copy')
    })

    // Try to create copy - wrap in try-catch since it throws
    await act(async () => {
      try {
        await result.current.createFullCopy()
      } catch {
        // Expected to throw
      }
    })

    expect(mockAddError).toHaveBeenCalledWith({
      message: 'Failed to create graph copy: API Error',
      type: 'network'
    })
    expect(result.current.isCreatingCopy).toBe(false)
  })

  it('should cancel copy operation', () => {
    const { result } = renderHook(() => useGraphCopy(), {
      wrapper: createWrapper()
    })

    // Add an active operation manually
    act(() => {
      result.current.copyState.activeOperations.push({
        id: 'copy-123',
        name: 'Test Copy',
        type: 'full',
        status: 'in_progress',
        progress: 50,
        created_at: '2023-01-01T00:00:00Z',
        parameters: {}
      })
    })

    // Cancel the operation
    act(() => {
      result.current.cancelCopy('copy-123')
    })

    expect(result.current.copyState.activeOperations).toHaveLength(0)
    expect(result.current.copyState.completedOperations).toHaveLength(1)
    expect(result.current.copyState.completedOperations[0]).toMatchObject({
      id: 'copy-123',
      status: 'failed',
      error_message: 'Cancelled by user'
    })
  })

  it('should clear completed operations', () => {
    const { result } = renderHook(() => useGraphCopy(), {
      wrapper: createWrapper()
    })

    // Add completed operations manually
    act(() => {
      result.current.copyState.completedOperations.push(
        {
          id: 'copy-1',
          name: 'Copy 1',
          type: 'full',
          status: 'completed',
          progress: 100,
          created_at: '2023-01-01T00:00:00Z',
          parameters: {}
        },
        {
          id: 'copy-2',
          name: 'Copy 2',
          type: 'filtered',
          status: 'failed',
          progress: 30,
          created_at: '2023-01-02T00:00:00Z',
          parameters: {}
        }
      )
    })

    expect(result.current.copyState.completedOperations).toHaveLength(2)

    // Clear completed operations
    act(() => {
      result.current.clearCompletedOperations()
    })

    expect(result.current.copyState.completedOperations).toHaveLength(0)
  })
})