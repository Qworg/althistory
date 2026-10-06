# Offline subsystem (Req 14.2)

Requirement 14.2: *whilst network connectivity is lost, cache user changes and
sync when the connection is restored.*

## The exact claim this delivers

> While the device is offline, **event and arc create/update/delete made through
> the app's mutation hooks are saved in a durable `localStorage` queue and sent
> when the connection returns.** Every other kind of write (causal links, graph
> management, import/export, API keys) needs a connection: it fails and is
> reported as a failure, and is **not** saved.

That is the whole claim. It is narrower than "the app works offline" and
narrower than "all user changes are cached". What backs it:

- The write paths exist and are wired: `submitMutation` in `offlineSync.ts` is
  called by `@/hooks/useAPI.ts` (`useCreateEvent`, `useUpdateEvent`,
  `useDeleteEvent`, `useCreateArc`, `useUpdateArc`, `useDeleteArc`) and by the
  equivalent hooks in `@/hooks/useEvents.ts` and `@/hooks/useArcs.ts`. These are
  the hooks the timeline UI edits through. `offlineWriteWiring.test.tsx` renders
  the real hooks with the device offline and asserts the write lands in the
  queue instead of the API client.
- The queue is durable: `mutationQueue.ts` writes each mutation under its own
  `localStorage` key and **throws `QueueStorageError` when it cannot persist**.
  A write that was not stored is never reported as queued; the caller surfaces
  the failure.
- Replay is ordered: a write is sent immediately only when the device is online,
  the queue is empty and no replay pass is running. Otherwise it is appended to
  the queue, so a fresh write cannot overtake an earlier queued one.
- Failures are classified: network errors, 5xx, 401, 408 and 429 stay queued and
  are retried; other 4xx are permanent rejections that are removed and surfaced.

## Pieces

| File | Purpose |
| --- | --- |
| `connectivity.ts` | Reads `navigator.onLine`; subscribes to `online`/`offline`. Coarse signal only — no reachability probe. |
| `mutationQueue.ts` | Durable FIFO queue in `localStorage`, one key per mutation (`althistory.offline-mutation-queue.v1.<id>`); migrates the older single-array payload. |
| `mutationReplay.ts` | Replay policy: send order, failure classification, dependent skipping. |
| `offlineSync.ts` | Wires connectivity + queue + store; `submitMutation` is the offline-aware write path; owns the retry schedule and the notifications. |
| `OfflineIndicator.tsx` | Renders connectivity and queue depth. Mounted from `main.tsx`. |
| `registerServiceWorker.ts` + `public/sw.js` | App-shell caching (the shell document and the build assets it references). |

## Failure policy on replay

| Failure | What happens |
| --- | --- |
| Network error / abort (no HTTP status) | Stays queued, in order. Retried with capped exponential backoff (2s doubling to 60s) while online. |
| 5xx, 401, 408, 429 | Same as above: keeps the write. 401 is retryable because an expired token is likely after time offline and the same write succeeds once signed in. |
| Other 4xx (400, 403, 404, 409, 410, 422, …) | Permanent for that payload: removed from the queue and surfaced through `addError` / NotificationCenter. |
| Sent, but removal from storage failed | Not counted as synced; stays queued (it may be sent again) and the storage error is surfaced. The pass stops. |
| A dependent write after a permanent rejection | Skipped and surfaced, when both carry the same `entityKey`. |

**A 401 does not mean "lost".** It means the queue stops and keeps the write; the
replay retries at up to one-minute intervals until a valid token is available.
Nothing drains the queue while the device is offline.

## What is NOT handled (do not read as offline sync)

- **Not every write is queued.** Only event and arc writes go through
  `submitMutation`. Causal-link writes need a payload the API client transforms,
  and graph/import/export/API-key writes need a server answer the caller cannot
  reconstruct, so they fail loudly instead of being queued.
- **Causal links and the rest are not saved offline.** The offline notification
  says so explicitly.
- **No offline read.** Queries still hit the network; React Query's cache is in
  memory and is not persisted. Only writes are queued.
- **An offline-created event or arc cannot be edited afterwards.** The create has
  no server id, so the new item does not appear in the UI until it syncs; there
  is no client-id/day-one reconciliation. Queued creates therefore carry no
  `entityKey`.
- **No server conflict resolution.** The server's current state is never read
  back; a queued update can overwrite a newer server-side change (last write wins
  by replay order).
- **No idempotency keys.** If the server applied a write but the response was
  lost, replay can apply it twice.
- **No `Retry-After` honouring.** A 429 is retried on the schedule above, not on
  the delay the server asked for.
- **No Background Sync API.** Replay runs on the `online` event, at app start if
  already online, and on the retry timer. If the app is closed, nothing replays
  until it is opened again.
- **No cross-tab lock, and no cross-tab replay coordination.** Each mutation is
  its own storage key, so concurrent enqueues or removals in two tabs cannot
  lose each other's entries (an array read-modify-write could), and other tabs'
  changes are picked up through the `storage` event so the queued count stays
  right. Two tabs can still replay the same queue at the same time, so a write
  can be sent twice. There is no lock.

## Service worker status

`public/sw.js` is a static asset; Vite copies `public/` into `dist/` verbatim,
so no Vite plugin is required to ship it. Because it is copied verbatim it
contains no build-time precache manifest, so at install it fetches
`/index.html`, parses the asset URLs out of it, and precaches those alongside
`/`, `/index.html` and `/vite.svg`. Without that step an offline reload would
have the document but none of the hashed bundles — a blank page. Static assets
are also cached on first fetch. A navigation response is only written to the
cache when `response.ok`, so a 404/500 page cannot replace the cached shell.

Its behaviour is tested by evaluating the script in a sandbox with fake
`caches`/`fetch` (`serviceWorker.test.ts`): install-time precache, the
`response.ok` guard, the offline fallback, and pass-through for non-GET/API
requests. That is not a browser test: no real service worker install, activation,
scope or eviction behaviour is exercised, and registration is production-only
(`import.meta.env.PROD`) so `vite dev` never runs it. Cache invalidation is the
manual `CACHE_NAME` version bump; there is no revision hash per asset.
