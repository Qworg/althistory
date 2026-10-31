# Requirements Document

## Introduction

The Hierarchical Temporal Graph system is designed to capture and analyze historical events across multiple temporal scales, from instantaneous happenings to long-running historical arcs. The system will model complex causal relationships between events while maintaining temporal integrity and supporting efficient querying of historical patterns. This enables historians, researchers, and analysts to explore both fine-grained events and broader historical narratives within a unified framework.

## Requirements

### Requirement 1

**User Story:** As a historian, I want to store and organize historical events with precise timestamps, so that I can maintain accurate chronological records and analyze temporal patterns.

#### Acceptance Criteria

1. WHEN a user creates an event THEN the system SHALL store the event with id, description, actor, target, and exact timestamp
2. WHEN a user queries events by timestamp THEN the system SHALL return events ordered chronologically
3. WHEN a user provides an invalid timestamp THEN the system SHALL reject the event creation with a clear error message
4. IF an event lacks required fields THEN the system SHALL prevent creation and indicate missing fields

### Requirement 2

**User Story:** As a researcher, I want to group related events into hierarchical phases (arcs), so that I can analyze historical periods at different scales of granularity.

#### Acceptance Criteria

1. WHEN a user creates an arc THEN the system SHALL store the arc with id, name, start_time, and end_time
2. WHEN a user assigns an event to an arc THEN the system SHALL verify the event timestamp falls within the arc's time boundaries
3. WHEN a user creates nested arcs THEN the system SHALL enforce that child arcs fall completely within parent arc boundaries
4. IF an event timestamp is outside an arc's boundaries THEN the system SHALL reject the assignment with a temporal constraint error

### Requirement 3

**User Story:** As an analyst, I want to establish explicit causal relationships between events, so that I can trace cause-and-effect chains throughout history.

#### Acceptance Criteria

1. WHEN a user creates a causal link between events THEN the system SHALL store the relationship with weight and evidence metadata
2. WHEN a user queries causal chains THEN the system SHALL return paths of connected events up to a specified depth
3. WHEN a user assigns a causal weight THEN the system SHALL validate the weight is between 0.0 and 1.0
4. IF a causal relationship would create a temporal paradox THEN the system SHALL prevent creation and warn the user

### Requirement 4

**User Story:** As a data scientist, I want to infer and track underlying historical pressures, so that I can identify systemic forces driving historical events.

#### Acceptance Criteria

1. WHEN the system identifies event patterns THEN it SHALL create InferredPressure nodes with description and confidence scores
2. WHEN an inferred pressure is created THEN the system SHALL link it to relevant arcs via DRIVEN_BY relationships
3. WHEN a user queries pressures THEN the system SHALL return pressures ranked by confidence score
4. IF confidence score is below threshold THEN the system SHALL mark the pressure as tentative

### Requirement 5

**User Story:** As a researcher, I want to query events and arcs by temporal ranges, so that I can focus my analysis on specific historical periods.

#### Acceptance Criteria

1. WHEN a user queries events in a date range THEN the system SHALL return all events with timestamps in that range
2. WHEN a user queries overlapping arcs THEN the system SHALL return all arcs that intersect with the specified time period
3. WHEN a user performs temporal queries THEN the system SHALL complete queries within 2 seconds for datasets up to 100,000 events
4. IF no events exist in the queried range THEN the system SHALL return an empty result set with appropriate messaging

### Requirement 6

**User Story:** As a historian, I want to visualize temporal hierarchies and causal relationships, so that I can better understand complex historical patterns.

#### Acceptance Criteria

1. WHEN a user requests timeline visualization THEN the system SHALL render an interactive timeline with arcs as bars and events as markers
2. WHEN a user clicks on an arc THEN the system SHALL display its constituent events and sub-arcs
3. WHEN a user requests causal visualization THEN the system SHALL render a force-directed graph showing causal relationships
4. WHEN a user zooms into a time period THEN the system SHALL dynamically load and display relevant events and arcs

### Requirement 7

**User Story:** As a system administrator, I want to ensure data integrity across temporal relationships, so that the historical data remains consistent and reliable.

#### Acceptance Criteria

1. WHEN events are assigned to arcs THEN the system SHALL enforce that event timestamps fall within arc boundaries
2. WHEN arcs are nested THEN the system SHALL enforce that child arcs are completely contained within parent arcs
3. WHEN causal relationships are created THEN the system SHALL prevent temporal paradoxes where effects precede causes
4. IF integrity constraints are violated THEN the system SHALL reject the operation and provide detailed error information

### Requirement 8

**User Story:** As a researcher, I want to create copies of the graph (whole or subsets), so that I can use existing historical data as a foundation for new research projects or alternative analyses.

#### Acceptance Criteria

1. WHEN a user requests a full graph copy THEN the system SHALL duplicate all events, arcs, causal relationships, and inferred pressures
2. WHEN a user requests a subset copy by time range THEN the system SHALL copy all events and arcs that intersect with the specified period
3. WHEN a user requests a subset copy by entity filter THEN the system SHALL copy events matching the filter criteria along with their associated arcs and relationships
4. WHEN copying relationships THEN the system SHALL maintain referential integrity and only include relationships where both endpoints exist in the copy
5. IF a copy operation would exceed system limits THEN the system SHALL warn the user and offer to create the copy in batches

### Requirement 9

**User Story:** As a performance-conscious user, I want the system to handle large datasets efficiently, so that I can work with comprehensive historical databases without performance degradation.

#### Acceptance Criteria

1. WHEN the system stores temporal data THEN it SHALL use appropriate indexing for timestamp and interval queries
2. WHEN users perform complex queries THEN the system SHALL leverage graph database optimizations for traversal operations
3. WHEN the dataset grows beyond 50,000 events THEN the system SHALL maintain sub-second response times for basic queries
4. IF memory usage exceeds thresholds THEN the system SHALL implement efficient caching and pagination strategies