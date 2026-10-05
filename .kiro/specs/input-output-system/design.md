# Design Document

## Overview

The Input/Output System extends the Althistory platform with comprehensive data management capabilities. It enables researchers to work with multiple historical graphs, import/export data, ingest content from external sources, and integrate with automated systems.

## Architecture

```
+-----------------------------------------------------------------------------+
|                              Frontend (React)                                |
+---------------+--------------+----------------+-----------------------------+
|  Graph Manager | Import Wizard | Ingestion Wizard | API Key Dashboard        |
+-------+-------+-------+------+--------+-------+-------------+---------------+
        |               |               |                     |
        v               v               v                     v
+-----------------------------------------------------------------------------+
|                           REST API Layer                                     |
+------------+-------------+-------------+-------------+----------------------+
| /api/graphs | /api/export | /api/import | /api/ingest | /api/batch          |
|             | /api/jobs   |             |             | /api/validate       |
|             |             |             |             | /api/suggest        |
|             |             |             |             | /api/keys           |
+------+------+------+------+------+------+------+------+------+--------------+
       |             |             |             |             |
       v             v             v             v             v
+-----------------------------------------------------------------------------+
|                           Service Layer                                      |
+------------+-------------+-------------+-------------+----------------------+
| GraphService | ExportService | ImportService | IngestionSvc  | AuthService   |
|              |               |               | Orchestrator  | RateLimitSvc  |
|              |               |               +---------------+               |
|              |               |               | Wikipedia     |               |
|              |               |               | Wikidata      |               |
|              |               |               | Text/LLM      |               |
+------+-------+------+-------+------+-------+------+--------+-------+--------+
       |              |              |              |               |
       v              v              v              v               v
+-----------------------------------------------------------------------------+
|                         Repository Layer                                     |
+------------+-------------+-------------+-----------------------------------+
| GraphRepo  | JobRepo     | ApiKeyRepo  | Existing Repos (Event, Arc, etc)  |
| VersionRepo|             |             |                                   |
+------+-----+------+------+------+------+----------------------------------+
       |            |             |
       v            v             v
+-----------------------------------------------------------------------------+
|                         Storage Layer                                        |
+------------------------------------+----------------------------------------+
|    Neo4j + Redis (Cloud Mode)      |    JSON Files (Local Mode)             |
+------------------------------------+----------------------------------------+
```

## Technology Stack

### Backend Additions
- `bcrypt` - API key hashing
- `uuid` - Unique ID generation
- `ws` - WebSocket support
- `crypto` - SHA-256 for content addressing

### Frontend Additions
- New wizard components
- WebSocket client integration

## Data Models

### Graph Model

```typescript
interface Graph {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  version: number
  parentGraphId?: string      // For branched graphs
  branchPoint?: number        // Version number when branched
  status: 'active' | 'archived' | 'deleted'
  metadata: GraphMetadata
}

interface GraphMetadata {
  eventCount: number
  arcCount: number
  relationshipCount: number
  temporalRange?: {
    start: string
    end: string
  }
}

interface CreateGraphRequest {
  name: string
  description?: string
}

interface UpdateGraphRequest {
  name?: string
  description?: string
  status?: 'active' | 'archived'
}
```

### Git-like Version Model

```typescript
// Content-addressable object (stored by SHA-256 hash)
interface ContentObject {
  type: 'event' | 'arc' | 'relationship' | 'pressure'
  data: Record<string, unknown>
}

// Tree object maps entity IDs to content hashes
interface TreeObject {
  events: Record<string, string>        // entityId -> contentHash
  arcs: Record<string, string>
  relationships: Record<string, string>
  pressures: Record<string, string>
}

// Version reference (delta from parent)
interface VersionRef {
  graphId: string
  version: number
  timestamp: string
  parentVersion: number | null
  operation: VersionOperation
  description?: string
  userId?: string
  
  // Delta - only stores changes
  changes: {
    added: VersionChange[]
    modified: VersionChange[]
    deleted: VersionChange[]
  }
  
  // Root tree hash for fast checkout
  treeHash: string
}

interface VersionChange {
  type: 'event' | 'arc' | 'relationship' | 'pressure'
  id: string
  hash: string
  prevHash?: string  // For modified/deleted
}

type VersionOperation = 
  | 'create'
  | 'update' 
  | 'delete'
  | 'import'
  | 'merge'
  | 'branch'
  | 'rollback'

// Pack file for compressed historical versions
interface PackFile {
  id: string
  createdAt: string
  versionRange: { start: number; end: number }
  objects: Record<string, ContentObject>  // hash -> object
  versions: VersionRef[]
}
```

### Cross-Graph Reference Model

```typescript
// Reference to an entity in another graph
interface EntityRef {
  graphId: string
  entityType: 'event' | 'arc'
  entityId: string
}

// Extended causal relationship supporting cross-graph
interface CrossGraphCausalRelationship {
  id: string
  causeRef: EntityRef | string    // EntityRef for cross-graph, string for local
  effectRef: EntityRef | string
  weight: number
  evidence: string
  confidence: number
  relationship_type: 'direct' | 'indirect' | 'contributory'
  isCrossGraph: boolean
}

// Notification when referenced entity changes
interface ReferenceNotification {
  id: string
  sourceGraphId: string
  sourceEntityId: string
  targetGraphId: string
  changeType: 'modified' | 'deleted'
  timestamp: string
  acknowledged: boolean
}
```

### Export Format

```typescript
interface AlthistoryExport {
  version: '1.0'
  metadata: ExportMetadata
  data: ExportData
  provenance?: ExportProvenance
}

interface ExportMetadata {
  graphId: string
  graphName: string
  description?: string
  exportedAt: string
  sourceVersion: string      // App version
  graphVersion: number       // Graph version at export
  checksum: string           // SHA-256 of data section
  filters?: ExportFilters
}

interface ExportFilters {
  timeRange?: { start: string; end: string }
  actors?: string[]
  targets?: string[]
  arcIds?: string[]
  eventIds?: string[]
}

interface ExportData {
  events: ExportedEvent[]
  arcs: ExportedArc[]
  causalRelationships: ExportedRelationship[]
  inferredPressures?: ExportedPressure[]
  crossGraphRefs?: CrossGraphRef[]
}

interface ExportedEvent {
  id: string
  description: string
  actor: string
  target: string
  timestamp: string
  metadata?: Record<string, unknown>
  sourceRef?: string          // Reference to provenance source
}

interface ExportedArc {
  id: string
  name: string
  description: string
  start_time: string
  end_time: string
  level: number
  parent_arc_id: string | null
  metadata?: Record<string, unknown>
  sourceRef?: string
}

interface ExportedRelationship {
  id: string
  cause_event_id: string
  effect_event_id: string
  weight: number
  evidence: string
  confidence: number
  relationship_type: 'direct' | 'indirect' | 'contributory'
  sourceRef?: string
  // For cross-graph relationships
  causeGraphId?: string
  effectGraphId?: string
}

interface ExportedPressure {
  id: string
  description: string
  confidence_score: number
  pressure_type: 'economic' | 'social' | 'environmental' | 'political'
  evidence_event_ids: string[]
  affected_arc_ids: string[]
}

interface CrossGraphRef {
  localEntityId: string
  localEntityType: 'event' | 'arc' | 'relationship'
  referencedGraphId: string
  referencedEntityId: string
  referencedEntityType: 'event' | 'arc'
  // Optionally embed the referenced entity
  embeddedEntity?: ExportedEvent | ExportedArc
}

interface ExportProvenance {
  sources: DataSource[]
  importHistory: ImportRecord[]
}

interface DataSource {
  id: string
  type: 'wikipedia' | 'wikidata' | 'manual' | 'import' | 'llm-generated' | 'text-extraction'
  url?: string
  accessedAt?: string
  confidence: number
  entityIds: string[]
}

interface ImportRecord {
  id: string
  importedAt: string
  sourceFile?: string
  entityCount: number
  userId?: string
}
```

### API Key Model

```typescript
interface ApiKey {
  id: string
  name: string
  keyHash: string             // bcrypt hash
  keyPrefix: string           // First 8 chars (e.g., "ak_abc12")
  permissions: Permission[]
  rateLimit: RateLimitConfig
  allowedGraphs: string[] | '*'
  createdAt: string
  lastUsedAt?: string
  expiresAt?: string
  isActive: boolean
  metadata?: Record<string, unknown>
}

type Permission = 
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

interface RateLimitConfig {
  requestsPerMinute: number
  requestsPerHour: number
  requestsPerDay: number
  batchSizeLimit: number
  concurrentStreams: number
}

interface CreateApiKeyRequest {
  name: string
  permissions: Permission[]
  rateLimit?: Partial<RateLimitConfig>
  allowedGraphs?: string[] | '*'
  expiresAt?: string
}

interface CreateApiKeyResponse {
  id: string
  key: string               // Full key, shown only once
  keyPrefix: string
  name: string
  permissions: Permission[]
  createdAt: string
}

// Rate limit tracking
interface RateLimitState {
  keyId: string
  minute: { count: number; resetAt: number }
  hour: { count: number; resetAt: number }
  day: { count: number; resetAt: number }
}
```

### Async Job Model

```typescript
interface AsyncJob {
  id: string
  type: 'export' | 'import' | 'ingest'
  status: JobStatus
  progress: number            // 0-100
  createdAt: string
  startedAt?: string
  completedAt?: string
  expiresAt: string           // When results are cleaned up
  
  // Job-specific parameters
  parameters: ExportJobParams | ImportJobParams | IngestJobParams
  
  // Results
  result?: JobResult
  
  // Webhook
  webhookUrl?: string
  webhookSent?: boolean
}

type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

interface ExportJobParams {
  graphId: string
  scope: 'full' | 'filtered'
  filters?: ExportFilters
  includeProvenance: boolean
}

interface ImportJobParams {
  graphId: string
  mode: 'merge' | 'replace' | 'create-new'
  conflictResolution: 'skip' | 'overwrite' | 'rename'
  dataChecksum: string
}

interface IngestJobParams {
  type: 'wikipedia' | 'wikidata' | 'text'
  source: WikipediaIngestParams | WikidataIngestParams | TextIngestParams
}

interface WikipediaIngestParams {
  url: string
  followLinks: boolean
  linkDepth: number
  linkFilter?: string
  maxPages: number
}

interface WikidataIngestParams {
  queryType: 'historical-events' | 'person-timeline' | 'custom'
  parameters: Record<string, string>
  limit: number
}

interface TextIngestParams {
  text: string
  context?: {
    defaultTimeRange?: { start: string; end: string }
    defaultActors?: string[]
    locale?: string
  }
  useLLM: boolean
}

interface JobResult {
  outputPath?: string
  summary?: Record<string, unknown>
  errors?: string[]
  warnings?: string[]
}
```

### Ingestion Models

```typescript
interface ExtractedEvent {
  tempId: string              // Temporary ID before import
  description: string
  actor: string
  target: string
  timestamp: string
  confidence: number
  source: ExtractionSource
  selected: boolean           // For UI selection
  edited: boolean             // Track if user edited
}

interface ExtractedArc {
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

interface ExtractedRelationship {
  tempId: string
  causeEventTempId: string
  effectEventTempId: string
  weight: number
  confidence: number
  reasoning: string
  source: ExtractionSource
  selected: boolean
}

interface ExtractionSource {
  type: 'wikipedia' | 'wikidata' | 'text' | 'llm'
  url?: string
  articleTitle?: string
  wikidataId?: string
  extractedAt: string
}

interface ExtractionResult {
  events: ExtractedEvent[]
  arcs: ExtractedArc[]
  relationships: ExtractedRelationship[]
  sources: DataSource[]
  overallConfidence: number
}

interface IngestionPreview {
  jobId: string
  status: 'review'
  extraction: ExtractionResult
  validationIssues: ValidationIssue[]
}

interface ValidationIssue {
  entityTempId: string
  entityType: 'event' | 'arc' | 'relationship'
  severity: 'error' | 'warning'
  message: string
}
```

### Import Models

```typescript
interface ImportValidationResult {
  valid: boolean
  errors: ImportError[]
  warnings: ImportWarning[]
  summary: ImportSummary
}

interface ImportError {
  path: string                // JSON path to error
  message: string
  code: string
}

interface ImportWarning {
  path: string
  message: string
  code: string
}

interface ImportSummary {
  eventCount: number
  arcCount: number
  relationshipCount: number
  pressureCount: number
  crossRefCount: number
  temporalRange?: { start: string; end: string }
  actors: string[]
  conflicts: ImportConflict[]
}

interface ImportConflict {
  id: string
  type: 'duplicate-id' | 'temporal-violation' | 'causal-paradox' | 'orphan-reference'
  severity: 'error' | 'warning'
  entityType: 'event' | 'arc' | 'relationship'
  entityId: string
  existingEntity?: Record<string, unknown>
  incomingEntity: Record<string, unknown>
  suggestedResolution: 'skip' | 'overwrite' | 'rename'
  message: string
}

interface ImportPreview {
  toCreate: EntityCounts
  toUpdate: EntityCounts
  toDelete: EntityCounts      // Only for 'replace' mode
  conflicts: ImportConflict[]
}

interface EntityCounts {
  events: number
  arcs: number
  relationships: number
  pressures: number
}

interface ImportOptions {
  graphId: string
  mode: 'merge' | 'replace' | 'create-new'
  conflictResolution: 'skip' | 'overwrite' | 'rename' | 'manual'
  manualResolutions?: Record<string, 'skip' | 'overwrite' | 'rename'>
}

interface ImportResult {
  success: boolean
  graphId: string
  graphVersion: number
  imported: EntityCounts
  skipped: EntityCounts
  errors: ImportError[]
  warnings: ImportWarning[]
}
```

### LLM Integration Models

```typescript
interface LLMConfig {
  enabled: boolean
  provider: 'openai' | 'anthropic' | 'none'
  model?: string
  maxTokens?: number
  temperature?: number
  timeout?: number
  // Keys read from env vars, never stored
}

interface LLMClient {
  provider: string
  
  extractEvents(text: string, context?: ExtractionContext): Promise<ExtractedEvent[]>
  suggestRelationships(events: ExtractedEvent[]): Promise<ExtractedRelationship[]>
  enrichDescription(event: ExtractedEvent): Promise<string>
}

interface ExtractionContext {
  defaultTimeRange?: { start: string; end: string }
  defaultActors?: string[]
  knownEntities?: string[]
  locale?: string
  instructions?: string
}

interface LLMExtractionPrompt {
  systemPrompt: string
  userPrompt: string
  responseFormat: 'json' | 'text'
  schema?: Record<string, unknown>  // JSON schema for response
}
```

### WebSocket Streaming Models

```typescript
// Token for WebSocket authentication
interface StreamToken {
  token: string
  apiKeyId: string
  graphId: string
  permissions: Permission[]
  createdAt: string
  expiresAt: string
}

// WebSocket message types (Client -> Server)
type ClientMessage = 
  | { type: 'auth'; token: string }
  | { type: 'event'; data: CreateEventRequest; requestId?: string }
  | { type: 'arc'; data: CreateArcRequest; requestId?: string }
  | { type: 'relationship'; data: CreateRelationshipRequest; requestId?: string }
  | { type: 'flush' }
  | { type: 'close'; saveProgress: boolean }

// WebSocket message types (Server -> Client)
type ServerMessage =
  | { type: 'auth_result'; success: boolean; sessionId?: string; error?: string }
  | { type: 'ack'; requestId?: string; entityType: string; entityId: string; success: boolean; error?: string }
  | { type: 'batch_ack'; processed: number; failed: number; errors?: string[] }
  | { type: 'warning'; entityId: string; message: string }
  | { type: 'suggestion'; suggestionType: 'relationship' | 'arc'; data: Record<string, unknown> }
  | { type: 'error'; message: string; code: string }
  | { type: 'closed'; reason: string }

interface StreamSession {
  id: string
  apiKeyId: string
  graphId: string
  connectedAt: string
  lastActivityAt: string
  messagesReceived: number
  entitiesCreated: number
}
```

## API Specifications

### Graph Management API

```
GET /api/graphs
  Query: ?status=active&limit=50&offset=0
  Response: { graphs: Graph[], total: number }

POST /api/graphs
  Body: CreateGraphRequest
  Response: Graph

GET /api/graphs/:id
  Response: Graph

PUT /api/graphs/:id
  Body: UpdateGraphRequest
  Response: Graph

DELETE /api/graphs/:id
  Response: { success: true }

POST /api/graphs/:id/activate
  Response: { activeGraphId: string }

GET /api/graphs/:id/versions
  Query: ?limit=50&offset=0
  Response: { versions: VersionRef[], total: number }

POST /api/graphs/:id/rollback/:version
  Response: Graph

POST /api/graphs/:id/branch
  Body: { name: string; description?: string }
  Response: Graph

POST /api/graphs/:id/merge
  Body: { 
    sourceGraphId: string
    conflictResolution: 'keep-target' | 'keep-source' | 'manual'
    manualResolutions?: Record<string, 'keep-target' | 'keep-source'>
  }
  Response: { 
    success: boolean
    conflicts?: MergeConflict[]
    mergedGraph?: Graph 
  }
```

### Export API

```
GET /api/export
  Query: ?graphId=xxx&scope=full&includeProvenance=true&filters[actors]=a,b
  Response: AlthistoryExport (JSON file)

POST /api/export/jobs
  Body: {
    graphId: string
    scope: 'full' | 'filtered'
    filters?: ExportFilters
    includeProvenance: boolean
    webhook?: string
  }
  Response: { jobId: string; estimatedSize: number; estimatedTime: number }

GET /api/export/jobs/:id
  Response: AsyncJob

GET /api/export/jobs/:id/download
  Response: AlthistoryExport (file download)

DELETE /api/export/jobs/:id
  Response: { success: true }
```

### Import API

```
POST /api/import/validate
  Body: AlthistoryExport | { url: string }
  Response: ImportValidationResult

POST /api/import/preview
  Body: {
    data: AlthistoryExport
    targetGraphId?: string
    mode: 'merge' | 'replace' | 'create-new'
  }
  Response: ImportPreview

POST /api/import
  Body: {
    data: AlthistoryExport
    targetGraphId?: string
    mode: 'merge' | 'replace' | 'create-new'
    conflictResolution: 'skip' | 'overwrite' | 'rename' | 'manual'
    manualResolutions?: Record<string, 'skip' | 'overwrite' | 'rename'>
  }
  Response: ImportResult
```

### Ingestion API

```
POST /api/ingest/url
  Body: {
    url: string
    strategy: 'wikipedia' | 'auto'
    options: {
      followLinks: boolean
      linkDepth: number
      linkFilter?: string
      maxPages: number
    }
  }
  Response: { jobId: string; estimatedPages: number }

POST /api/ingest/wikidata
  Body: {
    queryType: 'historical-events' | 'person-timeline' | 'custom'
    parameters: Record<string, string>
    limit: number
  }
  Response: { jobId: string }

POST /api/ingest/text
  Body: {
    text: string
    context?: ExtractionContext
    useLLM?: boolean
  }
  Response: ExtractionResult (sync for small text)

GET /api/ingest/jobs/:id
  Response: AsyncJob

GET /api/ingest/jobs/:id/preview
  Response: IngestionPreview

POST /api/ingest/jobs/:id/approve
  Body: {
    approvedEventIds: string[]
    approvedArcIds: string[]
    approvedRelationshipIds: string[]
    edits?: Record<string, Partial<ExtractedEvent | ExtractedArc>>
    targetGraphId: string
  }
  Response: ImportResult

DELETE /api/ingest/jobs/:id
  Response: { success: true }
```

### Batch API

```
POST /api/batch/events
  Headers: X-API-Key: <key>
  Body: {
    graphId: string
    events: CreateEventRequest[]
    validation: 'strict' | 'lenient' | 'skip'
    onError: 'abort' | 'skip' | 'collect'
  }
  Response: {
    success: boolean
    created: string[]
    failed: { index: number; error: string }[]
    validationWarnings?: ValidationWarning[]
  }

POST /api/batch/arcs
  Body: { graphId: string; arcs: CreateArcRequest[]; validation: string; onError: string }
  Response: { success: boolean; created: string[]; failed: { index: number; error: string }[] }

POST /api/batch/relationships
  Body: { graphId: string; relationships: CreateRelationshipRequest[]; validation: string; onError: string }
  Response: { success: boolean; created: string[]; failed: { index: number; error: string }[] }

POST /api/batch/transaction
  Body: {
    graphId: string
    operations: BatchOperation[]
    atomic: boolean
  }
  Response: {
    success: boolean
    results: BatchOperationResult[]
    rollbackPerformed?: boolean
  }
```

### Validation API

```
POST /api/validate/graph
  Body: {
    events: Event[]
    arcs: Arc[]
    relationships: CausalRelationship[]
    checks: ('temporal' | 'causal' | 'referential' | 'all')[]
  }
  Response: {
    valid: boolean
    errors: {
      temporal: TemporalError[]
      causal: CausalError[]
      referential: ReferentialError[]
    }
    warnings: ValidationWarning[]
    suggestions: {
      missingArcs: SuggestedArc[]
      missingRelationships: CausalSuggestion[]
    }
  }

POST /api/validate/incremental
  Body: {
    graphId: string
    additions: {
      events?: Event[]
      arcs?: Arc[]
      relationships?: CausalRelationship[]
    }
  }
  Response: {
    valid: boolean
    conflicts: ConflictDetail[]
    wouldCreate: EntityCounts
  }
```

### Suggestion API

```
POST /api/suggest/relationships
  Body: {
    graphId?: string
    events?: Event[]
    options: {
      minConfidence: number
      maxSuggestions: number
      includeIndirect: boolean
    }
  }
  Response: { suggestions: CausalSuggestion[] }

POST /api/suggest/arcs
  Body: {
    graphId?: string
    events?: Event[]
    options: {
      minClusterSize: number
      temporalWindow: string
    }
  }
  Response: { suggestions: ArcSuggestion[] }

POST /api/suggest/completeness
  Body: { graphId: string }
  Response: {
    gaps: {
      temporalGaps: { start: string; end: string; suggestion: string }[]
      actorGaps: { actor: string; lastSeen: string; suggestion: string }[]
      causalGaps: { eventId: string; missingCause: boolean; missingEffect: boolean }[]
    }
    overallCompleteness: number
  }
```

### API Key Management

```
POST /api/keys
  Body: CreateApiKeyRequest
  Response: CreateApiKeyResponse

GET /api/keys
  Response: { keys: ApiKey[] }  // Keys have hash removed, only prefix shown

GET /api/keys/:id
  Response: ApiKey

PUT /api/keys/:id
  Body: { permissions?: Permission[]; rateLimit?: RateLimitConfig; isActive?: boolean }
  Response: ApiKey

DELETE /api/keys/:id
  Response: { success: true }
```

### Stream Token Endpoint

```
POST /api/stream/token
  Headers: X-API-Key: <key>
  Body: { graphId: string }
  Response: { token: string; expiresIn: number }
```

### WebSocket Endpoint

```
WS /api/ws/stream?token=<stream_token>

Connection Flow:
1. Client connects with token in query string
2. Server validates token and sends auth_result
3. Client sends event/arc/relationship messages
4. Server sends ack for each message
5. Server may send warnings or suggestions
6. Client sends close when done
```

## Local Mode Storage Structure

```
data/
+-- graphs/
|   +-- index.json                    # List of all graphs
|   +-- {graphId}/
|       +-- graph.json                # Graph metadata
|       +-- current.json              # Current tree hash
|       +-- objects/
|       |   +-- {hash}.json           # Content-addressable objects
|       +-- versions/
|       |   +-- {version}.json        # Version refs
|       +-- packs/
|           +-- pack-{timestamp}.json # Compressed historical data
|
+-- jobs/
|   +-- index.json                    # Active jobs
|   +-- {jobId}.json                  # Job details
|
+-- exports/
|   +-- {jobId}/
|       +-- export.json               # Export result
|
+-- ingestion/
|   +-- {jobId}/
|       +-- extraction.json           # Extraction results
|       +-- approved.json             # Approved entities
|
+-- keys/
|   +-- keys.json                     # API keys (hashed)
|
+-- rate-limits/
|   +-- limits.json                   # Current rate limit state
|
+-- cache.json                        # General cache
+-- config.json                       # Local config
```

## Frontend Components

### Graph Management

```typescript
// GraphSelector - Dropdown in header
interface GraphSelectorProps {
  currentGraphId: string
  onGraphChange: (graphId: string) => void
}

// GraphManagerModal - Full management UI
interface GraphManagerModalProps {
  isOpen: boolean
  onClose: () => void
  onGraphSelect: (graph: Graph) => void
  onGraphCreate: (request: CreateGraphRequest) => void
  onGraphBranch: (graphId: string, name: string) => void
  onGraphDelete: (graphId: string) => void
}

// GraphCard - Individual graph in list
interface GraphCardProps {
  graph: Graph
  isActive: boolean
  onSelect: () => void
  onBranch: () => void
  onDelete: () => void
  onViewHistory: () => void
}

// VersionHistoryPanel - Version timeline
interface VersionHistoryPanelProps {
  graphId: string
  versions: VersionRef[]
  onRollback: (version: number) => void
}
```

### Import Wizard

```typescript
// ImportWizard - Main container
interface ImportWizardProps {
  isOpen: boolean
  onClose: () => void
  onImportComplete: (result: ImportResult) => void
  targetGraphId: string
}

// Steps
interface ImportUploadStepProps {
  onUpload: (data: AlthistoryExport) => void
  onPaste: (json: string) => void
}

interface ImportValidationStepProps {
  validation: ImportValidationResult
  onContinue: () => void
  onBack: () => void
}

interface ImportPreviewStepProps {
  preview: ImportPreview
  onContinue: () => void
  onBack: () => void
}

interface ImportConflictStepProps {
  conflicts: ImportConflict[]
  resolutions: Record<string, 'skip' | 'overwrite' | 'rename'>
  onResolve: (conflictId: string, resolution: 'skip' | 'overwrite' | 'rename') => void
  onContinue: () => void
  onBack: () => void
}

interface ImportExecuteStepProps {
  isExecuting: boolean
  progress: number
  result?: ImportResult
  onExecute: () => void
  onBack: () => void
}
```

### Ingestion Wizard

```typescript
// IngestionWizard - Main container with tabs
interface IngestionWizardProps {
  isOpen: boolean
  onClose: () => void
  onIngestComplete: (result: ImportResult) => void
  targetGraphId: string
}

// Tab components
interface WikipediaTabProps {
  onSubmit: (params: WikipediaIngestParams) => void
}

interface WikidataTabProps {
  onSubmit: (params: WikidataIngestParams) => void
}

interface TextTabProps {
  onSubmit: (params: TextIngestParams) => void
}

// Review components
interface EntityReviewTableProps {
  entities: (ExtractedEvent | ExtractedArc | ExtractedRelationship)[]
  entityType: 'event' | 'arc' | 'relationship'
  onToggleSelection: (tempId: string) => void
  onEdit: (tempId: string, updates: Partial<ExtractedEvent | ExtractedArc>) => void
  onSelectAll: () => void
  onDeselectAll: () => void
}
```

### API Key Dashboard

```typescript
interface ApiKeyDashboardProps {
  // Admin-only component
}

interface CreateKeyModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (request: CreateApiKeyRequest) => void
}

interface KeyListItemProps {
  apiKey: ApiKey
  onEdit: () => void
  onRevoke: () => void
}

interface KeyUsageStatsProps {
  keyId: string
  rateLimit: RateLimitConfig
  currentUsage: RateLimitState
}
```

### Export Panel

```typescript
interface ExportPanelProps {
  currentGraphId: string
  onExportStart: (options: ExportJobParams) => void
}

interface ExportHistoryListProps {
  jobs: AsyncJob[]
  onDownload: (jobId: string) => void
  onDelete: (jobId: string) => void
}
```

## Error Handling

### New Error Classes

```typescript
class GraphNotFoundError extends AppError {
  readonly statusCode = 404
  readonly isOperational = true
  constructor(graphId: string) {
    super(`Graph not found: ${graphId}`)
  }
}

class GraphVersionError extends AppError {
  readonly statusCode = 400
  readonly isOperational = true
  constructor(message: string, public readonly version?: number) {
    super(message)
  }
}

class ImportValidationError extends AppError {
  readonly statusCode = 400
  readonly isOperational = true
  constructor(
    message: string,
    public readonly errors: ImportError[]
  ) {
    super(message)
  }
}

class RateLimitExceededError extends AppError {
  readonly statusCode = 429
  readonly isOperational = true
  constructor(
    public readonly retryAfter: number,
    public readonly limit: string
  ) {
    super(`Rate limit exceeded. Retry after ${retryAfter} seconds.`)
  }
}

class ApiKeyError extends AppError {
  readonly statusCode = 401
  readonly isOperational = true
  constructor(message: string) {
    super(message)
  }
}

class IngestionError extends AppError {
  readonly statusCode = 500
  readonly isOperational = true
  constructor(
    message: string,
    public readonly source: string,
    public readonly stage: string
  ) {
    super(message)
  }
}

class CrossGraphReferenceError extends AppError {
  readonly statusCode = 400
  readonly isOperational = true
  constructor(
    message: string,
    public readonly sourceGraphId: string,
    public readonly targetGraphId: string,
    public readonly entityId: string
  ) {
    super(message)
  }
}
```

## Security Considerations

1. **API Key Storage**: Keys are hashed with bcrypt before storage. Original key shown only once on creation.

2. **Rate Limiting**: Enforced at middleware level. Local mode uses in-memory tracking.

3. **Input Validation**: All imports validated for structure, constraints, and content.

4. **WebSocket Auth**: Short-lived tokens (5 min) tied to API keys. Tokens not reusable after connection.

5. **LLM Keys**: Read from environment variables, never exposed in API or UI.

6. **Cross-Graph Access**: Permissions checked for both source and target graphs.

## Performance Considerations

1. **Git-like Versioning**: Delta storage minimizes disk usage. Pack files compress old versions.

2. **Async Jobs**: Large operations (export, import, ingest) run asynchronously with progress tracking.

3. **Batch Operations**: Up to 1000 entities per batch to balance throughput and memory.

4. **Streaming**: WebSocket streaming avoids HTTP overhead for high-volume writes.

5. **Local Mode**: All operations work without external databases, using file-based storage.
