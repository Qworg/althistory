/**
 * WikidataIngestTab
 *
 * Wikidata source form for the ingestion wizard (Req 19.1). Mirrors the
 * `queryType` union the backend accepts, with the parameter each query type
 * needs.
 */

import { useEffect, useState, type FormEvent } from 'react'
import type { WikidataIngestRequest, WikidataQueryType } from '@/types'

export interface WikidataIngestTabProps {
  onSubmit: (request: WikidataIngestRequest) => void
  isSubmitting: boolean
  /**
   * The id of the form, so the wizard's footer button can submit it. The
   * primary action lives in the dialog footer, not in the tab.
   */
  formId: string
  /** Reports whether the form can be submitted as it stands. */
  onCanSubmitChange?: (canSubmit: boolean) => void
}

export function WikidataIngestTab({ onSubmit, isSubmitting, formId, onCanSubmitChange }: WikidataIngestTabProps) {
  const [queryType, setQueryType] = useState<WikidataQueryType>('historical-events')
  const [personId, setPersonId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [customQuery, setCustomQuery] = useState('')
  const [limit, setLimit] = useState(25)

  const customInvalid = queryType === 'custom' && customQuery.trim().length === 0
  const personInvalid = queryType === 'person-timeline' && personId.trim().length === 0
  const canSubmit = !isSubmitting && !customInvalid && !personInvalid
  useEffect(() => {
    onCanSubmitChange?.(canSubmit)
  }, [canSubmit, onCanSubmitChange])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return

    if (queryType === 'custom') {
      const trimmed = customQuery.trim()
      if (!trimmed) return
      onSubmit({ queryType, customQuery: trimmed, limit })
      return
    }

    if (queryType === 'person-timeline') {
      const trimmed = personId.trim()
      if (!trimmed) return
      onSubmit({ queryType, parameters: { person: trimmed }, limit })
      return
    }

    const parameters: Record<string, string> = {}
    if (subjectId.trim()) parameters.subject = subjectId.trim()
    if (startTime.trim()) parameters.startTime = startTime.trim()
    if (endTime.trim()) parameters.endTime = endTime.trim()

    if (Object.keys(parameters).length > 0) {
      onSubmit({ queryType, parameters, limit })
      return
    }

    onSubmit({ queryType, limit })
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="ingest-wikidata-query-type" className="block text-sm font-medium text-ink">
          Query type
        </label>
        <select
          id="ingest-wikidata-query-type"
          value={queryType}
          onChange={(event) => setQueryType(event.target.value as WikidataQueryType)}
          className="mt-1 block w-full rounded-md border border-line px-3 py-2 bg-card text-ink placeholder:text-ink-muted shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="historical-events">Historical events</option>
          <option value="person-timeline">Person timeline</option>
          <option value="custom">Custom SPARQL</option>
        </select>
      </div>

      {queryType === 'historical-events' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="ingest-wikidata-subject" className="block text-sm font-medium text-ink">
              Subject Wikidata ID
            </label>
            <input
              id="ingest-wikidata-subject"
              type="text"
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
              placeholder="e.g. Q83224 (optional)"
              className="mt-1 block w-full rounded-md border border-line px-3 py-2 text-sm bg-card text-ink placeholder:text-ink-muted shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="ingest-wikidata-start" className="block text-sm font-medium text-ink">
              Start time
            </label>
            <input
              id="ingest-wikidata-start"
              type="text"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              placeholder="e.g. 1066-01-01"
              className="mt-1 block w-full rounded-md border border-line px-3 py-2 text-sm bg-card text-ink placeholder:text-ink-muted shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="ingest-wikidata-end" className="block text-sm font-medium text-ink">
              End time
            </label>
            <input
              id="ingest-wikidata-end"
              type="text"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              placeholder="e.g. 1066-12-31"
              className="mt-1 block w-full rounded-md border border-line px-3 py-2 text-sm bg-card text-ink placeholder:text-ink-muted shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      )}

      {queryType === 'person-timeline' && (
        <div>
          <label htmlFor="ingest-wikidata-person" className="block text-sm font-medium text-ink">
            Person Wikidata ID *
          </label>
          <input
            id="ingest-wikidata-person"
            type="text"
            required
            value={personId}
            onChange={(event) => setPersonId(event.target.value)}
            placeholder="e.g. Q42"
            className="mt-1 block w-full rounded-md border border-line px-3 py-2 bg-card text-ink placeholder:text-ink-muted shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

      {queryType === 'custom' && (
        <div>
          <label htmlFor="ingest-wikidata-query" className="block text-sm font-medium text-ink">
            Custom SPARQL query *
          </label>
          <textarea
            id="ingest-wikidata-query"
            rows={6}
            value={customQuery}
            onChange={(event) => setCustomQuery(event.target.value)}
            className="mt-1 block w-full rounded-md border border-line px-3 py-2 font-mono-code text-sm bg-card text-ink placeholder:text-ink-muted shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

      <div>
        <label htmlFor="ingest-wikidata-limit" className="block text-sm font-medium text-ink">
          Result limit
        </label>
        <input
          id="ingest-wikidata-limit"
          type="number"
          min={1}
          value={limit}
          onChange={(event) => setLimit(Number(event.target.value))}
          className="mt-1 block w-32 rounded-md border border-line px-3 py-2 bg-card text-ink placeholder:text-ink-muted shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

    </form>
  )
}

export default WikidataIngestTab
