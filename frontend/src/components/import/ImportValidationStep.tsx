/**
 * ImportValidationStep Component
 * 
 * Shows validation results after parsing the import file.
 */

// React import not needed with new JSX transform
import { ImportValidationResult, ImportError, ImportWarning, GraphCalendar, ImportMode } from '@/types'
import { formatHistoricalDate } from '@/utils/historicalTime'

export interface ImportValidationStepProps {
  validation: ImportValidationResult
  onContinue: () => void
  onBack: () => void
  isLoading?: boolean
  /**
   * The incoming file's world calendar (`metadata.calendar`), or null for
   * none: the file's dates are shown in its own years, not the open graph's.
   */
  calendar?: GraphCalendar | null
  /**
   * With a graph to import into: how it is imported, and a change of it. The
   * dates are checked as that mode reads them (a new graph's own calendars,
   * or the target's), so the choice is offered here as well as at preview.
   */
  mode?: ImportMode
  onModeChange?: (mode: ImportMode) => void
}

const MODE_LABELS: Record<ImportMode, string> = {
  'create-new': 'As a new graph',
  merge: 'Merged into this graph',
  replace: 'Replacing this graph',
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
  calendar,
  mode,
  onModeChange,
}: ImportValidationStepProps) {
  const { valid, errors, warnings, summary } = validation

  return (
    <div className="space-y-6">
      {mode && onModeChange && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-medium text-ink-secondary">Import</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {(Object.keys(MODE_LABELS) as ImportMode[]).map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="validation-mode"
                  value={option}
                  checked={mode === option}
                  onChange={() => onModeChange(option)}
                  disabled={isLoading}
                  className="h-4 w-4 text-baseline border-line focus:ring-selected"
                />
                {MODE_LABELS[option]}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="text-center">
        <h3 className="text-lg font-medium text-ink">Validation Results</h3>
        <p className="mt-1 text-sm text-ink-muted">
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
      <div className="bg-subtle rounded-lg p-4">
        <h4 className="text-sm font-medium text-ink mb-3">Import Summary</h4>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-sm text-ink-muted">Events</dt>
            <dd className="text-2xl font-semibold text-ink">{summary.eventCount}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Arcs</dt>
            <dd className="text-2xl font-semibold text-ink">{summary.arcCount}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Relationships</dt>
            <dd className="text-2xl font-semibold text-ink">{summary.relationshipCount}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Pressures</dt>
            <dd className="text-2xl font-semibold text-ink">{summary.pressureCount}</dd>
          </div>
        </dl>
        
        {summary.temporalRange && (
          <div className="mt-4 pt-4 border-t border-line">
            <dt className="text-sm text-ink-muted">Time Range</dt>
            <dd className="text-sm text-ink">
              {formatHistoricalDate(summary.temporalRange.start, undefined, calendar ?? null)} -{' '}
              {formatHistoricalDate(summary.temporalRange.end, undefined, calendar ?? null)}
            </dd>
          </div>
        )}
        
        {summary.actors.length > 0 && (
          <div className="mt-2">
            <dt className="text-sm text-ink-muted">Actors ({summary.actors.length})</dt>
            <dd className="text-sm text-ink truncate">
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
      <div className="flex justify-between pt-4 border-t border-line">
        <button
          type="button"
          onClick={onBack}
          disabled={isLoading}
          className="inline-flex items-center px-4 py-2 border border-line text-sm font-medium rounded-md text-ink-secondary bg-card hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-selected disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={!valid || isLoading}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-on-accent bg-baseline hover:bg-baseline/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-selected disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Loading...' : 'Continue to Preview'}
        </button>
      </div>
    </div>
  )
}

export default ImportValidationStep
