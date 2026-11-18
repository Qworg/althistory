import { useSyncExternalStore } from 'react'
import { fontEpoch, subscribeFontEpoch } from './labelWidth'

/**
 * A number that changes when the page's fonts finish loading, which changes
 * every measured text width: a memo that measures labels lists it as a
 * dependency, so it measures again with the real font.
 */
export function useFontEpoch(): number {
  return useSyncExternalStore(subscribeFontEpoch, fontEpoch, fontEpoch)
}
