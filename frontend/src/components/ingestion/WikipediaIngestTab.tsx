/**
 * WikipediaIngestTab
 *
 * Wikipedia source form for the ingestion wizard (Req 19.2): a URL input plus
 * the link-following options the backend accepts (`followLinks`, `linkDepth`,
 * `linkFilter`, `maxPages`).
 */

import { useState, type FormEvent } from 'react'
import type { WikipediaIngestOptions, WikipediaIngestRequest } from '@/types'

export interface WikipediaIngestTabProps {
  onSubmit: (request: WikipediaIngestRequest) => void
  isSubmitting: boolean
}

export function WikipediaIngestTab({ onSubmit, isSubmitting }: WikipediaIngestTabProps) {
  const [url, setUrl] = useState('')
  const [followLinks, setFollowLinks] = useState(false)
  const [linkDepth, setLinkDepth] = useState(1)
  const [linkFilter, setLinkFilter] = useState('')
  const [maxPages, setMaxPages] = useState(10)

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmedUrl = url.trim()
    if (!trimmedUrl) return

    const options: WikipediaIngestOptions = { followLinks }
    if (followLinks) {
      options.linkDepth = linkDepth
      options.maxPages = maxPages
      const trimmedFilter = linkFilter.trim()
      if (trimmedFilter) options.linkFilter = trimmedFilter
    }

    onSubmit({ url: trimmedUrl, strategy: 'wikipedia', options })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="ingest-wikipedia-url" className="block text-sm font-medium text-gray-700">
          Wikipedia URL *
        </label>
        <input
          id="ingest-wikipedia-url"
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://en.wikipedia.org/wiki/Battle_of_Hastings"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="rounded-md border border-gray-200 p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="checkbox"
            checked={followLinks}
            onChange={(event) => setFollowLinks(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Follow links
        </label>

        {followLinks && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="ingest-wikipedia-depth" className="block text-xs font-medium text-gray-600">
                Link depth
              </label>
              <input
                id="ingest-wikipedia-depth"
                type="number"
                min={1}
                max={3}
                value={linkDepth}
                onChange={(event) => setLinkDepth(Number(event.target.value))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="ingest-wikipedia-filter" className="block text-xs font-medium text-gray-600">
                Link filter
              </label>
              <input
                id="ingest-wikipedia-filter"
                type="text"
                value={linkFilter}
                onChange={(event) => setLinkFilter(event.target.value)}
                placeholder="Battle.*"
                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="ingest-wikipedia-max-pages" className="block text-xs font-medium text-gray-600">
                Max pages
              </label>
              <input
                id="ingest-wikipedia-max-pages"
                type="number"
                min={1}
                value={maxPages}
                onChange={(event) => setMaxPages(Number(event.target.value))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting || url.trim().length === 0}
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isSubmitting ? 'Extracting...' : 'Extract Entities'}
        </button>
      </div>
    </form>
  )
}

export default WikipediaIngestTab
