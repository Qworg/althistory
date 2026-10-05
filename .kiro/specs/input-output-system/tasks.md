# Implementation Plan

## Phase 1: Foundation (Multi-Graph + Export)

- [ ] 1.1 Create Graph model and types
  - Define Graph, GraphMetadata interfaces in `timeline/src/models/Graph.ts`
  - Create GraphVersion, VersionRef, ContentObject interfaces
  - Add cross-graph reference types (EntityRef, CrossGraphCausalRelationship)
  - Export all types from models index
  - _Requirements: 1, 2, 4_

- [ ] 1.2 Implement Git-like VersionRepository
  - Create `timeline/src/repositories/VersionRepository.ts`
  - Implement ObjectStore for content-addressable storage (SHA-256 hashing)
  - Implement delta computation between versions
  - Add tree object management (mapping entity IDs to content hashes)
  - Create garbage collection for pack files
  - Add local mode file-based storage
  - Write unit tests for versioning operations
  - _Requirements: 2.1, 2.4, 2.5, 21.4_

- [ ] 1.3 Implement GraphRepository
  - Create `timeline/src/repositories/GraphRepository.ts`
  - Implement CRUD operations for graphs
  - Add version history retrieval
  - Implement rollback functionality using VersionRepository
  - Add local mode JSON file storage in `data/graphs/`
  - Write unit tests for graph operations
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 21.1_

- [ ] 1.4 Implement GraphService
  - Create `timeline/src/services/GraphService.ts`
  - Implement graph management business logic
  - Add branching functionality (create graph sharing parent history)
  - Implement merge with conflict detection
  - Add cross-graph reference validation
  - Wire up to container for dependency injection
  - Write integration tests
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3_

- [ ] 1.5 Create graph API routes
  - Create `timeline/src/api/routes/graphs.ts`
  - Implement GET /api/graphs (list all)
  - Implement POST /api/graphs (create)
  - Implement GET /api/graphs/:id (get one)
  - Implement PUT /api/graphs/:id (update)
  - Implement DELETE /api/graphs/:id (soft delete)
  - Implement POST /api/graphs/:id/activate
  - Implement GET /api/graphs/:id/versions
  - Implement POST /api/graphs/:id/rollback/:version
  - Implement POST /api/graphs/:id/branch
  - Implement POST /api/graphs/:id/merge
  - Register routes in main router
  - Write API tests
  - _Requirements: 1, 2, 3_

- [ ] 1.6 Implement ExportService
  - Create `timeline/src/services/ExportService.ts`
  - Implement AlthistoryExport format generation
  - Add filtered export capability (by time range, actors, etc.)
  - Implement provenance tracking in exports
  - Add SHA-256 checksum calculation
  - Handle cross-graph references in exports
  - Write unit tests
  - _Requirements: 5.1, 5.2, 5.3, 5.6, 4.4_

- [ ] 1.7 Implement JobRepository and JobService
  - Create `timeline/src/models/AsyncJob.ts` with job types
  - Create `timeline/src/repositories/JobRepository.ts`
  - Implement job persistence in `data/jobs/` for local mode
  - Create `timeline/src/services/JobService.ts`
  - Add progress tracking and status updates
  - Implement job expiration and cleanup
  - Write unit tests
  - _Requirements: 22.1, 22.2, 22.3, 22.5, 21.2_

- [ ] 1.8 Create export API routes
  - Create `timeline/src/api/routes/export.ts`
  - Implement GET /api/export (synchronous for small graphs)
  - Implement POST /api/export/jobs (async job creation)
  - Implement GET /api/export/jobs/:id (job status)
  - Implement GET /api/export/jobs/:id/download (file download)
  - Implement DELETE /api/export/jobs/:id (cancel/delete)
  - Register routes in main router
  - Write API tests
  - _Requirements: 5.4, 5.5_

- [ ] 1.9 Frontend: Graph selector component
  - Create `frontend/src/components/graphs/GraphSelector.tsx`
  - Implement dropdown showing current graph name
  - Add graph metadata display (event count, date range)
  - Handle graph switching with full state reload
  - Create `frontend/src/hooks/useGraphs.ts` for data fetching
  - Write component tests
  - _Requirements: 17.1_

- [ ] 1.10 Frontend: Graph management modal
  - Create `frontend/src/components/graphs/GraphManagerModal.tsx`
  - Create `frontend/src/components/graphs/GraphCard.tsx` for list items
  - Create `frontend/src/components/graphs/CreateGraphModal.tsx`
  - Create `frontend/src/components/graphs/BranchGraphModal.tsx`
  - Implement graph list with metadata cards
  - Add create, branch, delete actions
  - Write component tests
  - _Requirements: 17.2, 17.3, 17.4_

- [ ] 1.11 Frontend: Version history panel
  - Create `frontend/src/components/graphs/VersionHistoryPanel.tsx`
  - Display version timeline with operation types
  - Add rollback buttons with confirmation dialog
  - Show version details on hover/click
  - Write component tests
  - _Requirements: 17.5_

- [ ] 1.12 Frontend: Export panel
  - Create `frontend/src/components/export/ExportPanel.tsx`
  - Create `frontend/src/components/export/ExportHistoryList.tsx`
  - Implement export options form (scope, filters, provenance)
  - Add async job progress tracking
  - Handle download when complete
  - Create `frontend/src/hooks/useExport.ts`
  - Write component tests
  - _Requirements: 5.4, 5.5_

## Phase 2: Import System

- [ ] 2.1 Implement ImportService validation
  - Create `timeline/src/services/ImportService.ts`
  - Implement format validation (check required fields, types)
  - Add temporal constraint checking (events within arcs)
  - Add causal consistency checking (cause before effect)
  - Add referential integrity checking (no orphan references)
  - Write unit tests for each validation type
  - _Requirements: 6.1, 6.2_

- [ ] 2.2 Implement conflict detection
  - Add conflict detection for duplicate IDs
  - Detect temporal constraint violations with existing data
  - Detect causal paradoxes
  - Implement conflict resolution strategies (skip, overwrite, rename)
  - Generate unique IDs for 'rename' resolution
  - Write unit tests
  - _Requirements: 6.4_

- [ ] 2.3 Implement import preview
  - Create diff calculation (entities to create, update, delete)
  - Compare incoming data with existing graph state
  - Format preview response with counts and conflict details
  - Write unit tests
  - _Requirements: 6.3_

- [ ] 2.4 Implement import execution
  - Create atomic import with version transaction
  - Implement rollback on any failure
  - Apply conflict resolutions
  - Record provenance for imported entities
  - Update graph version with import commit
  - Write integration tests
  - _Requirements: 6.5, 6.6_

- [ ] 2.5 Create import API routes
  - Create `timeline/src/api/routes/import.ts`
  - Implement POST /api/import/validate
  - Implement POST /api/import/preview
  - Implement POST /api/import
  - Handle large imports as async jobs
  - Register routes in main router
  - Write API tests
  - _Requirements: 6_

- [ ] 2.6 Frontend: Import wizard
  - Create `frontend/src/components/import/ImportWizard.tsx` (main container)
  - Create `frontend/src/components/import/ImportUploadStep.tsx`
  - Create `frontend/src/components/import/ImportValidationStep.tsx`
  - Create `frontend/src/components/import/ImportPreviewStep.tsx`
  - Create `frontend/src/components/import/ImportConflictStep.tsx`
  - Create `frontend/src/components/import/ImportExecuteStep.tsx`
  - Create `frontend/src/components/import/ConflictResolutionRow.tsx`
  - Implement step navigation and state management
  - Create `frontend/src/hooks/useImport.ts`
  - Write component tests
  - _Requirements: 18_

## Phase 3: Authentication & Batch API

- [ ] 3.1 Create ApiKey model
  - Create `timeline/src/models/ApiKey.ts`
  - Define ApiKey interface with permissions
  - Define RateLimitConfig interface
  - Define Permission type union
  - Add key generation utilities (crypto.randomBytes)
  - _Requirements: 11.1_

- [ ] 3.2 Implement ApiKeyRepository
  - Create `timeline/src/repositories/ApiKeyRepository.ts`
  - Implement CRUD operations for keys
  - Implement bcrypt hashing for key storage
  - Add key lookup by prefix
  - Add local mode storage in `data/keys/keys.json`
  - Write unit tests
  - _Requirements: 11.2, 11.5, 21.1_

- [ ] 3.3 Implement AuthService
  - Create `timeline/src/services/AuthService.ts`
  - Implement key validation against hash
  - Add permission checking logic
  - Implement secure key generation
  - Add key prefix extraction
  - Wire up to container
  - Write unit tests
  - _Requirements: 11.3, 11.4_

- [ ] 3.4 Implement RateLimitService
  - Create `timeline/src/services/RateLimitService.ts`
  - Implement rate limit tracking (per minute, hour, day)
  - Add Redis-based tracking for cloud mode
  - Add in-memory tracking for local mode
  - Implement limit checking with header generation
  - Add warning logging when approaching limits
  - Write unit tests
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 21.3_

- [ ] 3.5 Create auth middleware
  - Update `timeline/src/api/middleware.ts`
  - Implement X-API-Key header validation
  - Add permission checking middleware factory
  - Add rate limit middleware
  - Include rate limit headers in responses
  - Write middleware tests
  - _Requirements: 11.3, 12_

- [ ] 3.6 Create API key routes
  - Create `timeline/src/api/routes/keys.ts`
  - Implement POST /api/keys (create, returns full key once)
  - Implement GET /api/keys (list, masked)
  - Implement GET /api/keys/:id
  - Implement PUT /api/keys/:id (update permissions, limits)
  - Implement DELETE /api/keys/:id (revoke)
  - Register routes with admin-only auth
  - Write API tests
  - _Requirements: 11_

- [ ] 3.7 Implement batch endpoints
  - Create `timeline/src/api/routes/batch.ts`
  - Implement POST /api/batch/events
  - Implement POST /api/batch/arcs
  - Implement POST /api/batch/relationships
  - Implement POST /api/batch/transaction (atomic)
  - Add validation modes (strict/lenient/skip)
  - Add error handling modes (abort/skip/collect)
  - Apply auth middleware to all routes
  - Write API tests
  - _Requirements: 13_

- [ ] 3.8 Implement validation endpoint
  - Create `timeline/src/api/routes/validate.ts`
  - Implement POST /api/validate/graph
  - Implement POST /api/validate/incremental
  - Return detailed error messages per violation
  - Include suggestions when valid
  - Write API tests
  - _Requirements: 14_

- [ ] 3.9 Enhance InferenceService for suggestions API
  - Update `timeline/src/services/InferenceService.ts`
  - Expose relationship suggestions as API-friendly format
  - Add arc suggestion generation (cluster events)
  - Add completeness analysis (gaps, missing links)
  - Write unit tests
  - _Requirements: 15_

- [ ] 3.10 Create suggestion routes
  - Create `timeline/src/api/routes/suggest.ts`
  - Implement POST /api/suggest/relationships
  - Implement POST /api/suggest/arcs
  - Implement POST /api/suggest/completeness
  - Apply auth middleware
  - Write API tests
  - _Requirements: 15_

- [ ] 3.11 Frontend: API key dashboard
  - Create `frontend/src/components/api-keys/ApiKeyDashboard.tsx`
  - Create `frontend/src/components/api-keys/CreateKeyModal.tsx`
  - Create `frontend/src/components/api-keys/KeyListItem.tsx`
  - Create `frontend/src/components/api-keys/KeyUsageStats.tsx`
  - Implement key creation with one-time display
  - Add copy-to-clipboard for new keys
  - Show usage statistics
  - Create `frontend/src/hooks/useApiKeys.ts`
  - Write component tests
  - _Requirements: 20_

## Phase 4: Web Ingestion

- [ ] 4.1 Implement WikipediaExtractor
  - Create `timeline/src/services/ingestion/WikipediaExtractor.ts`
  - Implement article fetching via MediaWiki API
  - Parse infoboxes for structured data
  - Parse timeline/history sections
  - Extract dates from prose text using patterns
  - Implement link following with depth control
  - Add link filtering by regex pattern
  - Generate confidence scores for extractions
  - Write unit tests with mock API responses
  - _Requirements: 7_

- [ ] 4.2 Implement WikidataExtractor
  - Create `timeline/src/services/ingestion/WikidataExtractor.ts`
  - Implement SPARQL query execution against Wikidata endpoint
  - Create predefined queries (historical events, person timeline)
  - Support custom SPARQL queries
  - Map Wikidata entities to Althistory event format
  - Include Wikidata IDs in provenance
  - Write unit tests with mock responses
  - _Requirements: 8_

- [ ] 4.3 Implement TextExtractor (pattern-based)
  - Create `timeline/src/services/ingestion/TextExtractor.ts`
  - Implement date pattern recognition (multiple formats)
  - Add basic named entity extraction
  - Implement sentence segmentation around dates
  - Calculate confidence scores based on pattern clarity
  - Write unit tests
  - _Requirements: 9.1, 9.3, 9.4_

- [ ] 4.4 Implement LLMClient abstraction
  - Create `timeline/src/services/llm/LLMClient.ts` (interface)
  - Create `timeline/src/services/llm/OpenAIClient.ts`
  - Create `timeline/src/services/llm/AnthropicClient.ts`
  - Create `timeline/src/services/llm/prompts.ts` (extraction prompts)
  - Read API keys from environment variables
  - Implement structured JSON response parsing
  - Add timeout and error handling
  - Write unit tests with mock responses
  - _Requirements: 10.1, 10.2, 10.5_

- [ ] 4.5 Enhance TextExtractor with LLM
  - Update TextExtractor to accept optional LLMClient
  - Implement LLM-powered extraction as primary method
  - Fall back to pattern-based when LLM unavailable/fails
  - Track extraction source in provenance (llm vs pattern)
  - Write integration tests
  - _Requirements: 9.2, 10.3, 10.4_

- [ ] 4.6 Implement IngestionOrchestrator
  - Create `timeline/src/services/ingestion/IngestionOrchestrator.ts`
  - Coordinate different extractors based on source type
  - Manage ingestion jobs (create, update progress, complete)
  - Store extraction results for review
  - Implement approve workflow (convert approved to import)
  - Handle partial imports (only selected entities)
  - Write integration tests
  - _Requirements: 7.5, 7.6, 8.5, 9.5_

- [ ] 4.7 Create ingestion API routes
  - Create `timeline/src/api/routes/ingest.ts`
  - Implement POST /api/ingest/url (Wikipedia)
  - Implement POST /api/ingest/wikidata
  - Implement POST /api/ingest/text (sync for small text)
  - Implement GET /api/ingest/jobs/:id
  - Implement GET /api/ingest/jobs/:id/preview
  - Implement POST /api/ingest/jobs/:id/approve
  - Implement DELETE /api/ingest/jobs/:id
  - Register routes in main router
  - Write API tests
  - _Requirements: 7, 8, 9_

- [ ] 4.8 Frontend: Ingestion wizard - Wikipedia tab
  - Create `frontend/src/components/ingestion/WikipediaTab.tsx`
  - Add URL input with Wikipedia URL validation
  - Add link following toggle and depth selector
  - Add link filter regex input
  - Add max pages limit input
  - Write component tests
  - _Requirements: 19.2_

- [ ] 4.9 Frontend: Ingestion wizard - Wikidata tab
  - Create `frontend/src/components/ingestion/WikidataTab.tsx`
  - Add predefined query selector dropdown
  - Add query parameter inputs (subject, time range)
  - Add custom SPARQL input for advanced users
  - Add result limit input
  - Write component tests
  - _Requirements: 19.1_

- [ ] 4.10 Frontend: Ingestion wizard - Text tab
  - Create `frontend/src/components/ingestion/TextTab.tsx`
  - Add large text input area
  - Add context options (default actors, time range, locale)
  - Add LLM toggle (if configured)
  - Write component tests
  - _Requirements: 19.1_

- [ ] 4.11 Frontend: Entity review table
  - Create `frontend/src/components/ingestion/EntityReviewTable.tsx`
  - Display entities in sortable table
  - Add checkbox column for selection
  - Add inline editing for all fields
  - Show confidence scores with color coding
  - Add select all / deselect all buttons
  - Create `frontend/src/components/ingestion/EntityRow.tsx`
  - Write component tests
  - _Requirements: 19.3, 19.4_

- [ ] 4.12 Frontend: Ingestion wizard container
  - Create `frontend/src/components/ingestion/IngestionWizard.tsx`
  - Implement tab navigation (Wikipedia, Wikidata, Text)
  - Show progress during extraction
  - Transition to review after extraction
  - Implement approve flow with selected entities
  - Show import results
  - Create `frontend/src/hooks/useIngestion.ts`
  - Write component tests
  - _Requirements: 19.5_

## Phase 5: Advanced Features

- [ ] 5.1 Implement WebSocket stream handler
  - Create `timeline/src/websocket/StreamHandler.ts`
  - Implement WebSocket connection handling
  - Validate stream tokens on connection
  - Process event/arc/relationship messages
  - Send acknowledgments for each message
  - Send validation warnings as non-blocking
  - Handle connection lifecycle (close, errors)
  - Write unit tests
  - _Requirements: 16.3, 16.4_

- [ ] 5.2 Create stream token endpoint
  - Create `timeline/src/api/routes/stream.ts`
  - Implement POST /api/stream/token
  - Generate short-lived tokens (5 min expiry)
  - Tie tokens to API keys and permissions
  - Store tokens in memory/Redis
  - Write API tests
  - _Requirements: 16.1_

- [ ] 5.3 Implement stream session management
  - Create `timeline/src/websocket/StreamSession.ts`
  - Track active sessions per API key
  - Enforce concurrent stream limits
  - Handle session timeout and cleanup
  - Log session statistics
  - Create `timeline/src/websocket/StreamProtocol.ts` (message types)
  - Write integration tests
  - _Requirements: 16.2, 16.5_

- [ ] 5.4 Add webhook notifications
  - Update JobService with webhook support
  - Implement HTTP POST on job completion
  - Add retry logic with exponential backoff
  - Log webhook delivery status
  - Write integration tests
  - _Requirements: 22.4_

- [ ] 5.5 Cloud mode adaptations
  - Add Redis-based rate limiting in RateLimitService
  - Add Redis-based job storage in JobRepository
  - Add Neo4j graph versioning in VersionRepository
  - Update GraphRepository for Neo4j
  - Test dual-mode switching
  - Write integration tests
  - _Requirements: 21_

- [ ] 5.6 Frontend: Streaming write hook
  - Create `frontend/src/hooks/useStreamingWrite.ts`
  - Implement WebSocket connection management
  - Add message queue with acknowledgment tracking
  - Handle reconnection with new token
  - Expose streaming state and progress
  - Write hook tests
  - _Requirements: 16_

- [ ] 5.7 Frontend: Real-time indicators
  - Add streaming status indicator component
  - Show write progress during streaming
  - Display error notifications for failed writes
  - Add connection status badge
  - Write component tests
  - _Requirements: 16_

- [ ] 5.8 Cross-graph reference UI
  - Update relationship creation to allow cross-graph selection
  - Add visual indicators for cross-graph references
  - Show notifications for referenced entity changes
  - Handle broken references gracefully
  - Write component tests
  - _Requirements: 4.2, 4.3, 4.5_

- [ ] 5.9 Integration testing
  - Create end-to-end tests for full workflows
  - Test import -> export round-trip data integrity
  - Test ingestion -> review -> import flow
  - Test streaming writes with large datasets
  - Test cross-graph reference scenarios
  - Test graph branching and merging
  - _Requirements: All_

- [ ] 5.10 Documentation
  - Write API documentation (OpenAPI/Swagger)
  - Create export format specification document
  - Write ingestion guide with examples
  - Create external integration guide for automated systems
  - Update CLAUDE.md with new features
  - Update AGENTS.md with new commands
  - _Requirements: All_
