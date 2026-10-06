/**
 * Service worker registration for offline app-shell loading (Req 14.2).
 *
 * The worker file is a static asset at `public/sw.js` (served from the site
 * root, so its scope is the whole app). Vite copies `public/` into `dist/`
 * verbatim, so no extra Vite plugin is needed to ship it. If the project later
 * wants build-time precache manifests or revision hashing, `vite-plugin-pwa`
 * would be the dependency to add; this implementation deliberately does not add
 * one.
 *
 * Registration is production-only: in `vite dev` the module graph is served
 * unbundled and a cache-first worker would serve stale transformed modules
 * across HMR. The worker itself is therefore NOT exercised by the dev server or
 * by jsdom (which has no `serviceWorker`), so its caching behaviour is
 * unverified by the unit suite -- see the offline README.
 */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) return
  if (typeof window === 'undefined') return

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('Service worker registration failed:', error)
    })
  })
}
