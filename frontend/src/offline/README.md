# Offline subsystem (Req 14.2)

Requirement 14.2: *whilst network connectivity is lost, cache user changes and
sync when the connection is restored.*

This directory implements a **narrow, working slice** of that: connectivity
awareness, a durable queue for writes made while offline, ordered replay on
reconnect, and a service worker that caches the app shell. It is **not** full
offline synchronization, and this document is deliberately explicit about what
is not handled.

## Pieces

| File | Purpose |
|---|---|
| `connectivity.ts` | Reads `navigator.onLine`; subscribes to `online`/`offline`. Coarse signal only — no reachability probe. |
| `mutationQueue.ts` | Durable FIFO queue persisted in `localStorage` under `althistory.offline-mutation-queue.v1`. |
| `mutationReplay.ts` | Replay policy (see below). Sends writes in order; classifies failures. |
| `offlineSync.ts` | Wires connectivity + queue + store; `submitMutation` is the offline-aware write path. |
| `OfflineIndicator.tsx` | Renders connectivity and queue depth. Mounted from `main.tsx`. |
| `registerServiceWorker.ts` + `public/sw.js` | App-shell caching. |

## Policy for the cases that do not solve cleanly

**A queued write rejected on replay (4xx).** It is removed from the queue and
surfaced through the existing `addError` channel (rendered by
`NotificationCenter`) — it is *not* retried forever, because a 4xx will not
become a success by waiting, and it is *not* dropped silently. A network error
or 5xx is treated as transient: the pass stops at that write and leaves it and
everything after it queued, in order.

**Two queued writes touching the same entity.** Replay is strict FIFO, so they
apply in the order the user made them. If a queued write carries an
`entityKey` (e.g. `event:e1`) and a 4xx rejects it, later queued writes with the
same `entityKey` are presumed to depend on it (create followed by update) and
are skipped rather than replayed into a guaranteed failure. Skipped writes are
also surfaced. Writes with no `entityKey`, or to a different entity, still
replay.

## What is NOT handled (do not read as offline sync)

- **No server conflict resolution.** The server's current state is never read
  back; a queued update can overwrite a newer server-side change (last write
  wins by replay order).
- **No idempotency keys.** If the server applied a write but the response was
  lost, replay can apply it twice.
- **No Background Sync API.** Replay runs on the `online` event (and at app
  start if already online). If the app is closed, nothing replays until it is
  opened again.
- **No cross-tab coordination.** Two tabs can replay the same queue
  concurrently; there is no lock.
- **No offline data read.** Queries still hit the network; only writes are
  queued. React Query's cache is in memory and is not persisted.
- **`submitMutation` is not yet used by the existing mutation hooks.** The
  React Query hooks in `@/hooks/useAPI.ts` still call the API client directly.
  Until they call `submitMutation`, the queue only receives writes from callers
  that opt in.

## Service worker status

`public/sw.js` is a static asset; Vite copies `public/` into `dist/` verbatim,
so **no Vite plugin is required** to ship it. (A build-time precache manifest
would need `vite-plugin-pwa`; that dependency is intentionally not added.)

Registration is production-only (`import.meta.env.PROD`) so it cannot serve
stale transformed modules during `vite dev`. **The service worker is not
verified by the unit suite:** jsdom has no `serviceWorker`, so no test exercises
registration, install, or fetch handling. It is also not exercised by the dev
server. Its caching behaviour requires a production build in a real browser to
verify, and that has not been done here.
