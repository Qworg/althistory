/**
 * Export Hooks
 * 
 * React Query hooks for managing graph exports.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, useEffect } from 'react'
import { apiClient } from '@/services/api'
import {
  ExportJob,
  CreateExportJobRequest,
  AlthistoryExport,
  ExportValidationResult,
  ExportFilters
} from '@/types'

// Query keys
export const exportKeys = {
  all: ['export'] as const,
  jobs: () => [...exportKeys.all, 'jobs'] as const,
  jobsList: (filters?: { status?: string }) => [...exportKeys.jobs(), filters] as const,
  job: (id: string) => [...exportKeys.jobs(), id] as const,
  stats: () => [...exportKeys.all, 'stats'] as const,
}

/**
 * Hook to list export jobs
 */
export function useExportJobs(options?: { status?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: exportKeys.jobsList({ status: options?.status }),
    queryFn: () => apiClient.export.getJobs(options),
    refetchInterval: (query) => {
      // Auto-refresh if there are pending/processing jobs
      const data = query.state.data as ExportJob[] | undefined
      const hasActiveJobs = data?.some(job => 
        job.status === 'pending' || job.status === 'processing'
      )
      return hasActiveJobs ? 3000 : false // Poll every 3 seconds if active jobs
    },
  })
}

/**
 * Hook to get a single export job with polling for active jobs
 */
export function useExportJob(jobId: string | null | undefined) {
  return useQuery({
    queryKey: exportKeys.job(jobId!),
    queryFn: () => apiClient.export.getJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data as ExportJob | undefined
      const isActive = data?.status === 'pending' || data?.status === 'processing'
      return isActive ? 2000 : false // Poll every 2 seconds while active
    },
  })
}

/**
 * Hook to get export statistics
 */
export function useExportStats() {
  return useQuery({
    queryKey: exportKeys.stats(),
    queryFn: () => apiClient.export.getStats(),
    staleTime: 60000, // 1 minute
  })
}

/**
 * Hook to create an export job
 */
export function useCreateExportJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateExportJobRequest) => apiClient.export.createJob(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: exportKeys.jobs() })
      queryClient.invalidateQueries({ queryKey: exportKeys.stats() })
    },
  })
}

/**
 * Hook to cancel an export job
 */
export function useCancelExportJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (jobId: string) => apiClient.export.cancelJob(jobId),
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: exportKeys.job(jobId) })
      queryClient.invalidateQueries({ queryKey: exportKeys.jobs() })
      queryClient.invalidateQueries({ queryKey: exportKeys.stats() })
    },
  })
}

/**
 * Hook to download an export file
 */
export function useDownloadExport() {
  return useMutation({
    mutationFn: async ({ jobId, filename }: { jobId: string; filename?: string }) => {
      const blob = await apiClient.export.downloadJob(jobId)
      
      // Create download link
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename || `export_${jobId}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      
      return blob
    },
  })
}

/**
 * Hook for synchronous export (small graphs)
 */
export function useSyncExport() {
  return useMutation({
    mutationFn: (data: CreateExportJobRequest) => apiClient.export.exportSync(data),
  })
}

/**
 * Hook to validate an export file
 */
export function useValidateExport() {
  return useMutation({
    mutationFn: (exportData: AlthistoryExport) => apiClient.export.validate(exportData),
  })
}

/**
 * Combined hook for export management
 */
export function useExportManagement(graphId?: string) {
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  
  const { data: jobs, isLoading: isLoadingJobs } = useExportJobs()
  const { data: activeJob, isLoading: isLoadingJob } = useExportJob(activeJobId)
  const { data: stats } = useExportStats()
  
  const createJob = useCreateExportJob()
  const cancelJob = useCancelExportJob()
  const downloadExport = useDownloadExport()
  const syncExport = useSyncExport()
  const validateExport = useValidateExport()

  // Handle export creation
  const handleCreateExport = useCallback(async (options: {
    scope: 'full' | 'filtered'
    filters?: ExportFilters
    includeProvenance?: boolean
  }) => {
    if (!graphId) {
      throw new Error('No graph selected')
    }
    
    const result = await createJob.mutateAsync({
      graphId,
      scope: options.scope,
      filters: options.filters,
      includeProvenance: options.includeProvenance,
    })
    
    setActiveJobId(result.jobId)
    return result
  }, [graphId, createJob])

  // Handle sync export for small graphs
  const handleSyncExport = useCallback(async (options: {
    scope: 'full' | 'filtered'
    filters?: ExportFilters
    includeProvenance?: boolean
  }) => {
    if (!graphId) {
      throw new Error('No graph selected')
    }
    
    return syncExport.mutateAsync({
      graphId,
      scope: options.scope,
      filters: options.filters,
      includeProvenance: options.includeProvenance,
    })
  }, [graphId, syncExport])

  // Handle download
  const handleDownload = useCallback(async (jobId: string, filename?: string) => {
    return downloadExport.mutateAsync({ jobId, filename })
  }, [downloadExport])

  // Handle cancel
  const handleCancel = useCallback(async (jobId: string) => {
    await cancelJob.mutateAsync(jobId)
    if (activeJobId === jobId) {
      setActiveJobId(null)
    }
  }, [cancelJob, activeJobId])

  // Handle file validation
  const handleValidate = useCallback(async (exportData: AlthistoryExport) => {
    return validateExport.mutateAsync(exportData)
  }, [validateExport])

  // Clear active job when it completes
  useEffect(() => {
    if (activeJob && (activeJob.status === 'completed' || activeJob.status === 'failed' || activeJob.status === 'cancelled')) {
      // Keep showing for a moment before clearing
      const timer = setTimeout(() => {
        if (activeJob.status !== 'completed') {
          setActiveJobId(null)
        }
      }, 5000)
      return () => clearTimeout(timer)
    }
  }, [activeJob?.status])

  return {
    // State
    jobs: jobs || [],
    activeJob,
    activeJobId,
    stats: stats?.export,
    
    // Loading states
    isLoading: isLoadingJobs || isLoadingJob,
    isCreating: createJob.isPending,
    isDownloading: downloadExport.isPending,
    isCancelling: cancelJob.isPending,
    isValidating: validateExport.isPending,
    isSyncExporting: syncExport.isPending,
    
    // Actions
    createExport: handleCreateExport,
    syncExport: handleSyncExport,
    downloadExport: handleDownload,
    cancelExport: handleCancel,
    validateExport: handleValidate,
    setActiveJobId,
    
    // Helpers
    hasActiveJobs: jobs?.some(j => j.status === 'pending' || j.status === 'processing') || false,
    completedJobs: jobs?.filter(j => j.status === 'completed') || [],
    failedJobs: jobs?.filter(j => j.status === 'failed') || [],
  }
}
