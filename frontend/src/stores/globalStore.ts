import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { Event, Arc, CausalRelationship, InferredPressure, FilterState, ViewMode, ErrorState } from '@/types'

interface GlobalState {
  // Data state
  events: Event[]
  arcs: Arc[]
  causalRelationships: CausalRelationship[]
  inferredPressures: InferredPressure[]
  
  // UI state
  selectedEvents: string[]
  selectedArcs: string[]
  activeFilters: FilterState
  viewMode: ViewMode
  
  // Loading states
  isLoading: boolean
  loadingOperations: Set<string>
  
  // Error handling
  errors: ErrorState[]
  
  // Actions
  setEvents: (events: Event[]) => void
  setArcs: (arcs: Arc[]) => void
  setCausalRelationships: (relationships: CausalRelationship[]) => void
  setInferredPressures: (pressures: InferredPressure[]) => void
  addEvent: (event: Event) => void
  updateEvent: (id: string, updates: Partial<Event>) => void
  deleteEvent: (id: string) => void
  setSelectedEvents: (eventIds: string[]) => void
  setSelectedArcs: (arcIds: string[]) => void
  setFilters: (filters: FilterState) => void
  setViewMode: (mode: ViewMode) => void
  setLoading: (loading: boolean) => void
  addLoadingOperation: (operation: string) => void
  removeLoadingOperation: (operation: string) => void
  addError: (error: Omit<ErrorState, 'id' | 'timestamp'>) => void
  clearErrors: () => void
  removeError: (id: string) => void
}

const initialFilters: FilterState = {
  dateRange: null,
  actors: [],
  targets: [],
  eventTypes: [],
  arcLevels: [],
  causalWeightRange: [0, 1],
  confidenceThreshold: 0,
  searchQuery: '',
}

export const useGlobalStore = create<GlobalState>()(
  devtools(
    (set) => ({
      // Initial state
      events: [],
      arcs: [],
      causalRelationships: [],
      inferredPressures: [],
      selectedEvents: [],
      selectedArcs: [],
      activeFilters: initialFilters,
      viewMode: 'timeline',
      isLoading: false,
      loadingOperations: new Set(),
      errors: [],

      // Actions
      setEvents: (events) => set({ events }),
      setArcs: (arcs) => set({ arcs }),
      setCausalRelationships: (relationships) => set({ causalRelationships: relationships }),
      setInferredPressures: (pressures) => set({ inferredPressures: pressures }),
      
      addEvent: (event) => set((state) => ({ 
        events: [...state.events, event] 
      })),
      
      updateEvent: (id, updates) => set((state) => ({
        events: state.events.map(event => 
          event.id === id ? { ...event, ...updates } : event
        )
      })),
      
      deleteEvent: (id) => set((state) => ({
        events: state.events.filter(event => event.id !== id),
        selectedEvents: state.selectedEvents.filter(eventId => eventId !== id)
      })),
      
      setSelectedEvents: (eventIds) => set({ selectedEvents: eventIds }),
      setSelectedArcs: (arcIds) => set({ selectedArcs: arcIds }),
      setFilters: (filters) => set({ activeFilters: filters }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setLoading: (loading) => set({ isLoading: loading }),
      
      addLoadingOperation: (operation) => set((state) => ({
        loadingOperations: new Set([...state.loadingOperations, operation])
      })),
      
      removeLoadingOperation: (operation) => set((state) => {
        const newOperations = new Set(state.loadingOperations)
        newOperations.delete(operation)
        return { loadingOperations: newOperations }
      }),
      
      addError: (error) => set((state) => ({
        errors: [...state.errors, {
          ...error,
          id: crypto.randomUUID(),
          timestamp: new Date()
        }]
      })),
      
      clearErrors: () => set({ errors: [] }),
      
      removeError: (id) => set((state) => ({
        errors: state.errors.filter(error => error.id !== id)
      })),
    }),
    {
      name: 'global-store',
    }
  )
)