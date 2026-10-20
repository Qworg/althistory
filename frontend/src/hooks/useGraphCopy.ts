import { useState, useCallback, useMemo } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/services/api'
import { useGlobalStore } from '@/stores/globalStore'
import { useCopyStore } from '@/stores/copyStore'
import { 
  CopyOperation, 
  CopyResult, 
  TimeRange, 
  EntityFilter,
  GraphCopyState 
} from '@/types'

/** How many consecutive status failures end the polling of a copy. */
const MAX_POLL_FAILURES = 5

/**
 * The error message of a copy the user cancelled.
 *
 * A cancellation is not a failure the user needs to be told about, so the
 * completion notice skips it.
 */
export const CANCELLED_MESSAGE = 'Cancelled by user'

interface UseGraphCopyReturn {
  // State
  copyState: GraphCopyState
  
  // Actions
  setCopyName: (name: string) => void
  setSelectedTimeRange: (range: TimeRange | null) => void
  setSelectedFilter: (filter: EntityFilter | null) => void
  
  // Copy operations
  createFullCopy: () => Promise<void>
  createTimeRangeCopy: () => Promise<void>
  createFilteredCopy: (filter?: EntityFilter) => Promise<void>
  cancelCopy: (copyId: string) => void
  
  // Status tracking
  refreshCopyStatus: (copyId: string) => void
  clearCompletedOperations: () => void
  
  // Loading states
  isCreatingCopy: boolean
  isRefreshingStatus: boolean
}

export const useGraphCopy = (): UseGraphCopyReturn => {
  const { addError, addLoadingOperation, removeLoadingOperation } = useGlobalStore()

  // The operations are shared state, so every component that asks for them
  // sees the same ones. The form state (name, time range, filter) stays
  // local: it belongs to the form, not to the application.
  // Each slice is selected on its own: selecting the whole store would
  // re-render every consumer whenever the polling map changed.
  const activeOperations = useCopyStore((state) => state.activeOperations)
  const completedOperations = useCopyStore((state) => state.completedOperations)
  const addOperation = useCopyStore((state) => state.addOperation)
  const updateOperation = useCopyStore((state) => state.updateOperation)
  const clearCompleted = useCopyStore((state) => state.clearCompletedOperations)
  const startPolling = useCopyStore((state) => state.startPolling)
  const stopPolling = useCopyStore((state) => state.stopPolling)

  // The form state is local -- it belongs to the form, not to the
  // application -- and the operation lists are shared.
  const [formState, setFormState] = useState<{
    selectedTimeRange: TimeRange | null
    selectedFilter: EntityFilter | null
    copyName: string
    isCreatingCopy: boolean
  }>({
    selectedTimeRange: null,
    selectedFilter: null,
    copyName: '',
    isCreatingCopy: false,
  })

  // One object, built from the shared lists and the local form state, so the
  // hook's contract (one `copyState`) still holds for the components that
  // read it -- without a mirror that lags a commit behind.
  const copyState: GraphCopyState = useMemo(
    () => ({
      activeOperations,
      completedOperations,
      selectedTimeRange: formState.selectedTimeRange,
      selectedFilter: formState.selectedFilter,
      copyName: formState.copyName,
      isCreatingCopy: formState.isCreatingCopy,
    }),
    [activeOperations, completedOperations, formState]
  )

  // Mutation for creating copies
  const createCopyMutation = useMutation({
    mutationFn: async ({ 
      type, 
      name, 
      timeRange, 
      filter 
    }: {
      type: 'full' | 'time_range' | 'filtered'
      name: string
      timeRange?: TimeRange
      filter?: EntityFilter
    }) => {
      addLoadingOperation('create-copy')
      
      try {
        let result: CopyResult
        
        switch (type) {
          case 'full':
            result = await apiClient.graph.copyFull(name)
            break
          case 'time_range':
            if (!timeRange) throw new Error('Time range is required for time range copy')
            result = await apiClient.graph.copyByTimeRange(timeRange, name)
            break
          case 'filtered':
            if (!filter) throw new Error('Filter is required for filtered copy')
            result = await apiClient.graph.copyByFilter(filter, name)
            break
          default:
            throw new Error(`Unknown copy type: ${type}`)
        }
        
        return result
      } finally {
        removeLoadingOperation('create-copy')
      }
    },
    onSuccess: (result, variables) => {
      const operation: CopyOperation = {
        id: result.id,
        name: result.name,
        type: variables.type,
        status: result.status,
        progress: result.progress,
        estimated_completion: result.estimated_completion,
        error_message: result.error_message,
        created_at: result.created_at,
        completed_at: result.completed_at,
        parameters: {
          timeRange: variables.timeRange,
          filter: variables.filter
        }
      }

      addOperation(operation)

      setFormState(prev => ({
        ...prev,
        isCreatingCopy: false,
        copyName: '',
        selectedTimeRange: null,
        selectedFilter: null
      }))

      // The backend copies synchronously: the response already says whether it
      // finished, and a finished copy is not polled. Polling it would replace
      // the real outcome with the status of the graph the copy created, which
      // is `completed` even when the copy itself failed.
      if (result.status === 'pending' || result.status === 'in_progress') {
        startStatusPolling(result.id)
      }
    },
    onError: (error) => {
      addError({
        message: `Failed to create graph copy: ${error.message}`,
        type: 'network'
      })
      
      setFormState(prev => ({
        ...prev,
        isCreatingCopy: false
      }))
    }
  })

  // Status polling for active operations
  const startStatusPolling = useCallback((copyId: string) => {
    if (useCopyStore.getState().pollingIntervals.has(copyId)) {
      return // Already polling
    }

    // How many consecutive failures are tolerated before the poll gives up.
    // The copy may be gone (a restarted backend forgets it) or the network may
    // be down; polling for the life of the page in either case is waste.
    let consecutiveFailures = 0

    const interval = setInterval(async () => {
      try {
        const result = await apiClient.graph.getCopyStatus(copyId)
        consecutiveFailures = 0

        updateOperation(copyId, {
          status: result.status,
          progress: result.progress,
          estimated_completion: result.estimated_completion,
          error_message: result.error_message,
          completed_at: result.completed_at,
        })

        // Stop polling if operation is complete
        if (result.status === 'completed' || result.status === 'failed') {
          stopPolling(copyId)
        }
      } catch (error) {
        consecutiveFailures += 1
        console.error(`Failed to check status for copy ${copyId}:`, error)

        if (consecutiveFailures >= MAX_POLL_FAILURES) {
          stopPolling(copyId)
          // The copy is left as it is. A network outage says nothing about the
          // copy, and recording it as failed would report a successful copy as
          // a failure for ever, because a finished copy is never polled again.
          // The user can still refresh it.
        }
      }
    }, 2000) // Poll every 2 seconds

    startPolling(copyId, interval)
  }, [startPolling, stopPolling, updateOperation])

  // Actions
  const setCopyName = useCallback((name: string) => {
    setFormState(prev => ({ ...prev, copyName: name }))
  }, [])

  const setSelectedTimeRange = useCallback((range: TimeRange | null) => {
    setFormState(prev => ({
      ...prev,
      selectedTimeRange: range,
      selectedFilter: null, // Clear filter when time range is selected
    }))
  }, [])

  const setSelectedFilter = useCallback((filter: EntityFilter | null) => {
    setFormState(prev => ({
      ...prev,
      selectedFilter: filter,
      selectedTimeRange: null, // Clear time range when filter is selected
    }))
  }, [])

  const createFullCopy = useCallback(async () => {
    if (!copyState.copyName.trim()) {
      addError({
        message: 'Please provide a name for the copy',
        type: 'validation'
      })
      return
    }

    setFormState(prev => ({ ...prev, isCreatingCopy: true }))
    
    await createCopyMutation.mutateAsync({
      type: 'full',
      name: copyState.copyName.trim()
    })
  }, [copyState.copyName, createCopyMutation, addError])

  const createTimeRangeCopy = useCallback(async () => {
    if (!copyState.copyName.trim()) {
      addError({
        message: 'Please provide a name for the copy',
        type: 'validation'
      })
      return
    }

    if (!copyState.selectedTimeRange) {
      addError({
        message: 'Please select a time range for the copy',
        type: 'validation'
      })
      return
    }

    setFormState(prev => ({ ...prev, isCreatingCopy: true }))
    
    await createCopyMutation.mutateAsync({
      type: 'time_range',
      name: copyState.copyName.trim(),
      timeRange: copyState.selectedTimeRange
    })
  }, [copyState.copyName, copyState.selectedTimeRange, createCopyMutation, addError])

  const createFilteredCopy = useCallback(async (filter?: EntityFilter) => {
    if (!copyState.copyName.trim()) {
      addError({
        message: 'Please provide a name for the copy',
        type: 'validation'
      })
      return
    }

    // Prefer an explicitly supplied filter so a copy created in the same tick as
    // the filter selection does not read a not-yet-committed state value.
    const effectiveFilter = filter ?? copyState.selectedFilter

    if (!effectiveFilter) {
      addError({
        message: 'Please configure filters for the copy',
        type: 'validation'
      })
      return
    }

    setFormState(prev => ({ ...prev, selectedFilter: effectiveFilter, isCreatingCopy: true }))
    
    await createCopyMutation.mutateAsync({
      type: 'filtered',
      name: copyState.copyName.trim(),
      filter: effectiveFilter
    })
  }, [copyState.copyName, copyState.selectedFilter, createCopyMutation, addError])

  const cancelCopy = useCallback((copyId: string) => {
    // Stop polling for this operation
    stopPolling(copyId)

    // The current operations are read from the store, not from the render's
    // copy of them: a cancel can arrive while the list is out of date.
    const operationToCancel = useCopyStore
      .getState()
      .activeOperations.find((operation) => operation.id === copyId)
    if (!operationToCancel) return

    updateOperation(copyId, {
      status: 'failed',
      error_message: CANCELLED_MESSAGE,
      completed_at: new Date().toISOString(),
    })
  }, [stopPolling, updateOperation])

  const refreshCopyStatus = useCallback((copyId: string) => {
    startStatusPolling(copyId)
  }, [startStatusPolling])

  const clearCompletedOperations = useCallback(() => {
    clearCompleted()
  }, [clearCompleted])

  return {
    copyState,
    setCopyName,
    setSelectedTimeRange,
    setSelectedFilter,
    createFullCopy,
    createTimeRangeCopy,
    createFilteredCopy,
    cancelCopy,
    refreshCopyStatus,
    clearCompletedOperations,
    isCreatingCopy: createCopyMutation.isPending || copyState.isCreatingCopy,
    isRefreshingStatus: false // Could be enhanced with actual refresh state
  }
}