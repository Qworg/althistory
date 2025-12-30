// Core data types based on backend API
export interface Event {
  id: string
  description: string
  actor: string
  target: string
  timestamp: string
  created_at: string
  updated_at: string
}

export interface Arc {
  id: string
  name: string
  description: string
  start_time: string
  end_time: string
  level: number
  parent_arc_id: string | null
  created_at: string
  updated_at: string
}

export interface CausalRelationship {
  id: string
  cause_event_id: string
  effect_event_id: string
  weight: number
  evidence: string
  confidence: number
  relationship_type: 'direct' | 'indirect' | 'contributory'
  created_at: string
  updated_at: string
}

export interface InferredPressure {
  id: string
  description: string
  confidence_score: number
  pressure_type: 'economic' | 'social' | 'environmental' | 'political'
  created_at: string
  updated_at: string
}

// API request/response types
export interface CreateEventRequest {
  description: string
  actor: string
  target: string
  timestamp: string
}

export interface UpdateEventRequest {
  description?: string
  actor?: string
  target?: string
  timestamp?: string
}

export interface CreateArcRequest {
  name: string
  description: string
  start_time: string
  end_time: string
  level: number
  parent_arc_id?: string | null
}

export interface UpdateArcRequest {
  name?: string
  description?: string
  start_time?: string
  end_time?: string
  level?: number
  parent_arc_id?: string | null
}

export interface CausalRelationshipData {
  weight: number
  evidence: string
  confidence: number
  relationship_type: 'direct' | 'indirect' | 'contributory'
}

export interface EventFilters {
  actor?: string
  target?: string
  start_date?: string
  end_date?: string
  search?: string
}

export interface ArcFilters {
  parent_arc_id?: string | null
  start_date?: string
  end_date?: string
  search?: string
}

export interface CausalPath {
  events: Event[]
  relationships: CausalRelationship[]
  totalWeight: number
  confidence: number
}

export interface CausalSuggestion {
  id: string
  cause_event_id: string
  effect_event_id: string
  suggested_weight: number
  confidence: number
  reasoning: string
}

export interface EventCluster {
  id: string
  events: Event[]
  center: { x: number; y: number }
  theme: string
}

export interface Pattern {
  id: string
  name: string
  description: string
  events: Event[]
  confidence: number
}

export interface CopyResult {
  id: string
  name: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  progress: number
  estimated_completion?: string
  error_message?: string
  created_at: string
  completed_at?: string
}

export interface CopyOperation {
  id: string
  name: string
  type: 'full' | 'time_range' | 'filtered'
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  progress: number
  estimated_completion?: string
  error_message?: string
  created_at: string
  completed_at?: string
  parameters: {
    timeRange?: TimeRange
    filter?: EntityFilter
  }
}

export interface GraphCopyState {
  activeOperations: CopyOperation[]
  completedOperations: CopyOperation[]
  selectedTimeRange: TimeRange | null
  selectedFilter: EntityFilter | null
  copyName: string
  isCreatingCopy: boolean
}

export interface EntityFilter {
  actors?: string[]
  targets?: string[]
  event_types?: string[]
  confidence_threshold?: number
}

// UI-specific types
export interface TimeRange {
  start: Date
  end: Date
}

export interface FilterState {
  dateRange: TimeRange | null
  actors: string[]
  targets: string[]
  eventTypes: string[]
  arcLevels: number[]
  causalWeightRange: [number, number]
  confidenceThreshold: number
  searchQuery: string
}

export type ViewMode = 'timeline' | 'causal' | 'actor-perspective'

export type LayoutMode = 'sidebar' | 'topbar'

export interface ErrorState {
  id: string
  message: string
  type: 'network' | 'validation' | 'visualization' | 'general'
  timestamp: Date
}

// User preferences that should be persisted
export interface UserPreferences {
  theme: 'light' | 'dark' | 'system'
  layoutMode: LayoutMode
  defaultViewMode: ViewMode
  timelineHeight: number
  showEventLabels: boolean
  autoSaveFilters: boolean
  notificationSettings: {
    showSuccess: boolean
    showErrors: boolean
    showWarnings: boolean
  }
  accessibility: {
    highContrast: boolean
    reducedMotion: boolean
    screenReaderOptimized: boolean
  }
}

// Session data that should be persisted temporarily
export interface SessionData {
  lastActiveFilters: FilterState
  lastViewMode: ViewMode
  lastSelectedEvents: string[]
  lastSelectedArcs: string[]
  recentSearches: string[]
  viewportState: {
    timeline: {
      zoomLevel: number
      centerTime: string | null
      fitToViewTrigger: number
    }
    causalGraph: {
      layout: string
      nodePositions: Record<string, { x: number; y: number }>
    }
  }
}

// Extended types for UI state management
export interface UIState {
  sidebarCollapsed: boolean
  filterPanelOpen: boolean
  activeModal: string | null
  dragState: {
    isDragging: boolean
    dragType: 'event' | 'arc' | null
    draggedItemId: string | null
  }
  selectionState: {
    isSelecting: boolean
    selectionType: 'single' | 'multiple' | 'range'
    selectionBox: {
      startX: number
      startY: number
      endX: number
      endY: number
    } | null
  }
}