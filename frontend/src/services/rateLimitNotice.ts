/**
 * Says so when the server refuses a request with 429 (rate limited).
 *
 * One place covers every caller of the API client: the response interceptor in
 * `api.ts` hands each failed response here, so a refused graph switch, event,
 * arc or link edit, batch, import, ingest, generate or stream-token request is
 * shown to the person as a notice in the app's `NotificationCenter` instead of
 * failing without a word. The message says what was refused and when to retry.
 */

import { useGlobalStore } from '@/stores/globalStore'

/** The parts of a failed axios response this module reads. */
export interface RefusedResponse {
  status?: number
  data?: unknown
  headers?: unknown
}

export interface RefusedRequest {
  method?: string
  url?: string
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
  if (/\/causal\/link/.test(path)) return method === 'DELETE' ? 'Removing the link' : 'Saving the link'
  if (method === 'GET' || method === 'HEAD') return 'Loading data'
  if (method === 'DELETE') return 'Deleting'
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

/** The sentence shown to the person. */
export function rateLimitedMessage(request: RefusedRequest, retryAfter: number | null): string {
  const when =
    retryAfter === null
      ? 'Try again in a moment.'
      : `Try again in ${retryAfter} ${retryAfter === 1 ? 'second' : 'seconds'}.`
  return `${refusalStem(request)} ${when}`
}

/** A notice goes away once the wait has passed (a little after, so it is read). */
const EXPIRY_GRACE_MS = 3000
const DEFAULT_EXPIRY_MS = 8000
const expiry = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Show a 429 to the person. Returns the message, or null when the response is
 * anything else or a status poll (the caller is already waiting on the job and
 * polls again; saying "refused" there would be noise).
 *
 * One refusal is one notice: a notice for the same thing (the same request
 * class) is updated with the new wait, not added again, and it expires when the
 * wait has passed.
 */
export function noticeRateLimited(response: RefusedResponse | undefined, request: RefusedRequest | undefined): string | null {
  if (response?.status !== 429) return null
  const req = request ?? {}
  if (isStatusPoll(req)) return null

  const stem = refusalStem(req)
  const wait = retryAfterSeconds(response)
  const message = rateLimitedMessage(req, wait)
  const store = useGlobalStore.getState()

  const existing = store.errors.find((e) => e.refusal === stem)
  if (existing) {
    if (existing.message !== message) store.updateError(existing.id, { message })
  } else {
    store.addError({ type: 'general', message, refusal: stem })
  }

  const id = (existing ?? useGlobalStore.getState().errors.find((e) => e.refusal === stem))?.id
  if (id) {
    const previous = expiry.get(stem)
    if (previous) clearTimeout(previous)
    expiry.set(
      stem,
      setTimeout(() => {
        expiry.delete(stem)
        useGlobalStore.getState().removeError(id)
      }, wait === null ? DEFAULT_EXPIRY_MS : wait * 1000 + EXPIRY_GRACE_MS)
    )
  }
  return message
}
