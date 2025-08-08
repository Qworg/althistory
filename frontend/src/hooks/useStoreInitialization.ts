import { useEffect } from 'react'
import { useGlobalStore } from '@/stores/globalStore'

/**
 * Hook to initialize the global store with persisted data
 * Should be called once at the app root level
 */
export function useStoreInitialization() {
  const loadPreferences = useGlobalStore(state => state.loadPreferences)
  const loadSessionData = useGlobalStore(state => state.loadSessionData)

  useEffect(() => {
    // Load persisted preferences and session data on app initialization
    loadPreferences()
    loadSessionData()
  }, [loadPreferences, loadSessionData])

  // Auto-save preferences when they change
  useEffect(() => {
    const unsubscribe = useGlobalStore.subscribe((state, prevState) => {
      if (state.userPreferences !== prevState.userPreferences) {
        // Debounce the save operation
        const timeoutId = setTimeout(() => {
          useGlobalStore.getState().savePreferences()
        }, 500)
        
        return () => clearTimeout(timeoutId)
      }
    })

    return unsubscribe
  }, [])

  // Auto-save session data when it changes
  useEffect(() => {
    const unsubscribe = useGlobalStore.subscribe((state, prevState) => {
      if (state.sessionData !== prevState.sessionData) {
        // Debounce the save operation
        const timeoutId = setTimeout(() => {
          useGlobalStore.getState().saveSessionData()
        }, 1000)
        
        return () => clearTimeout(timeoutId)
      }
    })

    return unsubscribe
  }, [])
}