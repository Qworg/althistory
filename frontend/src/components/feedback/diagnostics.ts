/**
 * The last few things that went wrong in this tab, for a feedback report
 * (issue #49): uncaught errors, unhandled rejections, errors a boundary caught,
 * and failed API calls.
 *
 * What is kept is deliberately thin. A failed call keeps its method, its path
 * (no query string: a search or a filter can be in it), its status, its error
 * code and the server's request id. It never keeps a request body, a header
 * or a key. An error keeps its message and the first lines of its stack,
 * both capped, because an error message can quote what the person typed.
 */

export type DiagnosticKind = 'error' | 'rejection' | 'boundary' | 'api'

export interface Diagnostic {
  kind: DiagnosticKind
  /** ISO time it happened. */
  at: string
  message: string
  /** The first lines of the stack, for errors. */
  stack?: string
  /** For a failed API call. */
  request?: { method: string; path: string; status: number; code?: string; requestId?: string }
}

const MAX_ENTRIES = 15
const MAX_MESSAGE = 300
const STACK_LINES = 6

const entries: Diagnostic[] = []

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Strip anything secret-shaped a message might carry: a bearer token, an `api_key=` or a long key. */
export function scrubSecrets(text: string): string {
  return text
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 [redacted]')
    .replace(/\b(api[_-]?key|token|password|secret)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi, '$1$2[redacted]')
    .replace(/\bak_[A-Za-z0-9_-]{16,}/g, '[redacted key]')
}

function push(entry: Diagnostic): void {
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
}

function describe(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    const stack = reason.stack
      ?.split('\n')
      .slice(0, STACK_LINES)
      .map((line) => line.trim())
      .join('\n')
    return {
      message: cap(scrubSecrets(`${reason.name}: ${reason.message}`), MAX_MESSAGE),
      ...(stack ? { stack: cap(scrubSecrets(stack), 1200) } : {}),
    }
  }
  let text: string
  try {
    text = typeof reason === 'string' ? reason : JSON.stringify(reason) ?? String(reason)
  } catch {
    text = String(reason)
  }
  return { message: cap(scrubSecrets(text), MAX_MESSAGE) }
}

/** Record an error a React error boundary caught. */
export function recordBoundaryError(error: unknown): void {
  push({ kind: 'boundary', at: new Date().toISOString(), ...describe(error) })
}

/**
 * Only the path of a URL: no origin, no query, no fragment. A path segment
 * may be an id, which a report needs; it is never a search or a key.
 */
export function pathOnly(url: string | undefined, baseURL?: string): string {
  if (!url) return ''
  try {
    const parsed = new URL(url, baseURL ? new URL(baseURL, 'http://app.invalid/') : 'http://app.invalid/')
    return parsed.pathname
  } catch {
    return url.split(/[?#]/)[0] ?? ''
  }
}

/** Record a failed API call (from the API client's response interceptor). */
export function recordApiFailure(failure: {
  method?: string
  url?: string
  baseURL?: string
  status?: number
  code?: string
  requestId?: string
  message?: string
}): void {
  const path = pathOnly(failure.url, failure.baseURL)
  push({
    kind: 'api',
    at: new Date().toISOString(),
    message: cap(scrubSecrets(failure.message ?? 'Request failed'), MAX_MESSAGE),
    request: {
      method: (failure.method ?? 'get').toUpperCase(),
      path,
      status: failure.status ?? 0,
      ...(failure.code ? { code: cap(failure.code, 60) } : {}),
      ...(failure.requestId ? { requestId: cap(failure.requestId, 80) } : {}),
    },
  })
}

/** What has gone wrong, oldest first. A copy: the caller may trim it. */
export function recentDiagnostics(): Diagnostic[] {
  return entries.map((entry) => ({ ...entry, ...(entry.request ? { request: { ...entry.request } } : {}) }))
}

/** For tests. */
export function clearDiagnostics(): void {
  entries.length = 0
}

let installed = false

/** Listen for uncaught errors and rejections. Idempotent; call once at startup. */
export function installDiagnostics(target: Window = window): void {
  if (installed) return
  installed = true
  target.addEventListener('error', (event: ErrorEvent) => {
    // A resource that failed to load (an <img>) fires `error` with no message.
    if (!event.error && !event.message) return
    push({ kind: 'error', at: new Date().toISOString(), ...describe(event.error ?? event.message) })
  })
  target.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    push({ kind: 'rejection', at: new Date().toISOString(), ...describe(event.reason) })
  })
}
