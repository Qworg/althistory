/**
 * What a feedback report says about where the reporter was and what the app
 * was doing (issue #49), read the moment the dialog is asked for.
 *
 * Ids, not content. The graph's name is included because it is how a person
 * names the graph they were in; the text of events, arcs, filters and searches
 * is not. A filter on actors is "3 actors", a search is "a search of 12
 * characters". Whatever text was on screen is in the screenshot, which the
 * reporter can leave out.
 */

import { useGlobalStore } from '@/stores/globalStore'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import { DEMO_MODE } from '@/demo/flag'
import type { ViewMode } from '@/types'
import { recentDiagnostics, type Diagnostic } from './diagnostics'

declare const __APP_VERSION__: string | undefined
declare const __APP_COMMIT__: string | undefined

export interface FeedbackContext {
  capturedAt: string
  page: { route: string; view: ViewMode; title: string }
  graph: { id: string | null; name?: string; branchOf?: string; calendar?: string | null }
  mode: 'demo' | 'app'
  state: {
    selectedEvents: string[]
    selectedArcs: string[]
    /** How many were selected, when more than the lists hold. */
    selectedTotal?: { events: number; arcs: number }
    filters: Record<string, unknown>
    timeline: { zoomLevel: number; centerTime: string | null }
    causalLayout: string
    layoutMode: string
    theme: { preference: string; shown: 'light' | 'dark' }
    sidebarCollapsed: boolean
    filterPanelOpen: boolean
  }
  environment: {
    app: { version: string; commit: string }
    userAgent: string
    language: string
    viewport: { width: number; height: number; devicePixelRatio: number }
    online: boolean
    queuedWrites: number
    queuedWritesWithoutGraph: number
  }
  errors: Diagnostic[]
}

/** What only a component can know (the open graph's record is in React Query). */
export interface ContextExtras {
  graphName?: string
  branchOf?: string
}

const MAX_IDS = 20

function appVersion(): { version: string; commit: string } {
  return {
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
    commit: typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown',
  }
}

/** The route without its query: a query can carry a search. `?event=` is an id, so it is kept. */
export function currentRoute(location: Location = window.location): string {
  // The demo uses hash URLs (`#/timeline?event=...`); the app uses paths.
  const raw = DEMO_MODE && location.hash.startsWith('#/') ? location.hash.slice(1) : location.pathname + location.search
  const [path, query = ''] = raw.split('?')
  const event = new URLSearchParams(query).get('event')
  return event ? `${path}?event=${encodeURIComponent(event)}` : (path ?? '/')
}

export function summarizeFilters(filters: ReturnType<typeof useGlobalStore.getState>['activeFilters']): Record<string, unknown> {
  const summary: Record<string, unknown> = {}
  if (filters.dateRange) summary.dateRange = filters.dateRange
  if (filters.actors.length) summary.actors = filters.actors.length
  if (filters.targets.length) summary.targets = filters.targets.length
  if (filters.eventTypes.length) summary.eventTypes = filters.eventTypes.length
  if (filters.arcLevels.length) summary.arcLevels = [...filters.arcLevels]
  if (filters.causalWeightRange[0] !== 0 || filters.causalWeightRange[1] !== 1) {
    summary.causalWeightRange = [...filters.causalWeightRange]
  }
  if (filters.confidenceThreshold) summary.confidenceThreshold = filters.confidenceThreshold
  if (filters.searchQuery.trim()) summary.searchLength = filters.searchQuery.trim().length
  return summary
}

export function captureContext(extras: ContextExtras = {}): FeedbackContext {
  const store = useGlobalStore.getState()
  const calendar = useWorldCalendarStore.getState()
  const graphId = (() => {
    try {
      return localStorage.getItem('active_graph_id')
    } catch {
      return null
    }
  })()
  const selectedEvents = store.selectedEvents
  const selectedArcs = store.selectedArcs
  const truncated = selectedEvents.length > MAX_IDS || selectedArcs.length > MAX_IDS

  return {
    capturedAt: new Date().toISOString(),
    page: { route: currentRoute(), view: store.viewMode, title: document.title },
    graph: {
      id: graphId,
      ...(extras.graphName ? { name: extras.graphName } : {}),
      ...(extras.branchOf ? { branchOf: extras.branchOf } : {}),
      ...(calendar.set ? { calendar: calendar.shown ?? 'primary' } : {}),
    },
    mode: DEMO_MODE ? 'demo' : 'app',
    state: {
      selectedEvents: selectedEvents.slice(0, MAX_IDS),
      selectedArcs: selectedArcs.slice(0, MAX_IDS),
      ...(truncated ? { selectedTotal: { events: selectedEvents.length, arcs: selectedArcs.length } } : {}),
      filters: summarizeFilters(store.activeFilters),
      timeline: {
        zoomLevel: store.sessionData.viewportState.timeline.zoomLevel,
        centerTime: store.sessionData.viewportState.timeline.centerTime,
      },
      causalLayout: store.sessionData.viewportState.causalGraph.layout,
      layoutMode: store.userPreferences.layoutMode,
      theme: {
        preference: store.userPreferences.theme,
        shown: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      },
      sidebarCollapsed: store.uiState.sidebarCollapsed,
      filterPanelOpen: store.uiState.filterPanelOpen,
    },
    environment: {
      app: appVersion(),
      userAgent: navigator.userAgent,
      language: navigator.language,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: Math.round((window.devicePixelRatio || 1) * 100) / 100,
      },
      online: store.isOnline,
      queuedWrites: store.pendingMutationCount,
      queuedWritesWithoutGraph: store.unscopedMutationCount,
    },
    errors: recentDiagnostics(),
  }
}
