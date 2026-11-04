import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Timeline } from '@/components/timeline/Timeline'
import { PressureExploration } from '@/components/timeline/PressureExploration'
import { usePressures } from '@/hooks/usePressures'
import { usePressureStore } from '@/stores/pressureStore'
import { PressureWithContext } from '@/types/pressure'
import { ViewLoadError, SlowLoadNotice } from './ViewLoadState'
import { useSlowLoading } from '@/hooks/useSlowLoading'
import { EmptyGraphState } from './EmptyGraphState'
import { useEvents, VIEW_EVENT_LIMIT as EVENT_LIMIT } from '@/hooks/useEvents'
import { useArcs } from '@/hooks/useArcs'
import {
  useDeleteEvent,
  useUpdateEvent,
  useDeleteArc,
  useUpdateArc,
  useCausalRelationships,
} from '@/hooks/useAPI'
import { useGlobalStore } from '@/stores/globalStore'
import { filterArcs, filterEvents, hasActiveFilters } from '@/components/filters/filterUtils'
import { Event, Arc } from '@/types'
import { ContextMenu, ConfirmDialog } from '@/components/ui'
import { EventDetailModal, ArcDetailPanel } from '@/components/modals'
import type { EventSaveExtras } from '@/components/modals/EventDetailModal'
import { useCreateEventWithCause } from '@/hooks/useCreateEventWithCause'
import { EventArcAssignment } from '@/components/timeline/EventArcAssignment'
import {
  findExcludedContainedEvents,
  findExcludedContainingArcs,
  findExcludedChildArcs,
  findEscapedParentArc,
} from './timelineInteractionUtils'
import type { UpdateArcRequest } from '@/types'
import { formatHistoricalDate, formatHistoricalTimestamp, formatEventDate } from '@/utils/historicalTime'
import { useEditHistory } from '@/hooks/useEditHistory'
import { useUndoableEventDelete } from '@/hooks/useUndoableEventDelete'
import { confidenceTier } from '@/components/timeline/confidenceTier'
import { editShortcutLabels } from '@/utils/platform'
import { shouldIgnoreAppShortcut } from '@/utils/keyboardShortcuts'
import { useActiveGraphId, useSwitchGraph } from '@/hooks/useGraphs'
import { useBranchDivergences } from '@/hooks/useBranchDivergences'
import { BranchFromEventDialog } from '@/components/graphs/BranchFromEventDialog'
import { timelineContentHeight } from '@/components/timeline/timelineLayout'
import { BranchComparisonModal } from '@/components/branch/BranchComparisonModal'
import { useBaselineGhost } from '@/hooks/useBaselineGhost'
import { EventCausesEffects } from '@/components/timeline/EventCausesEffects'
import { TimelineLegend } from '@/components/timeline/TimelineLegend'
import { computeRipple, RIPPLE_DEPTH, type TimelineLink } from '@/components/timeline/timelineLinks'
import {
  causesAndEffects,
  containingArcs,
  eventConfidence,
  eventSource,
} from '@/components/timeline/eventInspectorUtils'
import { Portal } from '@/components/ui/Portal'


function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Unknown error'
}

/**
 * A context menu that was opened, and what it was opened on.
 *
 * `type` and `item` are tied together: `type: 'event'` means `item` is an
 * `Event`. They used to be independent unions, which is why every consumer
 * had to cast and a mistake could not be caught.
 */
type ContextMenuState = (
  | { type: 'event'; item: Event; position: { x: number; y: number } }
  | { type: 'arc'; item: Arc; position: { x: number; y: number } }
) | null

type DeleteConfirmState = {
  type: 'event' | 'arc'
  item: Event | Arc
} | null

type EditModalState = {
  type: 'event' | 'arc'
  item: Event | Arc
} | null

export function TimelineView() {
  // The pressures are inferred over the graph's events (up to a thousand of
  // them), and the evidence of a pressure is joined against the events the
  // view holds. With the default fifty, the evidence of a larger graph was
  // dropped: the panel said "no evidence events" while the modal counted them.
  const eventsQuery = useEvents({ limit: EVENT_LIMIT })
  const arcsQuery = useArcs()
  const { data: fetchedEvents = [], isLoading: eventsLoading } = eventsQuery
  const { data: fetchedArcs = [], isLoading: arcsLoading } = arcsQuery
  // A failed request must not render as an empty history (see ViewLoadError).
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
  const { sessionData, activeFilters, addError, clearFilters } = useGlobalStore()

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
  const filtersActive = hasActiveFilters(activeFilters)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [selectedArc, setSelectedArc] = useState<Arc | null>(null)

  // A selection the filter has just hidden leaves the inspector: it would
  // otherwise describe a mark that is no longer on the canvas. (Only once it
  // is known to the graph, so a just-created event is not dropped mid-fetch.)
  useEffect(() => {
    if (
      selectedEvent &&
      fetchedEvents.some((e) => e.id === selectedEvent.id) &&
      !events.some((e) => e.id === selectedEvent.id)
    ) {
      setSelectedEvent(null)
    }
    if (
      selectedArc &&
      fetchedArcs.some((a) => a.id === selectedArc.id) &&
      !arcs.some((a) => a.id === selectedArc.id)
    ) {
      setSelectedArc(null)
    }
  }, [events, arcs, fetchedEvents, fetchedArcs, selectedEvent, selectedArc])

  // Context menu and modal state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>(null)
  const [editModal, setEditModal] = useState<EditModalState>(null)
  /**
   * The event whose arc assignment was asked for from the context menu.
   *
   * `Timeline` has a fallback assignment popup, but it only opens when no
   * context-menu handler is passed -- and this view always passes one, so in
   * the app that popup was unreachable. The action is offered here instead.
   */
  const [assignmentTarget, setAssignmentTarget] = useState<Event | null>(null)
  // The event a counterfactual branch would diverge from (Branch from this event)
  const [branchFromEvent, setBranchFromEvent] = useState<Event | null>(null)

  // The timeline double-click opens the create flow prefilled with the clicked
  // time. Arc expansion is owned entirely by Timeline (it drives which
  // descendants enter the rendered hierarchy), so this view keeps no mirror of
  // it -- a second copy here would be state nothing reads.
  const [createTimestamp, setCreateTimestamp] = useState<Date | null>(null)

  // On a branch, the baseline it was forked from is drawn behind it (the
  // Timeline's `ghost`), and the point of divergence is named under the title.
  // The divergence is measured over the unfiltered events (see the hook); the
  // ghost's marks follow the same filters as the branch's own.
  const baselineGhost = useBaselineGhost(fetchedEvents)
  const ghost = useMemo(
    () =>
      baselineGhost.ghost
        ? { ...baselineGhost.ghost, events: filterEvents(baselineGhost.ghost.events, activeFilters) }
        : undefined,
    [baselineGhost.ghost, activeFilters]
  )
  const [showBranchComparison, setShowBranchComparison] = useState(false)
  // Whether the filter panel is open: with it open, the empty selection rail
  // gives way (see reserveRail below).
  const filterPanelOpen = useGlobalStore((state) => state.uiState?.filterPanelOpen ?? false)


  // Where this history's own branches split off it: marked on the canvas and
  // listed (with a way in) under it. Measured over the unfiltered events, like
  // the ghost's divergence, so a filter cannot move a split.
  const branchDivergences = useBranchDivergences(fetchedEvents)
  const branchMarks = useMemo(
    () =>
      branchDivergences.flatMap(({ branch, label, date }) => (date ? [{ id: branch.id, label, date }] : [])),
    [branchDivergences]
  )
  const { mutate: openGraph, isPending: isOpeningGraph } = useSwitchGraph()

  // The causal links, for the inspector's causes and effects.
  const { data: relationships = [], isLoading: relationshipsLoading } = useCausalRelationships()

  // The pressures inferred over the graph. The timeline draws them as
  // indicators, and the exploration panel below is where they can be opened.
  //
  // The two halves share the exploration state (see `stores/pressureStore.ts`),
  // so clicking an indicator opens the panel on that pressure, and the panel's
  // evidence buttons reach the timeline.
  //
  // The arcs and events are passed in: the context that places a pressure in
  // time and links it to its evidence is built from them, and they are not in
  // the store (which only holds what this session wrote).
  const {
    visiblePressures,
    visualConfig,
    selectPressure,
    showEvidenceModalAction,
  } = usePressures(arcs, events, { scopeToEvents: filtersActive })

  // Clicking an indicator on the timeline opens the exploration panel on that
  // pressure. The indicator's tooltip promises it ("Click to explore evidence
  // and relationships"), and without this the click did nothing.
  const handlePressureSelect = useCallback(
    (pressure: PressureWithContext) => {
      selectPressure(pressure)
      showEvidenceModalAction(pressure)
    },
    [selectPressure, showEvidenceModalAction]
  )

  // The evidence of the selected pressure is highlighted on the timeline, so
  // the panel's "highlight evidence" button reaches the graph.
  const highlightedEventIds = usePressureStore(
    (state) => state.explorationState.highlightedEvidence
  )

  // The pressure kinds drawn on the arc bars, for the legend's key.
  const legendPressureTypes = useMemo(
    () =>
      visualConfig.showIndicators
        ? (['economic', 'social', 'political', 'environmental'] as const).filter((type) =>
            visiblePressures.some((pressure) => pressure.pressure_type === type)
          )
        : [],
    [visiblePressures, visualConfig.showIndicators]
  )

  const handlePressureEvidenceHighlight = useCallback((eventIds: Set<string>) => {
    usePressureStore.getState().setHighlightedEvidence(eventIds)
  }, [])

  // Mutation hooks
  const deleteEventMutation = useDeleteEvent()
  const updateEventMutation = useUpdateEvent()
  const createEventWithCause = useCreateEventWithCause()
  const deleteArcMutation = useDeleteArc()
  const updateArcMutation = useUpdateArc()

  // Container ref for measuring available space
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 240 })

  // Sized to its content: the timeline's own layout (arc rows from the top,
  // then three label rows and the event track, plus the divergence band and
  // the baseline lane when this graph is a branch). Height beyond that was an
  // empty band; the canvas grows itself when arcs are expanded.
  // The causal links as the canvas draws them: between events of this graph
  // that the filters left on screen.
  const timelineLinks = useMemo<TimelineLink[]>(() => {
    const visible = new Set(events.map((e) => e.id))
    return relationships
      .filter((r) => !r.isCrossGraph && visible.has(r.cause_event_id) && visible.has(r.effect_event_id))
      .map((r) => ({
        id: r.id,
        causeId: r.cause_event_id,
        effectId: r.effect_event_id,
        type: r.relationship_type,
        weight: r.weight,
      }))
  }, [relationships, events])

  // The link types and confidence tiers the canvas draws: the key lists only
  // what is there.
  const legendLinkTypes = useMemo(() => [...new Set(timelineLinks.map((link) => link.type))], [timelineLinks])
  const legendTiers = useMemo(() => {
    const present = new Set(events.map((event) => confidenceTier(eventConfidence(event))))
    return (['firm', 'probable', 'speculative'] as const).filter((tier) => present.has(tier))
  }, [events])


  const dynamicHeight = useMemo(
    () =>
      timelineContentHeight(arcs, {
        ghost: Boolean(ghost),
        divergence: Boolean(ghost?.divergence),
        links: timelineLinks.length > 0,
      }),
    [arcs, ghost, timelineLinks.length]
  )

  // Measure the card on mount and resize. The card only exists once loading
  // has finished (the skeleton has no ref), so the effect must re-run then:
  // keyed on dynamicHeight alone, a graph whose arc depth did not change the
  // height left the observer attached to nothing and the canvas at its 800px
  // default, overflowing a narrower card.
  const viewIsLoading = eventsLoading || arcsLoading
  useEffect(() => {
    const measureContainer = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        // The card's real content box: its padding differs by breakpoint, and a
        // fixed 600px floor overflowed the card on a phone (the SVG was clipped).
        const style = window.getComputedStyle(containerRef.current)
        const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
        const width = Math.max(280, Math.floor(rect.width - padding))
        setDimensions({ width, height: dynamicHeight })
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
  }, [dynamicHeight, viewIsLoading])

  const handleEventSelect = useCallback((event: Event) => {
    setSelectedEvent(event)
    setSelectedArc(null)
  }, [])

  const handleArcSelect = useCallback((arc: Arc) => {
    setSelectedArc(arc)
    setSelectedEvent(null)
  }, [])

  // Escape clears the inspector's selection, and with it the ripple trace.
  // (The marks stop Escape themselves while one has focus: there it returns
  // focus to the canvas first.)
  const hasInspectorSelection = Boolean(selectedEvent || selectedArc)
  useEffect(() => {
    if (!hasInspectorSelection) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || shouldIgnoreAppShortcut(event)) return
      setSelectedEvent(null)
      setSelectedArc(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [hasInspectorSelection])

  // The inspector reads the selected event as it is now, not the snapshot
  // taken when it was clicked, so an edit shows without reselecting.
  const inspectedEvent = useMemo(
    () => (selectedEvent ? fetchedEvents.find((e) => e.id === selectedEvent.id) ?? selectedEvent : null),
    [selectedEvent, fetchedEvents]
  )
  const inspector = useMemo(() => {
    if (!inspectedEvent) return null
    return {
      confidence: eventConfidence(inspectedEvent),
      arcs: containingArcs(inspectedEvent, fetchedArcs),
      source: eventSource(inspectedEvent),
      ...causesAndEffects(inspectedEvent.id, relationships, fetchedEvents),
    }
  }, [inspectedEvent, fetchedArcs, fetchedEvents, relationships])

  // How far the selection's consequences reach (the canvas traces the same).
  const rippleReach = useMemo(
    () => (inspectedEvent ? computeRipple(inspectedEvent.id, timelineLinks).effects.size : 0),
    [inspectedEvent, timelineLinks]
  )

  const handleEventCreate = useCallback((timestamp: Date) => {
    setCreateTimestamp(timestamp)
  }, [])

  const handleCreateEventSave = useCallback(async (eventData: Partial<Event>, extras?: EventSaveExtras) => {
    try {
      const outcome = await createEventWithCause(
        {
          description: eventData.description ?? '',
          actor: eventData.actor ?? '',
          target: eventData.target ?? '',
          timestamp: eventData.timestamp ?? createTimestamp?.toISOString() ?? new Date().toISOString(),
          ...(eventData.metadata && Object.keys(eventData.metadata).length > 0 ? { metadata: eventData.metadata } : {}),
        },
        extras
      )
      if (outcome.status === 'queued' && outcome.linkSkipped) {
        addError({
          type: 'network',
          message: 'You are offline: the event is queued, but its cause link was not made. Link it once you are back online.',
        })
      }
      setCreateTimestamp(null)
    } catch (error) {
      addError({
        type: 'network',
        message: `Failed to create event: ${describeError(error)}`,
      })
      // Re-throw so the modal keeps itself open and shows its inline message.
      throw error
    }
  }, [createEventWithCause, createTimestamp, addError])

  // Guardrails, read through refs so the drag preview, the commit, and an
  // undo/redo issued later all judge against the current graph -- not the one
  // captured when the edit was first made.
  const fetchedEventsRef = useRef(fetchedEvents)
  fetchedEventsRef.current = fetchedEvents
  const fetchedArcsRef = useRef(fetchedArcs)
  fetchedArcsRef.current = fetchedArcs

  /**
   * Why moving `event` to `newTimestamp` would be refused, or null.
   *
   * Reject rather than save-with-warning: arc membership is derived purely
   * from time bounds and events carry no explicit arc id, so a saved retime
   * that leaves an arc silently rewrites which arc contains the event with no
   * record of intent. Reassignment has its own explicit flow, so drag stays a
   * within-arc operation; the constraint is surfaced instead of written.
   */
  const eventMoveViolation = useCallback((event: Event, newTimestamp: Date): string | null => {
    const excludedArcs = findExcludedContainingArcs(event, newTimestamp, fetchedArcsRef.current)
    if (excludedArcs.length === 0) return null
    return (
      `outside its containing ${excludedArcs.length === 1 ? 'arc' : 'arcs'} ` +
      excludedArcs.map((arc) => `"${arc.name}"`).join(', ')
    )
  }, [])

  /** Why resizing `arc` to `newBounds` would be refused, or null. */
  const arcResizeViolation = useCallback(
    (arc: Arc, newBounds: { start: Date; end: Date }): { verb: 'resize' | 'shrink'; reason: string } | null => {
      if (newBounds.start.getTime() >= newBounds.end.getTime()) {
        return { verb: 'resize', reason: 'the end of the arc must be after its start' }
      }

      const excludedEvents = findExcludedContainedEvents(arc, newBounds, fetchedEventsRef.current)
      if (excludedEvents.length > 0) {
        return {
          verb: 'shrink',
          reason:
            `${excludedEvents.length} contained ` +
            `${excludedEvents.length === 1 ? 'event' : 'events'} would fall outside the new range`,
        }
      }

      // Hierarchy constraint, mirroring the event-in-arc rule above: a child arc
      // must stay inside its parent, and a parent must keep containing its
      // children. Reject rather than save-with-warning for the same reason drag
      // does -- a written resize would silently rewrite the hierarchy with no
      // record of intent -- and an empty violation list means the resize is valid.
      const escapedParent = findEscapedParentArc(arc, newBounds, fetchedArcsRef.current)
      const excludedChildren = findExcludedChildArcs(arc, newBounds, fetchedArcsRef.current)
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
        return { verb: 'resize', reason: violations.join(' and ') }
      }
      return null
    },
    []
  )

  // The same rules, phrased for the live drag preview (shown before release).
  const previewEventDragViolation = useCallback((event: Event, newTimestamp: Date) => {
    const reason = eventMoveViolation(event, newTimestamp)
    return reason ? `Will be refused: ${reason}` : null
  }, [eventMoveViolation])

  const previewArcResizeViolation = useCallback((arc: Arc, newBounds: { start: Date; end: Date }) => {
    const violation = arcResizeViolation(arc, newBounds)
    return violation ? `Will be refused: ${violation.reason}` : null
  }, [arcResizeViolation])

  /** Validate and persist an event's new time; resolves to whether it was written. */
  const moveEvent = useCallback(async (event: Event, newTimestamp: Date): Promise<boolean> => {
    const reason = eventMoveViolation(event, newTimestamp)
    if (reason) {
      addError({
        type: 'validation',
        message: `Cannot move "${event.description}" ${reason}. The event was left unchanged.`,
      })
      return false
    }
    try {
      await updateEventMutation.mutateAsync({
        id: event.id,
        data: { timestamp: newTimestamp.toISOString() },
      })
      return true
    } catch (error) {
      addError({
        type: 'network',
        message: `Failed to move "${event.description}": ${describeError(error)}`,
      })
      return false
    }
  }, [eventMoveViolation, updateEventMutation, addError])

  /** Validate and persist an arc's new bounds; resolves to whether it was written. */
  const resizeArc = useCallback(async (arc: Arc, newBounds: { start: Date; end: Date }): Promise<boolean> => {
    const violation = arcResizeViolation(arc, newBounds)
    if (violation) {
      addError({
        type: 'validation',
        message: `Cannot ${violation.verb} "${arc.name}": ${violation.reason}. The arc was left unchanged.`,
      })
      return false
    }
    try {
      await updateArcMutation.mutateAsync({
        id: arc.id,
        data: {
          start_time: newBounds.start.toISOString(),
          end_time: newBounds.end.toISOString(),
        },
      })
      return true
    } catch (error) {
      addError({
        type: 'network',
        message: `Failed to resize "${arc.name}": ${describeError(error)}`,
      })
      return false
    }
  }, [arcResizeViolation, updateArcMutation, addError])

  // Undo/redo for drags and resizes. A different graph has different
  // entities, so switching graphs discards the history.
  const activeGraphId = useActiveGraphId()
  const editHistory = useEditHistory({ resetKey: activeGraphId })
  const recordEdit = editHistory.record
  // Deleting an event ends with "Deleted … · Undo" in the status line below.
  const deleteEventUndoably = useUndoableEventDelete(recordEdit)
  // ⌘Z on Apple platforms, Ctrl+Z elsewhere (the handler accepts both).
  const editKeys = useMemo(() => editShortcutLabels(), [])

  /**
   * Re-apply a recorded event time to the event as it is NOW (it may have been
   * edited elsewhere since). An event that has since been deleted cannot be
   * restored; that step is reported and consumed so it does not block the rest
   * of the history.
   */
  const reapplyEventTime = useCallback(async (eventId: string, description: string, iso: string) => {
    const current = fetchedEventsRef.current.find((e) => e.id === eventId)
    if (!current) {
      addError({ type: 'general', message: `"${description}" no longer exists, so that change cannot be reversed.` })
      return true
    }
    return moveEvent(current, new Date(iso))
  }, [moveEvent, addError])

  const reapplyArcBounds = useCallback(async (arcId: string, name: string, bounds: { start: string; end: string }) => {
    const current = fetchedArcsRef.current.find((a) => a.id === arcId)
    if (!current) {
      addError({ type: 'general', message: `"${name}" no longer exists, so that change cannot be reversed.` })
      return true
    }
    return resizeArc(current, { start: new Date(bounds.start), end: new Date(bounds.end) })
  }, [resizeArc, addError])

  const handleEventDrag = useCallback(async (event: Event, newTimestamp: Date) => {
    const from = event.timestamp
    const to = newTimestamp.toISOString()
    if (!(await moveEvent(event, newTimestamp))) return
    recordEdit({
      description: `moved "${event.description}" to ${formatHistoricalTimestamp(to)}`,
      undo: () => reapplyEventTime(event.id, event.description, from),
      redo: () => reapplyEventTime(event.id, event.description, to),
    })
  }, [moveEvent, recordEdit, reapplyEventTime])

  const handleArcResize = useCallback(async (arc: Arc, newBounds: { start: Date; end: Date }) => {
    const from = { start: arc.start_time, end: arc.end_time }
    const to = { start: newBounds.start.toISOString(), end: newBounds.end.toISOString() }
    if (!(await resizeArc(arc, newBounds))) return
    recordEdit({
      description: `resized "${arc.name}" to ${formatHistoricalTimestamp(to.start)} – ${formatHistoricalTimestamp(to.end)}`,
      undo: () => reapplyArcBounds(arc.id, arc.name, from),
      redo: () => reapplyArcBounds(arc.id, arc.name, to),
    })
  }, [resizeArc, recordEdit, reapplyArcBounds])

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

  /**
   * Persist an event's arc assignment.
   *
   * The association lives in the event's `metadata.arcId` -- the same key the
   * CLI writes and the exporter reads. Passing `null` clears it.
   */
  const handleAssignToArc = useCallback(async (eventId: string, arcId: string | null) => {
    const target = assignmentTarget
    if (!target) return

    // The event as it is *now*, not as it was when the menu opened. A PUT
    // replaces the whole metadata object, so merging a snapshot would drop
    // anything another writer added while the modal was open.
    const latest = fetchedEvents.find((event) => event.id === eventId) ?? target

    const metadata: Record<string, unknown> = { ...(latest.metadata ?? {}) }
    if (arcId) {
      metadata.arcId = arcId
    } else {
      delete metadata.arcId
    }

    await updateEventMutation.mutateAsync({ id: eventId, data: { metadata } })
    setAssignmentTarget(null)
  }, [assignmentTarget, fetchedEvents, updateEventMutation])

  // Edit action from context menu
  const handleEdit = useCallback(() => {
    if (contextMenu) {
      setEditModal({ type: contextMenu.type, item: contextMenu.item })
      setContextMenu(null)
    }
  }, [contextMenu])

  // "Assign to arc" action from the event context menu
  const handleAssignRequest = useCallback(() => {
    if (contextMenu?.type === 'event') {
      setAssignmentTarget(contextMenu.item)
      setContextMenu(null)
    }
  }, [contextMenu])

  // "Branch from this event" from the event context menu
  const handleBranchRequest = useCallback(() => {
    if (contextMenu?.type === 'event') {
      setBranchFromEvent(contextMenu.item)
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
        await deleteEventUndoably(deleteConfirm.item as Event, relationships)
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
  }, [deleteConfirm, deleteEventUndoably, relationships, deleteArcMutation, selectedEvent, selectedArc, addError])

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
        await deleteEventUndoably(editModal.item as Event, relationships)
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
  }, [editModal, deleteEventUndoably, relationships, selectedEvent, addError])

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

  /**
   * The events and child arcs of the arc being edited.
   *
   * The panel needs both: it refuses a time range that would leave a
   * contained event outside it, and it warns that deleting an arc deletes
   * its children. It was mounted with neither, so both checks were silent.
   */
  const editModalArcContents = useMemo(() => {
    if (editModal?.type !== 'arc') {
      return { containedEvents: [], childArcs: [] }
    }

    const arcId = editModal.item.id
    // `fetchedEvents`, not the filtered list: the drag handler refuses a
    // resize that would leave a contained event outside the arc, and it
    // checks every event. Using the filtered list here would report a
    // smaller set and let the panel accept what the drag then refuses.
    return {
      containedEvents: fetchedEvents.filter((event) => event.metadata?.arcId === arcId),
      childArcs: fetchedArcs.filter((arc) => arc.parent_arc_id === arcId),
    }
  }, [editModal, fetchedEvents, fetchedArcs])

  if (loadFailure && !eventsLoading && !arcsLoading) {
    return (
      <div className="space-y-6">
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
      <div className="space-y-6">
        <div className="bg-card border border-line rounded-lg shadow-sm p-6" aria-busy="true">
          <span className="sr-only">Loading the timeline</span>
          <div className="animate-pulse">
            <div className="h-8 bg-subtle rounded w-1/4 mb-4"></div>
            <div className="h-96 bg-subtle rounded"></div>
          </div>
          {loadIsSlow && <SlowLoadNotice onRetry={retryLoad} />}
        </div>
      </div>
    )
  }

  const isDeleting = deleteEventMutation.isPending || deleteArcMutation.isPending
  // An event's links go with it, so the confirmation says how many.
  const deleteConfirmLinks =
    deleteConfirm?.type === 'event'
      ? relationships.filter(
          (r) => r.cause_event_id === deleteConfirm.item.id || r.effect_event_id === deleteConfirm.item.id
        ).length
      : 0
  const deleteConfirmName = deleteConfirm
    ? deleteConfirm.type === 'event'
      ? (deleteConfirm.item as Event).description
      : (deleteConfirm.item as Arc).name
    : ''

  const hasInspector = Boolean((inspectedEvent && inspector) || selectedArc)
  // With the filter panel open as well, an empty rail squeezed the canvas to a
  // third of the window: then the rail appears only for a selection.
  const reserveRail = hasInspector || !filterPanelOpen

  return (
    <div className="space-y-6">
      {/* One inspector placement for every lens: a rail beside the canvas from
          xl (as in the causal graph). The rail is always there at that width,
          so selecting an event never re-measures the canvas and moves its
          labels; with nothing selected it says what selection does. */}
      <div className={reserveRail ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start xl:gap-6' : ''}>
      <div ref={containerRef} className="bg-card border border-line rounded-lg shadow-sm p-6">
        {/* The breadcrumb and the navigation already name the view, so its
            heading is for the document outline only, and the canvas starts
            at the top of the card. */}
        <h2 className="sr-only">Timeline</h2>
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 mb-2 empty:hidden">
          {baselineGhost.branch && baselineGhost.baseline && <div className="min-w-0">
            {/* On a branch: which baseline it came from and where it departs,
                with the full comparison one click away. */}
            {baselineGhost.branch && baselineGhost.baseline && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-secondary" data-testid="branch-context">
                <svg className="h-4 w-4 shrink-0 text-divergence" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <circle cx="6" cy="5" r="2" />
                  <circle cx="6" cy="19" r="2" />
                  <circle cx="18" cy="9" r="2" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 7v10M18 11c0 4-6 3-11.2 6.4" />
                </svg>
                <span>
                  Branch of <span className="font-medium text-ink">{baselineGhost.baseline.name}</span>
                  {' · '}
                  {baselineGhost.pointOfDivergence ? (
                    <>
                      diverges{' '}
                      <span className="font-mono-code text-ink">
                        {formatHistoricalDate(baselineGhost.pointOfDivergence.timestamp)}
                      </span>
                    </>
                  ) : (
                    'no changes from it yet'
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setShowBranchComparison(true)}
                  className="rounded-sm font-medium text-ink underline decoration-divergence/60 underline-offset-2 hover:decoration-divergence focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selected"
                >
                  Compare branches
                </button>
              </p>
            )}
          </div>}
        </div>

        {fetchedEvents.length === 0 && fetchedArcs.length === 0 ? (
          <EmptyGraphState kind="empty" />
        ) : events.length === 0 && arcs.length === 0 && filtersActive ? (
          <EmptyGraphState kind="filtered" onClearFilters={clearFilters} />
        ) : (
        <>
        <div className="mb-2">
          <Timeline
            events={events}
            arcs={arcs}
            ghost={ghost}
            branchMarks={branchMarks}
            pressures={visiblePressures}
            showPressureIndicators={visualConfig.showIndicators}
            highlightedEventIds={highlightedEventIds}
            selectedEventId={selectedEvent?.id ?? null}
            onPressureSelect={handlePressureSelect}
            width={dimensions.width}
            height={dynamicHeight}
            fitToViewTrigger={sessionData.viewportState.timeline.fitToViewTrigger}
            onEventSelect={handleEventSelect}
            onArcSelect={handleArcSelect}
            onEventCreate={handleEventCreate}
            onEventDrag={handleEventDrag}
            onArcResize={handleArcResize}
            getEventDragViolation={previewEventDragViolation}
            getArcResizeViolation={previewArcResizeViolation}
            onEventContextMenu={handleEventContextMenu}
            onArcContextMenu={handleArcContextMenu}
            links={timelineLinks}
          />
        </div>

        {/* What the marks and links mean, and the gestures. The gestures are
            pointer-only, so a touch screen is not told to double-click. */}
        <TimelineLegend
          counts={{ events: events.length, arcs: arcs.length, links: timelineLinks.length }}
          hasLinks={timelineLinks.length > 0}
          isTracing={Boolean(selectedEvent)}
          undoKey={editKeys.undo}
          truncatedAt={fetchedEvents.length >= EVENT_LIMIT ? EVENT_LIMIT : undefined}
          pressureTypes={legendPressureTypes}
          linkTypes={legendLinkTypes}
          tiers={legendTiers}
        />
        {branchDivergences.length > 0 && (
          <div className="-mt-2 mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-secondary">
            <span className="text-ink-muted">Branches from this history</span>
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="Branches from this history">
              {branchDivergences.map(({ branch, label, date }) => (
                <li key={branch.id} className="inline-flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
                    <path d="M6 1.5 L10.5 6 L6 10.5 L1.5 6 Z" fill="var(--surface-card)" stroke="var(--accent-divergence)" strokeWidth="1.75" />
                  </svg>
                  <span className="font-medium text-ink">{label}</span>
                  <span className="font-mono-code text-ink-muted">
                    {date ? `diverges ${formatHistoricalDate(date)}` : 'not diverged yet'}
                  </span>
                  <button
                    type="button"
                    onClick={() => openGraph(branch.id)}
                    disabled={isOpeningGraph}
                    className="rounded-sm font-medium text-baseline underline underline-offset-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected disabled:cursor-wait disabled:opacity-60"
                    aria-label={`Open the branch ${branch.name}`}
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        </>
        )}

        {/* Last direct edit, with undo/redo. role="status" so the outcome of a
            drag, an undo or a redo is announced, not only drawn. */}
        {editHistory.lastMessage && (
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-line bg-subtle px-3 py-1.5 text-xs text-ink-secondary">
            <span role="status" aria-live="polite" className="min-w-0 flex-1">
              {editHistory.lastMessage.charAt(0).toUpperCase() + editHistory.lastMessage.slice(1)}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void editHistory.undo()}
                disabled={!editHistory.canUndo}
                aria-keyshortcuts="Control+Z Meta+Z"
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-2 py-0.5 font-medium text-ink-secondary hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                Undo
                <kbd className="font-mono-code text-xs text-ink-muted">{editKeys.undo}</kbd>
              </button>
              <button
                type="button"
                onClick={() => void editHistory.redo()}
                disabled={!editHistory.canRedo}
                aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-2 py-0.5 font-medium text-ink-secondary hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                Redo
                <kbd className="font-mono-code text-xs text-ink-muted">{editKeys.redo}</kbd>
              </button>
            </div>
          </div>
        )}


        {/* The pressure exploration: the detail modal, the evidence highlighting
            and the confidence tracker all live inside it. A section of this
            card (rule-separated), closed to its summary line by default so the
            timeline stays the subject of the view. */}
        <PressureExploration
          arcs={arcs}
          events={events}
          scopeToEvents={filtersActive}
          onEventHighlight={handlePressureEvidenceHighlight}
          onEventSelect={handleEventSelect}
          className="mt-6 border-t border-line pt-5"
        />
      </div>

      {/* The inspector: under the canvas below xl, a bottom sheet over the page
          on a phone (so the traced ripple stays in view; it used to scroll the
          page down to an inspector under the legend), a rail from xl. */}
      {hasInspector ? (
        <aside
          aria-label="Selection"
          className="@container mt-6 rounded-lg border border-line bg-card p-5 shadow-sm xl:sticky xl:top-[calc(var(--app-header-h,0px)+1.5rem)] xl:mt-0 xl:max-h-[calc(100dvh-var(--app-header-h,0px)-3rem)] xl:overflow-y-auto max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] max-lg:z-30 max-lg:mt-0 max-lg:max-h-[55dvh] max-lg:overflow-y-auto max-lg:rounded-b-none max-lg:shadow-xl"
        >
          <button
            type="button"
            onClick={() => {
              setSelectedEvent(null)
              setSelectedArc(null)
            }}
            aria-label="Close the inspector (Esc)"
            title="Close (Esc)"
            className="float-right -mr-1 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected lg:hidden"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
      <section aria-label="Selection inspector" className="text-ink">
        {inspectedEvent && inspector && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-xl font-semibold text-ink">Selected event</h3>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditModal({ type: 'event', item: inspectedEvent })}
                  className="px-2.5 py-1 text-xs font-medium rounded-md border border-line bg-card text-ink-secondary hover:bg-subtle hover:text-ink"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setAssignmentTarget(inspectedEvent)}
                  className="px-2.5 py-1 text-xs font-medium rounded-md border border-line bg-card text-ink-secondary hover:bg-subtle hover:text-ink"
                >
                  Assign to arc
                </button>
                {/* The product's core move: fork a what-if at this point of
                    divergence. Amber is the divergence accent. */}
                <button
                  type="button"
                  onClick={() => setBranchFromEvent(inspectedEvent)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border border-divergence/60 bg-card text-ink hover:bg-divergence/10"
                >
                  <svg className="h-3.5 w-3.5 text-divergence" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <circle cx="6" cy="5" r="2" />
                    <circle cx="6" cy="19" r="2" />
                    <circle cx="18" cy="9" r="2" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 7v10M18 11c0 4-6 3-11.2 6.4" />
                  </svg>
                  Branch from this event
                </button>
              </div>
            </div>
            <dl className="grid grid-cols-1 @sm:grid-cols-2 @3xl:grid-cols-4 gap-x-6 gap-y-3 text-sm">
              <div className="@sm:col-span-2 @3xl:col-span-4">
                <dt className="text-xs font-medium text-ink-muted">Description</dt>
                <dd className="text-ink">{inspectedEvent.description}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-ink-muted">Actor</dt>
                <dd className="text-ink">{inspectedEvent.actor}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-ink-muted">Target</dt>
                <dd className="text-ink">{inspectedEvent.target}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-ink-muted">Timestamp</dt>
                <dd className="font-mono-code text-ink">{formatEventDate(inspectedEvent)}</dd>
              </div>
              {inspector.confidence !== null && (
                <div>
                  <dt className="text-xs font-medium text-ink-muted">Confidence</dt>
                  <dd className="font-mono-code text-ink" title="0 (doubtful) to 1 (certain)">
                    {inspector.confidence.toFixed(2)}
                  </dd>
                </div>
              )}
              <div className="@sm:col-span-2">
                <dt className="text-xs font-medium text-ink-muted">
                  {inspector.arcs.arcs.length === 1 ? 'Arc' : 'Arcs'}
                  {inspector.arcs.arcs.length > 0 && inspector.arcs.basis === 'date' && (
                    <span className="font-normal"> (by date)</span>
                  )}
                </dt>
                <dd className="text-ink">
                  {inspector.arcs.arcs.length === 0 ? (
                    <span className="text-ink-muted">In no arc</span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      {inspector.arcs.arcs.map((arc, index) => (
                        <span key={arc.id} className="inline-flex items-center gap-1.5">
                          {index > 0 && (
                            <svg className="h-3 w-3 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                          <button
                            type="button"
                            onClick={() => handleArcSelect(arc)}
                            className="rounded-sm text-ink underline decoration-line underline-offset-2 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selected"
                          >
                            {arc.name}
                          </button>
                        </span>
                      ))}
                    </span>
                  )}
                </dd>
              </div>
              {inspector.source && (
                <div className="@sm:col-span-2">
                  <dt className="text-xs font-medium text-ink-muted">Source</dt>
                  <dd className="text-ink">
                    {inspector.source.url ? (
                      <a
                        href={inspector.source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-words underline decoration-line underline-offset-2 hover:decoration-ink"
                      >
                        {inspector.source.title}
                      </a>
                    ) : (
                      inspector.source.title
                    )}
                    {inspector.source.origin && (
                      <span className="block text-xs text-ink-muted">{inspector.source.origin}</span>
                    )}
                  </dd>
                </div>
              )}
            </dl>
            <EventCausesEffects
              causes={inspector.causes}
              effects={inspector.effects}
              onSelectEvent={handleEventSelect}
              isLoading={relationshipsLoading}
            />
            {rippleReach > inspector.effects.length && (
              <p className="text-sm text-ink-secondary" data-testid="ripple-reach">
                In all, it sets{' '}
                <span className="font-medium text-ink">
                  {rippleReach} {rippleReach === 1 ? 'event' : 'events'}
                </span>{' '}
                in motion within {RIPPLE_DEPTH} steps, traced on the timeline above.
              </p>
            )}
          </div>
        )}
        {selectedArc && (
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="font-display text-xl font-semibold text-ink">Selected arc</h3>
              <button
                type="button"
                onClick={() => setEditModal({ type: 'arc', item: selectedArc })}
                className="px-2.5 py-1 text-xs font-medium rounded-md border border-line bg-card text-ink-secondary hover:bg-subtle hover:text-ink"
              >
                Edit
              </button>
            </div>
            <dl className="grid grid-cols-1 @sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <dt className="text-xs font-medium text-ink-muted">Name</dt>
                <dd className="text-ink">{selectedArc.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-ink-muted">Description</dt>
                <dd className="text-ink">{selectedArc.description}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-ink-muted">Start</dt>
                <dd className="font-mono-code text-ink">{formatHistoricalTimestamp(selectedArc.start_time)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-ink-muted">End</dt>
                <dd className="font-mono-code text-ink">{formatHistoricalTimestamp(selectedArc.end_time)}</dd>
              </div>
            </dl>
          </div>
        )}
      </section>
        </aside>
      ) : (
        <aside aria-label="Selection" className={`hidden rounded-lg border border-dashed border-line p-5 text-sm text-ink-secondary ${reserveRail ? 'xl:block' : ''}`}>
          <h3 className="font-display text-xl font-semibold text-ink">Nothing selected</h3>
          <p className="mt-2">
            Select an event to see why it is there and to trace what it caused: its ripple stays lit on the
            timeline while the rest fades back.
          </p>
        </aside>
      )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          isOpen={true}
          title={contextMenu.type === 'event' ? contextMenu.item.description : contextMenu.item.name}
          position={contextMenu.position}
          items={[
            { id: 'edit', label: 'Edit', onClick: handleEdit },
            // Only an event belongs to an arc; an arc has no such action.
            ...(contextMenu.type === 'event'
              ? [
                  { id: 'assign', label: 'Assign to arc', onClick: handleAssignRequest },
                  {
                    id: 'branch',
                    label: 'Branch from this event',
                    onClick: handleBranchRequest,
                  },
                ]
              : []),
            { id: 'delete', label: 'Delete', onClick: handleDeleteRequest, danger: true }
          ]}
          onClose={handleContextMenuClose}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <ConfirmDialog
          isOpen={true}
          title={`Delete “${deleteConfirmName}”?`}
          message={
            `The ${deleteConfirm.type} is removed from this graph` +
            (deleteConfirmLinks > 0
              ? `, with the ${deleteConfirmLinks} causal ${deleteConfirmLinks === 1 ? 'link' : 'links'} that join it to other events. `
              : '. ') +
            (deleteConfirm.type === 'event'
              ? `You can undo this straight afterwards, and the graph's Version history keeps the earlier version.`
              : `Its previous version stays in the graph's Version history, so it can be restored from Versions.`)
          }
          confirmLabel={`Delete ${deleteConfirm.type}`}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
          isLoading={isDeleting}
          variant="danger"
        />
      )}

      {/* Arc assignment for a single event, opened from the context menu.
          The current arc is read from the event's metadata, so the modal
          opens on the assignment the event already has. */}
      {assignmentTarget && (
        <Portal>
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
            {/* EventArcAssignment draws its own surface; this is only the dialog. */}
            <div role="dialog" aria-modal="true" aria-label="Assign Event to Arc" className="w-full max-w-md">
              <EventArcAssignment
                event={assignmentTarget}
                availableArcs={fetchedArcs}
                currentArcId={
                  typeof assignmentTarget.metadata?.arcId === 'string'
                    ? assignmentTarget.metadata.arcId
                    : null
                }
                onAssign={handleAssignToArc}
                onCancel={() => setAssignmentTarget(null)}
                className="w-full shadow-xl"
              />
            </div>
          </div>
        </Portal>
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
          containedEvents={editModalArcContents.containedEvents}
          childArcs={editModalArcContents.childArcs}
        />
      )}

      {/* Compare branches, from the branch line under the title: this branch
          against the baseline it was forked from. */}
      {showBranchComparison && baselineGhost.branch && baselineGhost.baseline && (
        <BranchComparisonModal
          isOpen={true}
          onClose={() => setShowBranchComparison(false)}
          initialBaselineGraphId={baselineGhost.baseline.id}
          initialCounterfactualGraphId={baselineGhost.branch.id}
        />
      )}

      {/* Branch from this event: fork a counterfactual at the selected point
          of divergence. The dialog renders nothing until it has an event. */}
      <BranchFromEventDialog
        event={branchFromEvent}
        isOpen={branchFromEvent !== null}
        onClose={() => setBranchFromEvent(null)}
      />

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
