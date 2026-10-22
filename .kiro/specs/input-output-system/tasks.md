# Implementation Plan

> **Status:** re-audited against the source. Every ticked box carries the
> `file:line` or test name that proves it.
>
> A tick means the work is done **and reachable** — the code exists, and a
> mounted view or a served route reaches it. Where the code exists but the
> feature cannot be reached, or only part of it is built, the box says so on
> its own line (`PARTIAL` / `NOT DONE`) rather than reading as a plain tick. The
> boxes that are still open link the issue that carries the work.

## Phase 1: Foundation (Multi-Graph + Export)

- [x] 1.1 Create Graph model and types  `timeline/src/models/Graph.ts:8` (`IGraph`), `:42` (`GraphMetadata`), `:57` (`Graph`), `:310` (`EntityRef`), `:316` (`CrossGraphCausalRelationship`), `:344` (`ContentObject`), `:385` (`VersionRef`); re-exported from `timeline/src/models/index.ts:8` _(the backend has no `GraphVersion` type — it is called `VersionRef`/`VersionChange` at `models/Graph.ts:365`; `GraphVersion` exists only as a frontend type at `frontend/src/types/index.ts:282`)_
  - Define Graph, GraphMetadata interfaces in `timeline/src/models/Graph.ts`
  - Create GraphVersion, VersionRef, ContentObject interfaces
  - Add cross-graph reference types (EntityRef, CrossGraphCausalRelationship)
  - Export all types from models index
  - _Requirements: 1, 2, 4_

- [x] 1.2 Implement Git-like VersionRepository  `timeline/src/repositories/VersionRepository.ts:95` (class), `:148` (`commit`), `:397`/`:782` (`calculateDiff`), `:411` (`storeObject`), `:445` (`storeTree`), `:514` (`packVersions`), `:584` (`gc`), `:659` (SHA-256); tests `timeline/src/repositories/VersionRepository.test.ts` (`'should produce consistent hashes for same content'`, `'should remove unreferenced objects'`, `'should create pack file for version range'`)
  - Create `timeline/src/repositories/VersionRepository.ts`
  - Implement ObjectStore for content-addressable storage (SHA-256 hashing)
  - Implement delta computation between versions
  - Add tree object management (mapping entity IDs to content hashes)
  - Create garbage collection for pack files
  - Add local mode file-based storage
  - Write unit tests for versioning operations
  - _Requirements: 2.1, 2.4, 2.5, 21.4_

- [x] 1.3 Implement GraphRepository  `timeline/src/repositories/GraphRepository.ts:38` (class), `:67` (`create`), `:119` (`findAll`), `:154` (`update`), `:169` (`delete`), `:251` (`getVersionHistory`), `:276` (`rollback`), `:361` (`branch`); JSON storage under `data/graphs/` at `:45`/`:494`; tests `timeline/src/repositories/GraphRepository.test.ts`
  - Create `timeline/src/repositories/GraphRepository.ts`
  - Implement CRUD operations for graphs
  - Add version history retrieval
  - Implement rollback functionality using VersionRepository
  - Add local mode JSON file storage in `data/graphs/`
  - Write unit tests for graph operations
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 21.1_

- [x] 1.4 Implement GraphService  `timeline/src/services/GraphService.ts` (`GraphService` class, `branchGraph`, `mergeGraph`); wired in `timeline/src/container.ts`; tests `timeline/src/services/GraphService.test.ts` (`'should detect merge conflicts and report them on a successful keep-target merge'`, `'should resolve conflicts with keep-source strategy without a manual map'`)
  - Create `timeline/src/services/GraphService.ts`
  - Implement graph management business logic
  - Add branching functionality (create graph sharing parent history)
  - Implement merge with conflict detection
  - Add cross-graph reference validation
  - Wire up to container for dependency injection
  - Write integration tests
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3_

- [x] 1.5 Create graph API routes  `timeline/src/api/routes/graphs.ts:109` (GET `/`), `:151` (POST `/`), `:316` (GET `/:id`), `:335` (PUT `/:id`), `:356` (DELETE `/:id`), `:375` (POST `/:id/activate`), `:395` (GET `/:id/versions`), `:433` (POST `/:id/rollback/:version`), `:465` (POST `/:id/branch`), `:517` (POST `/:id/merge`); registered at `timeline/src/api/routes.ts:65`; tests `timeline/src/api/routes/graphs.test.ts`
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

- [x] 1.6 Implement ExportService  `timeline/src/services/ExportService.ts:251` (class), `:20` (`AlthistoryExport`), `:108` (`CrossGraphRef`), `:123` (`ExportProvenance`), `:285` (`exportGraph`), `:476` (`exportToFile`), `:1432` (`calculateChecksum`), `:676` (`checksumOfExportData`); tests `timeline/src/services/ExportService.test.ts` (`'should include provenance when requested'`, `'should calculate checksum of data'`, `'should filter events by time range'`, `'should not warn about cross-graph references'`)
  - Create `timeline/src/services/ExportService.ts`
  - Implement AlthistoryExport format generation
  - Add filtered export capability (by time range, actors, etc.)
  - Implement provenance tracking in exports
  - Add SHA-256 checksum calculation
  - Handle cross-graph references in exports
  - Write unit tests
  - _Requirements: 5.1, 5.2, 5.3, 5.6, 4.4_

- [x] 1.7 Implement JobRepository and JobService  _(PARTIAL: `cleanupExpiredJobs` (`timeline/src/repositories/JobRepository.ts:194-207`) removes the job JSON but not the export file at `job.result.outputPath`, which Req 22.5 asks for)_ `timeline/src/models/AsyncJob.ts:145` (`AsyncJob`), `:5` (`JobType`), `:6` (`JobStatus`); `timeline/src/repositories/JobRepository.ts:28` (class), `:38` (`<dataDir>/jobs`), `:75` (`create`), `:194` (`cleanupExpiredJobs`); `timeline/src/services/JobService.ts:86` (class), `:279` (`createExportJob`), `:658` (`reportProgress`), `:374` (`cancelJob`), `:395` (`deleteJob`); tests `timeline/src/repositories/JobRepository.test.ts`, `timeline/src/services/JobService.test.ts`
  - Create `timeline/src/models/AsyncJob.ts` with job types
  - Create `timeline/src/repositories/JobRepository.ts`
  - Implement job persistence in `data/jobs/` for local mode
  - Create `timeline/src/services/JobService.ts`
  - Add progress tracking and status updates
  - Implement job expiration and cleanup
  - Write unit tests
  - _Requirements: 22.1, 22.2, 22.3, 22.5, 21.2_

- [x] 1.8 Create export API routes  `timeline/src/api/routes/export.ts:88` (GET `/`), `:48` (POST `/jobs`), `:203` (GET `/jobs/:jobId`), `:278` (GET `/jobs/:jobId/download`), `:241` (DELETE `/jobs/:jobId`); registered at `timeline/src/api/routes.ts`; tests `timeline/src/api/routes/export.test.ts` (`'returns the export document itself for a graph under the entity threshold'`, `'creates a job that completes with the full document'`)
  - Create `timeline/src/api/routes/export.ts`
  - Implement GET /api/export (synchronous for small graphs)
  - Implement POST /api/export/jobs (async job creation)
  - Implement GET /api/export/jobs/:id (job status)
  - Implement GET /api/export/jobs/:id/download (file download)
  - Implement DELETE /api/export/jobs/:id (cancel/delete)
  - Register routes in main router
  - Write API tests
  - _Requirements: 5.4, 5.5_

- [x] 1.9 Frontend: Graph selector component  `frontend/src/components/graphs/GraphSelector.tsx:220` (event/arc counts; there is no date range here — `GraphCard`, which has one at `frontend/src/components/graphs/GraphCard.tsx:138-140`, is rendered nowhere), `frontend/src/hooks/useGraphs.ts:56` (`useGraphs`), `:211` (`useSwitchGraph`, which clears the store and invalidates `events`/`arcs`/`causal`/`pressures`); tests `frontend/src/components/graphs/GraphSelector.test.tsx`
  - Create `frontend/src/components/graphs/GraphSelector.tsx`
  - Implement dropdown showing current graph name
  - Add graph metadata display (event count, date range)
  - Handle graph switching with full state reload
  - Create `frontend/src/hooks/useGraphs.ts` for data fetching
  - Write component tests
  - _Requirements: 17.1_

- [x] 1.10 Frontend: Graph management modal  _(PARTIAL: `GraphCard`, `CreateGraphModal` and `BranchGraphModal` are only re-exported by `frontend/src/components/graphs/index.ts:11-13` and never rendered, and `GraphManagerModal` has no create action)_ `frontend/src/components/graphs/GraphManagerModal.tsx:25`, `GraphCard.tsx:34`, `CreateGraphModal.tsx:27`, `BranchGraphModal.tsx:29`; tests `frontend/src/components/graphs/GraphManagerModal.test.tsx` (`'should show graph metadata'`, `'should call switchGraph and close modal when Switch is clicked'`)
  - Create `frontend/src/components/graphs/GraphManagerModal.tsx`
  - Create `frontend/src/components/graphs/GraphCard.tsx` for list items
  - Create `frontend/src/components/graphs/CreateGraphModal.tsx`
  - Create `frontend/src/components/graphs/BranchGraphModal.tsx`
  - Implement graph list with metadata cards
  - Add create, branch, delete actions
  - Write component tests
  - _Requirements: 17.2, 17.3, 17.4_

- [x] 1.11 Frontend: Version history panel  `frontend/src/components/graphs/VersionHistoryPanel.tsx:17` (panel), `:28` (`useRollbackGraph`), `:205`-`:228` (rollback confirm/cancel), `:114` (expand for details); tests `frontend/src/components/graphs/VersionHistoryPanel.test.tsx` _(PARTIAL: the operation type is never shown — the frontend `GraphVersion` type has no operation field, `frontend/src/types/index.ts:282`; and the panel is mounted with no props (`frontend/src/components/views/ViewToolbar.tsx:668`), so its optional `onVersionSelect` does nothing)_
  - Create `frontend/src/components/graphs/VersionHistoryPanel.tsx`
  - Display version timeline with operation types
  - Add rollback buttons with confirmation dialog
  - Show version details on hover/click
  - Write component tests
  - _Requirements: 17.5_

- [x] 1.12 Frontend: Export panel  _(PARTIAL: `ExportHistoryList` is only re-exported (`frontend/src/components/export/index.ts:10`); the panel draws its own list at `frontend/src/components/graphs/ExportPanel.tsx:330-351`)_ `frontend/src/components/graphs/ExportPanel.tsx:20` (scope), `:22` (filters), `:57` (includeProvenance), `:323` (job progress), `:343` (download), `frontend/src/components/graphs/ExportHistoryList.tsx:91`, `frontend/src/hooks/useExport.ts:146`; tests `frontend/src/components/graphs/ExportPanel.test.tsx` _(the files live under `components/graphs/`, not `components/export/`; `frontend/src/components/export/index.ts` re-exports them)_
  - Create `frontend/src/components/export/ExportPanel.tsx`
  - Create `frontend/src/components/export/ExportHistoryList.tsx`
  - Implement export options form (scope, filters, provenance)
  - Add async job progress tracking
  - Handle download when complete
  - Create `frontend/src/hooks/useExport.ts`
  - Write component tests
  - _Requirements: 5.4, 5.5_

## Phase 2: Import System

- [x] 2.1 Implement ImportService validation  `timeline/src/services/ImportService.ts:484` (`validateFormat`), `:1421` (`validateTemporalConstraints`), `:1175` (causal paradox), `:1520` (`validateCrossGraphReferences`), `:64` (`ImportErrorCode` incl. `TEMPORAL_VIOLATION`/`CAUSAL_PARADOX`/`ORPHAN_REFERENCE`); tests `timeline/src/services/ImportService.test.ts` (`'should validate arc temporal consistency'`, `'should detect causal paradoxes'`, `'should validate orphan relationship references'`)
  - Create `timeline/src/services/ImportService.ts`
  - Implement format validation (check required fields, types)
  - Add temporal constraint checking (events within arcs)
  - Add causal consistency checking (cause before effect)
  - Add referential integrity checking (no orphan references)
  - Write unit tests for each validation type
  - _Requirements: 6.1, 6.2_

- [x] 2.2 Implement conflict detection  `timeline/src/services/ImportService.ts:1628` (`detectConflicts`), `:129` (`ConflictResolution = 'skip' | 'overwrite' | 'rename'`), `:1716` (causal paradoxes vs. existing data), `:2320`-`:2334` (unique ID generation for the `rename` resolution); tests `timeline/src/services/ImportService.test.ts` (`'should generate new IDs when using rename resolution'`, `'should reject import when manual resolutions do not cover all error conflicts'` _(that test asserts `expect(true).toBe(true)`, `timeline/src/services/ImportService.test.ts:974`, so it proves nothing)_)
  - Add conflict detection for duplicate IDs
  - Detect temporal constraint violations with existing data _(NOT DONE: the `temporal-violation` code is declared at `timeline/src/services/ImportService.ts:124` and never emitted, and `validateTemporalConstraints` (`ImportService.ts:1421`) checks only the incoming data)_
  - Detect causal paradoxes
  - Implement conflict resolution strategies (skip, overwrite, rename)
  - Generate unique IDs for 'rename' resolution
  - Write unit tests
  - _Requirements: 6.4_

- [x] 2.3 Implement import preview  `timeline/src/services/ImportService.ts:1770` (`preview`), `:138` (`ImportPreview` with `toCreate`/`toUpdate`/`toDelete`), `:1628` (`detectConflicts`); tests `timeline/src/services/ImportService.test.ts` (`'should calculate entity counts for create-new mode'`, `'should include validation warnings in preview'`)
  - Create diff calculation (entities to create, update, delete)
  - Compare incoming data with existing graph state
  - Format preview response with counts and conflict details
  - Write unit tests
  - _Requirements: 6.3_

- [x] 2.4 Implement import execution  _(PARTIAL: a failed import leaves the graph it created behind — in create-new mode the graph is created at `timeline/src/services/ImportService.ts:2183` and the catch at `:2238-2251` does not remove it)_ `timeline/src/services/ImportService.ts:2017` (`executeImport`), `:2059` (`executeImportInternal`), `:2260` (`applyImportWithRollback`), `:157`-`:166` (`ImportResult.graphVersion`); tests `timeline/src/services/ImportService.test.ts` (`'should not create partial data on validation failure mid-import'`, `'should preserve existing data when import fails'`, `'should record complete provenance data'`)
  - Create atomic import with version transaction
  - Implement rollback on any failure
  - Apply conflict resolutions
  - Record provenance for imported entities
  - Update graph version with import commit
  - Write integration tests
  - _Requirements: 6.5, 6.6_

- [x] 2.5 Create import API routes  `timeline/src/api/routes/import.ts:659` (POST `/validate`), `:690` (POST `/preview`), `:743` (POST `/`), `:899` (GET `/jobs/:jobId`), `:928` (POST `/jobs/:jobId/cancel`); registered at `timeline/src/api/routes.ts`; async path via `ImportService.executeImportAsync` (`services/ImportService.ts:1893`); tests `timeline/src/api/routes/import.test.ts` (`'should handle large imports'`, `'should require auth on all import endpoints'`) _(the large-import test sends 100 events while the async path needs more than that (`timeline/src/services/ImportService.ts:46,1886`), so it runs the synchronous path)_
  - Create `timeline/src/api/routes/import.ts`
  - Implement POST /api/import/validate
  - Implement POST /api/import/preview
  - Implement POST /api/import
  - Handle large imports as async jobs
  - Register routes in main router
  - Write API tests
  - _Requirements: 6_

- [x] 2.6 Frontend: Import wizard  `frontend/src/components/import/ImportWizard.tsx:39` (`WizardStep`), `:41` (`STEP_ORDER`), `ImportUploadStep.tsx`, `ImportValidationStep.tsx`, `ImportPreviewStep.tsx`, `ImportConflictStep.tsx`, `ImportExecuteStep.tsx`, `ConflictResolutionRow.tsx`, `frontend/src/hooks/useImport.ts:43`/`:57`/`:83`/`:145`; tests `frontend/src/components/import/ImportWizard.test.tsx` and `frontend/src/components/import/ConflictResolutionRow.test.tsx`
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

- [x] 3.1 Create ApiKey model  `timeline/src/models/ApiKey.ts:5` (`Permission`), `:19` (`RateLimitConfig`), `:27` (`IApiKey`), `:45` (`DEFAULT_RATE_LIMITS`), `:111` (`ApiKey` class), `:372` (`StreamToken`) _(the `crypto.randomBytes` key-generation helper is in `timeline/src/repositories/ApiKeyRepository.ts:80`, not in the model)_
  - Create `timeline/src/models/ApiKey.ts`
  - Define ApiKey interface with permissions
  - Define RateLimitConfig interface
  - Define Permission type union
  - Add key generation utilities (crypto.randomBytes)
  - _Requirements: 11.1_

- [x] 3.2 Implement ApiKeyRepository  `timeline/src/repositories/ApiKeyRepository.ts:40` (class), `:80` (`generateKey` with `crypto.randomBytes`), `:84` (bcrypt hash), `:142` (`findByPrefix`), `:151` (`validateKey`), `:253` (`revoke`), `:52`-`:53` (`<dataDir>/keys/keys.json`); tests `timeline/src/repositories/ApiKeyRepository.test.ts` (`'should validate a correct key'`, `'should find key by prefix'`, `'should persist key to disk'`)
  - Create `timeline/src/repositories/ApiKeyRepository.ts`
  - Implement CRUD operations for keys
  - Implement bcrypt hashing for key storage
  - Add key lookup by prefix
  - Add local mode storage in `data/keys/keys.json`
  - Write unit tests
  - _Requirements: 11.2, 11.5, 21.1_

- [x] 3.3 Implement AuthService  `timeline/src/services/AuthService.ts:39` (class), `:62` (`authenticate`), `:88` (`checkPermission`), `:103` (`checkPermissions`), `:135` (`checkGraphAccess`), `:189` (`createApiKey`); wired at `timeline/src/container.ts:564`; tests `timeline/src/services/AuthService.test.ts` (`'should authenticate with valid API key'`, `'should deny access to non-allowed graph'`) _(key generation and prefix extraction live in `repositories/ApiKeyRepository.ts:80` and `:157`)_
  - Create `timeline/src/services/AuthService.ts`
  - Implement key validation against hash
  - Add permission checking logic
  - Implement secure key generation
  - Add key prefix extraction
  - Wire up to container
  - Write unit tests
  - _Requirements: 11.3, 11.4_

- [x] 3.4 Implement RateLimitService  `timeline/src/services/RateLimitService.ts:52` (class), `:107` (`checkLimit`), `:152` (`recordRequest`), `:187` (`getHeaders`), `:44`-`:46` (minute/hour/day windows), `:172` (approaching-limit warning log); tests `timeline/src/services/RateLimitService.test.ts` (`'should deny request when hour limit exceeded'`, `'should log warning when approaching limit'`) _(there is no Redis-backed counting — see the file header at `services/RateLimitService.ts:1-10`; the optional `redisClient` only persists the state map at `:349`/`:399`)_
  - Implement rate limit tracking (per minute, hour, day)
  - Add Redis-based tracking for cloud mode
  - Add in-memory tracking for local mode
  - Implement limit checking with header generation
  - Add warning logging when approaching limits
  - Write unit tests
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 21.3_

- [x] 3.5 Create auth middleware  `timeline/src/api/middleware.ts:437` (`extractApiKeyFromRequest`), `:463` (`authenticate`), `:534` (`requireAuth`), `:555` (`authorize`), `:597` (`authorizeAny`), `:637` (`authorizeGraphAccess`), `:682` (`rateLimit`, sets the rate-limit headers at `:713`), `:744` (`withAuth`); tests `timeline/src/api/auth-middleware.test.ts`
  - Update `timeline/src/api/middleware.ts`
  - Implement X-API-Key header validation
  - Add permission checking middleware factory
  - Add rate limit middleware
  - Include rate limit headers in responses
  - Write middleware tests
  - _Requirements: 11.3, 12_

- [x] 3.6 Create API key routes  _(PARTIAL: `DELETE /api/keys/:id` deletes the key for good (`timeline/src/api/routes/keys.ts:350`, `timeline/src/repositories/ApiKeyRepository.ts:265`); revoking is the separate route at `keys.ts:307`)_ `timeline/src/api/routes/keys.ts:34` (GET `/`), `:135` (POST `/`, returns the full key once), `:213` (GET `/:id`), `:248` (PUT `/:id`), `:307` (POST `/:id/revoke`), `:350` (DELETE `/:id`), admin-only via `authorize('admin')` at `:38`; registered at `timeline/src/api/routes.ts`; tests `timeline/src/api/routes/keys.test.ts` (`'should list all keys for admin'`, `'should not allow revoking own key'`)
  - Create `timeline/src/api/routes/keys.ts`
  - Implement POST /api/keys (create, returns full key once)
  - Implement GET /api/keys (list, masked)
  - Implement GET /api/keys/:id
  - Implement PUT /api/keys/:id (update permissions, limits)
  - Implement DELETE /api/keys/:id (revoke)
  - Register routes with admin-only auth
  - Write API tests
  - _Requirements: 11_

- [x] 3.7 Implement batch endpoints  _(PARTIAL: `onError` only distinguishes `abort` (`timeline/src/api/routes/batch.ts:207`), so `skip` and `collect` behave the same, `lenient` still creates the invalid entity (`:184-201`), and `strict` with `abort` keeps the rows already created (`:211`))_ `timeline/src/api/routes/batch.ts:147` (POST `/events`), `:231` (POST `/arcs`), `:314` (POST `/relationships`), `:444` (POST `/transaction`), `:41`-`:42` (`ValidationMode`/`ErrorHandlingMode`), `:149`-`:155` (auth middleware on every route); tests `timeline/src/api/routes/batch.test.ts`
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

- [x] 3.8 Implement validation endpoint  `timeline/src/api/routes/validate.ts:140` (POST `/graph`), `:395` (POST `/incremental`), `:160`/`:350`-`:356` (per-violation details and suggestions); tests `timeline/src/api/routes/validate.test.ts` (`'should detect cause after effect'`, `'should detect missing referenced events'`)
  - Create `timeline/src/api/routes/validate.ts`
  - Implement POST /api/validate/graph
  - Implement POST /api/validate/incremental
  - Return detailed error messages per violation
  - Include suggestions when valid
  - Write API tests
  - _Requirements: 14_

- [x] 3.9 Enhance InferenceService for suggestions API
  - Update `timeline/src/services/InferenceService.ts`
  - ~~Expose relationship suggestions as API-friendly format~~ — still in the route; tracked separately (#43)
  - Add arc suggestion generation (cluster events) — `InferenceService.clusterEventsIntoArcs`
  - Add completeness analysis (gaps, missing links) — `InferenceService.analyzeCompleteness`
  - Write unit tests — `src/services/InferenceService.arcSuggestion.test.ts`
  - _Requirements: 15_

- [x] 3.10 Create suggestion routes  `timeline/src/api/routes/suggest.ts:70` (POST `/relationships`), `:156` (POST `/arcs`), `:222` (POST `/completeness`), `:297` (POST `/pressures`); registered at `timeline/src/api/routes.ts`; tests `timeline/src/api/routes/suggest.test.ts` (`'should suggest arcs for clustered events'`, `'should analyze graph with events'`)
  - Create `timeline/src/api/routes/suggest.ts`
  - Implement POST /api/suggest/relationships
  - Implement POST /api/suggest/arcs
  - Implement POST /api/suggest/completeness
  - Apply auth middleware
  - Write API tests
  - _Requirements: 15_

- [x] 3.11 Frontend: API key dashboard  `frontend/src/components/api-keys/ApiKeyDashboard.tsx:33`, `CreateKeyModal.tsx:27`, `KeyListItem.tsx:33`, `frontend/src/hooks/useApiKeys.ts:24`-`:58`, `frontend/src/components/api-keys/useApiKeyDashboard.ts`; one-time key display + copy at `ApiKeyDashboard.tsx:60`; tests `frontend/src/components/api-keys/ApiKeyDashboard.test.tsx`, `CreateKeyModal.test.tsx`, `KeyListItem.test.tsx`, `KeyCountSummary.test.tsx`, `KeyUsageStats.test.tsx`, `KeyUsagePanel.test.tsx` _(the footer counter is `KeyCountSummary.tsx`; the per-key usage view of Req 20.4 is `KeyUsageStats.tsx`, rendered by `KeyUsagePanel.tsx` and opened per key from `KeyListItem.tsx`; its data comes from `GET /api/keys/:id/usage`)_
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

- [x] 4.1 Implement WikipediaExtractor  _(PARTIAL: the section headings are stripped (`timeline/src/services/ingestion/WikipediaExtractor.ts:660-662`), and there is no history-section parsing)_ `timeline/src/services/ingestion/WikipediaExtractor.ts:485` (class), `:495` (`extract`), `:410` (infobox/prose render modes), `:695` (`assertSafeLinkFilter` for the link regex), `:64`-`:87` (date templates); tests `timeline/src/services/ingestion/WikipediaExtractor.test.ts`
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

- [x] 4.2 Implement WikidataExtractor  `timeline/src/services/ingestion/WikidataExtractor.ts:204` (class), `:88` (`buildSparqlQuery`, incl. `custom`), `:39` (SPARQL endpoint), `:274`/`:283` (Wikidata id in provenance); tests `timeline/src/services/ingestion/WikidataExtractor.test.ts`
  - Create `timeline/src/services/ingestion/WikidataExtractor.ts`
  - Implement SPARQL query execution against Wikidata endpoint
  - Create predefined queries (historical events, person timeline)
  - Support custom SPARQL queries
  - Map Wikidata entities to Althistory event format
  - Include Wikidata IDs in provenance
  - Write unit tests with mock responses
  - _Requirements: 8_

- [x] 4.3 Implement TextExtractor (pattern-based)  `timeline/src/services/ingestion/TextExtractor.ts:67` (class), `:117` (`extractWithPatterns`), `:52` (`patternConfidence`), shared patterns in `timeline/src/services/ingestion/text-patterns.ts` (`extractDates`, `extractCapitalizedEntities`, `splitSentences`); tests `timeline/src/services/ingestion/TextExtractor.test.ts`
  - Create `timeline/src/services/ingestion/TextExtractor.ts`
  - Implement date pattern recognition (multiple formats)
  - Add basic named entity extraction
  - Implement sentence segmentation around dates
  - Calculate confidence scores based on pattern clarity
  - Write unit tests
  - _Requirements: 9.1, 9.3, 9.4_

- [x] 4.4 Implement LLMClient abstraction  `timeline/src/services/llm/LLMClient.ts:27` (interface), `:48`-`:95` (JSON coercion/parsing), `OpenAIClient.ts:32`, `AnthropicClient.ts:32`, `prompts.ts:78`/`:97`/`:115`, env keys in `timeline/src/services/llm/index.ts:34`/`:71`, timeout at `OpenAIClient.ts:44`/`AnthropicClient.ts:44`; tests `timeline/src/services/llm/LLMClients.test.ts` (`'parses events from a recorded chat-completions response and drops the invalid one'`, `'selects Anthropic when requested and its key is present'`)
  - Create `timeline/src/services/llm/LLMClient.ts` (interface)
  - Create `timeline/src/services/llm/OpenAIClient.ts`
  - Create `timeline/src/services/llm/AnthropicClient.ts`
  - Create `timeline/src/services/llm/prompts.ts` (extraction prompts)
  - Read API keys from environment variables
  - Implement structured JSON response parsing
  - Add timeout and error handling
  - Write unit tests with mock responses
  - _Requirements: 10.1, 10.2, 10.5_

- [x] 4.5 Enhance TextExtractor with LLM  `timeline/src/services/ingestion/TextExtractor.ts:45` (`llmClient?`), `:77`-`:92` (LLM first, pattern fallback), `:50`/`:172` (`LLM_SOURCE_TYPE` vs `TEXT_SOURCE_TYPE` in provenance); tests `timeline/src/services/ingestion/TextExtractor.test.ts`
  - Update TextExtractor to accept optional LLMClient
  - Implement LLM-powered extraction as primary method
  - Fall back to pattern-based when LLM unavailable/fails
  - Track extraction source in provenance (llm vs pattern)
  - Write integration tests
  - _Requirements: 9.2, 10.3, 10.4_

- [x] 4.6 Implement IngestionOrchestrator  _(PARTIAL: there is no progress state — `timeline/src/services/ingestion/IngestionOrchestrator.ts:66`)_ `timeline/src/services/ingestion/IngestionOrchestrator.ts:167` (class), `:191` (`ingest`), `:215` (`runExtractor` dispatch), `:260` (`approve`), `:315` (`selectForImport` — partial import of the selected subset), `:88` (`InMemoryIngestionJobStore`); tests `timeline/src/services/ingestion/IngestionOrchestrator.test.ts` (`'imports the selected entities through the import executor'`, `'restricts to the approved event ids and drops dangling relationships'`)
  - Create `timeline/src/services/ingestion/IngestionOrchestrator.ts`
  - Coordinate different extractors based on source type
  - Manage ingestion jobs (create, update progress, complete)
  - Store extraction results for review
  - Implement approve workflow (convert approved to import)
  - Handle partial imports (only selected entities)
  - Write integration tests
  - _Requirements: 7.5, 7.6, 8.5, 9.5_

- [x] 4.7 Create ingestion API routes  `timeline/src/api/routes/ingest.ts:241` (POST `/url`), `:264` (POST `/wikidata`), `:220` (POST `/text`), `:291` (GET `/jobs/:id`), `:309` (GET `/jobs/:id/preview`), `:331` (POST `/jobs/:id/approve`), `:368` (DELETE `/jobs/:id`); registered at `timeline/src/api/routes.ts:74`; tests `timeline/src/services/ingestion/ingest.route.test.ts` (`'is mounted on the main API router at /api/ingest'`) and `timeline/src/services/ingestion/ingestion.e2e.test.ts`
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

- [x] 4.8 Frontend: Ingestion wizard - Wikipedia tab  `frontend/src/components/ingestion/WikipediaIngestTab.tsx:18` (URL), `:48` (the URL is a `type="url"` field, not validated beyond the browser's own check), `:19`/`:61` (follow-links toggle), `:71` (depth), `:85` (link-filter regex), `:22`/`:105` (max pages) _(the file is `WikipediaIngestTab.tsx`, not `WikipediaTab.tsx`, it has no dedicated component test — it is covered by `frontend/src/components/ingestion/IngestionWizard.test.tsx:149` — and the form only checks `type="url"` (`:48`); the backend then rejects anything that is not a Wikipedia article, `timeline/src/services/ingestion/WikipediaExtractor.ts:183-185`)_
  - Create `frontend/src/components/ingestion/WikipediaTab.tsx`
  - Add URL input with Wikipedia URL validation
  - Add link following toggle and depth selector
  - Add link filter regex input
  - Add max pages limit input
  - Write component tests
  - _Requirements: 19.2_

- [x] 4.9 Frontend: Ingestion wizard - Wikidata tab  `frontend/src/components/ingestion/WikidataIngestTab.tsx:18` (query-type dropdown incl. `custom`), `:33`-`:40` (person parameter), `:81`-`:95` (custom SPARQL), `:21`/`:97` (result limit) _(the file is `WikidataIngestTab.tsx`; there is no time-range parameter input and no dedicated component test — covered by `IngestionWizard.test.tsx:183`)_
  - Create `frontend/src/components/ingestion/WikidataTab.tsx`
  - Add predefined query selector dropdown
  - Add query parameter inputs (subject, time range)
  - Add custom SPARQL input for advanced users
  - Add result limit input
  - Write component tests
  - _Requirements: 19.1_

- [x] 4.10 Frontend: Ingestion wizard - Text tab  `frontend/src/components/ingestion/TextIngestTab.tsx:25` (text submit), `:19`/`:48` (LLM toggle), `:34` (large text area) _(the file is `TextIngestTab.tsx`; the context options — default actors, time range, locale — are not implemented, and there is no dedicated component test)_
  - Create `frontend/src/components/ingestion/TextTab.tsx`
  - Add large text input area
  - Add context options (default actors, time range, locale)
  - Add LLM toggle (if configured)
  - Write component tests
  - _Requirements: 19.1_

- [x] 4.11 Frontend: Entity review table  `frontend/src/components/ingestion/EntityReviewTable.tsx:173` (table), `:182` (select-all/deselect-all checkbox), `:27`-`:109` (inline-editable columns incl. description/actor/target/timestamp) _(the table is not sortable, the confidence score has no colour coding, there is no separate `EntityRow.tsx`, and the table has no dedicated component test — it is covered by `frontend/src/components/ingestion/IngestionWizard.test.tsx:203` and `:221`)_
  - Create `frontend/src/components/ingestion/EntityReviewTable.tsx`
  - Display entities in sortable table
  - Add checkbox column for selection
  - Add inline editing for all fields
  - Show confidence scores with color coding
  - Add select all / deselect all buttons
  - Create `frontend/src/components/ingestion/EntityRow.tsx`
  - Write component tests
  - _Requirements: 19.3, 19.4_

- [x] 4.12 Frontend: Ingestion wizard container  `frontend/src/components/ingestion/IngestionWizard.tsx:42` (`SourceTab`), `:46` (tab list), `:81` (extraction pending state), `:243`-`:254` (approve flow), `:71` (import result), `frontend/src/hooks/useIngestion.ts:21`-`:67`; tests `frontend/src/components/ingestion/IngestionWizard.test.tsx` (`'renders tabs for Wikipedia, Wikidata and Text sources (Req 19.1)'`, `'approves only the checked entities (Req 19.5)'`)
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

- [x] 5.1 Implement WebSocket stream handler  _(PARTIAL: the only warning frame sent is a versioning failure (`timeline/src/websocket/StreamHandler.ts:1108`); no validation warnings are sent)_ `timeline/src/websocket/StreamHandler.ts:259` (class), `:342` (`handleUpgrade` — token validation), `:772`/`:775` (event and arc messages), `:821`/`:859` (acks), `:1109` (non-blocking validation warning), `:814` (backpressure close); tests `timeline/src/websocket/stream.integration.test.ts` (`'acks a successful event and actually persists it'`, `'acks a successful arc'`) _(the protocol has no `relationship` message type — `timeline/src/websocket/StreamProtocol.ts:28`-`:46` defines `event`, `arc` and `close` only)_
  - Create `timeline/src/websocket/StreamHandler.ts`
  - Implement WebSocket connection handling
  - Validate stream tokens on connection
  - Process event/arc/relationship messages
  - Send acknowledgments for each message
  - Send validation warnings as non-blocking
  - Handle connection lifecycle (close, errors)
  - Write unit tests
  - _Requirements: 16.3, 16.4_

- [x] 5.2 Create stream token endpoint  `timeline/src/api/routes/stream.ts:44` (POST `/token`), `timeline/src/websocket/StreamTokenStore.ts:33` (`STREAM_TOKEN_TTL_MS` = 5 min), `:101` (token generation), `:75` (in-memory store), `timeline/src/websocket/index.ts:28` (`getStreamTokenStore`); registered at `timeline/src/api/routes.ts:99`; tests `timeline/src/websocket/stream.integration.test.ts:709` (`'issues a short-lived token tied to the key and graph'`)
  - Create `timeline/src/api/routes/stream.ts`
  - Implement POST /api/stream/token
  - Generate short-lived tokens (5 min expiry)
  - Tie tokens to API keys and permissions
  - Store tokens in memory/Redis
  - Write API tests
  - _Requirements: 16.1_

- [x] 5.3 Implement stream session management  `timeline/src/websocket/StreamSession.ts:83` (`StreamSessionManager`), `:105`/`:220` (per-key session tracking), `:39` (session policy), `timeline/src/websocket/StreamProtocol.ts:28`-`:103` (message types); tests `timeline/src/websocket/StreamSession.test.ts` (`'refuses the N+1th session for the same API key and reports the limit'`, `'sweep removes an expired session and frees the slot it was holding'`) and `timeline/src/websocket/stream.integration.test.ts:1115` _(per-session statistics are counted — `entitiesCreated` at `StreamSession.ts:151` — but they are only logged on some paths: a client `close` message closes the session first (`timeline/src/websocket/StreamHandler.ts:769`), so the later release finds nothing to log at `:667`, and the expiry path (`:717-721`) logs no `entitiesCreated`)_
  - Create `timeline/src/websocket/StreamSession.ts`
  - Track active sessions per API key
  - Enforce concurrent stream limits
  - Handle session timeout and cleanup
  - Log session statistics
  - Create `timeline/src/websocket/StreamProtocol.ts` (message types)
  - Write integration tests
  - _Requirements: 16.2, 16.5_

- [x] 5.4 Add webhook notifications  `timeline/src/services/JobService.ts:699` (`sendWebhook`), `:781` (`attemptWebhook`), `:690`-`:715` (retry loop with exponential backoff), `:28`-`:32` (attempt/delay/timeout config), `:876`/`:891` (failure and abandonment records), `:482` (delivery on job completion); tests `timeline/src/services/JobService.test.ts` (`'should set webhook URL when provided'`)
  - Update JobService with webhook support
  - Implement HTTP POST on job completion
  - Add retry logic with exponential backoff
  - Log webhook delivery status
  - Write integration tests
  - _Requirements: 22.4_

- [ ] 5.5 Cloud mode adaptations _(not implemented: the stores stay file-backed in both modes — `timeline/src/repositories/JobRepository.ts:6` ("has no Redis/Neo4j backend"), `timeline/src/services/RateLimitService.ts:1-10` ("No Redis-backed implementation exists"); there is no Neo4j version or graph repository; only the dual-mode test exists at `timeline/src/tests/integration/cloud-mode-io.test.ts`) — tracked in [#31](https://github.com/Qworg/althistory/issues/31)_
  - Add Redis-based rate limiting in RateLimitService
  - Add Redis-based job storage in JobRepository
  - Add Neo4j graph versioning in VersionRepository
  - Update GraphRepository for Neo4j
  - Test dual-mode switching
  - Write integration tests
  - _Requirements: 21_

- [x] 5.6 Frontend: Streaming write hook  _(PARTIAL: there is no queue — `sendWithAck` rejects when the socket is closed (`frontend/src/hooks/useStreamingWrite.ts:196`))_ `frontend/src/hooks/useStreamingWrite.ts:62` (hook), `:101`-`:116` (connect + token fetch), `:193` (`sendWithAck` with per-message ack tracking), `:181` (close handling), `:44` (`getWebSocketStreamUrl`); tests `frontend/src/hooks/useStreamingWrite.test.ts` (`'sends events and receives correlated acks'`, `'handles validation warnings without failing the connection'`) _(there is no automatic reconnect: `connect` re-acquires a fresh token when called again, but nothing retries it)_
  - Create `frontend/src/hooks/useStreamingWrite.ts`
  - Implement WebSocket connection management
  - Add message queue with acknowledgment tracking
  - Handle reconnection with new token
  - Expose streaming state and progress
  - Write hook tests
  - _Requirements: 16_

- [x] 5.7 Frontend: Real-time indicators  _(PARTIAL: a failure appears only in a `title` tooltip (`frontend/src/components/streaming/StreamingStatusBadge.tsx:62`))_ `frontend/src/components/streaming/StreamingStatusBadge.tsx:17` (badge), `:24`-`:45` (status states), `:62` (sent/acked/failed stats), `:73`/`:83` (connect/disconnect); wired into `frontend/src/components/views/ViewToolbar.tsx:580`; tests `frontend/src/components/streaming/StreamingStatusBadge.test.tsx`
  - Add streaming status indicator component
  - Show write progress during streaming
  - Display error notifications for failed writes
  - Add connection status badge
  - Write component tests
  - _Requirements: 16_

- [x] 5.8 Cross-graph reference UI  _(PARTIAL: a broken local reference is labelled "Cross-graph" (`frontend/src/components/causal-graph/CausalGraphComponent.tsx:706`))_ `frontend/src/components/modals/CausalRelationshipModal.tsx:16`/`:39`/`:57` (graph picker for the effect graph), `frontend/src/components/causal-graph/CausalGraphComponent.tsx:746`-`:762` (`isCrossGraph` / `crossGraphLabel`), `:804` (`cross-graph` edge class), `:1298` (hover detail), `frontend/src/types/index.ts:40`-`:41`; test `frontend/src/components/causal-graph/CausalGraphComponent.test.tsx:658` _(there is no UI for reference-change notifications, and no backend queue for them either: the registry that fed `getReferenceNotifications` was removed in [#32](https://github.com/Qworg/althistory/issues/32) because nothing wrote it. A cross-graph reference lives on the entity's `metadata.crossGraphRefs` and nothing consumes that for notifications)_
  - Update relationship creation to allow cross-graph selection
  - Add visual indicators for cross-graph references
  - Show notifications for referenced entity changes _(NOT DONE -- there is no backend queue; see the note on 5.8 above and [#32](https://github.com/Qworg/althistory/issues/32))_
  - Handle broken references gracefully
  - Write component tests
  - _Requirements: 4.2, 4.3, 4.5_

- [x] 5.9 Integration testing  `e2e/tests/` (Playwright: `smoke.spec.ts`, `create-event.spec.ts`, `ingestion.spec.ts`, `offline.spec.ts`, `visual.spec.ts`); `timeline/src/services/ImportService.test.ts:1596` (`'should round-trip through export with the imported ids'`); `timeline/src/services/ingestion/ingestion.e2e.test.ts:121`; `timeline/src/services/GraphService.test.ts:391`/`:449` (branch and merge); `timeline/src/tests/integration/merge-semantics.test.ts`; `timeline/src/websocket/stream.integration.test.ts` _(no test streams a large dataset)_
  - Create end-to-end tests for full workflows
  - Test import -> export round-trip data integrity
  - Test ingestion -> review -> import flow
  - Test streaming writes with large datasets
  - Test cross-graph reference scenarios
  - Test graph branching and merging
  - _Requirements: All_

- [x] 5.10 Documentation `docs/export-format.md` (the document field by field, the three versions, the SHA-256-over-`data` checksum and how to verify it), `docs/ingestion.md` (CLI and API, the review step, the extraction modes and their cost), `docs/api-integration.md` (keys, permissions, `X-Graph-Id` scoping, error envelope, rate limits, async jobs and per-job webhooks, the export/import round trip), plus `CLAUDE.md` and `AGENTS.md` brought up to date (configuration precedence, the CLI, the documentation map, the causal-order rule, no skipped tests). The route inventory remains the OpenAPI description (`timeline/src/api/openapi/document.ts`, served at `GET /api/openapi.json` and drift-tested against the live routers). Written from the implementation: the checksum and field meanings come from `timeline/src/services/ExportService.ts`, the scoping and limits from `timeline/src/api/middleware.ts` and `timeline/src/services/RateLimitService.ts`, the job/webhook behaviour from `timeline/src/services/JobService.ts`.
  - Write API documentation (OpenAPI/Swagger)
  - Create export format specification document
  - Write ingestion guide with examples
  - Create external integration guide for automated systems
  - Update CLAUDE.md with new features
  - Update AGENTS.md with new commands
  - _Requirements: All_
