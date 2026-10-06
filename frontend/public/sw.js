/*
 * App-shell service worker for offline loading (Req 14.2).
 *
 * Scope: this file lives in `public/`, so Vite serves it at `/sw.js` with root
 * scope. It caches the app shell -- the HTML document and the same-origin build
 * assets (the hashed JS/CSS that the document references) -- and serves them
 * when the network is unavailable, so the app can boot offline.
 *
 * The build assets are discovered by parsing the fetched `/index.html` at
 * install time. That matters: this file is copied verbatim into `dist/` by
 * Vite, so it cannot contain a build-time precache manifest (that would need
 * `vite-plugin-pwa`). Without the parse, only `/`, `/index.html` and `/vite.svg`
 * would be cached, and an offline reload would serve the document without its
 * hashed bundles -- a blank page. Static assets are also cached on first fetch
 * (cache-first below), which covers an asset added after install.
 *
 * It intentionally does NOT cache or intercept API calls: writes that happen
 * offline are handled by the JavaScript mutation queue, not here (a service
 * worker has no access to localStorage, and this worker uses no IndexedDB).
 *
 * Limits: this is a cache of the shell, not offline data sync. It does not do
 * background sync, does not resolve data conflicts, does not verify that a
 * cached shell matches the deployed build beyond the cache-version bump below,
 * and does not guarantee that every asset of a fresh deploy was fetched before
 * the connection dropped.
 */

const CACHE_NAME = 'althistory-shell-v2'
const SHELL_URLS = ['/', '/index.html', '/vite.svg']

/** Same-origin asset URLs referenced by the document, e.g. `/assets/index-abc.js`. */
function extractAssetUrls(html) {
  const urls = new Set()
  const pattern = /(?:src|href)\s*=\s*["']([^"']+)["']/gi
  let match = pattern.exec(html)
  while (match !== null) {
    const value = match[1]
    // Only same-origin absolute paths are cacheable here; `data:`, `http(s):`
    // and relative URLs are skipped (getAssetUrl upstream already emits `/...`).
    if (value.startsWith('/') && !value.startsWith('/api')) {
      urls.add(value)
    }
    match = pattern.exec(html)
  }
  return [...urls]
}

/** Add a URL to the cache, tolerating a single missing asset. */
async function addIgnoringFailure(cache, url) {
  try {
    await cache.add(url)
  } catch (error) {
    // A missing asset is worth reporting, but must not fail the whole install.
    console.error('Service worker could not precache', url, error)
  }
}

/**
 * Cache the shell, then the assets the shell's document references. A failing
 * fetch (offline install, 404) leaves the rest of the install working.
 */
async function precacheShell(cache) {
  await Promise.all(SHELL_URLS.map((url) => addIgnoringFailure(cache, url)))

  let response
  try {
    response = await fetch('/index.html', { cache: 'reload' })
  } catch (error) {
    console.error('Service worker could not fetch the shell document:', error)
    return
  }
  if (!response.ok) return

  const copy = response.clone()
  const html = await copy.text()
  // Store the document we just parsed, so the cached shell and the cached asset
  // list belong to the same deploy.
  await cache.put('/index.html', response)

  const assets = extractAssetUrls(html)
  await Promise.all(assets.map((url) => addIgnoringFailure(cache, url)))
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => precacheShell(cache))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  // Only GET navigations and static assets are cached. Non-GET writes pass
  // straight through to the network (and are queued by the app when offline).
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    // A malformed request URL cannot be matched to a cache entry; let the
    // browser handle it directly.
    return
  }
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api')) return

  // Navigations: network-first so a fresh deploy is picked up, falling back to
  // the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only a successful document may replace the cached shell. Caching a
          // 404 or 500 here would overwrite a working offline shell with an
          // error page and then serve it offline.
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy))
          }
          return response
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || Response.error())),
    )
    return
  }

  // Static assets: cache-first, with a network fetch populating the cache. Only
  // successful responses are stored, so a 404 for a removed asset does not
  // poison the cache with an error page.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
