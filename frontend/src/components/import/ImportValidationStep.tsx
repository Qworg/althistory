/**
 * ImportValidationStep Component
 * 
 * Shows validation results after parsing the import file.
 */

// React import not needed with new JSX transform
import { ImportValidationResult, ImportError, ImportWarning } from '@/types'

export interface ImportValidationStepProps {
  validation: ImportValidationResult
  onContinue: () => void
  onBack: () => void
  isLoading?: boolean
}

function ErrorItem({ error }: { error: ImportError }) {
  return (
    <li className="flex items-start space-x-2">
      <svg className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
          clipRule="evenodd"
        />
      </svg>
      <div>
        <span className="font-medium text-red-800">{error.code}</span>
        <span className="text-red-700">: {error.message}</span>
        <span className="text-red-500 text-sm block">{error.path}</span>
      </div>
    </li>
  )
}

function WarningItem({ warning }: { warning: ImportWarning }) {
  return (
    <li className="flex items-start space-x-2">
      <svg className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
      <div>
        <span className="font-medium text-yellow-800">{warning.code}</span>
        <span className="text-yellow-700">: {warning.message}</span>
        <span className="text-yellow-500 text-sm block">{warning.path}</span>
      </div>
    </li>
  )
}

export function ImportValidationStep({
  validation,
  onContinue,
  onBack,
  isLoading = false,
}: ImportValidationStepProps) {
  const { valid, errors, warnings, summary } = validation

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-medium text-gray-900">Validation Results</h3>
        <p className="mt-1 text-sm text-gray-500">
          {valid
            ? 'Your import file passed validation'
            : 'There are issues with your import file'}
        </p>
      </div>

      {/* Status Banner */}
      <div
        className={`rounded-md p-4 ${
          valid ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}
      >
        <div className="flex">
          <div className="flex-shrink-0">
            {valid ? (
              <svg className="h-5 w-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
          <div className="ml-3">
            <h3
              className={`text-sm font-medium ${valid ? 'text-green-800' : 'text-red-800'}`}
            >
              {valid ? 'Validation Passed' : 'Validation Failed'}
            </h3>
            <p className={`mt-1 text-sm ${valid ? 'text-green-700' : 'text-red-700'}`}>
              {errors.length} error(s), {warnings.length} warning(s)
            </p>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-900 mb-3">Import Summary</h4>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-sm text-gray-500">Events</dt>
            <dd className="text-2xl font-semibold text-gray-900">{summary.eventCount}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Arcs</dt>
            <dd className="text-2xl font-semibold text-gray-900">{summary.arcCount}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Relationships</dt>
            <dd className="text-2xl font-semibold text-gray-900">{summary.relationshipCount}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Pressures</dt>
            <dd className="text-2xl font-semibold text-gray-900">{summary.pressureCount}</dd>
          </div>
        </dl>
        
        {summary.temporalRange && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <dt className="text-sm text-gray-500">Time Range</dt>
            <dd className="text-sm text-gray-900">
              {new Date(summary.temporalRange.start).toLocaleDateString()} -{' '}
              {new Date(summary.temporalRange.end).toLocaleDateString()}
            </dd>
          </div>
        )}
        
        {summary.actors.length > 0 && (
          <div className="mt-2">
            <dt className="text-sm text-gray-500">Actors ({summary.actors.length})</dt>
            <dd className="text-sm text-gray-900 truncate">
              {summary.actors.slice(0, 5).join(', ')}
              {summary.actors.length > 5 && ` and ${summary.actors.length - 5} more`}
            </dd>
          </div>
        )}
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-red-800 mb-2">
            Errors ({errors.length})
          </h4>
          <ul className="space-y-2 max-h-48 overflow-y-auto">
            {errors.map((error, index) => (
              <ErrorItem key={index} error={error} />
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-yellow-50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-yellow-800 mb-2">
            Warnings ({warnings.length})
          </h4>
          <ul className="space-y-2 max-h-48 overflow-y-auto">
            {warnings.map((warning, index) => (
              <WarningItem key={index} warning={warning} />
            ))}
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
          disabled={!valid || isLoading}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Loading...' : 'Continue to Preview'}
        </button>
      </div>
    </div>
  )
}

export default ImportValidationStep
