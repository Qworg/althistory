import { useState, useCallback, useRef, useEffect } from 'react'
import { Timeline } from '@/components/timeline/Timeline'
import { useEvents } from '@/hooks/useEvents'
import { useArcs } from '@/hooks/useArcs'
import { useDeleteEvent, useUpdateEvent, useDeleteArc, useUpdateArc } from '@/hooks/useAPI'
import { useGlobalStore } from '@/stores/globalStore'
import { Event, Arc, TimeRange } from '@/types'
import { ContextMenu, ConfirmDialog } from '@/components/ui'
import { EventDetailModal, ArcDetailPanel } from '@/components/modals'

type ContextMenuState = {
  type: 'event' | 'arc'
  item: Event | Arc
  position: { x: number; y: number }
} | null

type DeleteConfirmState = {
  type: 'event' | 'arc'
  item: Event | Arc
} | null

type EditModalState = {
  type: 'event' | 'arc'
  item: Event | Arc
} | null

export function TimelineView() {
  const { data: events = [], isLoading: eventsLoading } = useEvents()
  const { data: arcs = [], isLoading: arcsLoading } = useArcs()
  const { sessionData } = useGlobalStore()
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [selectedArc, setSelectedArc] = useState<Arc | null>(null)

  // Context menu and modal state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>(null)
  const [editModal, setEditModal] = useState<EditModalState>(null)

  // Mutation hooks
  const deleteEventMutation = useDeleteEvent()
  const updateEventMutation = useUpdateEvent()
  const deleteArcMutation = useDeleteArc()
  const updateArcMutation = useUpdateArc()

  // Container ref for measuring available space
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 400 })

  // Measure container on mount and resize
  useEffect(() => {
    const measureContainer = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        // Leave some padding for the container's own padding (p-6 = 24px each side)
        const width = Math.max(600, rect.width - 48)
        const height = 400 // Fixed height for better visibility
        setDimensions({ width, height })
      }
    }

    // Measure after a short delay to ensure layout is complete
    const timeoutId = setTimeout(measureContainer, 0)

    // Observe resize
    const resizeObserver = new ResizeObserver(measureContainer)
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      clearTimeout(timeoutId)
      resizeObserver.disconnect()
    }
  }, [])

  const handleEventSelect = useCallback((event: Event) => {
    setSelectedEvent(event)
    setSelectedArc(null)
  }, [])

  const handleArcSelect = useCallback((arc: Arc) => {
    setSelectedArc(arc)
    setSelectedEvent(null)
  }, [])

  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    console.log('Time range changed:', range)
  }, [])

  const handleEventCreate = useCallback((timestamp: Date) => {
    console.log('Create event at:', timestamp)
  }, [])

  const handleEventDrag = useCallback((event: Event, newTimestamp: Date) => {
    console.log('Event dragged:', event.id, 'to:', newTimestamp)
  }, [])

  // Context menu handlers
  const handleEventContextMenu = useCallback((event: Event, position: { x: number; y: number }) => {
    setContextMenu({ type: 'event', item: event, position })
  }, [])

  const handleArcContextMenu = useCallback((arc: Arc, position: { x: number; y: number }) => {
    setContextMenu({ type: 'arc', item: arc, position })
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
      } else {
        await deleteArcMutation.mutateAsync(deleteConfirm.item.id)
      }
      setDeleteConfirm(null)
      // Clear selection if deleted item was selected
      if (deleteConfirm.type === 'event' && selectedEvent?.id === deleteConfirm.item.id) {
        setSelectedEvent(null)
      } else if (deleteConfirm.type === 'arc' && selectedArc?.id === deleteConfirm.item.id) {
        setSelectedArc(null)
      }
    } catch (error) {
      console.error('Failed to delete:', error)
    }
  }, [deleteConfirm, deleteEventMutation, deleteArcMutation, selectedEvent, selectedArc])

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

  // Save arc changes
  const handleArcSave = useCallback(async (updates: any) => {
    if (editModal?.type === 'arc') {
      await updateArcMutation.mutateAsync({
        id: editModal.item.id,
        data: updates
      })
      setEditModal(null)
    }
  }, [editModal, updateArcMutation])

  // Delete arc from modal
  const handleArcDelete = useCallback(async () => {
    if (editModal?.type === 'arc') {
      await deleteArcMutation.mutateAsync(editModal.item.id)
      setEditModal(null)
      if (selectedArc?.id === editModal.item.id) {
        setSelectedArc(null)
      }
    }
  }, [editModal, deleteArcMutation, selectedArc])

  // Close edit modal
  const handleEditModalClose = useCallback(() => {
    setEditModal(null)
  }, [])

  if (eventsLoading || arcsLoading) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
            <div className="h-96 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  const isDeleting = deleteEventMutation.isPending || deleteArcMutation.isPending

  return (
    <div className="space-y-6">
      <div ref={containerRef} className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-gray-900">Timeline View</h2>
          <div className="text-sm text-gray-500">
            {events.length} events, {arcs.length} arcs
          </div>
        </div>

        <div className="mb-4">
          <Timeline
            events={events}
            arcs={arcs}
            width={dimensions.width}
            height={dimensions.height}
            fitToViewTrigger={sessionData.viewportState.timeline.fitToViewTrigger}
            onEventSelect={handleEventSelect}
            onArcSelect={handleArcSelect}
            onTimeRangeChange={handleTimeRangeChange}
            onEventCreate={handleEventCreate}
            onEventDrag={handleEventDrag}
            onEventContextMenu={handleEventContextMenu}
            onArcContextMenu={handleArcContextMenu}
          />
        </div>

        {/* Selection info panel */}
        {(selectedEvent || selectedArc) && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            {selectedEvent && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Selected Event</h3>
                <p><strong>Description:</strong> {selectedEvent.description}</p>
                <p><strong>Actor:</strong> {selectedEvent.actor}</p>
                <p><strong>Target:</strong> {selectedEvent.target}</p>
                <p><strong>Timestamp:</strong> {new Date(selectedEvent.timestamp).toLocaleString()}</p>
              </div>
            )}
            {selectedArc && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Selected Arc</h3>
                <p><strong>Name:</strong> {selectedArc.name}</p>
                <p><strong>Description:</strong> {selectedArc.description}</p>
                <p><strong>Start:</strong> {new Date(selectedArc.start_time).toLocaleString()}</p>
                <p><strong>End:</strong> {new Date(selectedArc.end_time).toLocaleString()}</p>
              </div>
            )}
          </div>
        )}
      </div>

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
          title={`Delete ${deleteConfirm.type === 'event' ? 'Event' : 'Arc'}`}
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

      {/* Arc Edit Panel */}
      {editModal?.type === 'arc' && (
        <ArcDetailPanel
          arc={editModal.item as Arc}
          isOpen={true}
          onClose={handleEditModalClose}
          onSave={handleArcSave}
          onDelete={handleArcDelete}
        />
      )}
    </div>
  )
}
