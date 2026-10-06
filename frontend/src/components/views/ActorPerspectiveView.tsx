import { useState, useCallback, useMemo } from 'react'
import { ActorTimeline } from '@/components/timeline/ActorTimeline'
import { ActorSelector } from '@/components/actor/ActorSelector'
import { ActorStats } from '@/components/actor/ActorStats'
import { useEvents } from '@/hooks/useEvents'
import { useArcs } from '@/hooks/useArcs'
import { useGlobalStore } from '@/stores/globalStore'
import { filterArcs, filterEvents } from '@/components/filters/filterUtils'
import { Event, Arc, TimeRange } from '@/types'

export interface ActorPerspectiveViewProps {
  className?: string
}

export interface ActorEventData extends Event {
  role: 'actor' | 'target'
  isHighlighted: boolean
}

export interface ActorStats {
  eventCount: number
  timeSpan: { start: Date; end: Date } | null
  relationshipMetrics: {
    asActor: number
    asTarget: number
    uniqueTargets: number
    uniqueActors: number
  }
}

export function ActorPerspectiveView({ className = '' }: ActorPerspectiveViewProps) {
  const { data: fetchedEvents = [], isLoading: eventsLoading } = useEvents()
  const { data: fetchedArcs = [], isLoading: arcsLoading } = useArcs()
  const { activeFilters } = useGlobalStore()

  // Apply the global filters client-side (see filterUtils for why). The actor
  // list is derived from the unfiltered events so filters do not remove the
  // option to select an actor.
  const allEvents = useMemo(
    () => filterEvents(fetchedEvents, activeFilters),
    [fetchedEvents, activeFilters]
  )
  const allArcs = useMemo(
    () => filterArcs(fetchedArcs, activeFilters),
    [fetchedArcs, activeFilters]
  )
  
  const [selectedActor, setSelectedActor] = useState<string>('')
  const [layoutMode, setLayoutMode] = useState<'chronological' | 'thematic'>('chronological')
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)

  // Get all unique actors from events
  const availableActors = useMemo(() => {
    const actorSet = new Set<string>()
    fetchedEvents.forEach(event => {
      actorSet.add(event.actor)
      actorSet.add(event.target)
    })
    return Array.from(actorSet).sort()
  }, [fetchedEvents])

  // Filter events for selected actor
  const actorEvents = useMemo((): ActorEventData[] => {
    if (!selectedActor) return []
    
    return allEvents
      .filter(event => event.actor === selectedActor || event.target === selectedActor)
      .map(event => ({
        ...event,
        role: event.actor === selectedActor ? 'actor' as const : 'target' as const,
        isHighlighted: false
      }))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  }, [allEvents, selectedActor])

  // Filter arcs that contain actor events
  const relevantArcs = useMemo((): Arc[] => {
    if (!selectedActor || actorEvents.length === 0) return []
    
    const actorEventTimes = actorEvents.map(e => new Date(e.timestamp).getTime())
    const minTime = Math.min(...actorEventTimes)
    const maxTime = Math.max(...actorEventTimes)
    
    return allArcs.filter(arc => {
      const arcStart = new Date(arc.start_time).getTime()
      const arcEnd = new Date(arc.end_time).getTime()
      
      // Include arc if it overlaps with actor's event timespan
      return arcStart <= maxTime && arcEnd >= minTime
    })
  }, [allArcs, selectedActor, actorEvents])

  // Calculate actor statistics
  const actorStats = useMemo((): ActorStats => {
    if (!selectedActor || actorEvents.length === 0) {
      return {
        eventCount: 0,
        timeSpan: null,
        relationshipMetrics: {
          asActor: 0,
          asTarget: 0,
          uniqueTargets: 0,
          uniqueActors: 0
        }
      }
    }

    const asActorEvents = actorEvents.filter(e => e.role === 'actor')
    const asTargetEvents = actorEvents.filter(e => e.role === 'target')
    
    const uniqueTargets = new Set(asActorEvents.map(e => e.target)).size
    const uniqueActors = new Set(asTargetEvents.map(e => e.actor)).size
    
    const timestamps = actorEvents.map(e => new Date(e.timestamp).getTime())
    const timeSpan = timestamps.length > 0 ? {
      start: new Date(Math.min(...timestamps)),
      end: new Date(Math.max(...timestamps))
    } : null

    return {
      eventCount: actorEvents.length,
      timeSpan,
      relationshipMetrics: {
        asActor: asActorEvents.length,
        asTarget: asTargetEvents.length,
        uniqueTargets,
        uniqueActors
      }
    }
  }, [selectedActor, actorEvents])

  const handleActorSelect = useCallback((actor: string) => {
    // Preserve current state before switching
    if (selectedActor && selectedActor !== actor) {
      // Could save current state to session storage or global store here
      console.log(`Switching from ${selectedActor} to ${actor}`)
    }
    
    setSelectedActor(actor)
    setSelectedEvent(null) // Clear event selection when switching actors
  }, [selectedActor])

  const handleEventSelect = useCallback((event: Event) => {
    setSelectedEvent(event)
  }, [])

  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    console.log('Actor perspective time range changed:', range)
    // Could be used to filter events within the time range
  }, [])

  const handleLayoutModeChange = useCallback((mode: 'chronological' | 'thematic') => {
    setLayoutMode(mode)
  }, [])

  if (eventsLoading || arcsLoading) {
    return (
      <div className={`space-y-6 ${className}`}>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
            <div className="h-12 bg-gray-200 rounded mb-4"></div>
            <div className="h-96 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header with actor selection */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Actor Perspective View</h2>
            <p className="text-gray-600">
              Explore events and relationships from a specific actor's perspective
            </p>
          </div>
          
          {/* Layout mode toggle */}
          {selectedActor && (
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-600">Layout:</span>
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => handleLayoutModeChange('chronological')}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    layoutMode === 'chronological'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Chronological
                </button>
                <button
                  onClick={() => handleLayoutModeChange('thematic')}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    layoutMode === 'thematic'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Thematic
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Actor selector */}
        <ActorSelector
          actors={availableActors}
          selectedActor={selectedActor}
          onActorSelect={handleActorSelect}
          className="mb-6"
        />

        {/* Actor statistics */}
        {selectedActor && (
          <div className="transition-all duration-300 ease-in-out">
            <ActorStats
              actor={selectedActor}
              stats={actorStats}
              className="mb-6"
            />
          </div>
        )}
      </div>

      {/* Actor timeline visualization */}
      {selectedActor && actorEvents.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 transition-all duration-300 ease-in-out">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900 transition-colors duration-200">
              Timeline for {selectedActor}
            </h3>
            <div className="text-sm text-gray-500 transition-opacity duration-200">
              {actorEvents.length} events across {relevantArcs.length} arcs
            </div>
          </div>

          <div className="transition-all duration-500 ease-in-out">
            <ActorTimeline
              events={actorEvents}
              arcs={relevantArcs}
              actor={selectedActor}
              layoutMode={layoutMode}
              width={800}
              height={400}
              onEventSelect={handleEventSelect}
              onTimeRangeChange={handleTimeRangeChange}
              className="w-full"
            />
          </div>

          {/* Selected event details */}
          {selectedEvent && (
            <div className="mt-6 p-4 bg-gray-50 rounded-lg transition-all duration-300 ease-in-out transform">
              <h4 className="font-semibold text-gray-900 mb-2">Selected Event</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p><strong>Description:</strong> {selectedEvent.description}</p>
                  <p><strong>Timestamp:</strong> {new Date(selectedEvent.timestamp).toLocaleString()}</p>
                </div>
                <div>
                  <p><strong>Actor:</strong> {selectedEvent.actor}</p>
                  <p><strong>Target:</strong> {selectedEvent.target}</p>
                  <p>
                    <strong>Role:</strong> 
                    <span className={`ml-1 px-2 py-1 rounded-full text-xs transition-colors duration-200 ${
                      selectedEvent.actor === selectedActor
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-green-100 text-green-800'
                    }`}>
                      {selectedEvent.actor === selectedActor ? 'Actor' : 'Target'}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {selectedActor && actorEvents.length === 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-center py-12">
            <div className="text-gray-400 mb-4">
              <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Events Found</h3>
            <p className="text-gray-600">
              No events found for actor "{selectedActor}". Try selecting a different actor.
            </p>
          </div>
        </div>
      )}

      {/* No actor selected state */}
      {!selectedActor && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-center py-12">
            <div className="text-gray-400 mb-4">
              <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Select an Actor</h3>
            <p className="text-gray-600">
              Choose an actor from the dropdown above to view their timeline perspective.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}