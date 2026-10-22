/**
 * Types of causal relationships between events
 */
export type CausalRelationshipType = 'direct' | 'indirect' | 'contributory';

/**
 * Causal relationship between events
 */
export interface CausalRelationship {
  /** Weight of the causal relationship (0.0 to 1.0) */
  weight: number;
  
  /** Evidence supporting this causal link */
  evidence: string;
  
  /** Confidence in this relationship (0.0 to 1.0) */
  confidence: number;
  
  /** Type of causal relationship */
  relationship_type: CausalRelationshipType;
}

/**
 * Relationship between events and arcs (events belong to arcs)
 */
export interface PartOfRelationship {
  /** How central this event is to the arc (0.0 to 1.0) */
  temporal_relevance: number;
}

/**
 * Types of containment for arc hierarchy
 */
export type ContainmentType = 'complete' | 'partial' | 'overlapping';

/**
 * Relationship for arc hierarchy (parent-child relationships)
 */
export interface SubsumesRelationship {
  /** Type of containment relationship */
  containment_type: ContainmentType;
}

/**
 * Relationship between arcs and inferred pressures
 */
export interface DrivenByRelationship {
  /** Strength of influence from pressure to arc (0.0 to 1.0) */
  influence_strength: number;
}

/**
 * Causal path representing a chain of causal relationships
 */
export interface CausalPath {
  /** Events in the causal chain, in order */
  events: string[]; // Event IDs
  
  /** Total strength of the causal path */
  total_strength: number;
  
  /** Individual relationship weights in the path */
  relationship_weights: number[];

  /**
   * The links of the path, in order: entry `i` connects `events[i]` to
   * `events[i + 1]`.
   *
   * The chain query already reads them, and a client that wants to filter by
   * confidence or relationship type -- the causal path explorer does -- cannot
   * do it from the weights alone.
   */
  relationships: Array<{
    weight: number;
    evidence: string;
    confidence: number;
    relationship_type: string;
  }>;
  
  /** Length of the causal chain */
  depth: number;
}

/**
 * Detected causal cycle
 */
export interface CausalCycle {
  /** Events involved in the cycle */
  events: string[]; // Event IDs
  
  /** Relationships forming the cycle */
  relationships: CausalRelationship[];
  
  /** Severity of the temporal paradox */
  paradox_severity: number;
}

/**
 * Suggestion for a potential causal link
 */
export interface CausalSuggestion {
  /** Source event ID */
  cause_event_id: string;
  
  /** Target event ID */
  effect_event_id: string;
  
  /** Suggested relationship */
  suggested_relationship: CausalRelationship;
  
  /** Reasoning for the suggestion */
  reasoning: string;
}

/**
 * Result of a causal relationship validation
 */
export interface CausalValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}