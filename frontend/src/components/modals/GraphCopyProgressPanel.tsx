/**
 * The copy panel: what happened to each copy, and how to get to it.
 *
 * There is no progress bar. `POST /graphs/copy` is synchronous: the graph is
 * copied inside the request, so the answer is already `completed` or
 * `failed` and there is no in-progress state to draw. The panel used to show
 * a 0-100% bar and an ETA for a status the server never produces, which read
 * as "still working" when nothing was.
 */

import React from 'react'
import { useGraphCopy } from '@/hooks/useGraphCopy'
import { ModalBase } from '@/components/modals/ModalBase'
import { formatHistoricalRange } from '@/utils/historicalTime'
import { CopyOperation } from '@/types'
import { COPY_TYPE_LABELS } from './copyTypeLabels'
import { CopyStatusBadge } from './CopyStatusBadge'

interface GraphCopyProgressPanelProps {
  isOpen: boolean
  onClose: () => void
  /** Called with the copy's graph id: a copy's id is the graph it created. */
  onSwitchToGraph?: (graphId: string) => void
  /** Opens the full, searchable list of every copy (Copy history). */
  onShowAll?: () => void
}

export const GraphCopyProgressPanel: React.FC<GraphCopyProgressPanelProps> = ({
  isOpen,
  onClose,
  onSwitchToGraph,
  onShowAll
}) => {
  const {
    copyState,
    cancelCopy,
    refreshCopyStatus,
    clearCompletedOperations
  } = useGraphCopy()

  const iconButton =
    'p-1 rounded-md text-ink-muted hover:text-ink hover:bg-subtle transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-selected'

  const renderOperation = (operation: CopyOperation, isActive: boolean) => (
    <li key={operation.id} className="border border-line rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex min-w-0 items-center gap-2">
          <CopyStatusBadge status={operation.status} />
          <h4 className="min-w-0 truncate text-base font-semibold text-ink" title={operation.name}>
            {operation.name}
          </h4>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isActive && (
            <>
              <button
                type="button"
                onClick={() => refreshCopyStatus(operation.id)}
                className={iconButton}
                title="Refresh status"
                aria-label={`Refresh status of ${operation.name}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => cancelCopy(operation.id)}
                className={`${iconButton} hover:text-red-700 dark:hover:text-red-300`}
                title="Cancel copy"
                aria-label={`Cancel copy ${operation.name}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          )}

          {!isActive && operation.status === 'completed' && onSwitchToGraph && (
            <button
              type="button"
              onClick={() => onSwitchToGraph(operation.id)}
              className="text-sm text-baseline hover:underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
            >
              Switch to copy
            </button>
          )}
        </div>
      </div>

      <p className="text-sm text-ink-secondary">
        {COPY_TYPE_LABELS[operation.type] ?? 'Copy'}
        {operation.parameters.timeRange && (
          <span className="ml-2 font-mono-code text-xs">
            {formatHistoricalRange(operation.parameters.timeRange.start, operation.parameters.timeRange.end)}
          </span>
        )}
        {operation.parameters.filter && (
          <span className="ml-2">
            ({operation.parameters.filter.actors?.length || 0} actors, {operation.parameters.filter.targets?.length || 0} targets)
          </span>
        )}
      </p>

      {/* Error Message */}
      {operation.error_message && (
        <p className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-800 dark:bg-red-500/10 dark:border-red-400/40 dark:text-red-200">
          {operation.error_message}
        </p>
      )}

      {/* Completion info: a wall-clock time, so the viewer's local time */}
      {operation.completed_at && (
        <p className="text-xs text-ink-muted mt-2">
          {operation.status === 'completed' ? 'Completed' : 'Failed'}{' '}
          <span className="font-mono-code">{new Date(operation.completed_at).toLocaleString()}</span>
        </p>
      )}
    </li>
  )

  const hasActiveOperations = copyState.activeOperations.length > 0
  const hasCompletedOperations = copyState.completedOperations.length > 0

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title="Copies"
      size="3xl"
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
      {/* Active Operations */}
      {hasActiveOperations && (
        <section className="mb-6">
          <h3 className="font-display text-xl font-semibold text-ink mb-3">
            Running <span className="font-mono-code text-base text-ink-muted">({copyState.activeOperations.length})</span>
          </h3>
          <ul className="space-y-3">
            {copyState.activeOperations.map(operation => renderOperation(operation, true))}
          </ul>
        </section>
      )}

      {/* Completed Operations */}
      {hasCompletedOperations && (
        <section className="mb-2">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-display text-xl font-semibold text-ink">
              Recent <span className="font-mono-code text-base text-ink-muted">({copyState.completedOperations.length})</span>
            </h3>
            <div className="flex items-center gap-4">
              {onShowAll && (
                <button
                  type="button"
                  onClick={onShowAll}
                  className="text-sm font-medium text-baseline underline underline-offset-2 hover:no-underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
                >
                  All copies…
                </button>
              )}
              <button
                type="button"
                onClick={clearCompletedOperations}
                className="text-sm text-ink-secondary hover:text-ink underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
              >
                Clear list
              </button>
            </div>
          </div>
          <ul className="space-y-3">
            {copyState.completedOperations.slice(-5).map(operation => renderOperation(operation, false))}
          </ul>
        </section>
      )}

      {/* Empty State */}
      {!hasActiveOperations && !hasCompletedOperations && (
        <div className="text-center py-10">
          <p className="text-base font-semibold text-ink mb-1">No copies yet</p>
          <p className="text-sm text-ink-secondary">
            Copies you make with Branch or copy… in the Graph menu show here. Branches are listed in the graph manager.
          </p>
        </div>
      )}
    </ModalBase>
  )
}
