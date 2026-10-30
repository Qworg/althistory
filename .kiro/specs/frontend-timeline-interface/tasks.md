# Implementation Plan

> **Status:** re-audited against the source. Every ticked box carries the
> `file:line` or test name that proves it.
>
> A tick means the work is done **and reachable** — the code exists, and a
> mounted view or a served route reaches it. Where the code exists but the
> feature cannot be reached, or only part of it is built, the box says so on
> its own line (`PARTIAL` / `NOT DONE`) rather than reading as a plain tick. The
> boxes that are still open link the issue that carries the work.

- [x] 1. Set up React application foundation and project structure. This is a SEPARATE PROJECT from "timeline" and should be in the base directory of the repo as "frontend". Do NOT alter the "timeline" folder.  `frontend/package.json:13-30`, `frontend/tsconfig.json:20-41`, `frontend/vite.config.ts:56-65`, `frontend/src/components`, `frontend/src/hooks`, `frontend/src/services`, `frontend/src/types`.







  - Create React TypeScript ^19.1.1 project with Vite ^7.0.6 build system and essential dependencies.
  - Set up project structure with components, hooks, services, and types directories
  - Configure TypeScript with strict settings and path aliases for clean imports
  - Install and configure core dependencies: React Router v7, Zustand ^5.0.7, React Query ^5.84.1, Tailwind CSS ^4
  - _Requirements: 7.1, 8.1, 14.1_

- [x] 2. Implement global state management and API client  `frontend/src/stores/globalStore.ts`, `frontend/src/services/api.ts`, `frontend/src/hooks/useEvents.ts`





  - [x] 2.1 Create Zustand store for global application state  `frontend/src/stores/globalStore.ts:16-120,186-421`, `frontend/src/utils/persistence.ts:11-89`, `frontend/src/test/stores/globalStore.test.ts` (21 tests)


    - Implement global state interface with events, arcs, causal relationships, and UI state
    - Add state actions for data manipulation and UI state updates
    - Create state persistence layer for user preferences and session data
    - Write unit tests for state management logic and action creators
    - _Requirements: 1.1, 2.1, 5.1, 14.2_

  - [x] 2.2 Implement API client with React Query integration  `frontend/src/services/api.ts:157-203,333-524`, `frontend/src/hooks/useEvents.ts:6-20`, `frontend/src/hooks/useArcs.ts:6-20`, `frontend/src/test/services/api.test.ts` (21 tests), `frontend/src/services/api.error.test.ts` (3 tests), `frontend/src/test/hooks/useAPI.test.tsx`


    - Create typed API client with methods for events, arcs, causal relationships, and inference using Axios ^1.11.0 (`frontend/src/services/api.ts:487-524` calls `/inference/pressures`, `POST /inference/analyze-clusters`, and `POST /inference/detect-patterns`)
    - Add request/response interceptors for error handling and authentication
    - Implement React Query ^5.84.1 hooks for data fetching, caching, and synchronization
    - Write integration tests for API client methods and error scenarios
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 9.1, 14.1_
- [x] 3. Create core UI components and layout structure  `frontend/src/components/layout`, `frontend/src/components/filters`, `frontend/src/components/modals`

  - [x] 3.1 Implement main application layout and navigation  `frontend/src/components/layout/MainLayout.tsx:93-127`, `frontend/src/components/layout/Header.tsx:29-50`, `frontend/src/components/layout/Navigation.tsx:4-13`, `frontend/src/components/layout/Breadcrumb.tsx:20-73`, `frontend/src/hooks/useLongPress.ts`, `frontend/src/components/layout/MainLayout.test.tsx:67-77`


    - Create responsive main layout component with header, sidebar, and content areas
    - Implement navigation component with view switching and breadcrumb functionality
    - Add responsive design breakpoints and mobile-optimized layouts with touch-optimized interactions
    - Add support for pinch-to-zoom and pan gestures for timeline navigation on mobile devices — pan and pinch are both provided by d3-zoom, which the timeline mounts (`frontend/src/components/timeline/Timeline.tsx:521`): its touch handler starts a gesture on the first touch and a pinch on the second (`node_modules/d3-zoom/src/zoom.js:316-341`), so a two-finger gesture zooms. It is not covered by a test — jsdom has no touch, so the gesture is only reachable on a device
    - Write component tests for layout rendering and responsive behavior
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 13.1, 13.2_

  - [x] 3.2 Create filter panel and search interface components  `frontend/src/components/filters/FilterPanel.tsx:48-121,165-212`, `frontend/src/components/filters/SearchInterface.tsx:36-52`, `frontend/src/components/filters/ActiveFilters.tsx`, `frontend/src/components/filters/filterUtils.ts`, `frontend/src/components/filters/FilterPanel.test.tsx`, `frontend/src/components/filters/SearchInterface.test.tsx`, `frontend/src/components/filters/ActiveFilters.test.tsx` _(note: `Event` has no `type` field on the domain model, so `FilterPanelContainer.tsx` intentionally omits the event-type filter section; see `FilterPanel.test.tsx:48-50,115-120`)_


    - Implement collapsible filter panel with date range, actor, target, and event type filters
    - Add search interface with real-time filtering, autocomplete suggestions, and result highlighting
    - Create filter state management with URL synchronization for bookmarkable filters
    - Add visual indicators for active filters and easy filter removal options
    - Write interaction tests for filter application and search functionality
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 3.3 Create event and arc detail modal components  `frontend/src/components/modals/EventDetailModal.tsx:130-200`, `frontend/src/components/modals/ArcDetailPanel.tsx:88-98` (Escape key handling), `frontend/src/components/views/TimelineView.tsx:487-501,657-658` (`containedEvents` and `childArcs`), `frontend/src/components/modals/ModalBase.tsx:120-145,167-193`, `frontend/src/components/modals/eventDetailModalUtils.ts:31-60`, `frontend/src/components/modals/arcDetailPanelUtils.ts:28-79`, `frontend/src/components/modals/EventDetailModal.test.tsx`, `frontend/src/components/modals/ArcDetailPanel.test.tsx`


    - Implement event detail modal with full information display and editing capabilities
    - Create arc detail panel showing contained events, child arcs, and properties
    - Add form validation and error handling for event and arc editing
    - Implement modal state management and keyboard navigation support
    - Write component tests for modal functionality and form validation
    - _Requirements: 1.3, 2.3, 3.2, 4.2_

- [x] 4. Implement timeline visualization foundation  `frontend/src/components/timeline/Timeline.tsx`, `frontend/src/utils/d3Calculations.ts`





  - [x] 4.1 Create D3.js timeline component with basic rendering  `frontend/src/components/timeline/Timeline.tsx:121-215,510-563,700-730`, `frontend/src/utils/d3Calculations.ts`, `frontend/src/components/timeline/Timeline.test.tsx`, `frontend/src/utils/d3Calculations.test.ts` (42 tests), `frontend/src/hooks/useTimelineScales.test.ts`


    - Set up D3.js ^7.9.0 integration with React ^19.1.1 using useRef and useEffect patterns
    - Implement time scale, axis rendering, and basic timeline structure
    - Add zoom and pan functionality with smooth transitions and boundary constraints
    - Write unit tests for timeline rendering and scale calculations using Vitest ^1.0.4
    - _Requirements: 1.1, 1.4, 7.1, 7.3_

  - [x] 4.2 Add event markers and interaction handling  `frontend/src/components/timeline/TimelineEvent.tsx`, `frontend/src/hooks/useTimelineEventHandlers.ts`, `frontend/src/components/timeline/Timeline.tsx:294-300,362-400,575-610`, `frontend/src/components/views/timelineInteractionUtils.ts:17-45`, `frontend/src/components/timeline/TimelineInteractionA.test.tsx`, `frontend/src/components/timeline/EventInteraction.test.tsx`, `frontend/src/components/views/TimelineView.interactions.test.tsx`


    - Implement event rendering as positioned markers with hover tooltips showing event details
    - Add click handlers for event selection and detailed event panel opening
    - Create double-click functionality for creating new events with timestamp pre-filled
    - Create drag functionality for event timestamp modification with temporal constraint validation
    - Write interaction tests for event selection, editing, and drag operations
    - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.3, 3.4_
- [x] 5. Implement arc visualization and management  `frontend/src/components/timeline/TimelineArc.tsx`, `frontend/src/components/timeline/arcHierarchyUtils.ts`

  - [x] 5.1 Create hierarchical arc rendering system  `frontend/src/components/timeline/TimelineArc.tsx`, `frontend/src/components/timeline/arcHierarchyUtils.ts:80-150`, `frontend/src/components/timeline/Timeline.tsx:650-690`, `frontend/src/components/timeline/ArcHierarchy.test.tsx` (16 tests), `frontend/src/components/timeline/TimelineInteractionA.test.tsx:493-508` (arc tooltip: name, date range, duration, event count)


    - Implement arc rendering as horizontal bars positioned by start/end times with nested hierarchy display
    - Add visual indicators for arc levels and containment relationships using different vertical levels
    - Create arc expansion/collapse functionality for exploring hierarchies and showing constituent events
    - Add hover functionality to highlight arcs and show basic information (name, duration, event count)
    - Write tests for arc hierarchy rendering and interaction behavior
    - _Requirements: 2.1, 2.2, 2.3, 2.4_



  - [x] 5.2 Add arc creation and editing capabilities  `frontend/src/components/timeline/Timeline.tsx:782` (event-to-arc assignment), `frontend/src/components/views/TimelineView.tsx:594-596,620-636` ("Assign to Arcs" in event context menu), `frontend/src/components/timeline/EventArcAssignment.tsx:25`, `frontend/src/components/modals/ArcDetailPanel.tsx`, `frontend/src/components/timeline/ArcCreationEditing.test.tsx`, `frontend/src/components/timeline/TimelineInteractionA.test.tsx:339-400`, `frontend/src/components/views/TimelineView.interactions.test.tsx:212-300`


    - Implement time range selection for creating new arcs with visual feedback and backend validation — PARTIAL: `frontend/src/components/timeline/ArcCreationModal.tsx` implements it and is tested, but it is not mounted in any view; arcs are created from the toolbar via `frontend/src/components/views/ViewToolbar.tsx:148-158,688-691` (ArcDetailPanel create mode)
    - Add arc resize functionality by dragging edges with temporal boundary and hierarchy constraint validation
    - Create event-to-arc assignment functionality with temporal containment verification
    - Create arc detail panel for viewing and editing arc properties
    - Write integration tests for arc creation, editing, and validation workflows
    - _Requirements: 4.1, 4.2, 4.3, 4.4_


- [x] 6. Implement causal graph visualization  `frontend/src/components/causal-graph/CausalGraphComponent.tsx`, `frontend/src/components/views/CausalGraphView.tsx`


  - [x] 6.1 Create Cytoscape.js causal graph component  `frontend/src/components/causal-graph/CausalGraphComponent.tsx:293-299,417-433` (weight-mapped node/edge styling), `frontend/src/components/causal-graph/CausalGraphComponent.test.tsx` (25 tests), `frontend/package.json:20`


    - Set up Cytoscape.js ^3.33.0 integration with React ^19.1.1 and TypeScript ^5.3.2 definitions
    - Implement node rendering for events with customizable styling and labels
    - Add edge rendering for causal relationships with weight-based visual styling
    - Write component tests for graph initialization and basic rendering using Vitest ^3.2.4
    - _Requirements: 5.1, 5.2, 10.1, 10.2_

  - [x] 6.2 Add causal relationship creation and editing  `frontend/src/components/causal-graph/CausalGraphComponent.tsx:212-268` (temporal ordering validation), `:524-540` (link creation), `:1290-1325` (edge hover details), `frontend/src/components/modals/CausalRelationshipModal.tsx:294-330,401-405`, `frontend/src/components/causal-graph/CausalRelationshipInteractions.test.tsx` (14 tests), `frontend/src/components/modals/CausalRelationshipModal.test.tsx`


    - Implement interactive causal link creation between event nodes with temporal ordering validation
    - Add relationship weight adjustment with visual feedback and backend persistence
    - Create hover functionality for causal edges showing relationship details (weight, evidence, confidence)
    - Create causal relationship detail modal for editing evidence and confidence
    - Write interaction tests for causal link creation and modification workflows
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 7. Implement causal chain exploration features  `frontend/src/components/causal-graph`, `frontend/src/hooks/useCausalPathExploration.ts`


  - [x] 7.1 Create causal path highlighting and navigation  `frontend/src/hooks/useCausalPathExploration.ts:28-96`, `frontend/src/components/causal-graph/CausalPathHighlighter.tsx`, `frontend/src/components/causal-graph/CausalChainNavigationControls.tsx:23`, `frontend/src/utils/causalPathCalculations.ts:7-129`, `frontend/src/components/causal-graph/CausalGraphComponent.tsx:163,1144-1153`, `frontend/src/utils/causalPathCalculations.test.ts` (33 tests), `frontend/src/components/causal-graph/CausalPathExplorer.test.tsx`


    - Implement causal chain traversal with configurable depth limits (`frontend/src/services/api.ts:428-445` passes `maxDepth` and unwraps `causalPaths`)
    - Add path highlighting with cumulative strength visualization
    - Create navigation controls for stepping through causal chains chronologically
    - Write tests for causal path calculation and visualization accuracy
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 7.2 Add causal suggestion system integration  `frontend/src/components/causal-graph/CausalSuggestionOverlay.tsx:55-56` (dashed edges), `frontend/src/hooks/useCausalSuggestions.ts:167-330` (accept/reject/feedback), `frontend/src/components/causal-graph/CausalSuggestionManager.tsx`, `frontend/src/components/views/CausalGraphView.tsx:261` (`focusEventId={selectedEvent?.id}`), `frontend/src/utils/suggestionManagerUtils.ts`, `frontend/src/utils/suggestionManagerUtils.test.ts` (39 tests), `frontend/src/components/causal-graph/CausalSuggestionManager.test.tsx`, `frontend/src/components/views/CausalGraphView.test.tsx`


    - Implement display of AI-generated causal suggestions as dashed connections (`frontend/src/components/views/CausalGraphView.tsx:261` passes `focusEventId={selectedEvent?.id}` to `CausalGraphComponent`)
    - Add suggestion acceptance/rejection workflow with confidence scoring (`frontend/src/components/causal-graph/CausalSuggestionManager.tsx`, rendered when `focusEventId` is selected)
    - Create suggestion feedback system to improve future recommendations _(PARTIAL: the feedback goes into an in-memory ref, `frontend/src/hooks/useCausalSuggestions.ts:285-293`; there is no endpoint behind it)_
    - Write integration tests for suggestion display and user interaction workflows
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 8. Create actor perspective view  `frontend/src/components/views/ActorPerspectiveView.tsx`, `frontend/src/components/timeline/ActorTimeline.tsx`


  - [x] 8.1 Implement actor-focused timeline visualization  `frontend/src/components/timeline/ActorTimeline.tsx:102-145` (chronological/thematic layouts), `:287-330` (actor/target styling), `frontend/src/components/views/ActorPerspectiveView.tsx:245`, `frontend/src/components/views/ActorPerspectiveView.test.tsx` (role distinction, layout toggle)


    - Create specialized timeline view filtered to single actor's involvement
    - Add role distinction visualization (actor vs target) with different styling
    - Implement chronological and thematic layout options for actor events
    - Write component tests for actor perspective rendering and filtering
    - _Requirements: 13.5, 6.1, 6.2_

  - [x] 8.2 Add actor selection and navigation interface  `frontend/src/components/views/ActorPerspectiveView.tsx:142-166` (per-actor `selectionByActor` state preservation across actor switches), `frontend/src/components/actor/ActorSelector.tsx:20-60`, `frontend/src/components/actor/ActorStats.tsx:140-200`, `frontend/src/components/actor/ActorSelector.test.tsx`, `frontend/src/components/actor/ActorStats.test.tsx`


    - Create actor selection dropdown with search and autocomplete functionality
    - Implement actor switching with smooth transitions and state preservation
    - Add actor statistics display (event count, time span, relationship metrics)
    - Write interaction tests for actor selection and view switching workflows
    - _Requirements: 13.5, 6.1, 6.4_

- [x] 9. Implement inferred pressure visualization  `frontend/src/hooks/usePressures.ts`, `frontend/src/services/api.ts:490` (`GET /inference/pressures`), `frontend/src/components/views/TimelineView.tsx:108-135,532-559`, `frontend/src/hooks/usePressures.shared.test.ts`, `frontend/src/services/api.pressures.test.ts`


  - [x] 9.1 Create pressure indicator display system  `frontend/src/components/timeline/PressureIndicators.tsx`, `frontend/src/utils/pressureVisualization.ts`, `frontend/src/components/views/TimelineView.tsx:532-542`, `frontend/src/components/timeline/PressureIndicators.test.tsx`, `frontend/src/utils/pressureVisualization.test.ts`
    - Implement pressure visualization as colored indicators on arcs with confidence-based opacity
    - Add pressure type categorization with distinct visual styling (economic, social, etc.)
    - Create pressure detail tooltips showing evidence events and influence strength
    - Write tests for pressure indicator rendering and confidence score visualization
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 9.2 Add pressure exploration and evidence tracking  `frontend/src/components/modals/PressureDetailModal.tsx`, `frontend/src/components/timeline/PressureExploration.tsx`, `frontend/src/components/timeline/PressureConfidenceTracker.tsx`, `frontend/src/components/views/TimelineView.tsx:544-559,662-674`, `frontend/src/components/modals/PressureDetailModal.test.tsx`, `frontend/src/components/timeline/PressureExploration.test.tsx`
    - Implement pressure detail modal showing contributing evidence events
    - Add evidence event highlighting when exploring pressure relationships
    - Create pressure confidence tracking with visual updates for score changes
    - Write integration tests for pressure exploration and evidence display workflows
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 10. Implement view switching and layout management  `frontend/src/components/views/ViewSwitcher.tsx`, `frontend/src/hooks/useViewStateManager.ts`


  - [x] 10.1 Create view mode switching system  `frontend/src/components/views/ViewSwitcher.tsx`, `frontend/src/hooks/useViewStateManager.ts:65-180` (saves leaving view's zoom/center via `previousViewMode.current`), `frontend/src/components/views/ViewToolbar.tsx`, `frontend/src/components/views/ViewSwitcher.test.tsx`, `frontend/src/hooks/useViewStateManager.test.ts` (12 tests), `frontend/src/components/views/ViewToolbar.test.tsx`


    - Implement seamless switching between timeline, causal graph, and actor perspective views
    - Add state preservation across view switches (selections, filters, zoom levels)
    - Create view-specific toolbar and control panels with context-appropriate options
    - Write tests for view switching functionality and state preservation
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 10.2 Add layout options for causal graph view  `frontend/src/components/causal-graph/CausalGraphLayoutManager.tsx:31-200` (cose, cose-bilkent, dagre, concentric, grid), `:268-300` (apply + transition), `frontend/src/components/causal-graph/CausalGraphOverview.tsx:17-165` (overview+detail), `frontend/src/utils/layoutManagerUtils.ts`, `frontend/src/components/causal-graph/CausalGraphLayoutManager.test.tsx`


    - Implement multiple layout algorithms (force-directed, hierarchical, circular)
    - Add layout switching with smooth transitions and position preservation
    - Create overview+detail interface for large dataset navigation
    - Write performance tests for layout switching and large graph rendering — NOT DONE: `frontend/src/components/causal-graph/CausalGraphPerformanceManager.tsx` has no test file and no layout-switching performance test exists
    - _Requirements: 13.3, 13.4, 7.1, 7.2_

- [x] 11. Implement graph copying functionality  `frontend/src/hooks/useGraphCopy.ts`, `timeline/src/services/GraphCopyService.ts`





  - [x] 11.1 Create graph copy interface and workflow  _(PARTIAL: the copy completes synchronously on the server — `timeline/src/api/routes/graphs.ts:89-104` always answers `completed`/`failed` — so the progress bar and the estimated completion time never render)_ `frontend/src/components/modals/GraphCopyModal.tsx:12-267` (full / time_range / filtered), `frontend/src/hooks/useGraphCopy.ts`, `frontend/src/components/modals/GraphCopyProgressPanel.tsx:151-157` (progress + estimated completion), `timeline/src/api/routes/graphs.ts:175-260`, `frontend/src/hooks/useGraphCopy.test.tsx`, `frontend/src/hooks/useGraphCopy.shared.test.tsx`, `timeline/src/services/GraphCopyService.unit.test.ts` (the `GraphCopyService.test.ts` is excluded by `timeline/vitest.config.ts:73`)


    - Implement time range selection interface for temporal subset copying
    - Add entity filter interface for creating filtered graph copies
    - Create copy progress tracking with estimated completion time display
    - Write integration tests for copy operation initiation and progress tracking
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 11.2 Add copy result management and navigation  `frontend/src/components/notifications/CopyCompletionNotifier.tsx`, `frontend/src/components/notifications/CopyCompletionNotification.tsx:44-45,172` (switch to new graph), `frontend/src/components/modals/CopyHistoryPanel.tsx:321-335` (`initialBaselineGraphId` and `initialCounterfactualGraphId`), `frontend/src/components/branch/BranchComparisonModal.tsx:13-33,89-99`, `frontend/src/components/modals/CopyHistoryPanel.test.tsx`, `frontend/src/components/notifications/CopyCompletionNotifier.test.tsx`


    - Implement copy completion notification with options to switch to new graph
    - Add graph comparison interface for viewing original vs copied data
    - Create copy history tracking and management interface
    - Write tests for copy result handling and graph switching workflows
    - _Requirements: 11.3, 11.4_

- [x] 12. Implement performance optimizations  `frontend/src/components/timeline/timelineVirtualization.ts`, `frontend/src/components/providers/queryClient.ts`


  - [x] 12.1 Add virtualization for large datasets  `frontend/src/components/timeline/timelineVirtualization.ts:62-135`, `frontend/src/components/timeline/Timeline.tsx:199,256`, `frontend/src/components/timeline/TimelineVirtualization.test.tsx:122-140` (10,000 events outside the window), `frontend/src/components/causal-graph/CausalGraphPerformanceManager.tsx:23-35,184-192` (level of detail)
    - Implement timeline virtualization for handling 10,000+ events efficiently
    - Add causal graph level-of-detail rendering for large node sets
    - Create progressive loading system with background data fetching — PARTIAL: background fetching comes from React Query (`frontend/src/components/providers/queryClient.ts:19-38`); there is no separate progressive-loading system
    - Write performance tests to validate sub-200ms interaction response times — NOT DONE: `frontend/src/components/timeline/Timeline.test.tsx:457-497` uses a 5,000 ms sanity threshold and states it is not a benchmark
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 12.2 Implement caching and data optimization  _(PARTIAL: the invalidation this cites is in mutation hooks nothing imports (`frontend/src/hooks/useEvents.ts:39,58,76`, `frontend/src/hooks/useArcs.ts:35,51,67`); the invalidation that runs is `frontend/src/hooks/useAPI.ts:116`)_ `frontend/src/components/providers/queryClient.ts:19-38` (staleTime/gcTime/retry), `frontend/src/hooks/useEvents.ts:39,58,76`, `frontend/src/hooks/useArcs.ts:35,51,67` (invalidation)
    - Add intelligent caching for visualization render data and API responses
    - Implement cache invalidation strategies for data consistency
    - Create memory management system for large dataset handling — NOT DONE: no dedicated memory-management layer exists; the windowed rendering in `frontend/src/components/timeline/timelineVirtualization.ts` is the only large-dataset handling
    - Write performance benchmarks for caching effectiveness and memory usage — NOT DONE: no such benchmark exists in `frontend/` or `e2e/`

    - _Requirements: 7.1, 7.2, 7.4_

- [x] 13. Add error handling and user feedback systems  `frontend/src/components/notifications`, `frontend/src/offline`


  - [x] 13.1 Implement comprehensive error handling  `frontend/src/components/notifications/ErrorBoundary.tsx`, `frontend/src/App.tsx:14-18`, `frontend/src/offline/mutationQueue.ts`, `frontend/src/offline/offlineSync.ts`, `frontend/src/offline/mutationReplay.ts`, `frontend/src/offline/OfflineIndicator.tsx`, `frontend/src/components/modals/EventDetailModal.tsx:130-160` (field-level errors), `frontend/src/components/notifications/ErrorBoundary.test.tsx`, `frontend/src/App.errorSurface.test.tsx`, `frontend/src/services/api.error.test.ts`, `frontend/src/offline/offlineSync.test.ts`
    - Create error boundary components for graceful failure recovery
    - Add network error handling with retry mechanisms and offline mode
    - Implement validation error display with field highlighting and correction guidance
    - Write error handling tests for various failure scenarios and recovery workflows
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 13.2 Create user feedback and notification system  `frontend/src/components/notifications/NotificationCenter.tsx:63-138`, `frontend/src/components/modals/GraphCopyProgressPanel.tsx`, `frontend/src/components/streaming/StreamingStatusBadge.tsx`, `frontend/src/components/ui/ConfirmDialog.tsx` (used at `frontend/src/components/views/TimelineView.tsx:468` and `frontend/src/components/views/CausalGraphView.tsx:341`), `frontend/src/components/notifications/NotificationCenter.test.tsx`
    - Implement toast notifications for operation success/failure feedback — PARTIAL: failures surface as dismissible toasts (`frontend/src/components/notifications/NotificationCenter.tsx:93-120`) and copy success has its own notice, but there is no generic success toast
    - Add loading states and progress indicators for API calls and long-running operations
    - Create loading indicators for progressive data loading and prevent duplicate requests — PARTIAL: only the in-flight "Working…" banner exists (`frontend/src/components/notifications/NotificationCenter.tsx:75-91`); duplicate-request suppression comes from React Query, not from a dedicated indicator
    - Create confirmation dialogs for destructive actions with clear messaging

    - Write user experience tests for feedback timing and message clarity

    - _Requirements: 14.1, 14.2, 7.2, 7.4_

- [x] 14. Implement accessibility features  `frontend/src/test/helpers/a11yTestHelpers.ts`, axe assertions in 8 frontend test files


  - [x] 14.1 Add keyboard navigation support  `frontend/src/hooks/useGlobalKeyboardShortcuts.ts:29-84`, `frontend/src/hooks/useViewShortcuts.ts`, `frontend/src/components/views/ViewToolbar.tsx:475-509`, `frontend/src/components/timeline/Timeline.tsx:582-624` (ArrowLeft/Right/Up/Down, PageUp/PageDown, +/-/0), `frontend/src/components/causal-graph/CausalGraphComponent.tsx:1102-1197` (ArrowLeft/Right/Up/Down and Enter node selection on graph container), `frontend/src/components/causal-graph/CausalGraphLayoutManager.tsx` (layout shortcuts), `frontend/src/hooks/useGlobalKeyboardShortcuts.test.ts` (7 tests), `frontend/src/components/timeline/Timeline.test.tsx:435-451`
    - Implement keyboard navigation for timeline (arrow keys, page up/down)
    - Add keyboard support for causal graph navigation and selection
    - Create keyboard shortcuts for common operations and view switching
    - Write accessibility tests for keyboard navigation completeness
    - _Requirements: 8.1, 8.2, 13.1_

  - [x] 14.2 Add screen reader and visual accessibility support  `frontend/src/components/modals/ModalBase.tsx:167-193`, `frontend/src/components/timeline/Timeline.tsx:611-619` (role=img + aria-label), `frontend/src/test/helpers/a11yTestHelpers.ts`, axe assertions in `frontend/src/components/modals/EventDetailModal.test.tsx`, `frontend/src/components/filters/FilterPanel.test.tsx`, `frontend/src/components/views/ViewToolbar.test.tsx`
    - Implement ARIA labels and roles for all interactive elements
    - Add alternative text descriptions for visualizations and complex graphics
    - Create high contrast mode and color-blind friendly color schemes (`frontend/src/components/layout/MainLayout.tsx:26-30` syncs `userPreferences.accessibility.highContrast` to `html.high-contrast` and `frontend/src/index.css:64-73` styles both `prefers-contrast: high` and `html.high-contrast`)
    - Write accessibility compliance tests using automated testing tools
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 15. Create comprehensive testing suite  `frontend/src` (116 test files, 1746 tests, all passing), `e2e/`, `.github/workflows/ci.yml`
  - [x] 15.1 Implement unit and integration tests  `frontend/src/test/stores/globalStore.test.ts`, `frontend/src/test/services/api.test.ts`, `frontend/src/test/integration/causalGraph.integration.test.tsx`, `frontend/src/test/integration/graphSwitching.integration.test.tsx`, `e2e/tests/visual.spec.ts`, `.github/workflows/ci.yml`
    - Write unit tests for all components with 80%+ code coverage using Vitest ^3.2.4 — NOT MET: measured coverage is 74.3% statements / 83.7% branches / 70.3% functions (`npm run test:coverage`)
    - Create integration tests for complete user workflows and data flows using React Testing Library ^16.3.0
    - Add visual regression tests for timeline and causal graph rendering — PARTIAL: `e2e/tests/visual.spec.ts` snapshots the timeline view and the ingestion review table, not the causal graph
    - Set up continuous integration pipeline with automated test execution
    - _Requirements: 7.1, 14.1_

  - [x] 15.2 Add end-to-end and performance testing  `e2e/tests/smoke.spec.ts`, `e2e/tests/create-event.spec.ts`, `e2e/tests/ingestion.spec.ts`, `e2e/tests/offline.spec.ts`, `e2e/playwright.config.ts`
    - Implement E2E tests using Playwright ^1.54.2 for critical user journeys
    - Create performance benchmarks for large dataset handling and interaction responsiveness — NOT DONE: no such benchmark exists in `e2e/` or `frontend/`
    - Add cross-browser compatibility testing for major browsers — NOT DONE: `e2e/playwright.config.ts:52-55` defines only a chromium project
    - Write load testing scenarios for concurrent user interactions — NOT DONE: no load-test harness exists
    - _Requirements: 7.1, 7.2, 7.3, 8.1_

- [x] 16. Integrate all components and finalize application  `frontend/src/App.tsx`, `frontend/src/components/routing/AppRoutes.tsx`
  - [x] 16.1 Connect all features and create unified user experience  `frontend/src/App.tsx:11-22`, `frontend/src/components/routing/AppRoutes.tsx`, `frontend/src/components/views/TimelineView.tsx:48-60`, `frontend/src/components/views/CausalGraphView.tsx:41-50`, `frontend/src/components/views/ActorPerspectiveView.tsx:34-45` (all views read the shared store filters), `e2e/tests/smoke.spec.ts`, `frontend/src/test/integration/graphSwitching.integration.test.tsx`
    - Integrate all visualization components with shared state management
    - Connect filter system to all views with consistent behavior (`frontend/src/hooks/useViewStateManager.ts:134-169,255-261` preserves active filters across view switches via `preserveCurrentFilters: true`)
    - Implement unified error handling and user feedback across all features
    - Write end-to-end integration tests for complete application workflows
    - _Requirements: 1.1, 2.1, 5.1, 6.1, 13.1_

  - [x] 16.2 Optimize and polish user interface  `frontend/src/components/layout/MainLayout.tsx:30-38`, `frontend/src/index.css`, `frontend/vite.config.ts:29-54` (manual chunks)
    - Fine-tune responsive design for optimal mobile and desktop experience
    - Implement smooth animations and transitions for enhanced user experience
    - Add final performance optimizations and bundle size reduction
    - Conduct user acceptance testing and incorporate feedback for final polish — NOT DONE: no user-acceptance-test record exists in the repository
    - _Requirements: 8.1, 8.2, 7.1, 14.1_
