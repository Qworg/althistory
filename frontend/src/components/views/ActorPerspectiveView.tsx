import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { ActorTimeline } from '@/components/timeline/ActorTimeline'
import { ActorSelector } from '@/components/actor/ActorSelector'
import { ActorStats } from '@/components/actor/ActorStats'
import { useEvents, VIEW_EVENT_LIMIT } from '@/hooks/useEvents'
import { ViewLoadError, SlowLoadNotice } from './ViewLoadState'
import { useSlowLoading } from '@/hooks/useSlowLoading'
import { EmptyGraphState } from './EmptyGraphState'
import { eventYear } from '@/components/causal-graph/causalGraphPresentation'
import { useArcs } from '@/hooks/useArcs'
import { useGlobalStore } from '@/stores/globalStore'
import { filterArcs, filterEvents } from '@/components/filters/filterUtils'
import { Event, Arc } from '@/types'
import { formatHistoricalTimestamp } from '@/utils/historicalTime'

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

/** How many actors the opening list shows; the picker holds the rest. */
const ACTOR_INDEX_LIMIT = 12

export function ActorPerspectiveView({ className = '' }: ActorPerspectiveViewProps) {
  const eventsQuery = useEvents({ limit: VIEW_EVENT_LIMIT })
  const arcsQuery = useArcs()
  const { data: fetchedEvents = [], isLoading: eventsLoading } = eventsQuery
  const { data: fetchedArcs = [], isLoading: arcsLoading } = arcsQuery
  const loadFailure = eventsQuery.isError
    ? { what: 'this graph’s events', error: eventsQuery.error }
    : arcsQuery.isError
    ? { what: 'this graph’s arcs', error: arcsQuery.error }
    : null
  const retryLoad = () => {
    void eventsQuery.refetch()
    void arcsQuery.refetch()
  }
  const loadIsSlow = useSlowLoading(eventsLoading || arcsLoading)
  const { activeFilters, sessionData, updateSessionData } = useGlobalStore()

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
  const [localLayoutMode, setLocalLayoutMode] = useState<'chronological' | 'thematic'>('chronological')
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const timelineContainerRef = useRef<HTMLDivElement>(null)
  const [timelineWidth, setTimelineWidth] = useState<number>(800)

  const layoutMode = sessionData?.viewportState?.actorPerspective?.layout ?? localLayoutMode
  const showStats = sessionData?.viewportState?.actorPerspective?.showStats ?? true

  useEffect(() => {
    const measure = () => {
      const container = timelineContainerRef.current
      if (container) {
        const rect = container.getBoundingClientRect()
        if (rect.width > 0) {
          // The card's padding changes with the breakpoint, so read it.
          const style = window.getComputedStyle(container)
          const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
          setTimelineWidth(Math.max(300, Math.floor(rect.width - padding)))
        }
      }
    }
    const timeoutId = setTimeout(measure, 0)
    const observer = new ResizeObserver(measure)
    if (timelineContainerRef.current) {
      observer.observe(timelineContainerRef.current)
    }
    return () => {
      clearTimeout(timeoutId)
      observer.disconnect()
    }
  }, [selectedActor])

  /**
   * The event that was selected under each actor.
   *
   * Switching actor used to clear the selection for good, so going back to an
   * actor started from nothing. The selection is remembered per actor and
   * restored when the actor is chosen again; it is derived from what has been
   * selected, so it never holds an event that was not chosen.
   */
  const [selectionByActor, setSelectionByActor] = useState<Record<string, string>>({})

  // Get all unique actors from events
  const availableActors = useMemo(() => {
    const actorSet = new Set<string>()
    fetchedEvents.forEach(event => {
      actorSet.add(event.actor)
      actorSet.add(event.target)
    })
    return Array.from(actorSet).sort()
  }, [fetchedEvents])

  // Every actor (or target) with how many events involve it and the years
  // they span, most involved first: what the view lists before one is chosen.
  const actorIndex = useMemo(() => {
    const byName = new Map<string, { count: number; first: number; last: number }>()
    for (const event of fetchedEvents) {
      const time = new Date(event.timestamp).getTime()
      for (const name of new Set([event.actor, event.target])) {
        if (!name) continue
        const entry = byName.get(name)
        if (entry) {
          entry.count += 1
          entry.first = Math.min(entry.first, time)
          entry.last = Math.max(entry.last, time)
        } else {
          byName.set(name, { count: 1, first: time, last: time })
        }
      }
    }
    return Array.from(byName, ([name, { count, first, last }]) => {
      const from = eventYear(new Date(first))
      const to = eventYear(new Date(last))
      return { name, count, span: from === to ? from : `${from}–${to}` }
    }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
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
    // Choosing the actor that is already selected is not a switch: the
    // selection must survive it. The selector does call back on a re-pick, and
    // restoring from the remembered map there would replace the current
    // selection with a stale one.
    if (actor === selectedActor) return

    // Remember what was selected under the actor being left.
    if (selectedActor && selectedEvent) {
      setSelectionByActor((remembered) => ({
        ...remembered,
        [selectedActor]: selectedEvent.id,
      }))
    }

    // Restore what was selected under the actor being entered, if it is still
    // an event of that actor.
    const rememberedId = selectionByActor[actor]
    const restored = rememberedId
      ? allEvents.find((event) => event.id === rememberedId) ?? null
      : null
    setSelectedEvent(restored)

    setSelectedActor(actor)
  }, [selectedActor, selectedEvent, selectionByActor, allEvents])

  const handleEventSelect = useCallback((event: Event) => {
    setSelectedEvent(event)
  }, [])

  const handleLayoutModeChange = useCallback((mode: 'chronological' | 'thematic') => {
    setLocalLayoutMode(mode)
    if (updateSessionData && sessionData?.viewportState) {
      updateSessionData({
        viewportState: {
          ...sessionData.viewportState,
          actorPerspective: {
            layout: mode,
            showStats
          }
        }
      })
    }
  }, [updateSessionData, sessionData, showStats])

  if (loadFailure && !eventsLoading && !arcsLoading) {
    return (
      <div className={`space-y-6 ${className}`}>
        <div className="bg-card border border-line rounded-lg shadow-sm p-6">
          <ViewLoadError
            what={loadFailure.what}
            error={loadFailure.error}
            onRetry={retryLoad}
            isRetrying={eventsQuery.isFetching || arcsQuery.isFetching}
          />
        </div>
      </div>
    )
  }

  if (eventsLoading || arcsLoading) {
    return (
      <div className={`space-y-6 ${className}`}>
        <div className="bg-card border border-line rounded-lg shadow-sm p-6" aria-busy="true">
          <span className="sr-only">Loading actors</span>
          <div className="animate-pulse">
            <div className="h-8 bg-subtle rounded w-1/3 mb-4"></div>
            <div className="h-12 bg-subtle rounded mb-4"></div>
            <div className="h-96 bg-subtle rounded"></div>
          </div>
          {loadIsSlow && <SlowLoadNotice onRetry={retryLoad} />}
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header with actor selection */}
      <div className="bg-card border border-line rounded-lg shadow-sm p-4 sm:p-6">
        <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
          <div>
            {/* The breadcrumb and the navigation already name the view. */}
            <h2 className="sr-only">Actor Perspective</h2>
            {/* One line, for the input in use; the keys are in Help (?). */}
            <p className="text-xs text-ink-muted">
              Pick an actor, then select a mark to inspect it
              <span className="[@media(pointer:coarse)]:hidden"> · C and T switch the layout, S the statistics</span>
            </p>
          </div>
          
          {/* The one layout switch for this view (the toolbar's C and T keys
              drive the same session state). */}
          {selectedActor && (
            <div className="flex items-center space-x-2">
              <span className="text-sm text-ink-secondary">Layout:</span>
              <div className="flex bg-subtle border border-line rounded-lg p-1" role="group" aria-label="Actor timeline layout">
                <button
                  type="button"
                  onClick={() => handleLayoutModeChange('chronological')}
                  aria-pressed={layoutMode === 'chronological'}
                  aria-keyshortcuts="C"
                  title="Chronological layout (C)"
                  className={`px-3 py-1 min-h-9 text-sm rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-selected ${
                    layoutMode === 'chronological'
                      ? 'bg-card text-ink shadow-sm'
                      : 'text-ink-secondary hover:text-ink'
                  }`}
                >
                  Chronological
                </button>
                <button
                  type="button"
                  onClick={() => handleLayoutModeChange('thematic')}
                  aria-pressed={layoutMode === 'thematic'}
                  aria-keyshortcuts="T"
                  title="Thematic layout (T)"
                  className={`px-3 py-1 min-h-9 text-sm rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-selected ${
                    layoutMode === 'thematic'
                      ? 'bg-card text-ink shadow-sm'
                      : 'text-ink-secondary hover:text-ink'
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

      </div>

      {/* Actor timeline visualization */}
      {selectedActor && actorEvents.length > 0 && (
        <div ref={timelineContainerRef} className="bg-card border border-line rounded-lg shadow-sm p-4 sm:p-6">
          <div className="flex flex-wrap justify-between items-baseline gap-x-4 gap-y-1 mb-4">
            <h3 className="font-display text-xl font-semibold text-ink">
              Timeline for {selectedActor}
            </h3>
            {/* The figures that matter at a glance, in one line; the full
                statistics follow the timeline (the actor's history comes first). */}
            <div className="font-mono-code text-xs text-ink-muted">
              {actorEvents.length} {actorEvents.length === 1 ? 'event' : 'events'} · {actorStats.relationshipMetrics.asActor} as actor ·{' '}
              {actorStats.relationshipMetrics.asTarget} as target
              {actorStats.timeSpan && (
                <> · {actorStats.timeSpan.start.getUTCFullYear()}–{actorStats.timeSpan.end.getUTCFullYear()}</>
              )}
              {' '}· {relevantArcs.length} {relevantArcs.length === 1 ? 'arc' : 'arcs'}
            </div>
          </div>

          <div className="transition-all duration-500 ease-in-out overflow-x-auto">
            <ActorTimeline
              events={actorEvents}
              arcs={relevantArcs}
              actor={selectedActor}
              layoutMode={layoutMode}
              width={timelineWidth}
              height={340}
              onEventSelect={handleEventSelect}
              className="w-full"
            />
          </div>

          {/* Selected event details */}
          {selectedEvent && (
            <section
              aria-label="Selected event"
              className="mt-6 p-4 bg-subtle text-ink border border-selected/35 rounded-lg"
            >
              <h4 className="text-base font-semibold text-ink mb-2">Selected event</h4>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-ink-muted">Description</dt>
                  <dd className="text-ink">{selectedEvent.description}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-muted">Actor</dt>
                  <dd className="text-ink">{selectedEvent.actor}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-muted">Target</dt>
                  <dd className="text-ink">{selectedEvent.target}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-muted">Timestamp</dt>
                  <dd className="font-mono-code text-ink">{formatHistoricalTimestamp(selectedEvent.timestamp)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-muted">Role</dt>
                  <dd>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      selectedEvent.actor === selectedActor
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-green-100 text-green-800'
                    }`}>
                      {selectedEvent.actor === selectedActor ? 'Actor' : 'Target'}
                    </span>
                  </dd>
                </div>
              </dl>
            </section>
          )}
        </div>
      )}

      {/* Actor statistics, after the actor's timeline (S shows or hides them) */}
      {selectedActor && showStats && (
        <div className="bg-card border border-line rounded-lg shadow-sm p-4 sm:p-6">
          <ActorStats actor={selectedActor} stats={actorStats} />
        </div>
      )}

      {/* Empty state */}
      {selectedActor && actorEvents.length === 0 && (
        <div className="bg-card border border-line rounded-lg shadow-sm p-6">
          <div className="text-center py-12">
            <div className="text-ink-muted mb-4">
              <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="font-display text-xl font-semibold text-ink mb-2">No Events Found</h3>
            <p className="text-ink-secondary">
              No events found for actor "{selectedActor}". Try selecting a different actor.
            </p>
          </div>
        </div>
      )}

      {/* No actor selected: the actors themselves, most involved first, so
          the view opens on something to choose rather than an instruction. */}
      {!selectedActor && (
        <div className="bg-card border border-line rounded-lg shadow-sm p-4 sm:p-6">
          {actorIndex.length === 0 ? (
            <EmptyGraphState kind="empty" />
          ) : (
            <>
              <h3 className="font-display text-xl font-semibold text-ink">Actors in this graph</h3>
              <p className="mt-1 text-sm text-ink-secondary">
                Most involved first. Choose one to see its history from its side.
              </p>
              <ul className="mt-4 grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3" aria-label="Actors, most involved first">
                {actorIndex.slice(0, ACTOR_INDEX_LIMIT).map(entry => (
                  <li key={entry.name} className="border-b border-line last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0">
                    <button
                      type="button"
                      onClick={() => handleActorSelect(entry.name)}
                      className="group flex w-full items-baseline justify-between gap-3 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-selected rounded-sm"
                    >
                      <span className="min-w-0 truncate font-medium text-ink group-hover:text-baseline">{entry.name}</span>
                      <span className="shrink-0 font-mono-code text-xs text-ink-muted">
                        {entry.count} {entry.count === 1 ? 'event' : 'events'} · {entry.span}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {actorIndex.length > ACTOR_INDEX_LIMIT && (
                <p className="mt-3 text-sm text-ink-muted">
                  And {actorIndex.length - ACTOR_INDEX_LIMIT} more in the actor picker above.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}