/*
 * App-shell service worker for offline loading (Req 14.2).
 *
 * Scope: this file lives in `public/`, so Vite serves it at `/sw.js` with
 * root scope. It caches the app shell (the HTML document and same-origin static
 * assets) and serves them when the network is unavailable, so the app can boot
 * offline. It intentionally does NOT cache or intercept API calls: writes that
 * happen offline are handled by the JavaScript mutation queue, not here (a
 * service worker has no access to localStorage, and this worker uses no
 * IndexedDB).
 *
 * Limits: this is a cache of the shell, not offline data sync. It does not do
 * background sync, does not resolve data conflicts, and does not verify that a
 * cached shell matches the deployed build beyond the cache-version bump below.
 */

const CACHE_NAME = 'althistory-shell-v1'
const SHELL_ASSETS = ['/', '/index.html', '/vite.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
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
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy))
          return response
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || Response.error())),
    )
    return
  }

  // Static assets: cache-first, with a network fetch populating the cache.
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
