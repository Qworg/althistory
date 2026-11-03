import React, { useState, useCallback, useEffect } from 'react'
import { useGraphCopy } from '@/hooks/useGraphCopy'
import { CopyOperation } from '@/types'
import { ConfirmDialog } from '@/components/ui'
import { ModalBase } from '@/components/modals/ModalBase'
import { formatHistoricalRange } from '@/utils/historicalTime'
import { COPY_TYPE_LABELS } from './copyTypeLabels'
import { CopyStatusBadge } from './CopyStatusBadge'

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
  const handleCancelDelete = useCallback(() => {
    setPendingDelete(null)
  }, [])

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
        op.type.toLowerCase().includes(query) ||
        (COPY_TYPE_LABELS[op.type] ?? '').toLowerCase().includes(query)
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

  // Wall-clock time (when the copy was made), so the viewer's local time.
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

  const ariaSort = (field: SortField): React.AriaAttributes['aria-sort'] =>
    sortField === field ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'

  const SortIcon = ({ field }: { field: SortField }) => (
    <svg
      className={`ml-1 h-3.5 w-3.5 ${sortField === field ? 'text-ink' : 'text-ink-muted'}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d={sortField !== field ? 'M8 9l4-4 4 4M16 15l-4 4-4-4' : sortDirection === 'asc' ? 'M8 14l4-4 4 4' : 'M16 10l-4 4-4-4'}
      />
    </svg>
  )

  const cell = 'border border-line px-4 py-3'
  const fieldClass =
    'px-3 py-2 border border-line bg-card text-ink rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-selected'
  const linkButton =
    'text-sm underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-selected'

  const sortableHeader = (field: SortField, label: string) => (
    <th scope="col" aria-sort={ariaSort(field)} className={`${cell} text-left`}>
      <button
        type="button"
        onClick={() => handleSort(field)}
        className="inline-flex items-center text-sm font-semibold text-ink hover:text-ink-secondary rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
      >
        {label}
        <SortIcon field={field} />
      </button>
    </th>
  )

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title="Copy history"
      size="4xl"
      // Escape belongs to the delete confirmation while it is open.
      closeOnEscape={pendingDelete === null}
      footer={
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md border border-line bg-card text-sm font-medium text-ink-secondary hover:bg-subtle hover:text-ink transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
          >
            Close
          </button>
        </div>
      }
    >
      <p className="text-sm text-ink-secondary mb-6">
        Copies made from your graphs: open one, compare it with the original, or delete it.
        Branches are listed in the graph manager.
      </p>

      {/* Filters and Search */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex-1 min-w-64">
          <label htmlFor="search-operations" className="sr-only">Search by name or type</label>
          <input
            id="search-operations"
            type="text"
            placeholder="Search by name or type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full ${fieldClass}`}
          />
        </div>

        <label htmlFor="filter-status" className="sr-only">Filter by status</label>
        <select
          id="filter-status"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as 'all' | 'completed' | 'failed')}
          className={fieldClass}
        >
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>

        <button
          type="button"
          onClick={clearCompletedOperations}
          className="px-4 py-2 text-sm text-red-700 border border-red-300 rounded-md hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:text-red-300 dark:border-red-400/40 dark:hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
          disabled={copyState.completedOperations.length === 0}
        >
          Clear history
        </button>
      </div>

      {/* Operations Table */}
      {filteredOperations.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border border-line text-sm">
            <thead className="bg-subtle">
              <tr>
                {sortableHeader('name', 'Name')}
                {sortableHeader('type', 'Type')}
                {sortableHeader('status', 'Status')}
                {sortableHeader('created_at', 'Created')}
                <th scope="col" className={`${cell} text-left font-semibold text-ink`}>Duration</th>
                <th scope="col" className={`${cell} text-left font-semibold text-ink`}>Progress</th>
                <th scope="col" className={`${cell} text-left font-semibold text-ink`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredOperations.map((operation) => (
                <tr key={operation.id} className="hover:bg-subtle">
                  <td className={cell}>
                    <div className="font-medium text-ink break-words">{operation.name}</div>
                    {operation.parameters.timeRange && (
                      <div className="text-xs text-ink-muted font-mono-code">
                        {formatHistoricalRange(operation.parameters.timeRange.start, operation.parameters.timeRange.end)}
                      </div>
                    )}
                    {operation.parameters.filter && (
                      <div className="text-xs text-ink-muted">
                        Filtered: {operation.parameters.filter.actors?.length || 0} actors, {operation.parameters.filter.targets?.length || 0} targets
                      </div>
                    )}
                  </td>
                  <td className={`${cell} text-ink-secondary`}>
                    {COPY_TYPE_LABELS[operation.type] ?? 'Copy'}
                  </td>
                  <td className={cell}>
                    <CopyStatusBadge status={operation.status} />
                  </td>
                  <td className={`${cell} font-mono-code text-ink-secondary`}>
                    {formatDate(operation.created_at)}
                  </td>
                  <td className={`${cell} font-mono-code text-ink-secondary`}>
                    {formatDuration(operation.created_at, operation.completed_at)}
                  </td>
                  <td className={cell}>
                    <div className="flex items-center">
                      <div className="w-16 bg-subtle border border-line rounded-full h-2 mr-2" aria-hidden="true">
                        <div
                          className="bg-baseline h-full rounded-full transition-all duration-300"
                          style={{ width: `${operation.progress}%` }}
                        />
                      </div>
                      <span className="font-mono-code text-ink-secondary">{operation.progress}%</span>
                    </div>
                  </td>
                  <td className={cell}>
                    <div className="flex gap-3">
                      {operation.status === 'completed' && onSwitchToGraph && (
                        <button
                          type="button"
                          onClick={() => onSwitchToGraph(operation.id)}
                          className={`${linkButton} text-baseline`}
                          title="Switch to this graph"
                        >
                          Open
                        </button>
                      )}

                      {operation.status === 'completed' && onCompareGraphs && (
                        <button
                          type="button"
                          onClick={() => onCompareGraphs('Original', operation.name, operation.id)}
                          className={`${linkButton} text-ink-secondary hover:text-ink`}
                          title="Compare with the original"
                        >
                          Compare
                        </button>
                      )}

                      {onDeleteCopy && (
                        <button
                          type="button"
                          onClick={() => setPendingDelete(operation)}
                          className={`${linkButton} text-red-700 hover:text-red-800 dark:text-red-300`}
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
        <div className="text-center py-10">
          <p className="text-base font-semibold text-ink mb-1">No copies found</p>
          <p className="text-sm text-ink-secondary">
            {searchQuery || filterStatus !== 'all'
              ? 'No copies match your current filters.'
              : 'Copies you make with Branch or copy… in the Graph menu show here.'
            }
          </p>
        </div>
      )}

      {/* Summary Stats */}
      {allOperations.length > 0 && (
        <dl className="mt-6 pt-6 border-t border-line grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          <div className="flex flex-col-reverse">
            <dt className="text-sm text-ink-secondary">Total copies</dt>
            <dd className="font-mono-code text-2xl font-semibold text-ink">{allOperations.length}</dd>
          </div>
          <div className="flex flex-col-reverse">
            <dt className="text-sm text-ink-secondary">Completed</dt>
            <dd className="font-mono-code text-2xl font-semibold text-ink">
              {allOperations.filter(op => op.status === 'completed').length}
            </dd>
          </div>
          <div className="flex flex-col-reverse">
            <dt className="text-sm text-ink-secondary">In progress</dt>
            <dd className="font-mono-code text-2xl font-semibold text-ink">
              {allOperations.filter(op => op.status === 'in_progress').length}
            </dd>
          </div>
          <div className="flex flex-col-reverse">
            <dt className="text-sm text-ink-secondary">Failed</dt>
            <dd className="font-mono-code text-2xl font-semibold text-ink">
              {allOperations.filter(op => op.status === 'failed').length}
            </dd>
          </div>
        </dl>
      )}

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
        onCancel={handleCancelDelete}
      />
    </ModalBase>
  )
}
