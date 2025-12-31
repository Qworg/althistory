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

// Graph Management Types
export type GraphStatus = 'active' | 'archived' | 'deleted'

export interface GraphMetadata {
  eventCount: number
  arcCount: number
  relationshipCount: number
  pressureCount: number
  timeRange?: {
    start: string
    end: string
  }
  tags?: string[]
}

export interface Graph {
  id: string
  name: string
  description?: string
  status: GraphStatus
  version: number
  createdAt: string
  updatedAt: string
  metadata: GraphMetadata
  parentGraphId?: string
  branchName?: string
}

export interface GraphVersion {
  version: number
  commitHash: string
  timestamp: string
  message: string
  author?: string
  changes: {
    eventsAdded: number
    eventsModified: number
    eventsDeleted: number
    arcsAdded: number
    arcsModified: number
    arcsDeleted: number
    relationshipsAdded: number
    relationshipsModified: number
    relationshipsDeleted: number
  }
}

export interface CreateGraphRequest {
  name: string
  description?: string
  tags?: string[]
}

export interface UpdateGraphRequest {
  name?: string
  description?: string
  tags?: string[]
  status?: GraphStatus
}

export interface BranchGraphRequest {
  branchName: string
  version?: number
}

export interface MergeGraphRequest {
  sourceBranchId: string
  strategy: 'ours' | 'theirs' | 'manual'
  message?: string
}

// Export Types
export type ExportJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

export interface ExportFilters {
  timeRange?: { start: string; end: string }
  actors?: string[]
  targets?: string[]
  arcIds?: string[]
  eventIds?: string[]
}

export interface ExportJob {
  id: string
  type: 'export'
  status: ExportJobStatus
  progress: number
  createdAt: string
  startedAt?: string
  completedAt?: string
  result?: {
    outputPath?: string
    summary?: Record<string, unknown>
    errors?: string[]
    warnings?: string[]
  }
  error?: string
}

export interface CreateExportJobRequest {
  graphId: string
  scope: 'full' | 'filtered'
  filters?: ExportFilters
  includeProvenance?: boolean
  webhook?: string
}

export interface AlthistoryExport {
  version: '1.0'
  metadata: {
    graphId: string
    graphName: string
    description?: string
    exportedAt: string
    sourceVersion: string
    graphVersion: number
    checksum: string
    filters?: ExportFilters
  }
  data: {
    events: Array<{
      id: string
      description: string
      actor: string
      target: string
      timestamp: string
      metadata?: Record<string, unknown>
    }>
    arcs: Array<{
      id: string
      name: string
      description: string
      start_time: string
      end_time: string
      level: number
      parent_arc_id: string | null
    }>
    causalRelationships: Array<{
      id: string
      cause_event_id: string
      effect_event_id: string
      weight: number
      evidence: string
      confidence: number
      relationship_type: 'direct' | 'indirect' | 'contributory'
    }>
    inferredPressures: Array<{
      id: string
      description: string
      confidence_score: number
      pressure_type: 'economic' | 'social' | 'environmental' | 'political'
      evidence_event_ids: string[]
      affected_arc_ids: string[]
    }>
  }
}

export interface ExportValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// Import Types
export type ImportMode = 'merge' | 'replace' | 'create-new'
export type ConflictResolution = 'skip' | 'overwrite' | 'rename'
export type ImportConflictType = 'duplicate-id' | 'temporal-violation' | 'causal-paradox' | 'orphan-reference' | 'arc-boundary-violation'

export interface ImportError {
  path: string
  message: string
  code: string
}

export interface ImportWarning {
  path: string
  message: string
  code: string
}

export interface ImportSummary {
  eventCount: number
  arcCount: number
  relationshipCount: number
  pressureCount: number
  crossRefCount: number
  temporalRange?: { start: string; end: string }
  actors: string[]
}

export interface ImportValidationResult {
  valid: boolean
  errors: ImportError[]
  warnings: ImportWarning[]
  summary: ImportSummary
}

export interface ImportConflict {
  id: string
  type: ImportConflictType
  severity: 'error' | 'warning'
  entityType: 'event' | 'arc' | 'relationship' | 'pressure'
  entityId: string
  existingEntity?: Record<string, unknown>
  incomingEntity: Record<string, unknown>
  suggestedResolution: ConflictResolution
  message: string
}

export interface EntityCounts {
  events: number
  arcs: number
  relationships: number
  pressures: number
}

export interface ImportPreview {
  toCreate: EntityCounts
  toUpdate: EntityCounts
  toDelete: EntityCounts
  conflicts: ImportConflict[]
  warnings: ImportWarning[]
}

export interface ImportOptions {
  graphId?: string
  mode: ImportMode
  conflictResolution: ConflictResolution | 'manual'
  manualResolutions?: Record<string, ConflictResolution>
}

export interface ImportResult {
  success: boolean
  graphId: string
  graphVersion: number
  imported: EntityCounts
  skipped: EntityCounts
  deleted: EntityCounts
  errors: ImportError[]
  warnings: ImportWarning[]
  jobId?: string
}

export interface ImportJob {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  progress: number
  createdAt: string
  startedAt?: string
  completedAt?: string
  result?: ImportResult
  error?: string
}

export interface AsyncImportResponse {
  jobId: string
  message: string
  async: boolean
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