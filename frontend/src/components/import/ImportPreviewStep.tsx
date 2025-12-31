/**
 * ImportPreviewStep Component
 * 
 * Shows what changes will be made by the import.
 */

// React import not needed with new JSX transform
import { ImportPreview, ImportMode, EntityCounts } from '@/types'

export interface ImportPreviewStepProps {
  preview: ImportPreview
  mode: ImportMode
  onModeChange: (mode: ImportMode) => void
  onContinue: () => void
  onBack: () => void
  hasConflicts: boolean
  isLoading?: boolean
}

function CountCard({
  title,
  counts,
  colorClass,
}: {
  title: string
  counts: EntityCounts
  colorClass: string
}) {
  const total = counts.events + counts.arcs + counts.relationships + counts.pressures
  if (total === 0) return null

  return (
    <div className={`rounded-lg p-4 ${colorClass}`}>
      <h4 className="text-sm font-medium mb-2">{title}</h4>
      <div className="grid grid-cols-2 gap-2 text-sm">
        {counts.events > 0 && (
          <div>
            <span className="font-medium">{counts.events}</span> events
          </div>
        )}
        {counts.arcs > 0 && (
          <div>
            <span className="font-medium">{counts.arcs}</span> arcs
          </div>
        )}
        {counts.relationships > 0 && (
          <div>
            <span className="font-medium">{counts.relationships}</span> relationships
          </div>
        )}
        {counts.pressures > 0 && (
          <div>
            <span className="font-medium">{counts.pressures}</span> pressures
          </div>
        )}
      </div>
    </div>
  )
}

export function ImportPreviewStep({
  preview,
  mode,
  onModeChange,
  onContinue,
  onBack,
  hasConflicts,
  isLoading = false,
}: ImportPreviewStepProps) {
  const { toCreate, toUpdate, toDelete, warnings } = preview

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-medium text-gray-900">Import Preview</h3>
        <p className="mt-1 text-sm text-gray-500">
          Review what changes will be made to your graph
        </p>
      </div>

      {/* Import Mode Selection */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-900 mb-3">Import Mode</h4>
        <div className="space-y-3">
          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="create-new"
              checked={mode === 'create-new'}
              onChange={() => onModeChange('create-new')}
              className="mt-1 h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              disabled={isLoading}
            />
            <div>
              <span className="block text-sm font-medium text-gray-900">
                Create New Graph
              </span>
              <span className="block text-sm text-gray-500">
                Import into a brand new graph (no conflicts possible)
              </span>
            </div>
          </label>
          
          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="merge"
              checked={mode === 'merge'}
              onChange={() => onModeChange('merge')}
              className="mt-1 h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              disabled={isLoading}
            />
            <div>
              <span className="block text-sm font-medium text-gray-900">
                Merge into Current Graph
              </span>
              <span className="block text-sm text-gray-500">
                Add new entities, skip existing ones with same IDs
              </span>
            </div>
          </label>
          
          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="replace"
              checked={mode === 'replace'}
              onChange={() => onModeChange('replace')}
              className="mt-1 h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              disabled={isLoading}
            />
            <div>
              <span className="block text-sm font-medium text-gray-900">
                Replace Current Graph
              </span>
              <span className="block text-sm text-gray-500">
                Replace existing entities with imported data
              </span>
            </div>
          </label>
        </div>
      </div>

      {/* Change Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <CountCard
          title="To Create"
          counts={toCreate}
          colorClass="bg-green-50 text-green-800"
        />
        <CountCard
          title="To Update"
          counts={toUpdate}
          colorClass="bg-blue-50 text-blue-800"
        />
        <CountCard
          title="To Delete"
          counts={toDelete}
          colorClass="bg-red-50 text-red-800"
        />
      </div>

      {/* No Changes Message */}
      {toCreate.events + toCreate.arcs + toCreate.relationships + toCreate.pressures === 0 &&
        toUpdate.events + toUpdate.arcs + toUpdate.relationships + toUpdate.pressures === 0 &&
        toDelete.events + toDelete.arcs + toDelete.relationships + toDelete.pressures === 0 && (
          <div className="bg-gray-50 rounded-lg p-4 text-center text-gray-500">
            No changes will be made with current settings
          </div>
        )}

      {/* Conflicts Warning */}
      {hasConflicts && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex">
            <svg
              className="h-5 w-5 text-yellow-400"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">
                Conflicts Detected
              </h3>
              <p className="mt-1 text-sm text-yellow-700">
                There are {preview.conflicts.length} conflict(s) that need to be resolved before importing.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-yellow-50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-yellow-800 mb-2">
            Warnings ({warnings.length})
          </h4>
          <ul className="space-y-1 text-sm text-yellow-700 max-h-32 overflow-y-auto">
            {warnings.slice(0, 5).map((warning, index) => (
              <li key={index}>
                {warning.code}: {warning.message}
              </li>
            ))}
            {warnings.length > 5 && (
              <li className="text-yellow-600">
                And {warnings.length - 5} more warnings...
              </li>
            )}
          </ul>
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
          disabled={isLoading}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {isLoading ? 'Loading...' : hasConflicts ? 'Resolve Conflicts' : 'Continue to Import'}
        </button>
      </div>
    </div>
  )
}

export default ImportPreviewStep
