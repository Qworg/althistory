/**
 * ExportHistoryList Component
 * 
 * A list component showing export job history with status, progress,
 * and action buttons for each job.
 */

import { memo, useCallback } from 'react'
import { ExportJob, ExportJobStatus } from '@/types'

interface ExportHistoryListProps {
  /** List of export jobs to display */
  jobs: ExportJob[]
  /** Called when download button is clicked */
  onDownload?: (jobId: string) => void
  /** Called when delete/cancel button is clicked */
  onDelete?: (jobId: string) => void
  /** Called when retry button is clicked for failed jobs */
  onRetry?: (jobId: string) => void
  /** Whether a download operation is in progress */
  isDownloading?: boolean
  /** Additional CSS classes */
  className?: string
  /** Maximum number of jobs to display */
  maxItems?: number
}

const statusConfig: Record<ExportJobStatus, { 
  icon: React.ReactNode
  bg: string
  text: string
  label: string 
}> = {
  pending: {
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" 
        />
      </svg>
    ),
    bg: 'bg-gray-100',
    text: 'text-gray-600',
    label: 'Pending',
  },
  processing: {
    icon: (
      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    ),
    bg: 'bg-blue-100',
    text: 'text-blue-600',
    label: 'Processing',
  },
  completed: {
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
    bg: 'bg-green-100',
    text: 'text-green-600',
    label: 'Completed',
  },
  failed: {
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
    bg: 'bg-red-100',
    text: 'text-red-600',
    label: 'Failed',
  },
  cancelled: {
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
          d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" 
        />
      </svg>
    ),
    bg: 'bg-gray-100',
    text: 'text-gray-500',
    label: 'Cancelled',
  },
}

export const ExportHistoryList = memo(function ExportHistoryList({
  jobs,
  onDownload,
  onDelete,
  onRetry,
  isDownloading = false,
  className = '',
  maxItems,
}: ExportHistoryListProps) {
  const displayedJobs = maxItems ? jobs.slice(0, maxItems) : jobs

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const handleDownload = useCallback((jobId: string) => {
    onDownload?.(jobId)
  }, [onDownload])

  const handleDelete = useCallback((jobId: string) => {
    onDelete?.(jobId)
  }, [onDelete])

  const handleRetry = useCallback((jobId: string) => {
    onRetry?.(jobId)
  }, [onRetry])

  if (displayedJobs.length === 0) {
    return (
      <div className={`text-center py-8 text-gray-500 ${className}`}>
        <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" 
          />
        </svg>
        <p className="text-sm">No export history</p>
        <p className="text-xs text-gray-400 mt-1">Export jobs will appear here</p>
      </div>
    )
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {displayedJobs.map(job => {
        const status = statusConfig[job.status]
        const isActive = job.status === 'pending' || job.status === 'processing'

        return (
          <div
            key={job.id}
            className={`
              border rounded-lg p-3 transition-all
              ${isActive ? 'border-blue-200 bg-blue-50' : 'border-gray-200'}
            `}
          >
            {/* Header Row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {/* Status Icon */}
                <span className={`flex-shrink-0 p-1 rounded ${status.bg} ${status.text}`}>
                  {status.icon}
                </span>
                
                {/* Job ID and Date */}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    Export {job.id.slice(-8)}
                  </div>
                  <div className="text-xs text-gray-400">
                    {formatDate(job.createdAt)}
                  </div>
                </div>
              </div>

              {/* Status Label */}
              <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded ${status.bg} ${status.text}`}>
                {status.label}
              </span>
            </div>

            {/* Progress Bar (for pending/processing) */}
            {isActive && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span>Progress</span>
                  <span>{job.progress}%</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-600 transition-all duration-300"
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error Message (for failed jobs) */}
            {job.status === 'failed' && job.error && (
              <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded p-2">
                <span className="font-medium">Error:</span> {job.error}
              </div>
            )}

            {/* Result Summary (for completed jobs) */}
            {job.status === 'completed' && job.result?.summary && (
              <div className="mt-2 text-xs text-gray-500">
                {Object.entries(job.result.summary).slice(0, 3).map(([key, value]) => (
                  <span key={key} className="mr-3">
                    {key}: {String(value)}
                  </span>
                ))}
              </div>
            )}

            {/* Warnings (for completed jobs) */}
            {job.status === 'completed' && job.result?.warnings && job.result.warnings.length > 0 && (
              <div className="mt-2 text-xs text-yellow-600">
                {job.result.warnings.length} warning{job.result.warnings.length !== 1 ? 's' : ''}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-gray-100">
              {/* Download button for completed jobs */}
              {job.status === 'completed' && onDownload && (
                <button
                  onClick={() => handleDownload(job.id)}
                  disabled={isDownloading}
                  className="px-3 py-1.5 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50 transition-colors flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" 
                    />
                  </svg>
                  {isDownloading ? 'Downloading...' : 'Download'}
                </button>
              )}

              {/* Retry button for failed jobs */}
              {job.status === 'failed' && onRetry && (
                <button
                  onClick={() => handleRetry(job.id)}
                  className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" 
                    />
                  </svg>
                  Retry
                </button>
              )}

              {/* Cancel button for active jobs */}
              {isActive && onDelete && (
                <button
                  onClick={() => handleDelete(job.id)}
                  className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors"
                >
                  Cancel
                </button>
              )}

              {/* Delete button for completed/failed/cancelled jobs */}
              {!isActive && onDelete && (
                <button
                  onClick={() => handleDelete(job.id)}
                  className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        )
      })}

      {/* Show "more" indicator */}
      {maxItems && jobs.length > maxItems && (
        <div className="text-center text-xs text-gray-400 py-2">
          +{jobs.length - maxItems} more exports
        </div>
      )}
    </div>
  )
})

export default ExportHistoryList
