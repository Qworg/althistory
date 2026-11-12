/**
 * TextIngestTab
 *
 * Pasted-text source form for the ingestion wizard (Req 19.1). The `useLLM`
 * flag lets the user choose between the offline pattern extractor and the
 * configured LLM.
 *
 * In a graph with a world calendar the server tells the model how the world
 * dates things, so "141 AR" lands on the stored year 1140; the pattern reader
 * cannot read invented dates, and the tab says so. The time range takes stored
 * dates, with the world date under each.
 */

import { useEffect, useState, type FormEvent } from 'react'
import type { GraphCalendar, TextIngestContext, TextIngestRequest } from '@/types'
import { useWorldCalendar } from '@/stores/worldCalendarStore'
import { calendarIn, worldBoundExamples } from '@althistory/calendar'

export interface TextIngestTabProps {
  onSubmit: (request: TextIngestRequest) => void
  isSubmitting: boolean
  /**
   * The id of the form, so the wizard's footer button can submit it. The
   * primary action lives in the dialog footer, not in the tab.
   */
  formId: string
  /** Reports whether the form can be submitted as it stands. */
  onCanSubmitChange?: (canSubmit: boolean) => void
}

export function TextIngestTab({ onSubmit, isSubmitting, formId, onCanSubmitChange }: TextIngestTabProps) {
  const [text, setText] = useState('')
  const [useLLM, setUseLLM] = useState(true)
  const [defaultActors, setDefaultActors] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [locale, setLocale] = useState('')
  const calendar = useWorldCalendar()

  const canSubmit = !isSubmitting && text.trim().length > 0
  useEffect(() => {
    onCanSubmitChange?.(canSubmit)
  }, [canSubmit, onCanSubmitChange])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || isSubmitting) return

    const context: TextIngestContext = {}
    const parsedActors = defaultActors
      .split(',')
      .map((actor) => actor.trim())
      .filter((actor) => actor.length > 0)
    if (parsedActors.length > 0) {
      context.defaultActors = parsedActors
    }
    if (startDate.trim() && endDate.trim()) {
      context.defaultTimeRange = { start: startDate.trim(), end: endDate.trim() }
    }
    if (locale.trim()) {
      context.locale = locale.trim()
    }

    if (Object.keys(context).length > 0) {
      onSubmit({ text: trimmed, useLLM, context })
      return
    }
    onSubmit({ text: trimmed, useLLM })
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="ingest-text-body" className="block text-sm font-medium text-ink">
          Text to extract *
        </label>
        <textarea
          id="ingest-text-body"
          rows={8}
          required
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="For example: The Battle of Hastings was fought on 14 October 1066…"
          className="mt-1 block w-full rounded-md border border-line px-3 py-2 bg-card text-ink placeholder:text-ink-muted shadow-sm focus:border-selected focus:outline-none focus:ring-1 focus:ring-selected"
        />
      </div>

      {calendar && <WorldCalendarNote calendar={calendar} useLLM={useLLM} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label htmlFor="ingest-text-actors" className="block text-xs font-medium text-ink-secondary">
            Default actors (comma-separated)
          </label>
          <input
            id="ingest-text-actors"
            type="text"
            value={defaultActors}
            onChange={(event) => setDefaultActors(event.target.value)}
            placeholder="e.g. Normans, Anglo-Saxons"
            className="mt-1 block w-full rounded-md border border-line px-2 py-1 text-sm bg-card text-ink placeholder:text-ink-muted focus:border-selected focus:outline-none focus:ring-1 focus:ring-selected"
          />
        </div>
        <div>
          <label htmlFor="ingest-text-start-date" className="block text-xs font-medium text-ink-secondary">
            Time range start
          </label>
          <input
            id="ingest-text-start-date"
            type="text"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            placeholder={calendar ? `e.g. ${worldBoundExamples(calendar).day}` : 'e.g. 1066-01-01'}
            className="mt-1 block w-full rounded-md border border-line px-2 py-1 text-sm bg-card text-ink placeholder:text-ink-muted focus:border-selected focus:outline-none focus:ring-1 focus:ring-selected"
          />
        </div>
        <div>
          <label htmlFor="ingest-text-end-date" className="block text-xs font-medium text-ink-secondary">
            Time range end
          </label>
          <input
            id="ingest-text-end-date"
            type="text"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            placeholder={calendar ? `e.g. ${worldBoundExamples(calendar).year}` : 'e.g. 1066-12-31'}
            className="mt-1 block w-full rounded-md border border-line px-2 py-1 text-sm bg-card text-ink placeholder:text-ink-muted focus:border-selected focus:outline-none focus:ring-1 focus:ring-selected"
          />
        </div>
        <div>
          <label htmlFor="ingest-text-locale" className="block text-xs font-medium text-ink-secondary">
            Locale
          </label>
          <input
            id="ingest-text-locale"
            type="text"
            value={locale}
            onChange={(event) => setLocale(event.target.value)}
            placeholder="e.g. en"
            className="mt-1 block w-full rounded-md border border-line px-2 py-1 text-sm bg-card text-ink placeholder:text-ink-muted focus:border-selected focus:outline-none focus:ring-1 focus:ring-selected"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={useLLM}
          onChange={(event) => setUseLLM(event.target.checked)}
          className="h-4 w-4 rounded border-line text-baseline focus:ring-selected"
        />
        Use LLM extraction
      </label>

    </form>
  )
}

/**
 * What a world's calendars mean for the text: the model is told them and
 * reads its dates in them (as the range above is written); the pattern
 * reader knows only Gregorian dates.
 */
function WorldCalendarNote({ calendar, useLLM }: { calendar: GraphCalendar; useLLM: boolean }) {
  const name = calendarIn(calendar).definition.name
  const example = worldBoundExamples(calendar).day
  return (
    <p className="rounded-md border border-line bg-subtle px-3 py-2 text-xs text-ink-secondary" role="note">
      {useLLM ? (
        <>
          This graph keeps {name}
          {calendar.calendars.length > 1 ? ` and ${calendar.calendars.length - 1} other calendar${calendar.calendars.length > 2 ? 's' : ''}` : ''}.
          The model is told how they count time, so the text can give its dates in them (“{example}”).
        </>
      ) : (
        <>
          This graph keeps {name}, but the pattern reader only reads Gregorian dates, which this world does not
          use. Use LLM extraction to read dates like “{example}”.
        </>
      )}
    </p>
  )
}

export default TextIngestTab
