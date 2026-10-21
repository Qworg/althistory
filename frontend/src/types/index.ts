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

export interface EntityRef {
  graphId: string
  entityType: 'event' | 'arc'
  entityId: string
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
  causeGraphId?: string
  effectGraphId?: string
  isCrossGraph?: boolean
}

/**
 * A pressure inferred over the graph.
 *
 * The shape is the backend's (`timeline/src/models/InferredPressure.ts`): it
 * carries the evidence as display strings, the ids of the events the inference
 * rests on, and the period it was inferred over. It does NOT carry
 * `created_at`/`updated_at` -- the backend never sent them, and the client
 * declared them, so every date the UI showed was an "Invalid Date".
 */
export interface InferredPressure {
  id: string
  description: string
  confidence_score: number
  pressure_type: 'economic' | 'social' | 'environmental' | 'political'
  /** Evidence as display strings. */
  evidence?: string[]
  /** The ids of the events the inference rests on. */
  evidence_event_ids?: string[]
  /** The period the pressure was inferred over. */
  time_range?: {
    start: string
    end: string
  }
  /**
   * The backend does not send these. They are kept optional so an older
   * cached response still typechecks; nothing renders them.
   */
  created_at?: string
  updated_at?: string
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
  causeGraphId?: string
  effectGraphId?: string
  isCrossGraph?: boolean
}

export interface EventFilters {
  actor?: string
  target?: string
  start_date?: string
  end_date?: string
  search?: string
  /** How many events to return; the backend's default is 50, its maximum 1000. */
  limit?: number
  /** How many events to skip. */
  offset?: number
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

export interface MergedResolution {
  strategy: 'merged'
  value: Record<string, unknown>
}

/** A value that actually resolves one merge conflict. */
export type ManualResolution = 'keep-target' | 'keep-source' | MergedResolution

export type MergeAnomalyType =
  | 'causal_cycle'
  | 'temporal_inversion'
  | 'orphan_relationship'
  /** A reference from an arc or a pressure to an entity the graph lacks. */
  | 'orphan_reference'

export interface MergeAnomaly {
  type: MergeAnomalyType
  message: string
  details?: Record<string, unknown>
}

export type MergeEntityType = 'event' | 'arc' | 'relationship' | 'pressure'

/** One entity that differs between the target and source graphs. */
export interface MergeConflict {
  entityType: MergeEntityType
  entityId: string
  sourceVersion: Record<string, unknown>
  targetVersion: Record<string, unknown>
  /** Reserved for a future three-way diff; not populated today. */
  baseVersion?: Record<string, unknown>
  suggestedResolution: ManualResolution
}

/** Request shape accepted by `POST /graphs/:id/merge`. */
export interface GraphMergeRequest {
  sourceGraphId: string
  conflictResolution: 'keep-target' | 'keep-source' | 'manual'
  /** Keyed `${entityType}:${entityId}`; required for every conflict when manual. */
  manualResolutions?: Record<string, ManualResolution>
  /** Preview the merge without committing it. */
  dryRun?: boolean
}

/** Result of a merge attempt, including a preview that found conflicts. */
export interface GraphMergeResponse {
  success: boolean
  graph?: Graph
  newVersion?: number
  conflicts?: MergeConflict[]
  anomalies?: MergeAnomaly[]
  dryRun?: boolean
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
  /** Human-readable progress message from backend */
  progressMessage?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  result?: ImportResult
  error?: string
}

export interface AsyncImportResponse {
  success: true
  jobId: string
  message: string
  async: true
}

/** Response shape for synchronous imports */
export interface SyncImportResponse extends ImportResult {
  async: false
}

/** Union type for execute import API response */
export type ExecuteImportResponse = AsyncImportResponse | SyncImportResponse

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

// API Key Management Types
export type Permission =
  | 'read:events'
  | 'write:events'
  | 'read:arcs'
  | 'write:arcs'
  | 'read:relationships'
  | 'write:relationships'
  | 'read:graphs'
  | 'write:graphs'
  | 'export'
  | 'import'
  | 'ingest'
  | 'admin'

export interface RateLimitConfig {
  requestsPerMinute: number
  requestsPerHour: number
  requestsPerDay: number
  batchSizeLimit: number
  concurrentStreams: number
}

export interface ApiKey {
  id: string
  name: string
  keyPrefix: string
  permissions: Permission[]
  rateLimit: RateLimitConfig
  allowedGraphs: string[] | '*'
  createdAt: string
  lastUsedAt?: string
  expiresAt?: string
  isActive: boolean
  metadata?: Record<string, unknown>
}

export interface CreateApiKeyRequest {
  name: string
  permissions: Permission[]
  rateLimit?: Partial<RateLimitConfig>
  allowedGraphs?: string[] | '*'
  expiresAt?: string
}

export interface CreateApiKeyResponse {
  id: string
  key: string // Full key, shown only once
  keyPrefix: string
  name: string
  permissions: Permission[]
  rateLimit: RateLimitConfig
  createdAt: string
}

export interface UpdateApiKeyRequest {
  name?: string
  permissions?: Permission[]
  rateLimit?: Partial<RateLimitConfig>
  allowedGraphs?: string[] | '*'
  isActive?: boolean
}

export interface ApiKeyStats {
  total: number
  active: number
  inactive: number
  expired: number
}

/**
 * The rate limits configured on an API key.
 *
 * Mirrors `RateLimitConfig` in `timeline/src/models/ApiKey.ts`.
 */
export interface ApiKeyRateLimit {
  requestsPerMinute: number
  requestsPerHour: number
  requestsPerDay: number
  batchSizeLimit: number
  concurrentStreams: number
}

/**
 * How much of a rate limit window has been used.
 */
export interface ApiKeyUsageWindow {
  /** The number of requests counted in this window. */
  count: number
  /**
   * When the window resets, as a millisecond timestamp.
   *
   * Null when no window is running: either the key was never used, or the
   * window it used has ended.
   */
  resetAt: number | null
}

/**
 * The current usage of one API key.
 *
 * The shape of `GET /api/keys/:id/usage`.
 */
export interface ApiKeyUsage {
  keyId: string
  rateLimit: ApiKeyRateLimit
  currentUsage: {
    minute: ApiKeyUsageWindow
    hour: ApiKeyUsageWindow
    day: ApiKeyUsageWindow
  }
}

// Web Ingestion Types (Req 19). Mirrors the shapes returned by
// `timeline/src/services/ingestion/types.ts`; the frontend bundle cannot import
// from the timeline package, so these are declared here.
export type ExtractionSourceType = 'wikipedia' | 'wikidata' | 'text' | 'llm'

/** Where an extracted entity came from, recorded on every extracted entity. */
export interface ExtractionSource {
  type: ExtractionSourceType
  url?: string
  articleTitle?: string
  wikidataId?: string
  extractedAt: string
}

export interface ExtractedEvent {
  tempId: string
  description: string
  actor: string
  target: string
  timestamp: string
  confidence: number
  source: ExtractionSource
  selected: boolean
  edited: boolean
}

export interface ExtractedArc {
  tempId: string
  name: string
  description: string
  start_time: string
  end_time: string
  level: number
  confidence: number
  source: ExtractionSource
  selected: boolean
  edited: boolean
}

export interface ExtractedRelationship {
  tempId: string
  causeEventTempId: string
  effectEventTempId: string
  weight: number
  confidence: number
  reasoning: string
  source: ExtractionSource
  selected: boolean
}

/** Provenance record attached to an extraction. */
export interface IngestionSourceRecord {
  id: string
  type: 'wikipedia' | 'wikidata' | 'manual' | 'import' | 'llm-generated' | 'text-extraction'
  url?: string
  accessedAt?: string
  confidence: number
  entityIds: string[]
}

export interface ExtractionResult {
  events: ExtractedEvent[]
  arcs: ExtractedArc[]
  relationships: ExtractedRelationship[]
  sources: IngestionSourceRecord[]
  overallConfidence: number
}

export interface IngestionValidationIssue {
  entityTempId: string
  entityType: 'event' | 'arc' | 'relationship'
  severity: 'error' | 'warning'
  message: string
}

/** Result of an extraction, held for review before import. */
export interface IngestionPreview {
  jobId: string
  status: 'review'
  extraction: ExtractionResult
  validationIssues: IngestionValidationIssue[]
}

/** Response returned by the synchronous ingest endpoints. */
export interface IngestResponse extends IngestionPreview {
  estimatedPages?: number
}

/** Editable fields, spanning both event and arc shapes. */
export type ExtractedEdit = Partial<ExtractedEvent> & Partial<ExtractedArc>

export type WikidataQueryType = 'historical-events' | 'person-timeline' | 'custom'

export interface WikipediaIngestOptions {
  followLinks?: boolean
  /** Clamped to the spec maximum of 3 by the backend. */
  linkDepth?: number
  /** Regular expression (as a string) applied to linked article titles. */
  linkFilter?: string
  /** Upper bound on pages fetched when link following is enabled. */
  maxPages?: number
}

export interface WikipediaIngestRequest {
  url: string
  strategy?: 'wikipedia' | 'auto'
  options?: WikipediaIngestOptions
}

export interface WikidataIngestRequest {
  queryType: WikidataQueryType
  parameters?: Record<string, string>
  customQuery?: string
  limit?: number
}

export interface TextIngestRequest {
  text: string
  useLLM?: boolean
}

export interface ApproveIngestionRequest {
  approvedEventIds?: string[]
  approvedArcIds?: string[]
  approvedRelationshipIds?: string[]
  edits?: Record<string, ExtractedEdit>
  targetGraphId?: string
  mode?: ImportMode
  conflictResolution?: ConflictResolution
  userId?: string
}

export interface IngestionJobStatus {
  id: string
  source: ExtractionSourceType
  status: 'review' | 'imported' | 'failed'
  createdAt: string
  updatedAt: string
  validationIssues: IngestionValidationIssue[]
  importResult?: ImportResult
}

export * from './stream'
export * from './simulation'
