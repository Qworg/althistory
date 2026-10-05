/**
 * ImportExecuteStep Component
 * 
 * Executes the import and shows progress/results.
 */

// React import not needed with new JSX transform
import { ImportResult, EntityCounts } from '@/types'

export interface ImportExecuteStepProps {
  isExecuting: boolean
  progress: number
  result: ImportResult | null
  error: string | null
  onExecute: () => void
  onBack: () => void
  onComplete: () => void
  /** FIX #17: Optional cancel handler for async imports */
  onCancel?: () => void
  /** FIX #17: Whether cancellation is in progress */
  isCancelling?: boolean
}

function CountSummary({ title, counts }: { title: string; counts: EntityCounts }) {
  const total = counts.events + counts.arcs + counts.relationships + counts.pressures
  if (total === 0) return null

  return (
    <div className="flex justify-between items-center py-2">
      <span className="text-sm text-gray-600">{title}</span>
      <div className="flex space-x-3 text-sm">
        {counts.events > 0 && (
          <span>
            <span className="font-medium">{counts.events}</span> events
          </span>
        )}
        {counts.arcs > 0 && (
          <span>
            <span className="font-medium">{counts.arcs}</span> arcs
          </span>
        )}
        {counts.relationships > 0 && (
          <span>
            <span className="font-medium">{counts.relationships}</span> relationships
          </span>
        )}
        {counts.pressures > 0 && (
          <span>
            <span className="font-medium">{counts.pressures}</span> pressures
          </span>
        )}
      </div>
    </div>
  )
}

export function ImportExecuteStep({
  isExecuting,
  progress,
  result,
  error,
  onExecute,
  onBack,
  onComplete,
  onCancel,
  isCancelling = false,
}: ImportExecuteStepProps) {
  const hasStarted = isExecuting || result !== null || error !== null
  const isSuccess = result?.success === true
  const isFailed = result?.success === false || error !== null

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-medium text-gray-900">
          {!hasStarted && 'Ready to Import'}
          {isExecuting && 'Importing...'}
          {isSuccess && 'Import Complete'}
          {isFailed && 'Import Failed'}
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          {!hasStarted && 'Click the button below to start the import process'}
          {isExecuting && 'Please wait while your data is being imported'}
          {isSuccess && 'Your data has been successfully imported'}
          {isFailed && 'There was an error during the import process'}
        </p>
      </div>

      {/* Progress Bar (during execution) */}
      {isExecuting && (
        <div className="space-y-2">
          {/* FIX #8: Handle indeterminate progress (-1) for sync imports */}
          {progress === -1 ? (
            <>
              <div className="flex justify-between text-sm text-gray-600">
                <span>Processing...</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden" role="progressbar" aria-label="Import in progress">
                <div
                  className="bg-blue-500 h-3 rounded-full animate-pulse"
                  style={{ width: '100%' }}
                />
              </div>
              <p className="text-sm text-gray-500 text-center">
                Importing data...
              </p>
            </>
          ) : (
            <>
              <div className="flex justify-between text-sm text-gray-600">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className="bg-blue-500 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-sm text-gray-500 text-center">
                {isCancelling ? 'Cancelling import...' : 'Processing entities...'}
              </p>
              {/* FIX #17: Cancel button for async imports */}
              {onCancel && !isCancelling && (
                <div className="flex justify-center mt-2">
                  <button
                    type="button"
                    onClick={onCancel}
                    className="inline-flex items-center px-3 py-1 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                  >
                    Cancel Import
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Success State */}
      {isSuccess && result && (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex">
              <svg
                className="h-5 w-5 text-green-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-green-800">
                  Import Successful
                </h3>
                <p className="mt-1 text-sm text-green-700">
                  Graph version: {result.graphVersion}
                </p>
                <p className="text-sm text-green-700">
                  Graph ID: {result.graphId}
                </p>
              </div>
            </div>
          </div>

          {/* Import Summary */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-900 mb-3">Import Summary</h4>
            <div className="divide-y divide-gray-200">
              <CountSummary title="Imported" counts={result.imported} />
              <CountSummary title="Skipped" counts={result.skipped} />
              {result.deleted && <CountSummary title="Deleted" counts={result.deleted} />}
            </div>
          </div>

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="bg-yellow-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-yellow-800 mb-2">
                Warnings ({result.warnings.length})
              </h4>
              <ul className="space-y-1 text-sm text-yellow-700 max-h-32 overflow-y-auto">
                {result.warnings.map((warning, index) => (
                  <li key={index}>
                    {warning.code}: {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Error State */}
      {isFailed && (
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex">
              <svg
                className="h-5 w-5 text-red-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Import Failed</h3>
                {error && (
                  <p className="mt-1 text-sm text-red-700">{error}</p>
                )}
              </div>
            </div>
          </div>

          {/* Detailed Errors */}
          {result?.errors && result.errors.length > 0 && (
            <div className="bg-red-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-red-800 mb-2">
                Errors ({result.errors.length})
              </h4>
              <ul className="space-y-2 text-sm text-red-700 max-h-48 overflow-y-auto">
                {result.errors.map((err, index) => (
                  <li key={index} className="flex items-start space-x-2">
                    <span className="font-medium">{err.code}:</span>
                    <span>{err.message}</span>
                    <span className="text-red-500 text-xs">{err.path}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Pre-execute State */}
      {!hasStarted && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex">
            <svg
              className="h-5 w-5 text-blue-400"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800">Ready to Import</h3>
              <p className="mt-1 text-sm text-blue-700">
                All validations passed. Click "Start Import" to begin the import process.
                This action will create a new version in your graph.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between pt-4 border-t border-gray-200">
        <button
          type="button"
          onClick={onBack}
          disabled={isExecuting}
          className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {isSuccess || isFailed ? 'Start Over' : 'Back'}
        </button>

        {!hasStarted && (
          <button
            type="button"
            onClick={onExecute}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            Start Import
          </button>
        )}

        {isSuccess && (
          <button
            type="button"
            onClick={onComplete}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Done
          </button>
        )}

        {isFailed && (
          <button
            type="button"
            onClick={onExecute}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Retry Import
          </button>
        )}
      </div>
    </div>
  )
}

export default ImportExecuteStep
