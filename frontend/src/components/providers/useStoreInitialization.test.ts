import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStoreInitialization } from '@/hooks/useStoreInitialization'
import { useGlobalStore } from '@/stores/globalStore'
import { userPreferencesPersistence, sessionDataPersistence } from '@/utils/persistence'
import { UserPreferences } from '@/types'

const originalPreferences: UserPreferences = useGlobalStore.getState().userPreferences
const originalSessionData = useGlobalStore.getState().sessionData

describe('useStoreInitialization (mounted at the app root)', () => {
  beforeEach(() => {
    localStorage.clear()
    useGlobalStore.setState({
      userPreferences: originalPreferences,
      sessionData: originalSessionData,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('hydrates persisted preferences and session data on mount', () => {
    userPreferencesPersistence.save<UserPreferences>({ ...originalPreferences, theme: 'dark' })
    sessionDataPersistence.save({ ...originalSessionData, lastViewMode: 'causal' })

    renderHook(() => useStoreInitialization())

    expect(useGlobalStore.getState().userPreferences.theme).toBe('dark')
    expect(useGlobalStore.getState().sessionData.lastViewMode).toBe('causal')
  })

  it('persists preference changes made after mount', () => {
    vi.useFakeTimers()
    renderHook(() => useStoreInitialization())

    act(() => {
      useGlobalStore.getState().setUserPreferences({ theme: 'dark' })
    })

    act(() => {
      vi.advanceTimersByTime(600)
    })

    const persisted = userPreferencesPersistence.load<UserPreferences>()
    expect(persisted?.theme).toBe('dark')
  })
})
