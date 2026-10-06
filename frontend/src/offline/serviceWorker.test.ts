import { describe, it, expect, beforeEach, vi } from 'vitest'
// The worker is a plain script in `public/`, copied verbatim into `dist/` by
// Vite. `?raw` imports its text so it can be evaluated in a sandbox below.
import swSource from '../../public/sw.js?raw'

/**
 * Behavioural tests for `public/sw.js`, the app-shell service worker.
 *
 * jsdom has no service-worker implementation, so the worker script is evaluated
 * in a sandbox with stand-ins for `self`, `caches` and `fetch`, and its
 * install/fetch handlers are driven directly. That is what makes the two
 * caching guarantees testable here:
 *   - a failed navigation must not replace the cached shell (else a 404 or 500
 *     page becomes the offline shell), and
 *   - install must precache the hashed build assets referenced by the document,
 *     not just `/`, `/index.html` and `/vite.svg` (else an offline load has the
 *     document but none of its JavaScript, i.e. a blank page).
 * It does not prove anything about how a real browser schedules the worker.
 */

const ORIGIN = 'https://app.example'
const CACHE_NAME = 'althistory-shell-v2'

/**
 * The subset of `Request` the worker reads. `mode: 'navigate'` requests cannot
 * be constructed with `new Request(...)` (the spec forbids it), so navigations
 * are passed in as plain objects with the same fields.
 */
interface SwRequest {
  method: string
  url: string
  mode: string
}

interface SwEvent {
  waitUntil?: (work: Promise<unknown>) => void
  respondWith?: (work: Promise<Response>) => void
  request?: SwRequest
}

type SwListener = (event: SwEvent) => void

interface FakeCaches {
  open: (name: string) => Promise<FakeCache>
  match: (key: string | Request) => Promise<Response | undefined>
  keys: () => Promise<string[]>
  delete: (name: string) => Promise<boolean>
}

interface FakeCache {
  add: (url: string) => Promise<void>
  addAll: (urls: string[]) => Promise<void>
  put: (key: string | Request, response: Response) => Promise<void>
  match: (key: string | Request) => Promise<Response | undefined>
}

function keyOf(key: string | Request): string {
  return typeof key === 'string' ? key : key.url
}

interface Sandbox {
  listeners: Map<string, SwListener>
  store: Map<string, Map<string, Response>>
  caches: FakeCaches
  fetchMock: ReturnType<typeof vi.fn<(input: string | Request) => Promise<Response>>>
}

const source = swSource

function loadServiceWorker(
  fetchImpl: (input: string | Request) => Promise<Response>,
): Sandbox {
  const store = new Map<string, Map<string, Response>>()
  const fetchMock = vi.fn(fetchImpl)

  const cacheFor = (name: string): FakeCache => {
    const entries = store.get(name) ?? new Map<string, Response>()
    store.set(name, entries)
    return {
      add: async (url) => {
        const response = await fetchMock(url)
        if (!response.ok) throw new Error(`${url} responded ${response.status}`)
        entries.set(url, response)
      },
      addAll: async (urls) => {
        for (const url of urls) {
          const response = await fetchMock(url)
          if (!response.ok) throw new Error(`${url} responded ${response.status}`)
          entries.set(url, response)
        }
      },
      put: async (key, response) => {
        entries.set(keyOf(key), response)
      },
      match: async (key) => entries.get(keyOf(key)),
    }
  }

  const caches: FakeCaches = {
    open: async (name) => cacheFor(name),
    match: async (key) => {
      for (const entries of store.values()) {
        const hit = entries.get(keyOf(key))
        if (hit) return hit
      }
      return undefined
    },
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
  }

  const listeners = new Map<string, SwListener>()
  const fakeSelf = {
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
    addEventListener: (type: string, listener: SwListener) => {
      listeners.set(type, listener)
    },
  }

  const factory = new Function('self', 'caches', 'fetch', 'Response', source)
  factory(fakeSelf, caches, fetchMock, Response)

  return { listeners, store, caches, fetchMock }
}

function installWork(sandbox: Sandbox): Promise<unknown>[] {
  const pending: Promise<unknown>[] = []
  const install = sandbox.listeners.get('install')
  expect(install).toBeDefined()
  install?.({ waitUntil: (work) => pending.push(work) })
  return pending
}

function runFetch(sandbox: Sandbox, request: SwRequest): Promise<Response | undefined> {
  let responded: Promise<Response> | undefined
  const handler = sandbox.listeners.get('fetch')
  expect(handler).toBeDefined()
  handler?.({ request, respondWith: (work) => (responded = work) })
  return responded ?? Promise.resolve(undefined)
}

const indexHtml = `<!doctype html><html><head>
  <link rel="icon" href="/vite.svg">
  <script type="module" crossorigin src="/assets/index-abc123.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/index-def456.css">
  <link rel="preconnect" href="https://cdn.example.com">
  </head><body><div id="root"></div></body></html>`

describe('app-shell service worker', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('precaches the hashed build assets the shell document references', async () => {
    const sandbox = loadServiceWorker(async (input) => {
      const url = String(input)
      if (url === '/index.html') return new Response(indexHtml, { status: 200 })
      if (url === '/') return new Response(indexHtml, { status: 200 })
      if (url === '/vite.svg') return new Response('<svg/>', { status: 200 })
      if (url.startsWith('/assets/')) return new Response('/* built asset */', { status: 200 })
      return new Response('missing', { status: 404 })
    })

    await Promise.all(installWork(sandbox))

    const entries = sandbox.store.get(CACHE_NAME)
    expect(entries).toBeDefined()
    // Without the parse of index.html only /, /index.html and /vite.svg are
    // cached, and an offline load has no JavaScript to run.
    expect([...(entries?.keys() ?? [])].sort()).toEqual([
      '/',
      '/assets/index-abc123.js',
      '/assets/index-def456.css',
      '/index.html',
      '/vite.svg',
    ])
  })

  it('does not let a failed navigation overwrite the cached shell', async () => {
    const sandbox = loadServiceWorker(async () => new Response('server error page', { status: 500 }))
    const cache = await sandbox.caches.open(CACHE_NAME)
    await cache.put('/index.html', new Response('cached shell', { status: 200 }))

    const response = await runFetch(
      sandbox,
      { method: 'GET', url: `${ORIGIN}/`, mode: 'navigate' },
    )

    expect(response?.status).toBe(500)
    const cached = await sandbox.caches.match('/index.html')
    await expect(cached?.clone().text()).resolves.toBe('cached shell')
  })

  it('refreshes the cached shell after a successful navigation', async () => {
    const sandbox = loadServiceWorker(async () => new Response('fresh shell', { status: 200 }))
    const cache = await sandbox.caches.open(CACHE_NAME)
    await cache.put('/index.html', new Response('stale shell', { status: 200 }))

    await runFetch(sandbox, { method: 'GET', url: `${ORIGIN}/`, mode: 'navigate' })

    const cached = await sandbox.caches.match('/index.html')
    await expect(cached?.clone().text()).resolves.toBe('fresh shell')
  })

  it('falls back to the cached shell when the navigation fails', async () => {
    const sandbox = loadServiceWorker(async () => {
      throw new Error('offline')
    })
    const cache = await sandbox.caches.open(CACHE_NAME)
    await cache.put('/index.html', new Response('cached shell', { status: 200 }))

    const response = await runFetch(
      sandbox,
      { method: 'GET', url: `${ORIGIN}/`, mode: 'navigate' },
    )

    await expect(response?.text()).resolves.toBe('cached shell')
  })

  it('does not cache a failed static asset response', async () => {
    const sandbox = loadServiceWorker(async () => new Response('missing', { status: 404 }))

    await runFetch(sandbox, { method: 'GET', url: `${ORIGIN}/assets/gone.js`, mode: 'cors' })

    expect(await sandbox.caches.match('/assets/gone.js')).toBeUndefined()
  })

  it('leaves writes and API requests to the network', async () => {
    const sandbox = loadServiceWorker(async () => new Response('ok', { status: 200 }))

    const write = await runFetch(
      sandbox,
      { method: 'POST', url: `${ORIGIN}/api/events`, mode: 'cors' },
    )
    const apiRead = await runFetch(sandbox, {
      method: 'GET',
      url: `${ORIGIN}/api/events`,
      mode: 'cors',
    })

    expect(write).toBeUndefined()
    expect(apiRead).toBeUndefined()
    expect(sandbox.fetchMock).not.toHaveBeenCalled()
  })
})
