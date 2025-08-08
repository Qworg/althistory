import { useState, useCallback } from 'react'
import { Timeline } from '@/components/timeline/Timeline'
import { useEvents } from '@/hooks/useEvents'
import { useArcs } from '@/hooks/useArcs'
import { Event, Arc, TimeRange } from '@/types'

export function TimelineView() {
  const { data: events = [], isLoading: eventsLoading } = useEvents()
  const { data: arcs = [], isLoading: arcsLoading } = useArcs()
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [selectedArc, setSelectedArc] = useState<Arc | null>(null)

  const handleEventSelect = useCallback((event: Event) => {
    setSelectedEvent(event)
    setSelectedArc(null)
    console.log('Event selected:', event)
  }, [])

  const handleArcSelect = useCallback((arc: Arc) => {
    setSelectedArc(arc)
    setSelectedEvent(null)
    console.log('Arc selected:', arc)
  }, [])

  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    console.log('Time range changed:', range)
    // This could trigger data refetching for the new time range
  }, [])

  const handleEventCreate = useCallback((timestamp: Date) => {
    console.log('Create event at:', timestamp)
    // This would open a modal or form to create a new event
  }, [])

  const handleEventDrag = useCallback((event: Event, newTimestamp: Date) => {
    console.log('Event dragged:', event.id, 'to:', newTimestamp)
    // This would update the event timestamp via API
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

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
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
            width={800}
            height={400}
            onEventSelect={handleEventSelect}
            onArcSelect={handleArcSelect}
            onTimeRangeChange={handleTimeRangeChange}
            onEventCreate={handleEventCreate}
            onEventDrag={handleEventDrag}
            className="w-full"
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
    </div>
  )
}