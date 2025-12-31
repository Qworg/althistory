/**
 * ConflictResolutionRow Component
 * 
 * Displays a single import conflict with resolution options.
 * Extracted as a separate component per requirements.
 */

import { ImportConflict, ConflictResolution } from '@/types'

export interface ConflictResolutionRowProps {
  conflict: ImportConflict
  resolution: ConflictResolution | undefined
  onResolve: (resolution: ConflictResolution) => void
}

/**
 * Get the severity badge classes - uses static Tailwind classes to work with JIT
 */
function getSeverityBadgeClasses(severity: 'error' | 'warning'): string {
  if (severity === 'error') {
    return 'bg-red-100 text-red-800'
  }
  return 'bg-yellow-100 text-yellow-800'
}

export function ConflictResolutionRow({
  conflict,
  resolution,
  onResolve,
}: ConflictResolutionRowProps) {
  const severityClasses = getSeverityBadgeClasses(conflict.severity)

  return (
    <div className="border rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-2">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${severityClasses}`}
          >
            {conflict.severity}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
            {conflict.entityType}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
            {conflict.type}
          </span>
        </div>
        <span className="text-xs text-gray-500 font-mono">{conflict.entityId}</span>
      </div>

      {/* Message */}
      <p className="text-sm text-gray-700">{conflict.message}</p>

      {/* Entity Comparison (for duplicate-id conflicts) */}
      {conflict.existingEntity && (
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="bg-red-50 rounded p-2">
            <h5 className="font-medium text-red-800 mb-1">Existing</h5>
            <pre className="text-red-700 whitespace-pre-wrap overflow-hidden">
              {JSON.stringify(conflict.existingEntity, null, 2).slice(0, 200)}
              {JSON.stringify(conflict.existingEntity, null, 2).length > 200 && '...'}
            </pre>
          </div>
          <div className="bg-green-50 rounded p-2">
            <h5 className="font-medium text-green-800 mb-1">Incoming</h5>
            <pre className="text-green-700 whitespace-pre-wrap overflow-hidden">
              {JSON.stringify(conflict.incomingEntity, null, 2).slice(0, 200)}
              {JSON.stringify(conflict.incomingEntity, null, 2).length > 200 && '...'}
            </pre>
          </div>
        </div>
      )}

      {/* Resolution Options */}
      <div className="flex items-center space-x-4 pt-2 border-t">
        <span className="text-sm text-gray-500">Resolution:</span>
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={() => onResolve('skip')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              resolution === 'skip'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title="Don't import this entity"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => onResolve('overwrite')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              resolution === 'overwrite'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title="Replace existing with imported"
          >
            Overwrite
          </button>
          <button
            type="button"
            onClick={() => onResolve('rename')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              resolution === 'rename'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title="Import with a new generated ID"
          >
            Rename
          </button>
        </div>
        {conflict.suggestedResolution && (
          <span className="text-xs text-gray-400">
            (suggested: {conflict.suggestedResolution})
          </span>
        )}
      </div>
    </div>
  )
}

export default ConflictResolutionRow
