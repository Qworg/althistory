// Timeline-specific state interfaces for the refactored architecture
// See: impl/deferredplans/01-timeline-architecture-refactor.md
// See: impl/deferredplans/ADR-001-d3-react-integration.md

import React from 'react'
import { Event, Arc, TimeRange } from './index'
import type { ScaleTime } from 'd3'
import { ArcWithUIState } from '@/components/timeline/arcHierarchyUtils'

/**
 * Visualization State (local, non-reactive)
 * 
 * These values change frequently during user interaction but don't need
 * to trigger re-renders of the entire component tree. They can be stored
 * in refs or local state.
 */
export interface VisualizationState {
  /** Current zoom level (1.0 = 100%) */
  zoom: number
  /** Current pan offset */
  pan: { x: number; y: number }
  /** ID of currently hovered element, or null */
  hoverTarget: string | null
  /** Whether user is currently dragging */
  isDragging: boolean
  /** Type of drag operation in progress */
  dragType: 'event' | 'arc' | 'selection' | null
}

/**
 * Business Logic State (global store)
 * 
 * Core data that drives the application. Changes here should trigger
 * re-renders and potentially API calls. Managed via Zustand store.
 */
export interface TimelineBusinessState {
  /** All events in the timeline */
  events: Event[]
  /** All arcs (narrative threads) */
  arcs: Arc[]
  /** Currently selected event ID, or null */
  selectedEventId: string | null
  /** Currently selected arc ID, or null */
  selectedArcId: string | null
  /** IDs of expanded arcs (showing children) */
  expandedArcIds: Set<string>
  /** IDs of selected elements (for multi-select) */
  selectedElementIds: Set<string>
}

/**
 * Derived State (computed, memoized)
 * 
 * Values computed from business state. Should be memoized using useMemo
 * to prevent unnecessary recalculations.
 */
export interface DerivedTimelineState {
  /** D3 time scale for x-axis positioning */
  xScale: ScaleTime<number, number>
  /** Processed arc hierarchy with render levels */
  arcHierarchy: ArcWithUIState[]
  /** Maximum hierarchy depth */
  maxLevel: number
  /** Currently visible time range */
  visibleTimeRange: TimeRange
  /** Inner width after margins */
  innerWidth: number
  /** Inner height after margins */
  innerHeight: number
}

/**
 * Timeline margin configuration
 */
export interface TimelineMargin {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Position of an event on the timeline (calculated)
 */
export interface EventPosition {
  id: string
  x: number
  y: number
  event: Event
}

/**
 * Position of an arc on the timeline (calculated)
 */
export interface ArcPosition {
  id: string
  x: number
  y: number
  width: number
  arc: ArcWithUIState
}

/**
 * Props for timeline event handler hook
 */
export interface TimelineEventHandlerProps {
  onEventSelect?: (event: Event) => void
  onArcSelect?: (arc: Arc) => void
  onEventCreate?: (timestamp: Date) => void
  xScale: ScaleTime<number, number> | null
  margin: TimelineMargin
  innerWidth: number
}

/**
 * Return type for useTimelineScales hook
 */
export interface UseTimelineScalesResult {
  xScale: ScaleTime<number, number>
  innerWidth: number
  innerHeight: number
  xDomain: [Date, Date]
}

/**
 * Return type for useTimelineEventHandlers hook
 */
export interface UseTimelineEventHandlersResult {
  handleEventClick: (event: Event) => void
  handleArcClick: (arc: Arc) => void
  handleSvgDoubleClick: (e: React.MouseEvent<SVGSVGElement>) => void
}
