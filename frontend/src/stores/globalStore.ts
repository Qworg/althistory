import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  Event,
  Arc,
  CausalRelationship,
  InferredPressure,
  FilterState,
  ViewMode,
  ErrorState,
  UserPreferences,
  SessionData,
  UIState
} from '@/types'
import { userPreferencesPersistence, sessionDataPersistence } from '@/utils/persistence'

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
  uiState: UIState
  
  // User preferences and session data
  userPreferences: UserPreferences
  sessionData: SessionData
  
  // Loading states
  isLoading: boolean
  loadingOperations: Set<string>
  
  // Error handling
  errors: ErrorState[]

  // Offline connectivity (Req 14.2). `isOnline` mirrors the browser's
  // connectivity state; `pendingMutationCount` mirrors the durable offline
  // mutation queue. Neither is persisted by this store -- the queue module owns
  // its own storage.
  isOnline: boolean
  pendingMutationCount: number
  // True while a replay pass is walking the queue. The indicator uses it to say
  // "Syncing" only when a pass is actually running.
  syncInProgress: boolean
  
  // Data manipulation actions
  setEvents: (events: Event[]) => void
  setArcs: (arcs: Arc[]) => void
  setCausalRelationships: (relationships: CausalRelationship[]) => void
  setInferredPressures: (pressures: InferredPressure[]) => void
  addEvent: (event: Event) => void
  updateEvent: (id: string, updates: Partial<Event>) => void
  deleteEvent: (id: string) => void
  addArc: (arc: Arc) => void
  updateArc: (id: string, updates: Partial<Arc>) => void
  deleteArc: (id: string) => void
  addCausalRelationship: (relationship: CausalRelationship) => void
  updateCausalRelationship: (id: string, updates: Partial<CausalRelationship>) => void
  deleteCausalRelationship: (id: string) => void
  
  // Selection actions
  setSelectedEvents: (eventIds: string[]) => void
  setSelectedArcs: (arcIds: string[]) => void
  toggleEventSelection: (eventId: string) => void
  toggleArcSelection: (arcId: string) => void
  clearSelection: () => void
  
  // Filter and view actions
  setFilters: (filters: FilterState) => void
  updateFilters: (updates: Partial<FilterState>) => void
  clearFilters: () => void
  setViewMode: (mode: ViewMode) => void
  
  // UI state actions
  setUIState: (updates: Partial<UIState>) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setFilterPanelOpen: (open: boolean) => void
  setActiveModal: (modalId: string | null) => void
  setDragState: (dragState: Partial<UIState['dragState']>) => void
  setSelectionState: (selectionState: Partial<UIState['selectionState']>) => void
  
  // Preferences actions
  setUserPreferences: (preferences: Partial<UserPreferences>) => void
  updateSessionData: (updates: Partial<SessionData>) => void
  
  // Loading state actions
  setLoading: (loading: boolean) => void
  addLoadingOperation: (operation: string) => void
  removeLoadingOperation: (operation: string) => void
  
  // Error handling actions
  addError: (error: Omit<ErrorState, 'id' | 'timestamp'>) => void
  clearErrors: () => void
  removeError: (id: string) => void

  // Offline connectivity actions
  setOnline: (online: boolean) => void
  setPendingMutationCount: (count: number) => void
  setSyncInProgress: (inProgress: boolean) => void
  
  // Persistence actions
  savePreferences: () => void
  loadPreferences: () => void
  saveSessionData: () => void
  loadSessionData: () => void
  clearPersistedData: () => void
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

const initialUserPreferences: UserPreferences = {
  theme: 'system',
  layoutMode: 'sidebar',
  defaultViewMode: 'timeline',
  timelineHeight: 600,
  showEventLabels: true,
  autoSaveFilters: true,
  notificationSettings: {
    showSuccess: true,
    showErrors: true,
    showWarnings: true,
  },
  accessibility: {
    highContrast: false,
    reducedMotion: false,
    screenReaderOptimized: false,
  },
}

const initialSessionData: SessionData = {
  lastActiveFilters: initialFilters,
  lastViewMode: 'timeline',
  lastSelectedEvents: [],
  lastSelectedArcs: [],
  recentSearches: [],
  viewportState: {
    timeline: {
      zoomLevel: 1,
      centerTime: null,
      fitToViewTrigger: 0,
    },
    causalGraph: {
      layout: 'cose',
      nodePositions: {},
    },
  },
}

const initialUIState: UIState = {
  sidebarCollapsed: false,
  filterPanelOpen: true,
  activeModal: null,
  dragState: {
    isDragging: false,
    dragType: null,
    draggedItemId: null,
  },
  selectionState: {
    isSelecting: false,
    selectionType: 'single',
    selectionBox: null,
  },
}

export const useGlobalStore = create<GlobalState>()(
  devtools(
    (set, get) => ({
      // Initial state
      events: [],
      arcs: [],
      causalRelationships: [],
      inferredPressures: [],
      selectedEvents: [],
      selectedArcs: [],
      activeFilters: initialFilters,
      viewMode: 'timeline',
      uiState: initialUIState,
      userPreferences: initialUserPreferences,
      sessionData: initialSessionData,
      isLoading: false,
      loadingOperations: new Set(),
      errors: [],
      isOnline: true,
      pendingMutationCount: 0,
      syncInProgress: false,

      // Data manipulation actions
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

      addArc: (arc) => set((state) => ({ 
        arcs: [...state.arcs, arc] 
      })),
      
      updateArc: (id, updates) => set((state) => ({
        arcs: state.arcs.map(arc => 
          arc.id === id ? { ...arc, ...updates } : arc
        )
      })),
      
      deleteArc: (id) => set((state) => ({
        arcs: state.arcs.filter(arc => arc.id !== id),
        selectedArcs: state.selectedArcs.filter(arcId => arcId !== id)
      })),

      addCausalRelationship: (relationship) => set((state) => ({ 
        causalRelationships: [...state.causalRelationships, relationship] 
      })),
      
      updateCausalRelationship: (id, updates) => set((state) => ({
        causalRelationships: state.causalRelationships.map(rel => 
          rel.id === id ? { ...rel, ...updates } : rel
        )
      })),
      
      deleteCausalRelationship: (id) => set((state) => ({
        causalRelationships: state.causalRelationships.filter(rel => rel.id !== id)
      })),
      
      // Selection actions
      setSelectedEvents: (eventIds) => set({ selectedEvents: eventIds }),
      setSelectedArcs: (arcIds) => set({ selectedArcs: arcIds }),
      
      toggleEventSelection: (eventId) => set((state) => ({
        selectedEvents: state.selectedEvents.includes(eventId)
          ? state.selectedEvents.filter(id => id !== eventId)
          : [...state.selectedEvents, eventId]
      })),
      
      toggleArcSelection: (arcId) => set((state) => ({
        selectedArcs: state.selectedArcs.includes(arcId)
          ? state.selectedArcs.filter(id => id !== arcId)
          : [...state.selectedArcs, arcId]
      })),
      
      clearSelection: () => set({ selectedEvents: [], selectedArcs: [] }),
      
      // Filter and view actions
      setFilters: (filters) => {
        set({ activeFilters: filters })
        // Auto-save filters if enabled. Persist after `set` so the committed
        // state (not the value being replaced) is written.
        if (get().userPreferences.autoSaveFilters) {
          get().updateSessionData({ lastActiveFilters: filters })
        }
      },
      
      updateFilters: (updates) => {
        set((state) => ({ activeFilters: { ...state.activeFilters, ...updates } }))
        // Auto-save filters if enabled, using the committed filter state.
        if (get().userPreferences.autoSaveFilters) {
          get().updateSessionData({ lastActiveFilters: get().activeFilters })
        }
      },
      
      clearFilters: () => set({ activeFilters: initialFilters }),
      
      setViewMode: (mode) => {
        set({ viewMode: mode })
        get().updateSessionData({ lastViewMode: mode })
      },
      
      // UI state actions
      setUIState: (updates) => set((state) => ({
        uiState: { ...state.uiState, ...updates }
      })),
      
      setSidebarCollapsed: (collapsed) => set((state) => ({
        uiState: { ...state.uiState, sidebarCollapsed: collapsed }
      })),
      
      setFilterPanelOpen: (open) => set((state) => ({
        uiState: { ...state.uiState, filterPanelOpen: open }
      })),
      
      setActiveModal: (modalId) => set((state) => ({
        uiState: { ...state.uiState, activeModal: modalId }
      })),
      
      setDragState: (dragState) => set((state) => ({
        uiState: { 
          ...state.uiState, 
          dragState: { ...state.uiState.dragState, ...dragState }
        }
      })),
      
      setSelectionState: (selectionState) => set((state) => ({
        uiState: { 
          ...state.uiState, 
          selectionState: { ...state.uiState.selectionState, ...selectionState }
        }
      })),
      
      // Preferences actions
      setUserPreferences: (preferences) => {
        set((state) => ({
          userPreferences: { ...state.userPreferences, ...preferences }
        }))
        // Persist AFTER `set`: zustand commits synchronously, so
        // `savePreferences` reads the value just written, not the previous one.
        get().savePreferences()
      },
      
      updateSessionData: (updates) => {
        set((state) => ({
          sessionData: { ...state.sessionData, ...updates }
        }))
        // Persist AFTER `set` so the committed session data is written.
        get().saveSessionData()
      },
      
      // Loading state actions
      setLoading: (loading) => set({ isLoading: loading }),
      
      addLoadingOperation: (operation) => set((state) => ({
        loadingOperations: new Set([...state.loadingOperations, operation])
      })),
      
      removeLoadingOperation: (operation) => set((state) => {
        const newOperations = new Set(state.loadingOperations)
        newOperations.delete(operation)
        return { loadingOperations: newOperations }
      }),
      
      // Error handling actions
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

      // Offline connectivity actions
      setOnline: (online) => set({ isOnline: online }),
      setPendingMutationCount: (count) => set({ pendingMutationCount: count }),
      setSyncInProgress: (inProgress) => set({ syncInProgress: inProgress }),
      
      // Persistence actions
      savePreferences: () => {
        const { userPreferences } = get()
        userPreferencesPersistence.save(userPreferences)
      },
      
      loadPreferences: () => {
        const savedPreferences = userPreferencesPersistence.load<UserPreferences>()
        if (savedPreferences) {
          set({ userPreferences: { ...initialUserPreferences, ...savedPreferences } })
        }
      },
      
      saveSessionData: () => {
        const { sessionData } = get()
        sessionDataPersistence.save(sessionData)
      },
      
      loadSessionData: () => {
        const savedSessionData = sessionDataPersistence.load<SessionData>()
        if (savedSessionData) {
          set({ 
            sessionData: { ...initialSessionData, ...savedSessionData },
            activeFilters: savedSessionData.lastActiveFilters || initialFilters,
            viewMode: savedSessionData.lastViewMode || 'timeline',
            selectedEvents: savedSessionData.lastSelectedEvents || [],
            selectedArcs: savedSessionData.lastSelectedArcs || []
          })
        }
      },
      
      clearPersistedData: () => {
        userPreferencesPersistence.clear()
        sessionDataPersistence.clear()
        set({
          userPreferences: initialUserPreferences,
          sessionData: initialSessionData
        })
      },
    }),
    {
      name: 'global-store',
    }
  )
)