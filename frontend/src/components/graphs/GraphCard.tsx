/**
 * GraphCard Component
 * 
 * A card component for displaying a graph in a list view.
 * Shows graph metadata, status, and provides action buttons.
 */

import { memo, useCallback } from 'react'
import { Graph, GraphStatus } from '@/types'

interface GraphCardProps {
  /** The graph to display */
  graph: Graph
  /** Whether this graph is currently active */
  isActive?: boolean
  /** Called when the card is clicked to select */
  onSelect?: (graph: Graph) => void
  /** Called when the edit button is clicked */
  onEdit?: (graph: Graph) => void
  /** Called when the archive/unarchive button is clicked */
  onArchive?: (graph: Graph) => void
  /** Called when the delete button is clicked */
  onDelete?: (graph: Graph) => void
  /** Additional CSS classes */
  className?: string
}

const statusConfig: Record<GraphStatus, { bg: string; text: string; label: string }> = {
  active: { bg: 'bg-green-100', text: 'text-green-700', label: 'Active' },
  archived: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Archived' },
  deleted: { bg: 'bg-red-100', text: 'text-red-700', label: 'Deleted' },
}

export const GraphCard = memo(function GraphCard({
  graph,
  isActive = false,
  onSelect,
  onEdit,
  onArchive,
  onDelete,
  className = '',
}: GraphCardProps) {
  const status = statusConfig[graph.status]

  const handleClick = useCallback(() => {
    onSelect?.(graph)
  }, [graph, onSelect])

  const handleEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onEdit?.(graph)
  }, [graph, onEdit])

  const handleArchive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onArchive?.(graph)
  }, [graph, onArchive])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete?.(graph)
  }, [graph, onDelete])

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div
      onClick={handleClick}
      className={`
        p-4 border rounded-lg cursor-pointer transition-all
        ${isActive ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'}
        ${className}
      `}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
    >
      {/* Header: Name and Status Badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 truncate">
              {graph.name}
            </h3>
            {graph.branchName && (
              <span className="flex-shrink-0 text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                {graph.branchName}
              </span>
            )}
          </div>
          {graph.description && (
            <p className="text-sm text-gray-500 mt-1 line-clamp-2">
              {graph.description}
            </p>
          )}
        </div>
        <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded ${status.bg} ${status.text}`}>
          {status.label}
        </span>
      </div>

      {/* Stats Row */}
      <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
        <span className="flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" 
            />
          </svg>
          {graph.metadata.eventCount} events
        </span>
        <span className="flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M13 10V3L4 14h7v7l9-11h-7z" 
            />
          </svg>
          {graph.metadata.arcCount} arcs
        </span>
        <span className="text-gray-400">v{graph.version}</span>
      </div>

      {/* Time Range (if available) */}
      {graph.metadata.timeRange && (
        <div className="mt-2 text-xs text-gray-400">
          {new Date(graph.metadata.timeRange.start).getFullYear()} - {new Date(graph.metadata.timeRange.end).getFullYear()}
        </div>
      )}

      {/* Last Updated */}
      <div className="mt-3 text-xs text-gray-400">
        Updated {formatDate(graph.updatedAt)}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100">
        {onEdit && (
          <button
            onClick={handleEdit}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded hover:bg-gray-50 transition-colors"
            aria-label={`Edit ${graph.name}`}
          >
            Edit
          </button>
        )}
        {onArchive && (
          <button
            onClick={handleArchive}
            className={`px-3 py-1.5 text-sm border rounded transition-colors ${
              graph.status === 'archived'
                ? 'border-green-200 text-green-600 hover:bg-green-50'
                : 'border-yellow-200 text-yellow-600 hover:bg-yellow-50'
            }`}
            aria-label={graph.status === 'archived' ? `Unarchive ${graph.name}` : `Archive ${graph.name}`}
          >
            {graph.status === 'archived' ? 'Unarchive' : 'Archive'}
          </button>
        )}
        {onDelete && (
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded hover:bg-red-50 transition-colors"
            aria-label={`Delete ${graph.name}`}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
})

export default GraphCard
