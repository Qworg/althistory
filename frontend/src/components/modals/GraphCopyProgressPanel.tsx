import React from 'react'
import { useGraphCopy } from '@/hooks/useGraphCopy'
import { CopyOperation } from '@/types'

interface GraphCopyProgressPanelProps {
  isOpen: boolean
  onClose: () => void
  onSwitchToGraph?: (graphName: string) => void
}

export const GraphCopyProgressPanel: React.FC<GraphCopyProgressPanelProps> = ({
  isOpen,
  onClose,
  onSwitchToGraph
}) => {
  const {
    copyState,
    cancelCopy,
    refreshCopyStatus,
    clearCompletedOperations
  } = useGraphCopy()

  const formatEstimatedTime = (estimatedCompletion?: string) => {
    if (!estimatedCompletion) return 'Calculating...'
    
    const now = new Date()
    const completion = new Date(estimatedCompletion)
    const diffMs = completion.getTime() - now.getTime()
    
    if (diffMs <= 0) return 'Almost done'
    
    const diffMinutes = Math.ceil(diffMs / (1000 * 60))
    if (diffMinutes < 60) return `~${diffMinutes} min`
    
    const diffHours = Math.ceil(diffMinutes / 60)
    return `~${diffHours} hour${diffHours > 1 ? 's' : ''}`
  }

  const getStatusColor = (status: CopyOperation['status']) => {
    switch (status) {
      case 'pending':
        return 'text-yellow-600 bg-yellow-100'
      case 'in_progress':
        return 'text-blue-600 bg-blue-100'
      case 'completed':
        return 'text-green-600 bg-green-100'
      case 'failed':
        return 'text-red-600 bg-red-100'
      default:
        return 'text-gray-600 bg-gray-100'
    }
  }

  const getStatusIcon = (status: CopyOperation['status']) => {
    switch (status) {
      case 'pending':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      case 'in_progress':
        return (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        )
      case 'completed':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )
      case 'failed':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )
      default:
        return null
    }
  }

  const renderOperation = (operation: CopyOperation, isActive: boolean) => (
    <div key={operation.id} className="border border-gray-200 rounded-lg p-4 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(operation.status)}`}>
            {getStatusIcon(operation.status)}
            <span className="ml-1 capitalize">{operation.status.replace('_', ' ')}</span>
          </span>
          <h3 className="font-medium text-gray-900">{operation.name}</h3>
        </div>
        
        <div className="flex items-center space-x-2">
          {isActive && (
            <>
              <button
                onClick={() => refreshCopyStatus(operation.id)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                title="Refresh status"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                onClick={() => cancelCopy(operation.id)}
                className="text-red-400 hover:text-red-600 transition-colors"
                title="Cancel operation"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          )}
          
          {!isActive && operation.status === 'completed' && onSwitchToGraph && (
            <button
              onClick={() => onSwitchToGraph(operation.name)}
              className="text-blue-600 hover:text-blue-800 text-sm underline"
            >
              Switch to Graph
            </button>
          )}
        </div>
      </div>

      <div className="text-sm text-gray-600 mb-2">
        <span className="capitalize">{operation.type.replace('_', ' ')} copy</span>
        {operation.parameters.timeRange && (
          <span className="ml-2">
            ({new Date(operation.parameters.timeRange.start).toLocaleDateString()} - {new Date(operation.parameters.timeRange.end).toLocaleDateString()})
          </span>
        )}
        {operation.parameters.filter && (
          <span className="ml-2">
            (Filtered: {operation.parameters.filter.actors?.length || 0} actors, {operation.parameters.filter.targets?.length || 0} targets)
          </span>
        )}
      </div>

      {/* Progress Bar */}
      {isActive && (
        <div className="mb-2">
          <div className="flex justify-between text-sm text-gray-600 mb-1">
            <span>Progress: {operation.progress}%</span>
            <span>{formatEstimatedTime(operation.estimated_completion)}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${operation.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error Message */}
      {operation.error_message && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {operation.error_message}
        </div>
      )}

      {/* Completion Info */}
      {operation.completed_at && (
        <div className="text-xs text-gray-500 mt-2">
          {operation.status === 'completed' ? 'Completed' : 'Failed'} at {new Date(operation.completed_at).toLocaleString()}
        </div>
      )}
    </div>
  )

  if (!isOpen) return null

  const hasActiveOperations = copyState.activeOperations.length > 0
  const hasCompletedOperations = copyState.completedOperations.length > 0

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Graph Copy Operations</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Active Operations */}
          {hasActiveOperations && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                Active Operations ({copyState.activeOperations.length})
              </h3>
              {copyState.activeOperations.map(operation => renderOperation(operation, true))}
            </div>
          )}

          {/* Completed Operations */}
          {hasCompletedOperations && (
            <div className="mb-6">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold text-gray-900">
                  Recent Operations ({copyState.completedOperations.length})
                </h3>
                <button
                  onClick={clearCompletedOperations}
                  className="text-sm text-gray-600 hover:text-gray-800 underline"
                >
                  Clear All
                </button>
              </div>
              {copyState.completedOperations.slice(-5).map(operation => renderOperation(operation, false))}
            </div>
          )}

          {/* Empty State */}
          {!hasActiveOperations && !hasCompletedOperations && (
            <div className="text-center py-12">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Copy Operations</h3>
              <p className="text-gray-600">
                Create a graph copy to see operations here.
              </p>
            </div>
          )}

          {/* Close Button */}
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}