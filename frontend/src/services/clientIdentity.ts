/**
 * Who this tab is, to the app's live change feed.
 *
 * Every request carries `X-Althistory-Client: web` and a per-tab `X-Client-Id`.
 * The server stamps them on the changes the request makes, so when the feed
 * pushes a change back this tab can tell its own edits (already shown, no
 * need to announce or highlight them) from another writer's.
 *
 * The id is a claim used to label changes, never to authorise anything.
 */

export const CLIENT_KIND_HEADER = 'X-Althistory-Client'
export const CLIENT_ID_HEADER = 'X-Client-Id'

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    // An insecure context has no randomUUID.
    return `tab-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  }
}

/** One id for this page load; a reload is a new tab as far as the feed is concerned. */
export const CLIENT_ID: string = newId()
