/**
 * WebSocket streaming module.
 *
 * Re-exports the protocol, token store, session manager and handler, plus a
 * process-wide token store singleton. The stream token route and the stream
 * handler must share ONE store or tokens issued by the route would be
 * unrecognised on connect, so `getStreamTokenStore()` is the single accessor
 * both use.
 */

export * from './StreamProtocol';
export * from './StreamTokenStore';
export * from './StreamSession';
export * from './StreamHandler';

import { StreamTokenStore, STREAM_TOKEN_EVICTION_INTERVAL_MS } from './StreamTokenStore';

let tokenStore: StreamTokenStore | undefined;

/**
 * The process-wide stream token store.
 *
 * Constructed with the eviction timer enabled so issuing tokens is not the only
 * thing that bounds the store's memory: a token nobody ever presents again
 * stops being held an hour (or, in the worst case, a TTL window) after it is
 * minted. The timer is unref'd, so it never keeps the process alive.
 */
export function getStreamTokenStore(): StreamTokenStore {
  if (!tokenStore) {
    tokenStore = new StreamTokenStore({
      evictionIntervalMs: STREAM_TOKEN_EVICTION_INTERVAL_MS,
    });
  }
  return tokenStore;
}

/**
 * Drop the singleton so a subsequent `getStreamTokenStore()` returns a fresh
 * store. Intended for test isolation; production never calls it.
 */
export function resetStreamTokenStore(): void {
  tokenStore?.dispose();
  tokenStore = undefined;
}
