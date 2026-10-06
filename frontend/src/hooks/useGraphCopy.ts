import { useState, useCallback, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api'
import { useGlobalStore } from '@/stores/globalStore'
import { 
  CopyOperation, 
  CopyResult, 
  TimeRange, 
  EntityFilter,
  GraphCopyState 
} from '@/types'

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
  
  const [copyState, setCopyState] = useState<GraphCopyState>({
    activeOperations: [],
    completedOperations: [],
    selectedTimeRange: null,
    selectedFilter: null,
    copyName: '',
    isCreatingCopy: false
  })

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
        created_at: result.created_at,
        parameters: {
          timeRange: variables.timeRange,
          filter: variables.filter
        }
      }
      
      setCopyState(prev => ({
        ...prev,
        activeOperations: [...prev.activeOperations, operation],
        isCreatingCopy: false,
        copyName: '',
        selectedTimeRange: null,
        selectedFilter: null
      }))
      
      // Start polling for status updates
      startStatusPolling(result.id)
    },
    onError: (error) => {
      addError({
        message: `Failed to create graph copy: ${error.message}`,
        type: 'network'
      })
      
      setCopyState(prev => ({
        ...prev,
        isCreatingCopy: false
      }))
    }
  })

  // Query for checking copy status
  useQuery({
    queryKey: ['copy-status'],
    queryFn: async () => {
      const activeIds = copyState.activeOperations.map(op => op.id)
      const statusPromises = activeIds.map(id => apiClient.graph.getCopyStatus(id))
      return Promise.all(statusPromises)
    },
    enabled: false, // Only run manually
    refetchInterval: false
  })

  // Status polling for active operations
  const [pollingIntervals, setPollingIntervals] = useState<Map<string, number>>(new Map())

  const startStatusPolling = useCallback((copyId: string) => {
    if (pollingIntervals.has(copyId)) {
      return // Already polling
    }

    const interval = setInterval(async () => {
      try {
        const result = await apiClient.graph.getCopyStatus(copyId)
        
        setCopyState(prev => {
          const updatedActiveOps = prev.activeOperations.map(op => 
            op.id === copyId ? {
              ...op,
              status: result.status,
              progress: result.progress,
              estimated_completion: result.estimated_completion,
              error_message: result.error_message,
              completed_at: result.completed_at
            } : op
          )
          
          // Move completed operations to completed list
          const stillActive = updatedActiveOps.filter(op => 
            op.status === 'pending' || op.status === 'in_progress'
          )
          const nowCompleted = updatedActiveOps.filter(op => 
            op.status === 'completed' || op.status === 'failed'
          )
          
          return {
            ...prev,
            activeOperations: stillActive,
            completedOperations: [...prev.completedOperations, ...nowCompleted]
          }
        })
        
        // Stop polling if operation is complete
        if (result.status === 'completed' || result.status === 'failed') {
          const interval = pollingIntervals.get(copyId)
          if (interval) {
            clearInterval(interval)
            setPollingIntervals(prev => {
              const newMap = new Map(prev)
              newMap.delete(copyId)
              return newMap
            })
          }
        }
      } catch (error) {
        console.error(`Failed to check status for copy ${copyId}:`, error)
      }
    }, 2000) // Poll every 2 seconds

    setPollingIntervals(prev => new Map(prev).set(copyId, interval))
  }, [pollingIntervals])

  // Cleanup polling intervals on unmount
  useEffect(() => {
    return () => {
      pollingIntervals.forEach(interval => clearInterval(interval))
    }
  }, [pollingIntervals])

  // Actions
  const setCopyName = useCallback((name: string) => {
    setCopyState(prev => ({ ...prev, copyName: name }))
  }, [])

  const setSelectedTimeRange = useCallback((range: TimeRange | null) => {
    setCopyState(prev => ({ 
      ...prev, 
      selectedTimeRange: range,
      selectedFilter: null // Clear filter when time range is selected
    }))
  }, [])

  const setSelectedFilter = useCallback((filter: EntityFilter | null) => {
    setCopyState(prev => ({ 
      ...prev, 
      selectedFilter: filter,
      selectedTimeRange: null // Clear time range when filter is selected
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

    setCopyState(prev => ({ ...prev, isCreatingCopy: true }))
    
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

    setCopyState(prev => ({ ...prev, isCreatingCopy: true }))
    
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

    setCopyState(prev => ({ ...prev, selectedFilter: effectiveFilter, isCreatingCopy: true }))
    
    await createCopyMutation.mutateAsync({
      type: 'filtered',
      name: copyState.copyName.trim(),
      filter: effectiveFilter
    })
  }, [copyState.copyName, copyState.selectedFilter, createCopyMutation, addError])

  const cancelCopy = useCallback((copyId: string) => {
    // Stop polling for this operation
    const interval = pollingIntervals.get(copyId)
    if (interval) {
      clearInterval(interval)
      setPollingIntervals(prev => {
        const newMap = new Map(prev)
        newMap.delete(copyId)
        return newMap
      })
    }

    // Move to completed with failed status
    setCopyState(prev => {
      const operationToCancel = prev.activeOperations.find(op => op.id === copyId)
      if (!operationToCancel) return prev

      const cancelledOperation = {
        ...operationToCancel,
        status: 'failed' as const,
        error_message: 'Cancelled by user',
        completed_at: new Date().toISOString()
      }

      return {
        ...prev,
        activeOperations: prev.activeOperations.filter(op => op.id !== copyId),
        completedOperations: [...prev.completedOperations, cancelledOperation]
      }
    })
  }, [pollingIntervals])

  const refreshCopyStatus = useCallback((copyId: string) => {
    startStatusPolling(copyId)
  }, [startStatusPolling])

  const clearCompletedOperations = useCallback(() => {
    setCopyState(prev => ({
      ...prev,
      completedOperations: []
    }))
  }, [])

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