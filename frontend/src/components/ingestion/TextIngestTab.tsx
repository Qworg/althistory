/**
 * TextIngestTab
 *
 * Pasted-text source form for the ingestion wizard (Req 19.1). The `useLLM`
 * flag lets the user choose between the offline pattern extractor and the
 * configured LLM.
 */

import { useState, type FormEvent } from 'react'
import type { TextIngestContext, TextIngestRequest } from '@/types'

export interface TextIngestTabProps {
  onSubmit: (request: TextIngestRequest) => void
  isSubmitting: boolean
}

export function TextIngestTab({ onSubmit, isSubmitting }: TextIngestTabProps) {
  const [text, setText] = useState('')
  const [useLLM, setUseLLM] = useState(true)
  const [defaultActors, setDefaultActors] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [locale, setLocale] = useState('')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return

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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="ingest-text-body" className="block text-sm font-medium text-gray-700">
          Text to extract *
        </label>
        <textarea
          id="ingest-text-body"
          rows={8}
          required
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="The Battle of Hastings was fought on 14 October 1066..."
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label htmlFor="ingest-text-actors" className="block text-xs font-medium text-gray-600">
            Default actors (comma-separated)
          </label>
          <input
            id="ingest-text-actors"
            type="text"
            value={defaultActors}
            onChange={(event) => setDefaultActors(event.target.value)}
            placeholder="Normans, Anglo-Saxons"
            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="ingest-text-start-date" className="block text-xs font-medium text-gray-600">
            Time range start
          </label>
          <input
            id="ingest-text-start-date"
            type="text"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            placeholder="1066-01-01"
            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="ingest-text-end-date" className="block text-xs font-medium text-gray-600">
            Time range end
          </label>
          <input
            id="ingest-text-end-date"
            type="text"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            placeholder="1066-12-31"
            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="ingest-text-locale" className="block text-xs font-medium text-gray-600">
            Locale
          </label>
          <input
            id="ingest-text-locale"
            type="text"
            value={locale}
            onChange={(event) => setLocale(event.target.value)}
            placeholder="en"
            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input
          type="checkbox"
          checked={useLLM}
          onChange={(event) => setUseLLM(event.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        Use LLM extraction
      </label>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting || text.trim().length === 0}
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isSubmitting ? 'Extracting...' : 'Extract Entities'}
        </button>
      </div>
    </form>
  )
}

export default TextIngestTab
