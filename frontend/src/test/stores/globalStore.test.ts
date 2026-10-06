import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useGlobalStore } from '@/stores/globalStore'
import { Event, Arc, CausalRelationship } from '@/types'
import {
  userPreferencesPersistence,
  sessionDataPersistence,
  type PersistenceManager,
} from '@/utils/persistence'

type PersistenceUtilsModule = typeof import('@/utils/persistence')

/** The two managers `@/stores/globalStore` imports from the persistence module. */
type PersistenceManagerExports = Pick<
  PersistenceUtilsModule,
  'userPreferencesPersistence' | 'sessionDataPersistence'
>

/**
 * The public surface of the real `PersistenceManager`. `Pick<_, keyof _>` drops the private
 * `config` field, so a public method added to the class later becomes a compile error in the
 * mock below instead of an `undefined` at runtime.
 */
type PersistenceManagerApi = Pick<PersistenceManager, keyof PersistenceManager>

// Mock the persistence utilities, typed against the real module so a new manager method is a
// compile error here rather than a silent runtime miss.
vi.mock('@/utils/persistence', () => {
  const createPersistenceStub = (): PersistenceManagerApi => ({
    save: vi.fn(),
    load: <T>(): T | null => null,
    clear: vi.fn(),
  })

  return {
    userPreferencesPersistence: createPersistenceStub(),
    sessionDataPersistence: createPersistenceStub(),
  } satisfies Record<keyof PersistenceManagerExports, PersistenceManagerApi>
})

type GlobalStoreState = ReturnType<typeof useGlobalStore.getState>

/**
 * The slice reset before every test. Typing it as a `Pick` of the real store state means a
 * renamed or removed field fails to compile here instead of leaving stale data behind.
 */
const RESET_STATE: Pick<
  GlobalStoreState,
  | 'events'
  | 'arcs'
  | 'causalRelationships'
  | 'inferredPressures'
  | 'selectedEvents'
  | 'selectedArcs'
  | 'errors'
  | 'loadingOperations'
> = {
  events: [],
  arcs: [],
  causalRelationships: [],
  inferredPressures: [],
  selectedEvents: [],
  selectedArcs: [],
  errors: [],
  loadingOperations: new Set<string>(),
}

describe('GlobalStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useGlobalStore.setState(RESET_STATE)
  })

  describe('Event Management', () => {
    it('should add an event', () => {
      const mockEvent: Event = {
        id: '1',
        description: 'Test event',
        actor: 'Test actor',
        target: 'Test target',
        timestamp: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      useGlobalStore.getState().addEvent(mockEvent)
      
      const events = useGlobalStore.getState().events
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual(mockEvent)
    })

    it('should update an event', () => {
      const mockEvent: Event = {
        id: '1',
        description: 'Test event',
        actor: 'Test actor',
        target: 'Test target',
        timestamp: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      useGlobalStore.getState().addEvent(mockEvent)
      useGlobalStore.getState().updateEvent('1', { description: 'Updated event' })
      
      const events = useGlobalStore.getState().events
      expect(events[0]?.description).toBe('Updated event')
    })

    it('should delete an event', () => {
      const mockEvent: Event = {
        id: '1',
        description: 'Test event',
        actor: 'Test actor',
        target: 'Test target',
        timestamp: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      useGlobalStore.getState().addEvent(mockEvent)
      useGlobalStore.getState().setSelectedEvents(['1'])
      useGlobalStore.getState().deleteEvent('1')
      
      const state = useGlobalStore.getState()
      expect(state.events).toHaveLength(0)
      expect(state.selectedEvents).toHaveLength(0)
    })
  })

  describe('Arc Management', () => {
    it('should add an arc', () => {
      const mockArc: Arc = {
        id: '1',
        name: 'Test arc',
        description: 'Test arc description',
        start_time: '2024-01-01T00:00:00Z',
        end_time: '2024-01-02T00:00:00Z',
        level: 0,
        parent_arc_id: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      useGlobalStore.getState().addArc(mockArc)
      
      const arcs = useGlobalStore.getState().arcs
      expect(arcs).toHaveLength(1)
      expect(arcs[0]).toEqual(mockArc)
    })

    it('should update an arc', () => {
      const mockArc: Arc = {
        id: '1',
        name: 'Test arc',
        description: 'Test arc description',
        start_time: '2024-01-01T00:00:00Z',
        end_time: '2024-01-02T00:00:00Z',
        level: 0,
        parent_arc_id: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      useGlobalStore.getState().addArc(mockArc)
      useGlobalStore.getState().updateArc('1', { name: 'Updated arc' })
      
      const arcs = useGlobalStore.getState().arcs
      expect(arcs[0]?.name).toBe('Updated arc')
    })

    it('should delete an arc', () => {
      const mockArc: Arc = {
        id: '1',
        name: 'Test arc',
        description: 'Test arc description',
        start_time: '2024-01-01T00:00:00Z',
        end_time: '2024-01-02T00:00:00Z',
        level: 0,
        parent_arc_id: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      useGlobalStore.getState().addArc(mockArc)
      useGlobalStore.getState().setSelectedArcs(['1'])
      useGlobalStore.getState().deleteArc('1')
      
      const state = useGlobalStore.getState()
      expect(state.arcs).toHaveLength(0)
      expect(state.selectedArcs).toHaveLength(0)
    })
  })

  describe('Selection Management', () => {
    it('should toggle event selection', () => {
      useGlobalStore.getState().toggleEventSelection('1')
      expect(useGlobalStore.getState().selectedEvents).toContain('1')
      
      useGlobalStore.getState().toggleEventSelection('1')
      expect(useGlobalStore.getState().selectedEvents).not.toContain('1')
    })

    it('should toggle arc selection', () => {
      useGlobalStore.getState().toggleArcSelection('1')
      expect(useGlobalStore.getState().selectedArcs).toContain('1')
      
      useGlobalStore.getState().toggleArcSelection('1')
      expect(useGlobalStore.getState().selectedArcs).not.toContain('1')
    })

    it('should clear all selections', () => {
      useGlobalStore.getState().setSelectedEvents(['1', '2'])
      useGlobalStore.getState().setSelectedArcs(['1', '2'])
      useGlobalStore.getState().clearSelection()
      
      const state = useGlobalStore.getState()
      expect(state.selectedEvents).toHaveLength(0)
      expect(state.selectedArcs).toHaveLength(0)
    })
  })

  describe('Filter Management', () => {
    it('should update filters', () => {
      const newFilters = {
        searchQuery: 'test query',
        actors: ['actor1', 'actor2'],
      }

      useGlobalStore.getState().updateFilters(newFilters)
      
      const filters = useGlobalStore.getState().activeFilters
      expect(filters.searchQuery).toBe('test query')
      expect(filters.actors).toEqual(['actor1', 'actor2'])
    })

    it('should clear filters', () => {
      useGlobalStore.getState().updateFilters({ searchQuery: 'test' })
      useGlobalStore.getState().clearFilters()
      
      const filters = useGlobalStore.getState().activeFilters
      expect(filters.searchQuery).toBe('')
    })
  })

  describe('Loading State Management', () => {
    it('should manage loading operations', () => {
      useGlobalStore.getState().addLoadingOperation('fetch-events')
      expect(useGlobalStore.getState().loadingOperations.has('fetch-events')).toBe(true)
      
      useGlobalStore.getState().removeLoadingOperation('fetch-events')
      expect(useGlobalStore.getState().loadingOperations.has('fetch-events')).toBe(false)
    })
  })

  describe('Error Management', () => {
    it('should add and remove errors', () => {
      useGlobalStore.getState().addError({
        message: 'Test error',
        type: 'network',
      })
      
      const errors = useGlobalStore.getState().errors
      expect(errors).toHaveLength(1)
      const [firstError] = errors
      if (!firstError) throw new Error('expected the store to record one error')
      expect(firstError.message).toBe('Test error')
      expect(firstError.type).toBe('network')
      expect(firstError.id).toBeDefined()
      expect(firstError.timestamp).toBeInstanceOf(Date)
      
      useGlobalStore.getState().removeError(firstError.id)
      expect(useGlobalStore.getState().errors).toHaveLength(0)
    })

    it('should clear all errors', () => {
      useGlobalStore.getState().addError({ message: 'Error 1', type: 'network' })
      useGlobalStore.getState().addError({ message: 'Error 2', type: 'validation' })
      
      expect(useGlobalStore.getState().errors).toHaveLength(2)
      
      useGlobalStore.getState().clearErrors()
      expect(useGlobalStore.getState().errors).toHaveLength(0)
    })
  })

  describe('UI State Management', () => {
    it('should update UI state', () => {
      useGlobalStore.getState().setSidebarCollapsed(true)
      expect(useGlobalStore.getState().uiState.sidebarCollapsed).toBe(true)
      
      useGlobalStore.getState().setFilterPanelOpen(false)
      expect(useGlobalStore.getState().uiState.filterPanelOpen).toBe(false)
      
      useGlobalStore.getState().setActiveModal('event-detail')
      expect(useGlobalStore.getState().uiState.activeModal).toBe('event-detail')
    })

    it('should update drag state', () => {
      useGlobalStore.getState().setDragState({
        isDragging: true,
        dragType: 'event',
        draggedItemId: '1',
      })
      
      const dragState = useGlobalStore.getState().uiState.dragState
      expect(dragState.isDragging).toBe(true)
      expect(dragState.dragType).toBe('event')
      expect(dragState.draggedItemId).toBe('1')
    })
  })

  describe('Causal Relationship Management', () => {
    it('should add a causal relationship', () => {
      const mockRelationship: CausalRelationship = {
        id: '1',
        cause_event_id: 'event1',
        effect_event_id: 'event2',
        weight: 0.8,
        evidence: 'Test evidence',
        confidence: 0.9,
        relationship_type: 'direct',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      useGlobalStore.getState().addCausalRelationship(mockRelationship)
      
      const relationships = useGlobalStore.getState().causalRelationships
      expect(relationships).toHaveLength(1)
      expect(relationships[0]).toEqual(mockRelationship)
    })

    it('should update a causal relationship', () => {
      const mockRelationship: CausalRelationship = {
        id: '1',
        cause_event_id: 'event1',
        effect_event_id: 'event2',
        weight: 0.8,
        evidence: 'Test evidence',
        confidence: 0.9,
        relationship_type: 'direct',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      useGlobalStore.getState().addCausalRelationship(mockRelationship)
      useGlobalStore.getState().updateCausalRelationship('1', { weight: 0.9 })
      
      const relationships = useGlobalStore.getState().causalRelationships
      expect(relationships[0]?.weight).toBe(0.9)
    })

    it('should delete a causal relationship', () => {
      const mockRelationship: CausalRelationship = {
        id: '1',
        cause_event_id: 'event1',
        effect_event_id: 'event2',
        weight: 0.8,
        evidence: 'Test evidence',
        confidence: 0.9,
        relationship_type: 'direct',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      useGlobalStore.getState().addCausalRelationship(mockRelationship)
      useGlobalStore.getState().deleteCausalRelationship('1')
      
      const relationships = useGlobalStore.getState().causalRelationships
      expect(relationships).toHaveLength(0)
    })
  })

  describe('Persistence Writes Committed State', () => {
    it('persists the newly set preference value, not the value it replaced', () => {
      useGlobalStore.setState({
        userPreferences: { ...useGlobalStore.getState().userPreferences, theme: 'light' },
      })
      const save = vi.mocked(userPreferencesPersistence.save)
      save.mockClear()

      useGlobalStore.getState().setUserPreferences({ theme: 'dark' })

      expect(useGlobalStore.getState().userPreferences.theme).toBe('dark')
      expect(save).toHaveBeenCalledTimes(1)
      expect(save.mock.calls[0]?.[0]).toMatchObject({ theme: 'dark' })
    })

    it('persists the newly set session value, not the value it replaced', () => {
      useGlobalStore.setState({
        sessionData: { ...useGlobalStore.getState().sessionData, lastViewMode: 'timeline' },
      })
      const save = vi.mocked(sessionDataPersistence.save)
      save.mockClear()

      useGlobalStore.getState().updateSessionData({ lastViewMode: 'causal' })

      expect(useGlobalStore.getState().sessionData.lastViewMode).toBe('causal')
      expect(save).toHaveBeenCalledTimes(1)
      expect(save.mock.calls[0]?.[0]).toMatchObject({ lastViewMode: 'causal' })
    })
  })
})