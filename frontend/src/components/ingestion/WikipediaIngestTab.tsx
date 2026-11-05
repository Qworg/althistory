/**
 * WikipediaIngestTab
 *
 * Wikipedia source form for the ingestion wizard (Req 19.2): a URL input plus
 * the link-following options the backend accepts (`followLinks`, `linkDepth`,
 * `linkFilter`, `maxPages`).
 */

import { useEffect, useState, type FormEvent } from 'react'
import type { WikipediaIngestOptions, WikipediaIngestRequest } from '@/types'

export interface WikipediaIngestTabProps {
  onSubmit: (request: WikipediaIngestRequest) => void
  isSubmitting: boolean
  /**
   * The id of the form, so the wizard's footer button can submit it. The
   * primary action lives in the dialog footer, not in the tab.
   */
  formId: string
  /** Reports whether the form can be submitted as it stands. */
  onCanSubmitChange?: (canSubmit: boolean) => void
}

const WIKIPEDIA_URL_PATTERN = /^https?:\/\/([a-z0-9-]+\.)?wikipedia\.org\/wiki\/.+/i

function isValidWikipediaUrl(value: string): boolean {
  return WIKIPEDIA_URL_PATTERN.test(value.trim())
}

export function WikipediaIngestTab({ onSubmit, isSubmitting, formId, onCanSubmitChange }: WikipediaIngestTabProps) {
  const [url, setUrl] = useState('')
  const [followLinks, setFollowLinks] = useState(false)
  const [linkDepth, setLinkDepth] = useState(1)
  const [linkFilter, setLinkFilter] = useState('')
  const [maxPages, setMaxPages] = useState(10)

  const trimmedUrl = url.trim()
  const urlInvalid = trimmedUrl.length > 0 && !isValidWikipediaUrl(trimmedUrl)
  const canSubmit = !isSubmitting && trimmedUrl.length > 0 && !urlInvalid
  useEffect(() => {
    onCanSubmitChange?.(canSubmit)
  }, [canSubmit, onCanSubmitChange])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return

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
    <form id={formId} onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="ingest-wikipedia-url" className="block text-sm font-medium text-ink">
          Wikipedia URL *
        </label>
        <input
          id="ingest-wikipedia-url"
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="e.g. https://en.wikipedia.org/wiki/Battle_of_Hastings"
          aria-invalid={urlInvalid}
          className="mt-1 block w-full rounded-md border border-line px-3 py-2 bg-card text-ink placeholder:text-ink-muted shadow-sm focus:border-selected focus:outline-none focus:ring-1 focus:ring-selected"
        />
        {urlInvalid && (
          <p className="mt-1 text-xs text-red-700 dark:text-red-300" role="alert">
            Please enter a valid Wikipedia article URL (e.g. https://en.wikipedia.org/wiki/...)
          </p>
        )}
      </div>

      <div className="rounded-md border border-line p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={followLinks}
            onChange={(event) => setFollowLinks(event.target.checked)}
            className="h-4 w-4 rounded border-line text-baseline focus:ring-selected"
          />
          Follow links
        </label>

        {followLinks && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="ingest-wikipedia-depth" className="block text-xs font-medium text-ink-secondary">
                Link depth
              </label>
              <input
                id="ingest-wikipedia-depth"
                type="number"
                min={1}
                max={3}
                value={linkDepth}
                onChange={(event) => setLinkDepth(Number(event.target.value))}
                className="mt-1 block w-full rounded-md border border-line px-2 py-1 text-sm bg-card text-ink placeholder:text-ink-muted focus:border-selected focus:outline-none focus:ring-1 focus:ring-selected"
              />
            </div>
            <div>
              <label htmlFor="ingest-wikipedia-filter" className="block text-xs font-medium text-ink-secondary">
                Link filter
              </label>
              <input
                id="ingest-wikipedia-filter"
                type="text"
                value={linkFilter}
                onChange={(event) => setLinkFilter(event.target.value)}
                placeholder="e.g. Battle.*"
                className="mt-1 block w-full rounded-md border border-line px-2 py-1 text-sm bg-card text-ink placeholder:text-ink-muted focus:border-selected focus:outline-none focus:ring-1 focus:ring-selected"
              />
            </div>
            <div>
              <label htmlFor="ingest-wikipedia-max-pages" className="block text-xs font-medium text-ink-secondary">
                Max pages
              </label>
              <input
                id="ingest-wikipedia-max-pages"
                type="number"
                min={1}
                value={maxPages}
                onChange={(event) => setMaxPages(Number(event.target.value))}
                className="mt-1 block w-full rounded-md border border-line px-2 py-1 text-sm bg-card text-ink placeholder:text-ink-muted focus:border-selected focus:outline-none focus:ring-1 focus:ring-selected"
              />
            </div>
          </div>
        )}
      </div>

    </form>
  )
}

export default WikipediaIngestTab
