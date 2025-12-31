# Requirements Document

## Introduction

The Input/Output System provides comprehensive capabilities for managing multiple historical graphs, importing and exporting data, ingesting content from external sources (Wikipedia, Wikidata, text), and exposing APIs for external automated systems. This system enables researchers to work with multiple timelines, share data between projects, leverage existing historical databases, and integrate with AI-powered history generation tools.

The design emphasizes flexibility (supporting both cloud and local-only modes), data integrity (with Git-like versioning), and extensibility (supporting cross-graph references and multiple LLM providers).

## Requirements

### Requirement 1: Multi-Graph Management

**User Story:** As a researcher, I want to manage multiple separate historical graphs, so that I can work on different time periods or alternative histories independently.

#### Acceptance Criteria

1. WHEN a user views the application THEN the system SHALL display a graph selector showing all available graphs with metadata (name, event count, date range)
2. WHEN a user creates a new graph THEN the system SHALL initialize an empty graph with the specified name and description
3. WHEN a user switches graphs THEN the system SHALL reload the entire application state with the selected graph's data
4. WHEN a user deletes a graph THEN the system SHALL soft-delete the graph (recoverable) and prevent access to its data
5. WHEN a user views graph details THEN the system SHALL display metadata including event count, arc count, relationship count, and temporal range

### Requirement 2: Graph Versioning

**User Story:** As a historian, I want every change to my graph to be tracked and reversible, so that I can experiment freely and recover from mistakes.

#### Acceptance Criteria

1. WHEN a user modifies any entity (event, arc, relationship) THEN the system SHALL create a new version with the change recorded
2. WHEN a user views version history THEN the system SHALL display all versions with timestamps, operation types, and descriptions
3. WHEN a user rolls back to a previous version THEN the system SHALL restore the graph state to that exact version
4. WHEN storing versions THEN the system SHALL use Git-like delta compression to minimize storage (content-addressable objects, delta chains)
5. WHEN a graph has many versions THEN the system SHALL support garbage collection to pack old deltas and remove unreferenced objects

### Requirement 3: Graph Branching and Merging

**User Story:** As a researcher, I want to create alternative versions of a graph and optionally merge changes back, so that I can explore "what-if" scenarios.

#### Acceptance Criteria

1. WHEN a user branches a graph THEN the system SHALL create a new graph that shares history with the parent up to the branch point
2. WHEN a user views a branched graph THEN the system SHALL indicate its parent graph and branch point version
3. WHEN a user merges a branch THEN the system SHALL detect conflicts (same entity modified in both branches) and present resolution options
4. WHEN conflicts exist during merge THEN the system SHALL support resolution strategies: keep-source, keep-target, or manual selection
5. WHEN a merge completes THEN the system SHALL create a merge commit recording both parent versions

### Requirement 4: Cross-Graph References

**User Story:** As a historian, I want to reference events from one graph in another graph, so that I can build interconnected historical universes.

#### Acceptance Criteria

1. WHEN creating a causal relationship THEN the system SHALL allow selecting events from other graphs as cause or effect
2. WHEN displaying a cross-graph reference THEN the system SHALL clearly indicate the source graph with visual distinction
3. WHEN the referenced entity is modified in its source graph THEN the system SHALL notify users of the referencing graph
4. WHEN exporting a graph with cross-references THEN the system SHALL include reference metadata and optionally embed referenced entities
5. WHEN a referenced graph is deleted THEN the system SHALL preserve the reference with a "broken link" indicator

### Requirement 5: Data Export

**User Story:** As a researcher, I want to export my historical data in a portable format, so that I can share it, back it up, or use it in other tools.

#### Acceptance Criteria

1. WHEN a user exports a graph THEN the system SHALL generate a JSON file conforming to the Althistory Export Format v1.0
2. WHEN exporting THEN the system SHALL include all events, arcs, causal relationships, and optionally inferred pressures
3. WHEN a user applies filters before export THEN the system SHALL export only the filtered subset of data
4. WHEN exporting a large graph (>10k entities) THEN the system SHALL create an async job with progress tracking
5. WHEN export completes THEN the system SHALL provide a download link valid for at least 1 hour
6. WHEN exporting THEN the system SHALL include provenance information tracking the source of each entity

### Requirement 6: Data Import

**User Story:** As a researcher, I want to import historical data from files, so that I can build upon existing datasets or restore backups.

#### Acceptance Criteria

1. WHEN a user uploads an import file THEN the system SHALL validate the format and report any structural errors
2. WHEN validating an import THEN the system SHALL check temporal constraints, causal consistency, and referential integrity
3. WHEN a user previews an import THEN the system SHALL show what entities would be created, updated, or deleted
4. WHEN conflicts are detected THEN the system SHALL present each conflict with resolution options (skip, overwrite, rename)
5. WHEN a user executes an import THEN the system SHALL apply changes atomically (all-or-nothing on failure)
6. WHEN import completes THEN the system SHALL report summary statistics and any warnings

### Requirement 7: Wikipedia Ingestion

**User Story:** As a historian, I want to extract historical events from Wikipedia articles, so that I can quickly build timelines from existing research.

#### Acceptance Criteria

1. WHEN a user provides a Wikipedia URL THEN the system SHALL fetch and parse the article content
2. WHEN parsing an article THEN the system SHALL extract events from infoboxes, timeline sections, and prose text
3. WHEN a user enables link following THEN the system SHALL crawl linked articles up to the specified depth (max 3)
4. WHEN link following is enabled THEN the system SHALL filter links based on user-provided patterns (regex)
5. WHEN extraction completes THEN the system SHALL present extracted entities for review with confidence scores
6. WHEN a user reviews extracted entities THEN the system SHALL allow editing before import

### Requirement 8: Wikidata Ingestion

**User Story:** As a researcher, I want to query Wikidata for structured historical data, so that I can import verified facts with precise dates.

#### Acceptance Criteria

1. WHEN a user selects a predefined query (historical events, person timeline) THEN the system SHALL execute the appropriate SPARQL query
2. WHEN a user provides custom SPARQL THEN the system SHALL execute the query against the Wikidata endpoint
3. WHEN results are returned THEN the system SHALL map Wikidata entities to Althistory events with source attribution
4. WHEN a user specifies a time range THEN the system SHALL filter Wikidata results to that period
5. WHEN extraction completes THEN the system SHALL present results for review before import

### Requirement 9: Text Ingestion

**User Story:** As a historian, I want to extract events from pasted text, so that I can digitize information from various sources.

#### Acceptance Criteria

1. WHEN a user pastes text THEN the system SHALL extract dates and events using pattern matching
2. WHEN LLM integration is enabled THEN the system SHALL use AI to improve extraction accuracy
3. WHEN extracting entities THEN the system SHALL identify actors, targets, and timestamps with confidence scores
4. WHEN context is provided (default actors, time range) THEN the system SHALL use it to improve extraction
5. WHEN extraction completes THEN the system SHALL present results for review and editing before import

### Requirement 10: LLM Integration

**User Story:** As a researcher, I want AI assistance in extracting and analyzing historical data, so that I can work more efficiently.

#### Acceptance Criteria

1. WHEN LLM is enabled THEN the system SHALL support both OpenAI and Anthropic providers
2. WHEN LLM extraction is requested THEN the system SHALL send text with appropriate prompts and parse structured responses
3. WHEN LLM is unavailable or fails THEN the system SHALL fall back to pattern-based extraction
4. WHEN LLM is used THEN the system SHALL track which entities were AI-generated in provenance data
5. WHEN configuring LLM THEN the system SHALL read API keys from environment variables (never expose in UI)

### Requirement 11: API Key Authentication

**User Story:** As an administrator, I want to issue API keys to external systems, so that automated tools can access the graph data securely.

#### Acceptance Criteria

1. WHEN an admin creates an API key THEN the system SHALL generate a secure random key and display it once
2. WHEN storing API keys THEN the system SHALL hash them with bcrypt (never store plaintext)
3. WHEN an API request includes a key THEN the system SHALL validate it and enforce its permissions
4. WHEN a key has expired or been revoked THEN the system SHALL reject requests with 401 Unauthorized
5. WHEN viewing keys THEN the system SHALL display only the prefix (first 8 characters) for identification

### Requirement 12: Rate Limiting

**User Story:** As an administrator, I want to limit API usage per key, so that no single consumer can overwhelm the system.

#### Acceptance Criteria

1. WHEN a key is created THEN the system SHALL assign configurable rate limits (per minute, hour, day)
2. WHEN rate limits are exceeded THEN the system SHALL return 429 Too Many Requests with retry-after header
3. WHEN processing requests THEN the system SHALL include rate limit headers (limit, remaining, reset)
4. WHEN a key approaches its limit THEN the system SHALL log warnings for monitoring
5. WHEN in local mode THEN the system SHALL track rate limits in memory (no Redis required)

### Requirement 13: Batch Operations

**User Story:** As an automated system, I want to create many entities in a single request, so that I can efficiently populate graphs.

#### Acceptance Criteria

1. WHEN a batch request is received THEN the system SHALL process up to 1000 entities per request
2. WHEN validation is set to 'strict' THEN the system SHALL reject the entire batch if any entity fails validation
3. WHEN validation is set to 'lenient' THEN the system SHALL skip invalid entities and continue processing
4. WHEN onError is 'collect' THEN the system SHALL return details of all failures after processing
5. WHEN a transaction batch is requested THEN the system SHALL apply all operations atomically

### Requirement 14: Validation Endpoint

**User Story:** As an automated system, I want to validate entities before committing them, so that I can catch errors early.

#### Acceptance Criteria

1. WHEN a validation request is received THEN the system SHALL check temporal constraints, causal consistency, and references
2. WHEN validating incrementally THEN the system SHALL check compatibility with existing graph data
3. WHEN validation fails THEN the system SHALL return detailed error messages for each violation
4. WHEN validation passes THEN the system SHALL return suggestions for missing arcs or relationships
5. WHEN validating THEN the system SHALL not modify any data

### Requirement 15: Suggestion Endpoint

**User Story:** As a researcher, I want AI-powered suggestions for relationships and structure, so that I can discover patterns I might have missed.

#### Acceptance Criteria

1. WHEN relationship suggestions are requested THEN the system SHALL analyze temporal and actor patterns to suggest causal links
2. WHEN arc suggestions are requested THEN the system SHALL cluster events by time and theme to suggest groupings
3. WHEN completeness analysis is requested THEN the system SHALL identify temporal gaps, actor gaps, and missing causal links
4. WHEN returning suggestions THEN the system SHALL include confidence scores and reasoning
5. WHEN suggestions are based on existing InferenceService THEN the system SHALL expose its capabilities via API

### Requirement 16: WebSocket Streaming

**User Story:** As an automated history generator, I want to stream events in real-time, so that I can write large datasets efficiently.

#### Acceptance Criteria

1. WHEN a client requests a stream token THEN the system SHALL issue a short-lived token (5 minutes) tied to an API key
2. WHEN a client connects with a valid token THEN the system SHALL establish a persistent WebSocket session
3. WHEN events are streamed THEN the system SHALL acknowledge each event with success or error status
4. WHEN validation warnings occur THEN the system SHALL send them as non-blocking notifications
5. WHEN the connection drops THEN the system SHALL require a new token to reconnect

### Requirement 17: Frontend - Graph Management

**User Story:** As a user, I want a visual interface to manage my graphs, so that I can organize my historical research projects.

#### Acceptance Criteria

1. WHEN a user views the header THEN the system SHALL display a graph selector dropdown with the active graph name
2. WHEN a user opens graph management THEN the system SHALL display a modal with all graphs as cards
3. WHEN a user creates a graph THEN the system SHALL show a form for name and description
4. WHEN a user branches a graph THEN the system SHALL prompt for the new branch name
5. WHEN a user views version history THEN the system SHALL display a timeline of changes with rollback buttons

### Requirement 18: Frontend - Import Wizard

**User Story:** As a user, I want a guided import process, so that I can safely bring in external data.

#### Acceptance Criteria

1. WHEN a user starts an import THEN the system SHALL display a 5-step wizard (Upload -> Validate -> Preview -> Conflicts -> Execute)
2. WHEN uploading THEN the system SHALL accept file upload or pasted JSON
3. WHEN conflicts are detected THEN the system SHALL display each conflict with resolution options
4. WHEN executing THEN the system SHALL show progress and final summary
5. WHEN import fails THEN the system SHALL show error details and allow retry

### Requirement 19: Frontend - Ingestion Wizard

**User Story:** As a user, I want a visual interface to extract data from external sources, so that I can build timelines from existing content.

#### Acceptance Criteria

1. WHEN a user opens ingestion THEN the system SHALL display tabs for Wikipedia, Wikidata, and Text sources
2. WHEN configuring Wikipedia THEN the system SHALL allow URL input and link-following options
3. WHEN reviewing extracted data THEN the system SHALL display entities in an editable table with checkboxes
4. WHEN a user edits an entity THEN the system SHALL update the extraction before import
5. WHEN a user approves selected entities THEN the system SHALL import only the checked items

### Requirement 20: Frontend - API Key Dashboard

**User Story:** As an administrator, I want to manage API keys through the interface, so that I can control external access.

#### Acceptance Criteria

1. WHEN an admin views the dashboard THEN the system SHALL display all keys with masked values and usage stats
2. WHEN creating a key THEN the system SHALL display the full key once with a copy button
3. WHEN editing a key THEN the system SHALL allow changing permissions and rate limits
4. WHEN viewing usage THEN the system SHALL show requests over time and remaining limits
5. WHEN revoking a key THEN the system SHALL require confirmation and immediately invalidate it

### Requirement 21: Local Mode Compatibility

**User Story:** As a developer, I want all features to work without external databases, so that I can develop and demo locally.

#### Acceptance Criteria

1. WHEN LOCAL_EXECUTION_ENABLED=true THEN the system SHALL store all data in JSON files
2. WHEN managing jobs locally THEN the system SHALL persist job state to survive restarts
3. WHEN rate limiting locally THEN the system SHALL track limits in memory
4. WHEN versioning locally THEN the system SHALL use file-based Git-like storage
5. WHEN ingesting locally THEN the system SHALL not require any additional dependencies beyond Node.js

### Requirement 22: Async Job Management

**User Story:** As a user, I want long-running operations to run in the background, so that I don't have to wait.

#### Acceptance Criteria

1. WHEN a job is created THEN the system SHALL return immediately with a job ID
2. WHEN a job is processing THEN the system SHALL update progress percentage
3. WHEN a job completes THEN the system SHALL store results for retrieval
4. WHEN a job has a webhook configured THEN the system SHALL POST to the URL on completion
5. WHEN jobs expire THEN the system SHALL clean up result files automatically
