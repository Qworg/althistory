/**
 * Says so when the server refuses a request with 429 (rate limited).
 *
 * One place covers every caller of the API client: the response interceptor in
 * `api.ts` hands each failed response here, so a refused graph switch, event,
 * arc or link edit, batch, import, ingest, generate or stream-token request is
 * shown to the person as a notice in the app's `NotificationCenter` instead of
 * failing without a word. The message says what was refused and when to retry.
 * The one exception is a request its caller marked `toldByCaller`: the graph
 * picker shows its own refused switch as an alert, and a notice as well would
 * say it twice.
 */

import { useGlobalStore } from '@/stores/globalStore'
import type { ErrorState } from '@/types'

/** The parts of a failed axios response this module reads. */
export interface RefusedResponse {
  status?: number
  data?: unknown
  headers?: unknown
}

export interface RefusedRequest {
  method?: string
  url?: string
  /** Set by a caller that shows the refusal itself. */
  toldByCaller?: boolean
}

/** Seconds to wait, from the error body's `retryAfter` or the `Retry-After` header. */
export function retryAfterSeconds(response: RefusedResponse | undefined, now: number = Date.now()): number | null {
  if (!response) return null
  const body = response.data as { error?: { retryAfter?: unknown }; retryAfter?: unknown } | undefined
  const fromBody = body?.error?.retryAfter ?? body?.retryAfter
  if (typeof fromBody === 'number' && Number.isFinite(fromBody) && fromBody > 0) return Math.ceil(fromBody)

  const headers = response.headers as Record<string, unknown> | { get?: (name: string) => unknown } | undefined
  let raw: unknown
  if (headers && typeof (headers as { get?: unknown }).get === 'function') {
    raw = (headers as { get: (name: string) => unknown }).get('retry-after')
  } else if (headers) {
    const record = headers as Record<string, unknown>
    raw = record['retry-after'] ?? record['Retry-After']
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    const seconds = Number(raw)
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds)
    // The header may also be an HTTP date.
    const at = typeof raw === 'string' ? Date.parse(raw) : NaN
    if (Number.isFinite(at) && at > now) return Math.ceil((at - now) / 1000)
  }
  return null
}

/** What was refused, in the words a person would use. */
export function describeRefusedRequest(request: RefusedRequest): string {
  const method = (request.method ?? 'get').toUpperCase()
  const path = (request.url ?? '').split('?')[0] ?? ''

  if (isStatusPoll(request)) return 'Checking on the job'
  if (/\/graphs\/[^/]+\/activate$/.test(path)) return 'Switching graphs'
  if (/\/stream\/token$/.test(path)) return 'Starting live sync'
  if (/\/batch(\/|$)/.test(path)) return 'The batch update'
  if (/\/import(\/|$)/.test(path)) return 'The import'
  if (/\/ingest(\/|$)/.test(path)) return 'The ingestion'
  if (/\/generate(\/|$)/.test(path)) return 'The generation request'
  if (/\/export(\/|$)/.test(path)) return 'The export'
  if (/\/graphs\/copy(\/|$)/.test(path)) return 'Creating the copy'
  if (/\/causal\/link/.test(path)) return method === 'DELETE' ? 'Removing the link' : 'Saving the link'
  if (method === 'GET' || method === 'HEAD') return 'Loading data'
  if (method === 'DELETE') {
    if (/\/arcs(\/|$)/.test(path)) return 'Deleting the arc'
    if (/\/events(\/|$)/.test(path)) return 'Deleting the event'
    if (/\/causal(\/|$)/.test(path)) return 'Deleting the link'
    return 'Deleting'
  }
  if (/\/arcs(\/|$)/.test(path)) return 'Saving the arc'
  if (/\/events(\/|$)/.test(path)) return 'Saving the event'
  return 'Saving your change'
}

/** Whether a request is a job-status poll (`GET .../jobs/:id`). */
export function isStatusPoll(request: RefusedRequest): boolean {
  const path = (request.url ?? '').split('?')[0] ?? ''
  return (request.method ?? 'get').toUpperCase() === 'GET' && /\/jobs\/[^/]+\/?$/.test(path)
}

/** What was refused, without the wait: the identity of a notice. */
export function refusalStem(request: RefusedRequest): string {
  return `${describeRefusedRequest(request)} was refused because too many requests were sent.`
}

/**
 * The sentence a thrown `APIError` carries for a 429. It has no number in it: a
 * wait written into a message is stale a second later. The notice and the
 * picker's alert count the wait down from `retryAt`.
 */
export function rateLimitedMessage(request: RefusedRequest): string {
  return `${refusalStem(request)} Try again shortly.`
}

/** Whether an error is the API client's 429 (it carries what was refused). */
export function isRefusal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && typeof (error as { refusal?: unknown }).refusal === 'string'
}

/**
 * Report an API failure from a caller that has its own context ("Failed to save
 * event"). A refusal for load (429) is already on screen as the retry notice,
 * which says what was refused and counts the wait down, so the caller adds
 * nothing; anything else is shown as `context: message`.
 */
export function reportApiError(
  context: string | null,
  error: unknown,
  type: ErrorState['type'] = 'network',
  /** Where to add it; the store's by default (a hook that already holds `addError` may pass it). */
  add: (error: Omit<ErrorState, 'id' | 'timestamp'>) => void = (e) => useGlobalStore.getState().addError(e)
): void {
  if (isRefusal(error)) return
  const detail = error instanceof Error && error.message ? error.message : 'Unknown error'
  add({ type, message: context ? `${context}: ${detail}` : detail })
}

/** A notice goes away a little after the wait has passed. */
const EXPIRY_GRACE_MS = 3000
const DEFAULT_EXPIRY_MS = 8000
const expiry = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Show a 429 to the person. Returns the notice's message, or null when the
 * response is anything else or a status poll (the caller is already waiting on
 * the job and polls again; saying "refused" there would be noise).
 *
 * One kind of refusal is one notice: a repeat only moves its `retryAt`, which
 * the notice centre renders as a live countdown. It expires shortly after.
 */
export function noticeRateLimited(response: RefusedResponse | undefined, request: RefusedRequest | undefined): string | null {
  if (response?.status !== 429) return null
  const req = request ?? {}
  if (isStatusPoll(req)) return null

  const stem = refusalStem(req)
  const wait = retryAfterSeconds(response)
  const retryAt = wait === null ? undefined : Date.now() + wait * 1000
  const store = useGlobalStore.getState()

  let notice = store.errors.find((e) => e.refusal === stem)
  // The picker's own switch says so itself (its alert); every other switch,
  // from the Graph Manager, a branch dialog, a copy and so on, gets the notice.
  // A notice a different door already raised still follows the server's wait.
  if (req.toldByCaller && !notice) return null
  if (notice) {
    store.updateError(notice.id, { retryAt })
  } else {
    store.addError({ type: 'general', message: stem, refusal: stem, retryAt })
    notice = useGlobalStore.getState().errors.find((e) => e.refusal === stem)
  }

  if (notice) {
    const id = notice.id
    const previous = expiry.get(stem)
    if (previous) clearTimeout(previous)
    expiry.set(
      stem,
      setTimeout(() => {
        expiry.delete(stem)
        useGlobalStore.getState().removeError(id)
      }, retryAt === undefined ? DEFAULT_EXPIRY_MS : retryAt - Date.now() + EXPIRY_GRACE_MS)
    )
  }
  return stem
}
