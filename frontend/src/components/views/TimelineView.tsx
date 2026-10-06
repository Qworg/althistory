import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Timeline } from '@/components/timeline/Timeline'
import { useEvents } from '@/hooks/useEvents'
import { useArcs } from '@/hooks/useArcs'
import {
  useCreateEvent,
  useDeleteEvent,
  useUpdateEvent,
  useDeleteArc,
  useUpdateArc,
} from '@/hooks/useAPI'
import { useGlobalStore } from '@/stores/globalStore'
import { filterArcs, filterEvents } from '@/components/filters/filterUtils'
import { Event, Arc, TimeRange } from '@/types'
import { ContextMenu, ConfirmDialog } from '@/components/ui'
import { EventDetailModal, ArcDetailPanel } from '@/components/modals'
import {
  findExcludedContainedEvents,
  findExcludedContainingArcs,
  findExcludedChildArcs,
  findEscapedParentArc,
} from './timelineInteractionUtils'
import type { UpdateArcRequest } from '@/types'

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Unknown error'
}

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
  const { data: fetchedEvents = [], isLoading: eventsLoading } = useEvents()
  const { data: fetchedArcs = [], isLoading: arcsLoading } = useArcs()
  const { sessionData, activeFilters, addError } = useGlobalStore()

  // The backend event/arc routes do not accept the UI's filter vocabulary (see
  // filterUtils), so the active filters are applied to the fetched collections.
  const events = useMemo(
    () => filterEvents(fetchedEvents, activeFilters),
    [fetchedEvents, activeFilters]
  )
  const arcs = useMemo(
    () => filterArcs(fetchedArcs, activeFilters),
    [fetchedArcs, activeFilters]
  )
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [selectedArc, setSelectedArc] = useState<Arc | null>(null)

  // Context menu and modal state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>(null)
  const [editModal, setEditModal] = useState<EditModalState>(null)

  // The timeline double-click opens the create flow prefilled with the clicked
  // time. Arc expansion is owned entirely by Timeline (it drives which
  // descendants enter the rendered hierarchy), so this view keeps no mirror of
  // it -- a second copy here would be state nothing reads.
  const [createTimestamp, setCreateTimestamp] = useState<Date | null>(null)

  // Mutation hooks
  const deleteEventMutation = useDeleteEvent()
  const updateEventMutation = useUpdateEvent()
  const createEventMutation = useCreateEvent()
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
    setCreateTimestamp(timestamp)
  }, [])

  const handleCreateEventSave = useCallback(async (eventData: Partial<Event>) => {
    try {
      await createEventMutation.mutateAsync({
        description: eventData.description ?? '',
        actor: eventData.actor ?? '',
        target: eventData.target ?? '',
        timestamp: eventData.timestamp ?? createTimestamp?.toISOString() ?? new Date().toISOString(),
      })
      setCreateTimestamp(null)
    } catch (error) {
      addError({
        type: 'network',
        message: `Failed to create event: ${describeError(error)}`,
      })
      // Re-throw so the modal keeps itself open and shows its inline message.
      throw error
    }
  }, [createEventMutation, createTimestamp, addError])

  const handleEventDrag = useCallback(async (event: Event, newTimestamp: Date) => {
    // Reject rather than save-with-warning: arc membership is derived purely
    // from time bounds and events carry no explicit arc id, so a saved retime
    // that leaves an arc silently rewrites which arc contains the event with no
    // record of intent. Reassignment has its own explicit flow, so drag stays a
    // within-arc operation; the constraint is surfaced instead of written.
    const excludedArcs = findExcludedContainingArcs(event, newTimestamp, fetchedArcs)
    if (excludedArcs.length > 0) {
      addError({
        type: 'validation',
        message:
          `Cannot move "${event.description}" outside its containing ` +
          `${excludedArcs.length === 1 ? 'arc' : 'arcs'} ` +
          `${excludedArcs.map((arc) => `"${arc.name}"`).join(', ')}. ` +
          'The event was left unchanged.',
      })
      return
    }

    try {
      await updateEventMutation.mutateAsync({
        id: event.id,
        data: { timestamp: newTimestamp.toISOString() },
      })
    } catch (error) {
      addError({
        type: 'network',
        message: `Failed to move "${event.description}": ${describeError(error)}`,
      })
    }
  }, [fetchedArcs, updateEventMutation, addError])

  const handleArcResize = useCallback(async (arc: Arc, newBounds: { start: Date; end: Date }) => {
    if (newBounds.start.getTime() >= newBounds.end.getTime()) {
      addError({
        type: 'validation',
        message: `Cannot resize "${arc.name}": the end of the arc must be after its start. The arc was left unchanged.`,
      })
      return
    }

    const excludedEvents = findExcludedContainedEvents(arc, newBounds, fetchedEvents)
    if (excludedEvents.length > 0) {
      addError({
        type: 'validation',
        message:
          `Cannot shrink "${arc.name}": ${excludedEvents.length} contained ` +
          `${excludedEvents.length === 1 ? 'event' : 'events'} would fall outside the new range. ` +
          'The arc was left unchanged.',
      })
      return
    }

    // Hierarchy constraint, mirroring the event-in-arc rule above: a child arc
    // must stay inside its parent, and a parent must keep containing its
    // children. Reject rather than save-with-warning for the same reason drag
    // does -- a written resize would silently rewrite the hierarchy with no
    // record of intent -- and an empty violation list means the resize is valid.
    const escapedParent = findEscapedParentArc(arc, newBounds, fetchedArcs)
    const excludedChildren = findExcludedChildArcs(arc, newBounds, fetchedArcs)
    if (escapedParent || excludedChildren.length > 0) {
      const violations: string[] = []
      if (escapedParent) {
        violations.push(`it would extend outside its parent arc "${escapedParent.name}"`)
      }
      if (excludedChildren.length > 0) {
        violations.push(
          `it would no longer contain child ` +
            `${excludedChildren.length === 1 ? 'arc' : 'arcs'} ` +
            excludedChildren.map((child) => `"${child.name}"`).join(', ')
        )
      }
      addError({
        type: 'validation',
        message: `Cannot resize "${arc.name}": ${violations.join(' and ')}. The arc was left unchanged.`,
      })
      return
    }

    try {
      await updateArcMutation.mutateAsync({
        id: arc.id,
        data: {
          start_time: newBounds.start.toISOString(),
          end_time: newBounds.end.toISOString(),
        },
      })
    } catch (error) {
      addError({
        type: 'network',
        message: `Failed to resize "${arc.name}": ${describeError(error)}`,
      })
    }
  }, [fetchedEvents, fetchedArcs, updateArcMutation, addError])

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
      addError({
        type: 'network',
        message: `Failed to delete ${deleteConfirm.type}: ${describeError(error)}`,
      })
    }
  }, [deleteConfirm, deleteEventMutation, deleteArcMutation, selectedEvent, selectedArc, addError])

  // Cancel delete
  const handleDeleteCancel = useCallback(() => {
    setDeleteConfirm(null)
  }, [])

  // Save event changes
  const handleEventSave = useCallback(async (updates: Partial<Event>) => {
    if (editModal?.type === 'event') {
      try {
        await updateEventMutation.mutateAsync({
          id: editModal.item.id,
          data: updates
        })
        setEditModal(null)
      } catch (error) {
        addError({
          type: 'network',
          message: `Failed to save event: ${describeError(error)}`,
        })
        throw error
      }
    }
  }, [editModal, updateEventMutation, addError])

  // Delete event from modal
  const handleEventDelete = useCallback(async () => {
    if (editModal?.type === 'event') {
      try {
        await deleteEventMutation.mutateAsync(editModal.item.id)
        setEditModal(null)
        if (selectedEvent?.id === editModal.item.id) {
          setSelectedEvent(null)
        }
      } catch (error) {
        addError({
          type: 'network',
          message: `Failed to delete event: ${describeError(error)}`,
        })
        throw error
      }
    }
  }, [editModal, deleteEventMutation, selectedEvent, addError])

  // Save arc changes
  const handleArcSave = useCallback(async (updates: UpdateArcRequest) => {
    if (editModal?.type === 'arc') {
      try {
        await updateArcMutation.mutateAsync({
          id: editModal.item.id,
          data: updates
        })
        setEditModal(null)
      } catch (error) {
        addError({
          type: 'network',
          message: `Failed to save arc: ${describeError(error)}`,
        })
        throw error
      }
    }
  }, [editModal, updateArcMutation, addError])

  // Delete arc from modal
  const handleArcDelete = useCallback(async () => {
    if (editModal?.type === 'arc') {
      try {
        await deleteArcMutation.mutateAsync(editModal.item.id)
        setEditModal(null)
        if (selectedArc?.id === editModal.item.id) {
          setSelectedArc(null)
        }
      } catch (error) {
        addError({
          type: 'network',
          message: `Failed to delete arc: ${describeError(error)}`,
        })
        throw error
      }
    }
  }, [editModal, deleteArcMutation, selectedArc, addError])

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
            onArcResize={handleArcResize}
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

      {/* Create Event Modal (opened by double-clicking the timeline) */}
      {createTimestamp && (
        <EventDetailModal
          event={null}
          isOpen={true}
          initialTimestamp={createTimestamp.toISOString()}
          onClose={() => setCreateTimestamp(null)}
          onSave={handleCreateEventSave}
        />
      )}
    </div>
  )
}
