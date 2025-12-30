import { useState, useCallback, useEffect } from 'react'
import { CausalGraphComponent } from '@/components/causal-graph'
import { Event, CausalRelationship } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'
import { useEvents, useCausalRelationships, useDeleteCausalLink, useUpdateCausalLink, useDeleteEvent, useUpdateEvent } from '@/hooks/useAPI'
import { ContextMenu, ConfirmDialog } from '@/components/ui'
import { EventDetailModal, CausalRelationshipModal } from '@/components/modals'

type ContextMenuState = {
  type: 'event' | 'relationship'
  item: Event | CausalRelationship
  position: { x: number; y: number }
} | null

type DeleteConfirmState = {
  type: 'event' | 'relationship'
  item: Event | CausalRelationship
} | null

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

  const {
    events,
    causalRelationships,
    setEvents,
    setCausalRelationships
  } = useGlobalStore()

  // Sync fetched data to global store
  useEffect(() => {
    if (fetchedEvents.length > 0) {
      setEvents(fetchedEvents)
    }
  }, [fetchedEvents, setEvents])

  useEffect(() => {
    if (fetchedRelationships.length > 0) {
      setCausalRelationships(fetchedRelationships)
    }
  }, [fetchedRelationships, setCausalRelationships])

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

  // Delete relationship from modal
  const handleRelationshipDelete = useCallback(async (_relationshipId: string) => {
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
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Causal Graph View</h2>
            <p className="text-sm text-gray-600 mt-1">
              Explore causal relationships between events
            </p>
          </div>

          {/* Statistics */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-6 text-sm text-gray-600">
            <span>{events.length} events</span>
            <span>{causalRelationships.length} relationships</span>
          </div>
        </div>

        {/* Selection info */}
        {(selectedEvent || selectedRelationship) && (
          <div className="mt-3 pt-3 border-t border-gray-100 text-sm">
            {selectedEvent && (
              <span className="text-blue-600 font-medium">
                Selected: {selectedEvent.actor} → {selectedEvent.target}
              </span>
            )}
            {selectedRelationship && (
              <span className="text-green-600 font-medium">
                Relationship weight: {selectedRelationship.weight.toFixed(2)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Main graph container */}
      <div className="flex-1 bg-white rounded-lg shadow p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full min-h-[400px]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading graph data...</p>
            </div>
          </div>
        ) : events.length === 0 ? (
          <div className="flex items-center justify-center h-full min-h-[400px]">
            <div className="text-center">
              <p className="text-gray-600 mb-2">No events to display</p>
              <p className="text-sm text-gray-500">Create events in the Timeline view first</p>
            </div>
          </div>
        ) : (
          <CausalGraphComponent
          className="h-full"
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
        <div className="bg-white rounded-lg shadow p-3 sm:p-4">
          {hoveredEvent && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-2 text-sm sm:text-base">Event Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 text-xs sm:text-sm">
                <div>
                  <span className="font-medium text-gray-700">Actor:</span>
                  <span className="ml-2 text-gray-900">{hoveredEvent.actor}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Target:</span>
                  <span className="ml-2 text-gray-900">{hoveredEvent.target}</span>
                </div>
                <div className="sm:col-span-2">
                  <span className="font-medium text-gray-700">Description:</span>
                  <span className="ml-2 text-gray-900">{hoveredEvent.description}</span>
                </div>
                <div className="sm:col-span-2">
                  <span className="font-medium text-gray-700">Timestamp:</span>
                  <span className="ml-2 text-gray-900">
                    {new Date(hoveredEvent.timestamp).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}

          {hoveredRelationship && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-2 text-sm sm:text-base">Causal Relationship</h3>
              <div className="grid grid-cols-2 gap-2 sm:gap-4 text-xs sm:text-sm">
                <div>
                  <span className="font-medium text-gray-700">Weight:</span>
                  <span className="ml-2 text-gray-900">{hoveredRelationship.weight.toFixed(2)}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Confidence:</span>
                  <span className="ml-2 text-gray-900">{hoveredRelationship.confidence.toFixed(2)}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Type:</span>
                  <span className="ml-2 text-gray-900 capitalize">{hoveredRelationship.relationship_type}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-medium text-gray-700">Evidence:</span>
                  <span className="ml-2 text-gray-900">{hoveredRelationship.evidence}</span>
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
          title={`Delete ${deleteConfirm.type === 'event' ? 'Event' : 'Relationship'}`}
          message={`Are you sure you want to delete this ${deleteConfirm.type}? This action cannot be undone.`}
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
