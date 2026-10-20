import { create } from 'zustand'
import { CopyOperation } from '@/types'

/**
 * The state of the graph-copy operations, shared by everything that shows
 * them.
 *
 * It used to live in `useGraphCopy`'s own `useState`, which meant every
 * component that called the hook got its own copy of the operations: the modal
 * that started a copy saw it, the progress panel and the history panel did
 * not, and the completion notification could not be mounted anywhere that
 * outlived the modal.
 *
 * The operations are shared state, so they belong in a store. The polling
 * intervals live here too: two components polling the same copy would double
 * the requests and race each other's updates.
 */
interface CopyStoreState {
  /** Copies that are still running. */
  activeOperations: CopyOperation[]
  /** Copies that have finished, successfully or not. */
  completedOperations: CopyOperation[]

  /** The polling interval of each copy being watched, by copy id. */
  pollingIntervals: Map<string, ReturnType<typeof setInterval>>

  /** Register a running copy. */
  addOperation: (operation: CopyOperation) => void
  /**
   * Record the result of a status poll: the operation moves from the active
   * list to the completed list when it is done.
   */
  updateOperation: (
    id: string,
    update: Partial<CopyOperation>
  ) => void
  /** Remove a completed copy from the history. */
  clearCompletedOperations: () => void

  /** Start watching a copy, unless it is already watched. */
  startPolling: (id: string, interval: ReturnType<typeof setInterval>) => void
  /** Stop watching a copy and release its interval. */
  stopPolling: (id: string) => void
  /** Release every interval; used when the application tears down. */
  stopAllPolling: () => void
}

export const useCopyStore = create<CopyStoreState>((set, get) => ({
  activeOperations: [],
  completedOperations: [],
  pollingIntervals: new Map(),

  addOperation: (operation) =>
    set((state) => {
      // A copy that has already finished is not running: it goes straight to
      // the completed list, so the panels do not offer to refresh or cancel it.
      if (operation.status === 'completed' || operation.status === 'failed') {
        return {
          completedOperations: [...state.completedOperations, operation],
        }
      }
      return {
        activeOperations: [...state.activeOperations, operation],
      }
    }),

  updateOperation: (id, update) =>
    set((state) => {
      // A poll that arrives after the copy is gone changes nothing, and must
      // not hand every consumer a new array.
      if (!state.activeOperations.some((operation) => operation.id === id)) {
        return state
      }

      const updated = state.activeOperations.map((operation) =>
        operation.id === id ? { ...operation, ...update } : operation
      )

      const stillActive = updated.filter(
        (operation) =>
          operation.status === 'pending' || operation.status === 'in_progress'
      )
      const nowCompleted = updated.filter(
        (operation) =>
          operation.status === 'completed' || operation.status === 'failed'
      )

      return {
        activeOperations: stillActive,
        completedOperations:
          nowCompleted.length > 0
            ? [...state.completedOperations, ...nowCompleted]
            : state.completedOperations,
      }
    }),

  clearCompletedOperations: () => set({ completedOperations: [] }),

  startPolling: (id, interval) =>
    set((state) => {
      if (state.pollingIntervals.has(id)) {
        // The copy is already being watched: the interval that was just
        // handed over would never be cleared, so it is released here.
        clearInterval(interval)
        return state
      }
      const pollingIntervals = new Map(state.pollingIntervals)
      pollingIntervals.set(id, interval)
      return { pollingIntervals }
    }),

  stopPolling: (id) => {
    const interval = get().pollingIntervals.get(id)
    if (interval) clearInterval(interval)
    set((state) => {
      const pollingIntervals = new Map(state.pollingIntervals)
      pollingIntervals.delete(id)
      return { pollingIntervals }
    })
  },

  stopAllPolling: () => {
    for (const interval of get().pollingIntervals.values()) {
      clearInterval(interval)
    }
    set({ pollingIntervals: new Map() })
  },
}))

// The polling intervals are released when a copy finishes, when it is
// cancelled, and by `stopAllPolling`. A hot reload of a file that imports this
// one does not re-evaluate this module, so the store -- and the intervals it
// holds -- survive the reload.
