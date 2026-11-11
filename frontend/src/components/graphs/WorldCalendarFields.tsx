import { useEffect, useRef } from 'react'
import type { GraphCalendar } from '@/types'
import {
  MAX_CALENDAR_NAME_LENGTH,
  MAX_ERA_LABEL_LENGTH,
  formatWorldYear,
  type CalendarDraft,
} from '@/utils/worldCalendar'
import type { CalendarDraftState } from './useCalendarDraft'

interface WorldCalendarFieldsProps {
  /** From `useCalendarDraft`. */
  state: CalendarDraftState
  /** Prefixes the field ids, so two forms on one page do not share them. */
  idPrefix: string
  /**
   * A stored year to show in the preview: the graph's first year when it has
   * events, so the preview speaks about this history. Defaults to year 1.
   */
  sampleYear?: number
  disabled?: boolean
}

const INPUT_CLASS =
  'w-full px-3 py-2 border rounded-md bg-card text-ink text-sm placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-selected disabled:opacity-50'

/** The calendar to preview: the epoch alone has to be valid, the label is shown as typed. */
function previewCalendar(draft: CalendarDraft, epochValid: boolean): GraphCalendar | null {
  if (!epochValid || draft.epochYear.trim() === '') return null
  const eraLabel = draft.eraLabel.trim()
  return { epochYear: Number(draft.epochYear.trim()), ...(eraLabel ? { eraLabel } : {}) }
}

/**
 * The optional "World calendar" section of a graph form: the stored year that
 * is the world's year 1, an era label and a name, with a live preview. Dates
 * stay stored as Gregorian UTC instants; the calendar only relabels the year
 * when one is shown.
 */
export function WorldCalendarFields({ state, idPrefix, sampleYear, disabled = false }: WorldCalendarFieldsProps) {
  const { enabled, setEnabled, draft, setField, errors, submitted, hadCalendar } = state
  const epochRef = useRef<HTMLInputElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  // Set by the button that toggles the section, which is unmounted by its own
  // click: focus goes to what replaces it instead of dropping to <body>.
  const moveFocus = useRef(false)

  // "Add a world calendar" moves focus to the first field it reveals;
  // "Remove calendar" to the button that adds it back.
  useEffect(() => {
    if (moveFocus.current) (enabled ? epochRef.current : addRef.current)?.focus()
    moveFocus.current = false
  }, [enabled])

  const ids = {
    epoch: `${idPrefix}-calendar-epoch`,
    label: `${idPrefix}-calendar-era`,
    name: `${idPrefix}-calendar-name`,
    preview: `${idPrefix}-calendar-preview`,
  }

  // An empty epoch year is "not yet", not a mistake, until the form is submitted.
  const epochError = errors.epochYear && (submitted || draft.epochYear.trim() !== '') ? errors.epochYear : undefined
  const calendar = previewCalendar(draft, !errors.epochYear)
  const sample = calendar ? sampleYear ?? calendar.epochYear : null

  return (
    <fieldset className="rounded-lg border border-line p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-medium text-ink-secondary">
        World calendar <span className="font-normal text-ink-muted">(optional)</span>
      </legend>

      {!enabled ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-muted">
            For an invented world: show its years in the world’s own reckoning, such as “312 AR”. Dates are still
            entered, stored and ordered as calendar dates; only the year is relabelled.
          </p>
          {hadCalendar && (
            <p className="text-xs text-ink-secondary" role="status">
              Saving removes the calendar, and dates show their stored years again.
            </p>
          )}
          <button
            ref={addRef}
            type="button"
            onClick={() => {
              moveFocus.current = true
              setEnabled(true)
            }}
            className="rounded border border-line px-3 py-1.5 text-sm text-ink hover:bg-subtle"
          >
            {hadCalendar ? 'Keep the world calendar' : 'Add a world calendar'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor={ids.epoch} className="block text-xs font-medium text-ink-secondary mb-1">
                Year 1 is stored year <span className="text-red-600 dark:text-red-300" aria-hidden="true">*</span>
              </label>
              <input
                ref={epochRef}
                id={ids.epoch}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={draft.epochYear}
                onChange={(e) => setField('epochYear', e.target.value)}
                placeholder="1000"
                aria-required="true"
                aria-invalid={epochError ? true : undefined}
                aria-describedby={epochError ? `${ids.epoch}-error ${ids.preview}` : ids.preview}
                className={`${INPUT_CLASS} font-mono-code ${epochError ? 'border-red-500 dark:border-red-400' : 'border-line'}`}
              />
              {epochError && (
                <p id={`${ids.epoch}-error`} className="mt-1 text-xs text-red-700 dark:text-red-300">
                  {epochError}
                </p>
              )}
            </div>
            <div>
              <label htmlFor={ids.label} className="block text-xs font-medium text-ink-secondary mb-1">
                Era label
              </label>
              <input
                id={ids.label}
                type="text"
                autoComplete="off"
                value={draft.eraLabel}
                onChange={(e) => setField('eraLabel', e.target.value)}
                placeholder="AR"
                aria-invalid={errors.eraLabel ? true : undefined}
                aria-describedby={errors.eraLabel ? `${ids.label}-error` : undefined}
                className={`${INPUT_CLASS} ${errors.eraLabel ? 'border-red-500 dark:border-red-400' : 'border-line'}`}
              />
              {errors.eraLabel && (
                <p id={`${ids.label}-error`} className="mt-1 text-xs text-red-700 dark:text-red-300">
                  {errors.eraLabel}
                </p>
              )}
            </div>
            <div>
              <label htmlFor={ids.name} className="block text-xs font-medium text-ink-secondary mb-1">
                Calendar name
              </label>
              <input
                id={ids.name}
                type="text"
                autoComplete="off"
                value={draft.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="the Reckoning of Vael"
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? `${ids.name}-error` : undefined}
                className={`${INPUT_CLASS} ${errors.name ? 'border-red-500 dark:border-red-400' : 'border-line'}`}
              />
              {errors.name && (
                <p id={`${ids.name}-error`} className="mt-1 text-xs text-red-700 dark:text-red-300">
                  {errors.name}
                </p>
              )}
            </div>
          </div>

          <div id={ids.preview} className="text-xs text-ink-muted" aria-live="polite">
            {calendar && sample !== null ? (
              <>
                <p className="text-ink-secondary">
                  Stored year <span className="font-mono-code">{sample}</span> shows as{' '}
                  <span className="font-medium text-ink">{formatWorldYear(sample, calendar)}</span>.
                </p>
                <p>
                  Earlier years count back: stored <span className="font-mono-code">{calendar.epochYear - 1}</span> shows
                  as {formatWorldYear(calendar.epochYear - 1, calendar)}.
                </p>
              </>
            ) : (
              <p>
                Give the stored (calendar) year that is the world’s year 1, from 1 to 9999. The label goes after
                the year, up to {MAX_ERA_LABEL_LENGTH} characters; the name, up to {MAX_CALENDAR_NAME_LENGTH}, is for
                display.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              moveFocus.current = true
              setEnabled(false)
            }}
            className="rounded px-3 py-1.5 text-sm text-ink-secondary hover:bg-subtle hover:text-ink"
          >
            Remove calendar
          </button>
        </div>
      )}
    </fieldset>
  )
}
