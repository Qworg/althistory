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
import { WorldDateHint } from '@/components/ui/WorldDateHint'
import { describedBy, worldDateOf } from '@/utils/worldDateHint'
import { formatWorldYear, storedYear } from '@althistory/calendar'

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
            aria-describedby={describedBy(worldDateOf(startDate.trim(), calendar) && 'ingest-text-start-date-world')}
            placeholder="e.g. 1066-01-01"
            className="mt-1 block w-full rounded-md border border-line px-2 py-1 text-sm bg-card text-ink placeholder:text-ink-muted focus:border-selected focus:outline-none focus:ring-1 focus:ring-selected"
          />
          <WorldDateHint value={startDate.trim()} id="ingest-text-start-date-world" />
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
            aria-describedby={describedBy(worldDateOf(endDate.trim(), calendar) && 'ingest-text-end-date-world')}
            placeholder="e.g. 1066-12-31"
            className="mt-1 block w-full rounded-md border border-line px-2 py-1 text-sm bg-card text-ink placeholder:text-ink-muted focus:border-selected focus:outline-none focus:ring-1 focus:ring-selected"
          />
          <WorldDateHint value={endDate.trim()} id="ingest-text-end-date-world" />
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
 * What a world's calendar means for the text: the model reads its dates, the
 * patterns do not. The example is the world's year 1 and where it is stored.
 */
function WorldCalendarNote({ calendar, useLLM }: { calendar: GraphCalendar; useLLM: boolean }) {
  const example = formatWorldYear(storedYear(1, calendar), calendar)
  return (
    <p className="rounded-md border border-line bg-subtle px-3 py-2 text-xs text-ink-secondary" role="note">
      {useLLM ? (
        <>
          This graph keeps {calendar.name ?? 'its own calendar'}. The model is told how its dates are stored, so
          the text can say “{example}” (stored as <span className="font-mono-code">{calendar.epochYear}</span>)
          {calendar.monthNames ? ' and name the world’s months' : ''}. Without the model, the text’s dates must be
          the stored ones.
        </>
      ) : (
        <>
          This graph keeps {calendar.name ?? 'its own calendar'}, but the pattern reader only reads stored dates:
          write “{example}” as <span className="font-mono-code">{calendar.epochYear}</span>, or use LLM extraction.
        </>
      )}
    </p>
  )
}

export default TextIngestTab
