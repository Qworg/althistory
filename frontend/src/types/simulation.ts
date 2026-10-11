/**
 * Types for the autonomous historical simulation engine.
 *
 * Mirrors the payloads returned by `POST /inference/simulate`; the backend
 * serialises dates to ISO strings and flattens the pressure records, so the UI
 * never has to reach into domain classes.
 */

export type SimulationDomain =
  | 'political'
  | 'military'
  | 'economic'
  | 'scientific'
  | 'social'
  | 'environmental'

export const SIMULATION_DOMAINS: readonly SimulationDomain[] = [
  'political',
  'military',
  'economic',
  'scientific',
  'social',
  'environmental',
]

export interface SimulationRequestOptions {
  /** Number of forward hops (1-10). */
  steps?: number
  /** Wall-clock span of each hop, in milliseconds. */
  stepDurationMs?: number
  /** Convenience alternative to `stepDurationMs`, in 30.4-day months. */
  timeAdvanceMonths?: number
  /** Point of divergence; defaults to the latest event in the graph. */
  anchorEventId?: string
  /** Domain to evolve; defaults to the strongest inferred pressure. */
  domain?: SimulationDomain
  /** 0..1 bias applied to causal weights and event importance. */
  aggressiveness?: number
  /** Optional premise recorded on every generated event. */
  seedContext?: string
  /** Plan the run without persisting anything. */
  dryRun?: boolean
}

export interface SimulatedEventPayload {
  id: string
  description: string
  actor: string
  target: string
  timestamp: string
  metadata: Record<string, unknown>
}

export interface SimulatedPressurePayload {
  id: string
  description: string
  confidence_score: number
  pressure_type: string
  evidence: string[]
}

export interface SimulatedRelationshipPayload {
  id: string
  cause_event_id: string
  effect_event_id: string
  weight: number
  evidence: string
  confidence: number
  relationship_type: 'direct' | 'indirect' | 'contributory'
}

export interface SimulationResult {
  graphId: string
  anchorEventId?: string
  domain: SimulationDomain
  steps: number
  stepDurationMs: number
  aggressiveness: number
  dryRun: boolean
  events: SimulatedEventPayload[]
  relationships: SimulatedRelationshipPayload[]
  pressures: SimulatedPressurePayload[]
}
