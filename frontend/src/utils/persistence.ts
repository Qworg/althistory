// Persistence utilities for local storage
export interface PersistenceConfig {
  key: string
  version: number
  migrate?: (persistedState: any, version: number) => any
}

export class PersistenceManager {
  private config: PersistenceConfig

  constructor(config: PersistenceConfig) {
    this.config = config
  }

  save<T>(state: T): void {
    try {
      const serializedState = JSON.stringify({
        state,
        version: this.config.version,
        timestamp: Date.now()
      })
      localStorage.setItem(this.config.key, serializedState)
    } catch (error) {
      console.warn('Failed to save state to localStorage:', error)
    }
  }

  load<T>(): T | null {
    try {
      const serializedState = localStorage.getItem(this.config.key)
      if (!serializedState) return null

      const { state, version, timestamp } = JSON.parse(serializedState)
      
      // Check if state is too old (older than 7 days)
      const maxAge = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
      if (Date.now() - timestamp > maxAge) {
        this.clear()
        return null
      }

      // Handle version migration if needed
      if (version !== this.config.version && this.config.migrate) {
        return this.config.migrate(state, version)
      }

      return state
    } catch (error) {
      console.warn('Failed to load state from localStorage:', error)
      this.clear()
      return null
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(this.config.key)
    } catch (error) {
      console.warn('Failed to clear localStorage:', error)
    }
  }
}

// Create persistence managers for different parts of the state
export const userPreferencesPersistence = new PersistenceManager({
  key: 'timeline-interface-preferences',
  version: 1,
  migrate: (state, version) => {
    // Handle future migrations here
    return state
  }
})

export const sessionDataPersistence = new PersistenceManager({
  key: 'timeline-interface-session',
  version: 1,
  migrate: (state, _version) => {
    // Handle future migrations here
    return state
  }
})