import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readLiveSyncPreference, resetLiveChangesStore, useLiveChangesStore, NOTICE_MS } from './liveChangesStore'
import { FRESH_MS } from '@/services/liveChanges'

describe('live changes store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    resetLiveChangesStore()
  })

  afterEach(() => {
    resetLiveChangesStore()
    vi.useRealTimers()
  })

  describe('the preference', () => {
    it('is on unless the person turned it off', () => {
      expect(readLiveSyncPreference()).toBe(true)
      useLiveChangesStore.getState().setEnabled(false)
      expect(readLiveSyncPreference()).toBe(false)
      expect(localStorage.getItem('althistory.liveSync')).toBe('off')
      useLiveChangesStore.getState().setEnabled(true)
      expect(readLiveSyncPreference()).toBe(true)
      expect(localStorage.getItem('althistory.liveSync')).toBeNull()
    })

    it('stays on when the browser will not say, rather than failing', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      expect(readLiveSyncPreference()).toBe(true)
      spy.mockRestore()
    })
  })

  describe('fresh items', () => {
    it('are highlighted until their time is up, and then the highlight goes by itself', () => {
      const store = useLiveChangesStore
      store.getState().markFresh([
        { type: 'event', id: 'e1' },
        { type: 'arc', id: 'a1' },
        { type: 'pressure', id: 'p1' },
      ])
      expect(store.getState().fresh.event.e1).toBeDefined()
      expect(store.getState().fresh.arc.a1).toBeDefined()
      expect(Object.keys(store.getState().fresh.relationship)).toEqual([])

      vi.advanceTimersByTime(FRESH_MS - 500)
      expect(store.getState().fresh.event.e1).toBeDefined()
      vi.advanceTimersByTime(1000)
      expect(store.getState().fresh.event.e1).toBeUndefined()
      expect(store.getState().fresh.arc.a1).toBeUndefined()
    })

    it('extends an item that changes again, and ends the others on their own time', () => {
      const store = useLiveChangesStore
      store.getState().markFresh([{ type: 'event', id: 'e1' }, { type: 'event', id: 'e2' }])
      vi.advanceTimersByTime(4000)
      store.getState().markFresh([{ type: 'event', id: 'e1' }])
      vi.advanceTimersByTime(3000)
      expect(store.getState().fresh.event.e1).toBeDefined()
      expect(store.getState().fresh.event.e2).toBeUndefined()
    })
  })

  describe('notices', () => {
    it('are shown, at most a few at once, and leave on their own', () => {
      const store = useLiveChangesStore
      store.getState().addNotices(['one', 'two', 'three', 'four', 'five'])
      expect(store.getState().notices.map((notice) => notice.message)).toEqual(['two', 'three', 'four', 'five'])
      vi.advanceTimersByTime(NOTICE_MS + 200)
      expect(store.getState().notices).toEqual([])
    })

    it('with one key replace each other instead of piling up', () => {
      const store = useLiveChangesStore
      store.getState().setNotice('generation:j1', 'was cancelled; 3 events stay')
      store.getState().addNotices(['other'])
      store.getState().setNotice('generation:j1', 'was cancelled; 4 events stay')
      expect(store.getState().notices.map((notice) => notice.message)).toEqual(['was cancelled; 4 events stay', 'other'])
    })

    it('can be dismissed', () => {
      const store = useLiveChangesStore
      store.getState().addNotices(['one', 'two'])
      const [first] = store.getState().notices
      store.getState().dismissNotice(first?.id ?? '')
      expect(store.getState().notices.map((notice) => notice.message)).toEqual(['two'])
    })
  })
})
