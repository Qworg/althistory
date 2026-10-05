/**
 * ImportConflictStep Component
 * 
 * Allows users to resolve conflicts before importing.
 */

import { ImportConflict, ConflictResolution } from '@/types'
import { ConflictResolutionRow } from './ConflictResolutionRow'

export interface ImportConflictStepProps {
  conflicts: ImportConflict[]
  resolutions: Record<string, ConflictResolution>
  onResolve: (conflictId: string, resolution: ConflictResolution) => void
  onResolveAll: (resolution: ConflictResolution) => void
  onContinue: () => void
  onBack: () => void
  isLoading?: boolean
}

export function ImportConflictStep({
  conflicts,
  resolutions,
  onResolve,
  onResolveAll,
  onContinue,
  onBack,
  isLoading = false,
}: ImportConflictStepProps) {
  const errorConflicts = conflicts.filter((c) => c.severity === 'error')
  const warningConflicts = conflicts.filter((c) => c.severity === 'warning')
  
  const resolvedCount = Object.keys(resolutions).length
  const errorResolvedCount = errorConflicts.filter((c) => resolutions[c.id]).length
  const allErrorsResolved = errorResolvedCount === errorConflicts.length
  
  const canContinue = allErrorsResolved

  // Calculate progress percentage safely
  const progressPercent = conflicts.length > 0 
    ? Math.round((resolvedCount / conflicts.length) * 100) 
    : 100

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-medium text-gray-900">Resolve Conflicts</h3>
        <p className="mt-1 text-sm text-gray-500">
          {conflicts.length} conflict(s) found. Resolve errors to continue.
        </p>
      </div>

      {/* Progress */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Resolution Progress</span>
          <span className="text-sm text-gray-500">
            {resolvedCount} / {conflicts.length} resolved
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              allErrorsResolved ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        {!allErrorsResolved && errorConflicts.length > 0 && (
          <p className="mt-2 text-xs text-red-600">
            {errorConflicts.length - errorResolvedCount} error(s) still need resolution
          </p>
        )}
      </div>

      {/* Bulk Actions */}
      <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
        <span className="text-sm text-gray-600">Apply to all conflicts:</span>
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={() => onResolveAll('skip')}
            className="px-3 py-1 text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-md transition-colors"
          >
            Skip All
          </button>
          <button
            type="button"
            onClick={() => onResolveAll('overwrite')}
            className="px-3 py-1 text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-md transition-colors"
          >
            Overwrite All
          </button>
          <button
            type="button"
            onClick={() => onResolveAll('rename')}
            className="px-3 py-1 text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-md transition-colors"
          >
            Rename All
          </button>
        </div>
      </div>

      {/* Error Conflicts */}
      {errorConflicts.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-red-800 mb-2">
            Errors ({errorConflicts.length}) - Must Resolve
          </h4>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {errorConflicts.map((conflict) => (
              <ConflictResolutionRow
                key={conflict.id}
                conflict={conflict}
                resolution={resolutions[conflict.id]}
                onResolve={(resolution) => onResolve(conflict.id, resolution)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Warning Conflicts */}
      {warningConflicts.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-yellow-800 mb-2">
            Warnings ({warningConflicts.length}) - Optional
          </h4>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {warningConflicts.map((conflict) => (
              <ConflictResolutionRow
                key={conflict.id}
                conflict={conflict}
                resolution={resolutions[conflict.id]}
                onResolve={(resolution) => onResolve(conflict.id, resolution)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between pt-4 border-t border-gray-200">
        <button
          type="button"
          onClick={onBack}
          disabled={isLoading}
          className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue || isLoading}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Loading...' : 'Continue to Import'}
        </button>
      </div>
    </div>
  )
}

export default ImportConflictStep
