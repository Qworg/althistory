import { useState, useCallback, useMemo, useEffect } from 'react'
import { shouldIgnoreAppShortcut } from '@/utils/keyboardShortcuts'
import { CausalGraphComponent } from '@/components/causal-graph'
import { Event, CausalRelationship } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'
import { filterCausalRelationships, filterEvents } from '@/components/filters/filterUtils'
import { VIEW_EVENT_LIMIT } from '@/hooks/useEvents'
import { ViewLoadError, SlowLoadNotice } from './ViewLoadState'
import { useSlowLoading } from '@/hooks/useSlowLoading'
import { EmptyGraphState } from './EmptyGraphState'
import { useEvents, useCausalRelationships, useDeleteCausalLink, useUpdateCausalLink, useDeleteEvent, useUpdateEvent } from '@/hooks/useAPI'
import { ContextMenu, ConfirmDialog } from '@/components/ui'
import { EventDetailModal, CausalRelationshipModal } from '@/components/modals'
import { CausalEventInspector } from '@/components/causal-graph/CausalEventInspector'
import { truncateLabel, formatActorTarget } from '@/components/causal-graph/causalGraphPresentation'

/**
 * The graph canvas is as tall as the window allows below the view header
 * (never under 400px, never so tall that it dwarfs a large screen). The page
 * is not height-constrained, so "fill the parent" would collapse it.
 */
const GRAPH_CANVAS_HEIGHT = 'h-[clamp(400px,calc(100dvh_-_18rem),960px)]'

type ContextMenuState = {
  type: 'event' | 'relationship'
  item: Event | CausalRelationship
  position: { x: number; y: number }
} | null

type DeleteConfirmState = {
  type: 'event' | 'relationship'
  item: Event | CausalRelationship
} | null

/** What a delete is about to remove, named, and how it can be undone. */
const RESTORE_NOTE = 'Version history keeps the graph as it was, so you can restore it from Versions.'

function eventName(event: Event | undefined): string {
  if (!event) return 'an event no longer in this graph'
  return `“${truncateLabel(event.description || formatActorTarget(event) || event.id, 80)}”`
}

function describeDeletion(
  target: NonNullable<DeleteConfirmState>,
  events: Event[],
  relationships: CausalRelationship[]
): { title: string; message: string } {
  if (target.type === 'event') {
    const event = target.item as Event
    const links = relationships.filter(
      rel => rel.cause_event_id === event.id || rel.effect_event_id === event.id
    ).length
    const cascade = links === 0 ? '' : links === 1 ? ' Its causal link goes with it.' : ` Its ${links} causal links go with it.`
    return {
      title: 'Delete event',
      message: `Delete ${eventName(event)}?${cascade} ${RESTORE_NOTE}`
    }
  }
  const rel = target.item as CausalRelationship
  const cause = events.find(e => e.id === rel.cause_event_id)
  const effect = events.find(e => e.id === rel.effect_event_id)
  return {
    title: 'Delete link',
    message: `Delete the link from ${eventName(cause)} to ${eventName(effect)}? ${RESTORE_NOTE}`
  }
}

type EditModalState = {
  type: 'event' | 'relationship'
  item: Event | CausalRelationship
} | null

export function CausalGraphView() {
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [selectedRelationship, setSelectedRelationship] = useState<CausalRelationship | null>(null)

  // Context menu and modal state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>(null)
  const [editModal, setEditModal] = useState<EditModalState>(null)

  // Fetch events and causal relationships
  const eventsQuery = useEvents({ limit: VIEW_EVENT_LIMIT })
  const relationshipsQuery = useCausalRelationships()
  const { data: fetchedEvents = [], isLoading: eventsLoading } = eventsQuery
  const { data: fetchedRelationships = [], isLoading: relationshipsLoading } = relationshipsQuery
  // A failed request must not read as an empty graph (see ViewLoadError).
  const loadFailure = eventsQuery.isError
    ? { what: 'this graph’s events', error: eventsQuery.error }
    : relationshipsQuery.isError
    ? { what: 'this graph’s causal links', error: relationshipsQuery.error }
    : null
  const retryLoad = () => {
    void eventsQuery.refetch()
    void relationshipsQuery.refetch()
  }

  const activeFilters = useGlobalStore(state => state.activeFilters)
  const clearFilters = useGlobalStore(state => state.clearFilters)

  // Apply the global filters client-side (see filterUtils for why).
  const filteredEvents = useMemo(
    () => filterEvents(fetchedEvents, activeFilters),
    [fetchedEvents, activeFilters]
  )
  const filteredRelationships = useMemo(
    () => filterCausalRelationships(fetchedRelationships, activeFilters),
    [fetchedRelationships, activeFilters]
  )

  const isLoading = eventsLoading || relationshipsLoading
  const loadIsSlow = useSlowLoading(isLoading)

  // The selected event as the graph holds it now (an edit shows at once), or
  // none once a filter has hidden it.
  const selectedEventNow = useMemo(
    () => (selectedEvent ? filteredEvents.find((e) => e.id === selectedEvent.id) ?? null : null),
    [selectedEvent, filteredEvents]
  )

  // Mutation hooks
  const deleteCausalLinkMutation = useDeleteCausalLink()
  const updateCausalLinkMutation = useUpdateCausalLink()
  const deleteEventMutation = useDeleteEvent()
  const updateEventMutation = useUpdateEvent()

  const handleNodeClick = useCallback((event: Event) => {
    setSelectedEvent(event)
    setSelectedRelationship(null)
  }, [])


  const handleEdgeClick = useCallback((relationship: CausalRelationship) => {
    setSelectedRelationship(relationship)
    setSelectedEvent(null)
  }, [])

  const filterPanelOpen = useGlobalStore((state) => state.uiState?.filterPanelOpen ?? false)

  const clearSelection = useCallback(() => {
    setSelectedEvent(null)
    setSelectedRelationship(null)
  }, [])

  // Escape clears the selection, as on the timeline. The canvas handles its
  // own Escape first (cancel a link being drawn, close a tool) and marks it
  // handled; only a bare Escape reaches this.
  const hasLocalSelection = selectedEvent !== null || selectedRelationship !== null
  useEffect(() => {
    if (!hasLocalSelection) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || shouldIgnoreAppShortcut(event)) return
      setSelectedEvent(null)
      setSelectedRelationship(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [hasLocalSelection])

  const handleInspectorEdit = useCallback((event: Event) => {
    setEditModal({ type: 'event', item: event })
  }, [])

  // Context menu handlers
  const handleNodeContextMenu = useCallback((event: Event, position: { x: number; y: number }) => {
    setContextMenu({ type: 'event', item: event, position })
  }, [])

  const handleRelationshipContextMenu = useCallback((relationship: CausalRelationship, position: { x: number; y: number }) => {
    setContextMenu({ type: 'relationship', item: relationship, position })
  }, [])

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null)
  }, [])

  // Edit action from context menu
  const handleEdit = useCallback(() => {
    if (contextMenu) {
      setEditModal({ type: contextMenu.type, item: contextMenu.item })
      setContextMenu(null)
    }
  }, [contextMenu])

  // Delete action from context menu
  const handleDeleteRequest = useCallback(() => {
    if (contextMenu) {
      setDeleteConfirm({ type: contextMenu.type, item: contextMenu.item })
      setContextMenu(null)
    }
  }, [contextMenu])

  // Confirm delete
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirm) return

    try {
      if (deleteConfirm.type === 'event') {
        await deleteEventMutation.mutateAsync(deleteConfirm.item.id)
        if (selectedEvent?.id === deleteConfirm.item.id) {
          setSelectedEvent(null)
        }
      } else {
        const rel = deleteConfirm.item as CausalRelationship
        await deleteCausalLinkMutation.mutateAsync({
          causeEventId: rel.cause_event_id,
          effectEventId: rel.effect_event_id
        })
        if (selectedRelationship?.id === rel.id) {
          setSelectedRelationship(null)
        }
      }
      setDeleteConfirm(null)
    } catch (error) {
      console.error('Failed to delete:', error)
      const addError = useGlobalStore.getState?.()?.addError
      addError?.({
        type: 'network',
        message: `Failed to delete ${deleteConfirm.type}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      })
    }
  }, [deleteConfirm, deleteEventMutation, deleteCausalLinkMutation, selectedEvent, selectedRelationship])

  // Cancel delete
  const handleDeleteCancel = useCallback(() => {
    setDeleteConfirm(null)
  }, [])

  // Save event changes
  const handleEventSave = useCallback(async (updates: Partial<Event>) => {
    if (editModal?.type === 'event') {
      await updateEventMutation.mutateAsync({
        id: editModal.item.id,
        data: updates
      })
      setEditModal(null)
    }
  }, [editModal, updateEventMutation])

  // Delete event from modal
  const handleEventDelete = useCallback(async () => {
    if (editModal?.type === 'event') {
      await deleteEventMutation.mutateAsync(editModal.item.id)
      setEditModal(null)
      if (selectedEvent?.id === editModal.item.id) {
        setSelectedEvent(null)
      }
    }
  }, [editModal, deleteEventMutation, selectedEvent])

  // Save relationship changes
  const handleRelationshipSave = useCallback(async (relationship: CausalRelationship) => {
    if (editModal?.type === 'relationship') {
      const rel = editModal.item as CausalRelationship
      await updateCausalLinkMutation.mutateAsync({
        causeEventId: rel.cause_event_id,
        effectEventId: rel.effect_event_id,
        data: {
          weight: relationship.weight,
          confidence: relationship.confidence,
          evidence: relationship.evidence,
          relationship_type: relationship.relationship_type
        }
      })
      setEditModal(null)
    }
  }, [editModal, updateCausalLinkMutation])

  // Delete relationship from modal. The id is not needed: the relationship to
  // delete is already carried on `editModal`, so the parameter is simply omitted
  // (the handler stays assignable to the `(relationshipId: string) => void`
  // prop it is passed as).
  const handleRelationshipDelete = useCallback(async () => {
    if (editModal?.type === 'relationship') {
      const rel = editModal.item as CausalRelationship
      await deleteCausalLinkMutation.mutateAsync({
        causeEventId: rel.cause_event_id,
        effectEventId: rel.effect_event_id
      })
      setEditModal(null)
      if (selectedRelationship?.id === rel.id) {
        setSelectedRelationship(null)
      }
    }
  }, [editModal, deleteCausalLinkMutation, selectedRelationship])

  // Close edit modal
  const handleEditModalClose = useCallback(() => {
    setEditModal(null)
  }, [])

  const isDeleting = deleteCausalLinkMutation.isPending || deleteEventMutation.isPending

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Header with stats */}
      <div className="bg-card border border-line rounded-lg shadow-sm p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            {/* The breadcrumb and the navigation already name the view. */}
            <h2 className="sr-only">Causal Graph</h2>
            {/* One line, for the input in use; the rest is in Help (?). */}
            <p className="text-xs text-ink-secondary">
              <span className="[@media(pointer:coarse)]:hidden">Click a node to inspect it · right-click it to edit · hover a link for its weight</span>
              <span className="hidden [@media(pointer:coarse)]:inline">Tap a node to inspect it</span>
            </p>
          </div>

          {/* Statistics */}
          <p className="font-mono-code shrink-0 whitespace-nowrap text-xs text-ink-muted">
            {filteredEvents.length} {filteredEvents.length === 1 ? 'event' : 'events'} ·{' '}
            {isLoading ? '…' : filteredRelationships.length}{' '}
            {filteredRelationships.length === 1 ? 'link' : 'links'}
          </p>
        </div>

        {/* A selected link (a selected event is described in the inspector) */}
        {selectedRelationship && (
          <div className="mt-3 pt-3 border-t border-line text-sm">
            {selectedRelationship && (
              <span className="text-ink">
                <span className="font-medium text-selected">Selected link:</span>{' '}
                <span className="capitalize">{selectedRelationship.relationship_type}</span>
                <span className="text-ink-secondary"> · weight </span>
                <span className="font-mono-code">{selectedRelationship.weight.toFixed(2)}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* The graph, with the selected event's inspector beside it on a wide
          screen and under it on a narrow one. */}
      {/* The inspector takes a column only while an event is selected: empty,
          its 20rem column was most of the reason the graph had ~40% of the
          window. With nothing selected the hint bar above says what to do. */}
      {/* The same placement as the timeline's: a rail beside the canvas from
          xl, always there at that width (so selecting never resizes the
          canvas), with the inspector in it once an event is selected. */}
      <div className={`flex-1 grid grid-cols-1 gap-4 xl:items-start ${selectedEventNow || !filterPanelOpen ? 'xl:grid-cols-[minmax(0,1fr)_20rem]' : ''}`}>
      <div className="bg-card border border-line rounded-lg shadow-sm p-4 min-w-0">
        {loadFailure && !isLoading ? (
          <ViewLoadError
            what={loadFailure.what}
            error={loadFailure.error}
            onRetry={retryLoad}
            isRetrying={eventsQuery.isFetching || relationshipsQuery.isFetching}
          />
        ) : isLoading ? (
          <div className="flex items-center justify-center h-full min-h-[400px]" aria-busy="true">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-baseline mx-auto mb-4" aria-hidden="true"></div>
              <p className="text-ink-secondary">Loading the causal graph…</p>
              {loadIsSlow && <SlowLoadNotice onRetry={retryLoad} />}
            </div>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full min-h-[400px]">
            <EmptyGraphState
              kind={fetchedEvents.length === 0 ? 'empty' : 'filtered'}
              onClearFilters={clearFilters}
            />
          </div>
        ) : (
          <CausalGraphComponent
            canvasClassName={GRAPH_CANVAS_HEIGHT}
            events={filteredEvents}
            causalRelationships={filteredRelationships}
            focusEventId={selectedEvent?.id}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            onNodeContextMenu={handleNodeContextMenu}
            onRelationshipContextMenu={handleRelationshipContextMenu}
          />
        )}
      </div>

        {!selectedEventNow && !filterPanelOpen && (
          <aside aria-label="Selection" className="hidden rounded-lg border border-dashed border-line p-5 text-sm text-ink-secondary xl:block">
            <h3 className="font-display text-xl font-semibold text-ink">Nothing selected</h3>
            <p className="mt-2">
              Select an event to see what caused it and what it set in motion: its ripple stays lit on the graph
              while the rest fades back.
            </p>
          </aside>
        )}
        {selectedEventNow && (
          <div className="bg-card border border-line rounded-lg shadow-sm p-4 xl:sticky xl:top-[calc(var(--app-header-h,0px)+1.5rem)] xl:max-h-[calc(100dvh-var(--app-header-h,0px)-3rem)] xl:overflow-y-auto max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] max-lg:z-30 max-lg:max-h-[55dvh] max-lg:overflow-y-auto max-lg:rounded-b-none max-lg:shadow-xl">
            <CausalEventInspector
              event={selectedEventNow}
              events={filteredEvents}
              relationships={filteredRelationships}
              onSelectEvent={handleNodeClick}
              onEdit={handleInspectorEdit}
              onClose={clearSelection}
              isLoading={relationshipsLoading}
            />
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          isOpen={true}
          title={
            contextMenu.type === 'event'
              ? (contextMenu.item as Event).description
              : 'The causal link'
          }
          position={contextMenu.position}
          items={[
            { id: 'edit', label: 'Edit', onClick: handleEdit },
            { id: 'delete', label: 'Delete', onClick: handleDeleteRequest, danger: true }
          ]}
          onClose={handleContextMenuClose}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <ConfirmDialog
          isOpen={true}
          {...describeDeletion(deleteConfirm, fetchedEvents, fetchedRelationships)}
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
          isLoading={isDeleting}
          variant="danger"
        />
      )}

      {/* Event Edit Modal */}
      {editModal?.type === 'event' && (
        <EventDetailModal
          event={editModal.item as Event}
          isOpen={true}
          onClose={handleEditModalClose}
          onSave={handleEventSave}
          onDelete={handleEventDelete}
        />
      )}

      {/* Relationship Edit Modal */}
      {editModal?.type === 'relationship' && (
        <CausalRelationshipModal
          relationship={editModal.item as CausalRelationship}
          isOpen={true}
          onClose={handleEditModalClose}
          onSave={handleRelationshipSave}
          onDelete={handleRelationshipDelete}
        />
      )}
    </div>
  )
}
