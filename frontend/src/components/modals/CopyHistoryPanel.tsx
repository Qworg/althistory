import React, { useState, useCallback, useEffect } from 'react'
import { useGraphCopy } from '@/hooks/useGraphCopy'
import { CopyOperation } from '@/types'
import { ConfirmDialog } from '@/components/ui'

interface CopyHistoryPanelProps {
  isOpen: boolean
  onClose: () => void
  /** Called with the copy's graph id: a copy's id is the graph it created. */
  onSwitchToGraph?: (graphId: string) => void
  /**
   * Called with the copy's own graph id and the name of the graph it was
   * copied from. The id is what makes the comparison the one that was asked
   * for: names are labels, and several copies can share one.
   */
  onCompareGraphs?: (originalName: string, copiedName: string, copiedGraphId: string) => void
  onDeleteCopy?: (copyId: string) => void
}

type SortField = 'name' | 'created_at' | 'status' | 'type'
type SortDirection = 'asc' | 'desc'

export const CopyHistoryPanel: React.FC<CopyHistoryPanelProps> = ({
  isOpen,
  onClose,
  onSwitchToGraph,
  onCompareGraphs,
  onDeleteCopy
}) => {
  const { copyState, clearCompletedOperations } = useGraphCopy()
  
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'failed'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  /**
   * The copy the user asked to delete, held until they confirm.
   *
   * Deleting a copy deletes a graph -- a copy's id *is* the graph it created
   * -- so it is not something to do on a single click, which is how every
   * other destructive action in the app behaves.
   */
  const [pendingDelete, setPendingDelete] = useState<CopyOperation | null>(null)

  /**
   * Delete the copy the user confirmed, then close the dialog.
   *
   * The confirmation is cleared first: if the delete fails, the panel shows
   * the failure rather than a dialog that cannot be dismissed.
   */
  const handleConfirmDelete = useCallback(() => {
    const copy = pendingDelete
    setPendingDelete(null)
    if (copy && onDeleteCopy) {
      onDeleteCopy(copy.id)
    }
  }, [pendingDelete, onDeleteCopy])

  // Reset filter state when panel opens
  useEffect(() => {
    if (isOpen) {
      setSortField('created_at')
      setSortDirection('desc')
      setFilterStatus('all')
      setSearchQuery('')
    } else {
      // A confirmation that was open when the panel closed must not survive
      // into the next time it opens.
      setPendingDelete(null)
    }
  }, [isOpen])

  // Combine active and completed operations (memoized to avoid recreating array)
  const allOperations = React.useMemo(
    () => [...copyState.activeOperations, ...copyState.completedOperations],
    [copyState.activeOperations, copyState.completedOperations]
  )

  // Filter and sort operations
  const filteredOperations = React.useMemo(() => {
    let filtered = allOperations

    // Apply status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(op => op.status === filterStatus)
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(op =>
        op.name.toLowerCase().includes(query) ||
        op.type.toLowerCase().includes(query)
      )
    }

    // Sort operations
    filtered.sort((a, b) => {
      let aValue: string | number | undefined = a[sortField]
      let bValue: string | number | undefined = b[sortField]

      if (sortField === 'created_at') {
        aValue = aValue ? new Date(aValue as string).getTime() : 0
        bValue = bValue ? new Date(bValue as string).getTime() : 0
      }

      // Safely handle string comparison with null checks
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        aValue = aValue.toLowerCase()
        bValue = bValue.toLowerCase()
      } else if (aValue == null && bValue == null) {
        return 0
      } else if (aValue == null) {
        return sortDirection === 'asc' ? -1 : 1
      } else if (bValue == null) {
        return sortDirection === 'asc' ? 1 : -1
      }

      if (sortDirection === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0
      }
    })

    return filtered
  }, [allOperations, filterStatus, searchQuery, sortField, sortDirection])

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }, [sortField])

  const getStatusIcon = (status: CopyOperation['status']) => {
    switch (status) {
      case 'pending':
        return '⏳'
      case 'in_progress':
        return '🔄'
      case 'completed':
        return '✅'
      case 'failed':
        return '❌'
      default:
        return '❓'
    }
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  const formatDuration = (startTime: string, endTime?: string) => {
    const start = new Date(startTime)
    const end = endTime ? new Date(endTime) : new Date()
    const durationMs = end.getTime() - start.getTime()
    
    if (durationMs < 1000) return '< 1s'
    if (durationMs < 60000) return `${Math.round(durationMs / 1000)}s`
    if (durationMs < 3600000) return `${Math.round(durationMs / 60000)}m`
    return `${Math.round(durationMs / 3600000)}h`
  }

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <span className="text-gray-400">↕️</span>
    }
    return sortDirection === 'asc' ? <span className="text-blue-600">↑</span> : <span className="text-blue-600">↓</span>
  }

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="copy-history-title"
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 id="copy-history-title" className="text-2xl font-bold text-gray-900">Copy History</h2>
              <p className="text-gray-600 mt-1">
                Manage and review all graph copy operations
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close panel"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Filters and Search */}
          <div className="flex flex-wrap gap-4 mb-6">
            <div className="flex-1 min-w-64">
              <label htmlFor="search-operations" className="sr-only">Search operations</label>
              <input
                id="search-operations"
                type="text"
                placeholder="Search by name or type..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search by name or type"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <label htmlFor="filter-status" className="sr-only">Filter by status</label>
            <select
              id="filter-status"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'all' | 'completed' | 'failed')}
              aria-label="Filter by status"
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Status</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>

            <button
              onClick={clearCompletedOperations}
              className="px-4 py-2 text-red-600 border border-red-300 rounded-md hover:bg-red-50 transition-colors"
              disabled={copyState.completedOperations.length === 0}
            >
              Clear History
            </button>
          </div>

          {/* Operations Table */}
          {filteredOperations.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th 
                      className="border border-gray-200 px-4 py-3 text-left cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('name')}
                    >
                      <div className="flex items-center">
                        Name {getSortIcon('name')}
                      </div>
                    </th>
                    <th 
                      className="border border-gray-200 px-4 py-3 text-left cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('type')}
                    >
                      <div className="flex items-center">
                        Type {getSortIcon('type')}
                      </div>
                    </th>
                    <th 
                      className="border border-gray-200 px-4 py-3 text-left cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('status')}
                    >
                      <div className="flex items-center">
                        Status {getSortIcon('status')}
                      </div>
                    </th>
                    <th 
                      className="border border-gray-200 px-4 py-3 text-left cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('created_at')}
                    >
                      <div className="flex items-center">
                        Created {getSortIcon('created_at')}
                      </div>
                    </th>
                    <th className="border border-gray-200 px-4 py-3 text-left">Duration</th>
                    <th className="border border-gray-200 px-4 py-3 text-left">Progress</th>
                    <th className="border border-gray-200 px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOperations.map((operation) => (
                    <tr key={operation.id} className="hover:bg-gray-50">
                      <td className="border border-gray-200 px-4 py-3">
                        <div className="font-medium">{operation.name}</div>
                        {operation.parameters.timeRange && (
                          <div className="text-xs text-gray-500">
                            {new Date(operation.parameters.timeRange.start).toLocaleDateString()} - {new Date(operation.parameters.timeRange.end).toLocaleDateString()}
                          </div>
                        )}
                        {operation.parameters.filter && (
                          <div className="text-xs text-gray-500">
                            Filtered: {operation.parameters.filter.actors?.length || 0} actors, {operation.parameters.filter.targets?.length || 0} targets
                          </div>
                        )}
                      </td>
                      <td className="border border-gray-200 px-4 py-3">
                        <span className="capitalize">{operation.type.replace('_', ' ')}</span>
                      </td>
                      <td className="border border-gray-200 px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(operation.status)}`}>
                          <span className="mr-1">{getStatusIcon(operation.status)}</span>
                          {operation.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="border border-gray-200 px-4 py-3 text-sm">
                        {formatDate(operation.created_at)}
                      </td>
                      <td className="border border-gray-200 px-4 py-3 text-sm">
                        {formatDuration(operation.created_at, operation.completed_at)}
                      </td>
                      <td className="border border-gray-200 px-4 py-3">
                        <div className="flex items-center">
                          <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${operation.progress}%` }}
                            />
                          </div>
                          <span className="text-sm text-gray-600">{operation.progress}%</span>
                        </div>
                      </td>
                      <td className="border border-gray-200 px-4 py-3">
                        <div className="flex space-x-2">
                          {operation.status === 'completed' && onSwitchToGraph && (
                            <button
                              onClick={() => onSwitchToGraph(operation.id)}
                              className="text-blue-600 hover:text-blue-800 text-sm underline"
                              title="Switch to this graph"
                            >
                              Open
                            </button>
                          )}
                          
                          {operation.status === 'completed' && onCompareGraphs && (
                            <button
                              onClick={() => onCompareGraphs('Original', operation.name, operation.id)}
                              className="text-green-600 hover:text-green-800 text-sm underline"
                              title="Compare with original"
                            >
                              Compare
                            </button>
                          )}
                          
                          {onDeleteCopy && (
                            <button
                              onClick={() => setPendingDelete(operation)}
                              className="text-red-600 hover:text-red-800 text-sm underline"
                              title="Delete this copy"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Copy Operations Found</h3>
              <p className="text-gray-600">
                {searchQuery || filterStatus !== 'all' 
                  ? 'No operations match your current filters.'
                  : 'Create a graph copy to see operations here.'
                }
              </p>
            </div>
          )}

          {/* Summary Stats */}
          {allOperations.length > 0 && (
            <div className="mt-6 pt-6 border-t">
              <div className="grid grid-cols-4 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-gray-900">{allOperations.length}</div>
                  <div className="text-sm text-gray-600">Total Operations</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-600">
                    {allOperations.filter(op => op.status === 'completed').length}
                  </div>
                  <div className="text-sm text-gray-600">Completed</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-blue-600">
                    {allOperations.filter(op => op.status === 'in_progress').length}
                  </div>
                  <div className="text-sm text-gray-600">In Progress</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-600">
                    {allOperations.filter(op => op.status === 'failed').length}
                  </div>
                  <div className="text-sm text-gray-600">Failed</div>
                </div>
              </div>
            </div>
          )}

          {/* Close Button */}
          <div className="flex justify-end mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Deleting a copy deletes the graph the copy created, so it asks
          first. The dialog says that plainly: "delete this copy" reads like
          removing a history entry, and it is not. */}
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Delete this copy?"
        message={
          pendingDelete
            ? `"${pendingDelete.name}" is a graph of its own. Deleting it removes the graph and everything in it. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete copy"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}