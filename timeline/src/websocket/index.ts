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

import { StreamTokenStore } from './StreamTokenStore';

let tokenStore: StreamTokenStore | undefined;

/** The process-wide stream token store. */
export function getStreamTokenStore(): StreamTokenStore {
  if (!tokenStore) {
    tokenStore = new StreamTokenStore();
  }
  return tokenStore;
}

/**
 * Drop the singleton so a subsequent `getStreamTokenStore()` returns a fresh
 * store. Intended for test isolation; production never calls it.
 */
export function resetStreamTokenStore(): void {
  tokenStore = undefined;
}
