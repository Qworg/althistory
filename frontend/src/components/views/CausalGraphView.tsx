import { useState, useCallback, useMemo } from 'react'
import { CausalGraphComponent } from '@/components/causal-graph'
import { Event, CausalRelationship } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'
import { filterCausalRelationships, filterEvents } from '@/components/filters/filterUtils'
import { useEvents, useCausalRelationships, useDeleteCausalLink, useUpdateCausalLink, useDeleteEvent, useUpdateEvent } from '@/hooks/useAPI'
import { ContextMenu, ConfirmDialog } from '@/components/ui'
import { EventDetailModal, CausalRelationshipModal } from '@/components/modals'
import { formatHistoricalTimestamp } from '@/utils/historicalTime'
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
  const [hoveredEvent, setHoveredEvent] = useState<Event | null>(null)
  const [hoveredRelationship, setHoveredRelationship] = useState<CausalRelationship | null>(null)

  // Context menu and modal state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>(null)
  const [editModal, setEditModal] = useState<EditModalState>(null)

  // Fetch events and causal relationships
  const { data: fetchedEvents = [], isLoading: eventsLoading } = useEvents()
  const { data: fetchedRelationships = [], isLoading: relationshipsLoading } = useCausalRelationships()

  const activeFilters = useGlobalStore(state => state.activeFilters)

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

  // Mutation hooks
  const deleteCausalLinkMutation = useDeleteCausalLink()
  const updateCausalLinkMutation = useUpdateCausalLink()
  const deleteEventMutation = useDeleteEvent()
  const updateEventMutation = useUpdateEvent()

  const handleNodeClick = useCallback((event: Event) => {
    setSelectedEvent(event)
    setSelectedRelationship(null)
  }, [])

  const handleNodeHover = useCallback((event: Event | null) => {
    setHoveredEvent(event)
  }, [])

  const handleEdgeClick = useCallback((relationship: CausalRelationship) => {
    setSelectedRelationship(relationship)
    setSelectedEvent(null)
  }, [])

  const handleEdgeHover = useCallback((relationship: CausalRelationship | null) => {
    setHoveredRelationship(relationship)
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
            <h2 className="font-display text-[1.75rem] leading-tight font-semibold text-ink">Causal Graph View</h2>
            <p className="text-sm text-ink-secondary mt-1">
              Explore causal relationships between events
            </p>
            <p className="text-xs text-ink-secondary mt-0.5">
              Click a node to inspect it · Hover a link for its weight and type · Right-click to edit · Draw Link (D) links two selected events, or the cause and effect you click next
            </p>
          </div>

          {/* Statistics */}
          <div className="font-mono-code flex flex-wrap items-center gap-3 sm:gap-6 text-xs text-ink-muted">
            <span>{filteredEvents.length} events</span>
            <span>{filteredRelationships.length} relationships</span>
          </div>
        </div>

        {/* Selection info */}
        {(selectedEvent || selectedRelationship) && (
          <div className="mt-3 pt-3 border-t border-line text-sm">
            {selectedEvent && (
              <span className="text-ink">
                <span className="font-medium text-selected">Selected:</span>{' '}
                <span className="font-medium">{selectedEvent.description || `${selectedEvent.actor} → ${selectedEvent.target}`}</span>
                {selectedEvent.description && (
                  <span className="text-ink-secondary"> · {selectedEvent.actor} → {selectedEvent.target}</span>
                )}
              </span>
            )}
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

      {/* Main graph container */}
      <div className="flex-1 bg-card border border-line rounded-lg shadow-sm p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full min-h-[400px]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-baseline mx-auto mb-4" aria-hidden="true"></div>
              <p className="text-ink-secondary">Loading graph data...</p>
            </div>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full min-h-[400px]">
            <div className="text-center">
              <p className="text-ink-secondary mb-2">No events to display</p>
              <p className="text-sm text-ink-secondary">Create events in the Timeline view first</p>
            </div>
          </div>
        ) : (
          <CausalGraphComponent
            canvasClassName={GRAPH_CANVAS_HEIGHT}
            events={filteredEvents}
            causalRelationships={filteredRelationships}
            focusEventId={selectedEvent?.id}
            onNodeClick={handleNodeClick}
            onNodeHover={handleNodeHover}
            onEdgeClick={handleEdgeClick}
            onEdgeHover={handleEdgeHover}
            onNodeContextMenu={handleNodeContextMenu}
            onRelationshipContextMenu={handleRelationshipContextMenu}
          />
        )}
      </div>

      {/* Info panels - hidden on mobile to save space, shown on hover/tap */}
      {(hoveredEvent || hoveredRelationship) && (
        <div className="bg-subtle text-ink border border-line rounded-lg p-3 sm:p-4">
          {hoveredEvent && (
            <div>
              <h3 className="font-display text-xl font-semibold text-ink mb-2">Event Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 text-xs sm:text-sm">
                <div>
                  <span className="font-medium text-ink-secondary">Actor:</span>
                  <span className="ml-2 text-ink">{hoveredEvent.actor}</span>
                </div>
                <div>
                  <span className="font-medium text-ink-secondary">Target:</span>
                  <span className="ml-2 text-ink">{hoveredEvent.target}</span>
                </div>
                <div className="sm:col-span-2">
                  <span className="font-medium text-ink-secondary">Description:</span>
                  <span className="ml-2 text-ink">{hoveredEvent.description}</span>
                </div>
                <div className="sm:col-span-2">
                  <span className="font-medium text-ink-secondary">Timestamp:</span>
                  <span className="ml-2 font-mono-code text-ink">
                    {formatHistoricalTimestamp(hoveredEvent.timestamp)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {hoveredRelationship && (
            <div>
              <h3 className="font-display text-xl font-semibold text-ink mb-2">Causal Relationship</h3>
              <div className="grid grid-cols-2 gap-2 sm:gap-4 text-xs sm:text-sm">
                <div>
                  <span className="font-medium text-ink-secondary">Weight:</span>
                  <span className="ml-2 font-mono-code text-ink">{hoveredRelationship.weight.toFixed(2)}</span>
                </div>
                <div>
                  <span className="font-medium text-ink-secondary">Confidence:</span>
                  <span className="ml-2 font-mono-code text-ink">{hoveredRelationship.confidence.toFixed(2)}</span>
                </div>
                <div>
                  <span className="font-medium text-ink-secondary">Type:</span>
                  <span className="ml-2 text-ink capitalize">{hoveredRelationship.relationship_type}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-medium text-ink-secondary">Evidence:</span>
                  <span className="ml-2 text-ink">{hoveredRelationship.evidence}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          isOpen={true}
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
