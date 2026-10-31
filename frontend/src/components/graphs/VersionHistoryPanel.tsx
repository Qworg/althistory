/**
 * VersionHistoryPanel Component
 * 
 * Sidebar panel showing version history of the current graph with rollback capability.
 */

import { useState, useCallback, memo } from 'react'
import { useGraphVersions, useRollbackGraph, useActiveGraphId, useActiveGraph } from '@/hooks/useGraphs'
import { GraphVersion } from '@/types'

interface VersionHistoryPanelProps {
  className?: string
  maxVersions?: number
  onVersionSelect?: (version: GraphVersion) => void
}

export const VersionHistoryPanel = memo(function VersionHistoryPanel({
  className = '',
  maxVersions = 20,
  onVersionSelect,
}: VersionHistoryPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [showConfirm, setShowConfirm] = useState<number | null>(null)

  const activeGraphId = useActiveGraphId()
  const { data: activeGraph } = useActiveGraph()
  const { data: versions, isLoading, error } = useGraphVersions(activeGraphId, maxVersions)
  const rollbackMutation = useRollbackGraph()

  const handleRollback = useCallback(async (version: number) => {
    if (!activeGraphId) return
    
    try {
      await rollbackMutation.mutateAsync({ id: activeGraphId, version })
      setShowConfirm(null)
    } catch (error) {
      console.error('Rollback failed:', error)
    }
  }, [activeGraphId, rollbackMutation])

  const handleVersionClick = useCallback((version: GraphVersion) => {
    onVersionSelect?.(version)
  }, [onVersionSelect])

  if (!activeGraphId) {
    return (
      <div className={`bg-white border rounded-lg p-4 ${className}`}>
        <div className="text-gray-500 text-sm">No graph selected</div>
      </div>
    )
  }

  return (
    <div className={`bg-white border rounded-lg overflow-hidden ${className}`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" 
            />
          </svg>
          <span className="font-medium text-gray-700">Version History</span>
        </div>
        <div className="flex items-center gap-2">
          {activeGraph && (
            <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded">
              v{activeGraph.version}
            </span>
          )}
          <svg 
            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-gray-500">
              <svg className="animate-spin h-5 w-5 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" 
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" 
                />
              </svg>
              Loading history...
            </div>
          ) : error ? (
            <div className="p-4 text-center text-red-500">
              Failed to load version history
            </div>
          ) : !versions || versions.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              No version history available
            </div>
          ) : (
            <div className="divide-y">
              {versions.map((version, index) => (
                <VersionItem
                  key={version.commitHash}
                  version={version}
                  isLatest={index === 0}
                  isCurrent={version.version === activeGraph?.version}
                  showConfirm={showConfirm === version.version}
                  isRollingBack={rollbackMutation.isPending}
                  onClick={() => handleVersionClick(version)}
                  onRollbackClick={() => setShowConfirm(version.version)}
                  onRollbackConfirm={() => handleRollback(version.version)}
                  onRollbackCancel={() => setShowConfirm(null)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

interface VersionItemProps {
  version: GraphVersion
  isLatest: boolean
  isCurrent: boolean
  showConfirm: boolean
  isRollingBack: boolean
  onClick: () => void
  onRollbackClick: () => void
  onRollbackConfirm: () => void
  onRollbackCancel: () => void
}

const VersionItem = memo(function VersionItem({
  version,
  isLatest,
  isCurrent,
  showConfirm,
  isRollingBack,
  onClick,
  onRollbackClick,
  onRollbackConfirm,
  onRollbackCancel,
}: VersionItemProps) {
  const timestamp = new Date(version.timestamp)
  const timeAgo = getTimeAgo(timestamp)

  return (
    <div 
      className={`
        px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors
        ${isCurrent ? 'bg-blue-50' : ''}
      `}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {/* Version Header */}
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">v{version.version}</span>
            {isCurrent && (
              <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                Current
              </span>
            )}
            {isLatest && !isCurrent && (
              <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                Latest
              </span>
            )}
            {version.operation && (
              <span className="text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded capitalize">
                {version.operation}
              </span>
            )}
          </div>

          {/* Commit Message */}
          <div className="text-sm text-gray-600 mt-1 truncate">
            {version.message || 'No commit message'}
          </div>

          {/* Timestamp and Author */}
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
            <span title={timestamp.toLocaleString()}>{timeAgo}</span>
            {version.author && (
              <>
                <span>-</span>
                <span>{version.author}</span>
              </>
            )}
          </div>

          {/* Changes Summary */}
          <div className="flex flex-wrap gap-1 mt-2">
            <ChangesBadge type="events" changes={version.changes} />
            <ChangesBadge type="arcs" changes={version.changes} />
            <ChangesBadge type="relationships" changes={version.changes} />
          </div>
        </div>

        {/* Rollback Button */}
        {!isCurrent && (
          <div className="ml-3 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            {showConfirm ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={onRollbackConfirm}
                  disabled={isRollingBack}
                  className="p-1 bg-orange-500 text-white rounded text-xs hover:bg-orange-600 disabled:opacity-50"
                >
                  {isRollingBack ? '...' : 'Yes'}
                </button>
                <button
                  onClick={onRollbackCancel}
                  className="p-1 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={onRollbackClick}
                className="p-1.5 text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded transition-colors"
                title="Rollback to this version"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" 
                  />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

interface ChangesBadgeProps {
  type: 'events' | 'arcs' | 'relationships'
  changes: GraphVersion['changes']
}

const ChangesBadge = memo(function ChangesBadge({ type, changes }: ChangesBadgeProps) {
  // A missing count is no change. Checking `=== 0` let `undefined` through and
  // drew an empty "E:" badge.
  const added = Number(changes[`${type}Added` as keyof typeof changes]) || 0
  const modified = Number(changes[`${type}Modified` as keyof typeof changes]) || 0
  const deleted = Number(changes[`${type}Deleted` as keyof typeof changes]) || 0

  if (added === 0 && modified === 0 && deleted === 0) {
    return null
  }

  const parts: string[] = []
  if (added > 0) parts.push(`+${added}`)
  if (modified > 0) parts.push(`~${modified}`)
  if (deleted > 0) parts.push(`-${deleted}`)

  const label = type.charAt(0).toUpperCase() // E, A, R
  const bgColor = added > 0 ? 'bg-green-50' : modified > 0 ? 'bg-yellow-50' : 'bg-red-50'
  const textColor = added > 0 ? 'text-green-700' : modified > 0 ? 'text-yellow-700' : 'text-red-700'

  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${bgColor} ${textColor}`} title={type}>
      {label}: {parts.join(' ')}
    </span>
  )
})

// Helper function
function getTimeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  
  return date.toLocaleDateString()
}

export default VersionHistoryPanel
