# Implementation Plan

- [x] 1. Set up React application foundation and project structure. This is a SEPARATE PROJECT from "timeline" and should be in the base directory of the repo as "frontend". Do NOT alter the "timeline" folder.









  - Create React TypeScript ^19.1.1 project with Vite ^7.0.6 build system and essential dependencies.
  - Set up project structure with components, hooks, services, and types directories
  - Configure TypeScript with strict settings and path aliases for clean imports
  - Install and configure core dependencies: React Router v7, Zustand ^5.0.7, React Query ^5.84.1, Tailwind CSS ^4
  - _Requirements: 7.1, 8.1, 14.1_

- [x] 2. Implement global state management and API client





  - [x] 2.1 Create Zustand store for global application state


    - Implement global state interface with events, arcs, causal relationships, and UI state
    - Add state actions for data manipulation and UI state updates
    - Create state persistence layer for user preferences and session data
    - Write unit tests for state management logic and action creators
    - _Requirements: 1.1, 2.1, 5.1, 14.2_

  - [x] 2.2 Implement API client with React Query integration


    - Create typed API client with methods for events, arcs, causal relationships, and inference using Axios ^1.11.0
    - Add request/response interceptors for error handling and authentication
    - Implement React Query ^5.84.1 hooks for data fetching, caching, and synchronization
    - Write integration tests for API client methods and error scenarios
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 9.1, 14.1_
- [x] 3. Create core UI components and layout structure




- [ ] 3. Create core UI components and layout structure

  - [x] 3.1 Implement main application layout and navigation


    - Create responsive main layout component with header, sidebar, and content areas
    - Implement navigation component with view switching and breadcrumb functionality
    - Add responsive design breakpoints and mobile-optimized layouts with touch-optimized interactions
    - Add support for pinch-to-zoom and pan gestures for timeline navigation on mobile devices
    - Write component tests for layout rendering and responsive behavior
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 13.1, 13.2_

  - [x] 3.2 Create filter panel and search interface components


    - Implement collapsible filter panel with date range, actor, target, and event type filters
    - Add search interface with real-time filtering, autocomplete suggestions, and result highlighting
    - Create filter state management with URL synchronization for bookmarkable filters
    - Add visual indicators for active filters and easy filter removal options
    - Write interaction tests for filter application and search functionality
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 3.3 Create event and arc detail modal components


    - Implement event detail modal with full information display and editing capabilities
    - Create arc detail panel showing contained events, child arcs, and properties
    - Add form validation and error handling for event and arc editing
    - Implement modal state management and keyboard navigation support
    - Write component tests for modal functionality and form validation
    - _Requirements: 1.3, 2.3, 3.2, 4.2_

- [x] 4. Implement timeline visualization foundation










  - [x] 4.1 Create D3.js timeline component with basic rendering



    - Set up D3.js ^7.9.0 integration with React ^19.1.1 using useRef and useEffect patterns
    - Implement time scale, axis rendering, and basic timeline structure
    - Add zoom and pan functionality with smooth transitions and boundary constraints
    - Write unit tests for timeline rendering and scale calculations using Vitest ^1.0.4
    - _Requirements: 1.1, 1.4, 7.1, 7.3_

  - [x] 4.2 Add event markers and interaction handling




    - Implement event rendering as positioned markers with hover tooltips showing event details
    - Add click handlers for event selection and detailed event panel opening
    - Create double-click functionality for creating new events with timestamp pre-filled
    - Create drag functionality for event timestamp modification with temporal constraint validation
    - Write interaction tests for event selection, editing, and drag operations
    - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.3, 3.4_
- [x] 5. Implement arc visualization and management



- [ ] 5. Implement arc visualization and management

  - [x] 5.1 Create hierarchical arc rendering system


    - Implement arc rendering as horizontal bars positioned by start/end times with nested hierarchy display
    - Add visual indicators for arc levels and containment relationships using different vertical levels
    - Create arc expansion/collapse functionality for exploring hierarchies and showing constituent events
    - Add hover functionality to highlight arcs and show basic information (name, duration, event count)
    - Write tests for arc hierarchy rendering and interaction behavior
    - _Requirements: 2.1, 2.2, 2.3, 2.4_



  - [x] 5.2 Add arc creation and editing capabilities







    - Implement time range selection for creating new arcs with visual feedback and backend validation
    - Add arc resize functionality by dragging edges with temporal boundary and hierarchy constraint validation
    - Create event-to-arc assignment functionality with temporal containment verification
    - Create arc detail panel for viewing and editing arc properties
    - Write integration tests for arc creation, editing, and validation workflows
    - _Requirements: 4.1, 4.2, 4.3, 4.4_


- [-] 6. Implement causal graph visualization



  - [x] 6.1 Create Cytoscape.js causal graph component


    - Set up Cytoscape.js ^3.33.0 integration with React ^19.1.1 and TypeScript ^5.3.2 definitions
    - Implement node rendering for events with customizable styling and labels
    - Add edge rendering for causal relationships with weight-based visual styling
    - Write component tests for graph initialization and basic rendering using Vitest ^3.2.4
    - _Requirements: 5.1, 5.2, 10.1, 10.2_

  - [x] 6.2 Add causal relationship creation and editing



    - Implement interactive causal link creation between event nodes with temporal ordering validation
    - Add relationship weight adjustment with visual feedback and backend persistence
    - Create hover functionality for causal edges showing relationship details (weight, evidence, confidence)
    - Create causal relationship detail modal for editing evidence and confidence
    - Write interaction tests for causal link creation and modification workflows
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 7. Implement causal chain exploration features




  - [x] 7.1 Create causal path highlighting and navigation


    - Implement causal chain traversal with configurable depth limits
    - Add path highlighting with cumulative strength visualization
    - Create navigation controls for stepping through causal chains chronologically
    - Write tests for causal path calculation and visualization accuracy
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 7.2 Add causal suggestion system integration


    - Implement display of AI-generated causal suggestions as dotted connections
    - Add suggestion acceptance/rejection workflow with confidence scoring
    - Create suggestion feedback system to improve future recommendations
    - Write integration tests for suggestion display and user interaction workflows
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 8. Create actor perspective view



  - [x] 8.1 Implement actor-focused timeline visualization


    - Create specialized timeline view filtered to single actor's involvement
    - Add role distinction visualization (actor vs target) with different styling
    - Implement chronological and thematic layout options for actor events
    - Write component tests for actor perspective rendering and filtering
    - _Requirements: 13.5, 6.1, 6.2_

  - [x] 8.2 Add actor selection and navigation interface


    - Create actor selection dropdown with search and autocomplete functionality
    - Implement actor switching with smooth transitions and state preservation
    - Add actor statistics display (event count, time span, relationship metrics)
    - Write interaction tests for actor selection and view switching workflows
    - _Requirements: 13.5, 6.1, 6.4_

- [x] 9. Implement inferred pressure visualization




  - [x] 9.1 Create pressure indicator display system


    - Implement pressure visualization as colored indicators on arcs with confidence-based opacity
    - Add pressure type categorization with distinct visual styling (economic, social, etc.)
    - Create pressure detail tooltips showing evidence events and influence strength
    - Write tests for pressure indicator rendering and confidence score visualization
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 9.2 Add pressure exploration and evidence tracking


    - Implement pressure detail modal showing contributing evidence events
    - Add evidence event highlighting when exploring pressure relationships
    - Create pressure confidence tracking with visual updates for score changes
    - Write integration tests for pressure exploration and evidence display workflows
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
-

- [x] 10. Implement view switching and layout management



  - [x] 10.1 Create view mode switching system


    - Implement seamless switching between timeline, causal graph, and actor perspective views
    - Add state preservation across view switches (selections, filters, zoom levels)
    - Create view-specific toolbar and control panels with context-appropriate options
    - Write tests for view switching functionality and state preservation
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 10.2 Add layout options for causal graph view


    - Implement multiple layout algorithms (force-directed, hierarchical, circular)
    - Add layout switching with smooth transitions and position preservation
    - Create overview+detail interface for large dataset navigation
    - Write performance tests for layout switching and large graph rendering
    - _Requirements: 13.3, 13.4, 7.1, 7.2_

- [ ] 11. Implement graph copying functionality










  - [x] 11.1 Create graph copy interface and workflow


    - Implement time range selection interface for temporal subset copying
    - Add entity filter interface for creating filtered graph copies
    - Create copy progress tracking with estimated completion time display
    - Write integration tests for copy operation initiation and progress tracking
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 11.2 Add copy result management and navigation


    - Implement copy completion notification with options to switch to new graph
    - Add graph comparison interface for viewing original vs copied data
    - Create copy history tracking and management interface
    - Write tests for copy result handling and graph switching workflows
    - _Requirements: 11.3, 11.4_

- [ ] 12. Implement performance optimizations




  - [ ] 12.1 Add virtualization for large datasets
    - Implement timeline virtualization for handling 10,000+ events efficiently
    - Add causal graph level-of-detail rendering for large node sets
    - Create progressive loading system with background data fetching
    - Write performance tests to validate sub-200ms interaction response times
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ] 12.2 Implement caching and data optimization
    - Add intelligent caching for visualization render data and API responses
    - Implement cache invalidation strategies for data consistency
    - Create memory management system for large dataset handling
    - Write performance benchmarks for caching effectiveness and memory usage

    - _Requirements: 7.1, 7.2, 7.4_

- [ ] 13. Add error handling and user feedback systems

  - [ ] 13.1 Implement comprehensive error handling
    - Create error boundary components for graceful failure recovery
    - Add network error handling with retry mechanisms and offline mode
    - Implement validation error display with field highlighting and correction guidance
    - Write error handling tests for various failure scenarios and recovery workflows
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [ ] 13.2 Create user feedback and notification system
    - Implement toast notifications for operation success/failure feedback
    - Add loading states and progress indicators for API calls and long-running operations
    - Create loading indicators for progressive data loading and prevent duplicate requests
    - Create confirmation dialogs for destructive actions with clear messaging

    - Write user experience tests for feedback timing and message clarity

    - _Requirements: 14.1, 14.2, 7.2, 7.4_

- [ ] 14. Implement accessibility features

  - [ ] 14.1 Add keyboard navigation support
    - Implement keyboard navigation for timeline (arrow keys, page up/down)
    - Add keyboard support for causal graph navigation and selection
    - Create keyboard shortcuts for common operations and view switching
    - Write accessibility tests for keyboard navigation completeness
    - _Requirements: 8.1, 8.2, 13.1_

  - [ ] 14.2 Add screen reader and visual accessibility support
    - Implement ARIA labels and roles for all interactive elements
    - Add alternative text descriptions for visualizations and complex graphics
    - Create high contrast mode and color-blind friendly color schemes
    - Write accessibility compliance tests using automated testing tools
    - _Requirements: 8.1, 8.2, 8.3_

- [ ] 15. Create comprehensive testing suite
  - [ ] 15.1 Implement unit and integration tests
    - Write unit tests for all components with 80%+ code coverage using Vitest ^3.2.4
    - Create integration tests for complete user workflows and data flows using React Testing Library ^16.3.0
    - Add visual regression tests for timeline and causal graph rendering
    - Set up continuous integration pipeline with automated test execution
    - _Requirements: 7.1, 14.1_

  - [ ] 15.2 Add end-to-end and performance testing
    - Implement E2E tests using Playwright ^1.54.2 for critical user journeys
    - Create performance benchmarks for large dataset handling and interaction responsiveness
    - Add cross-browser compatibility testing for major browsers
    - Write load testing scenarios for concurrent user interactions
    - _Requirements: 7.1, 7.2, 7.3, 8.1_

- [ ] 16. Integrate all components and finalize application
  - [ ] 16.1 Connect all features and create unified user experience
    - Integrate all visualization components with shared state management
    - Connect filter system to all views with consistent behavior
    - Implement unified error handling and user feedback across all features
    - Write end-to-end integration tests for complete application workflows
    - _Requirements: 1.1, 2.1, 5.1, 6.1, 13.1_

  - [ ] 16.2 Optimize and polish user interface
    - Fine-tune responsive design for optimal mobile and desktop experience
    - Implement smooth animations and transitions for enhanced user experience
    - Add final performance optimizations and bundle size reduction
    - Conduct user acceptance testing and incorporate feedback for final polish
    - _Requirements: 8.1, 8.2, 7.1, 14.1_