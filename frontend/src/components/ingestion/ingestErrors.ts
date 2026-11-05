import { APIError } from '@/services/api'

export type IngestSource = 'wikipedia' | 'wikidata' | 'text' | 'import'

/** What the review step shows when an extraction or import fails. */
export interface IngestErrorView {
  /** Plain words: what went wrong and what to do next. */
  message: string
  /** The server's own wording and status, for a "Details" disclosure. */
  detail?: string
  /** Whether pasting the text instead would get round it (a fetch failed). */
  offerText: boolean
}

const REMOTE: Partial<Record<IngestSource, string>> = { wikipedia: 'Wikipedia', wikidata: 'Wikidata' }

/**
 * Turn a failed ingestion request into something a researcher can act on.
 *
 * The wizard used to show the server's message as it came, so a Wikipedia
 * fetch that failed on the server read "Internal server error": no cause, no
 * next step, and nothing to say the Text tab works without the network.
 */
export function describeIngestError(error: unknown, source: IngestSource): IngestErrorView {
  const status = error instanceof APIError ? error.status : undefined
  const serverText = error instanceof Error ? error.message : undefined
  const detail = serverText ? `${status ? `${status}: ` : ''}${serverText}` : undefined
  const remote = REMOTE[source]

  if (status === 0) {
    return {
      message: "Couldn't reach the althistory server. Check that it is running and try again.",
      detail,
      offerText: false,
    }
  }
  if (status === 401 || status === 403) {
    return {
      message:
        status === 401
          ? 'The server needs an API key for this. Add one, then try again.'
          : 'This API key may not import history (it needs write access to events). Use a key that can.',
      detail,
      offerText: false,
    }
  }
  if (status === 429) {
    return { message: 'Too many requests in a short time. Wait a minute, then try again.', detail, offerText: false }
  }
  if (status === 404 && remote) {
    return {
      message: `${remote} has nothing at that address. Check the URL or title, or paste the text into the Text tab.`,
      detail,
      offerText: true,
    }
  }
  if (status !== undefined && status >= 400 && status < 500) {
    // Validation: the server names the field, which is the useful part.
    return { message: serverText ?? 'The request was not accepted. Check the fields and try again.', offerText: false }
  }
  if (remote) {
    return {
      message: `The server couldn't fetch from ${remote}. It may be offline or unable to reach the internet. Paste the article's text into the Text tab instead, or try again later.`,
      detail,
      offerText: true,
    }
  }
  return {
    message:
      source === 'import'
        ? 'The import failed on the server, and nothing was added. Your review is kept: try again.'
        : 'The extraction failed on the server. Try again; if it keeps failing, try a shorter passage.',
    detail,
    offerText: false,
  }
}
