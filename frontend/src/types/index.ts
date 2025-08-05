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

export interface ErrorState {
  id: string
  message: string
  type: 'network' | 'validation' | 'visualization' | 'general'
  timestamp: Date
}