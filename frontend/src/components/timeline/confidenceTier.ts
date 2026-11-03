/**
 * How sure the graph is of an event, as the shape of its timeline mark:
 * - `firm`: solid (confidence ≥ 0.75, or none recorded: no claim of doubt);
 * - `probable`: a ring around a small core (0.4–0.75);
 * - `speculative`: an open, dashed ring (< 0.4).
 * Shape rather than colour, so the reading survives high contrast and the
 * colour channel stays free for baseline / branch / selection.
 */
export type ConfidenceTier = 'firm' | 'probable' | 'speculative'

export function confidenceTier(confidence: number | null): ConfidenceTier {
  if (confidence === null || confidence >= 0.75) return 'firm'
  return confidence >= 0.4 ? 'probable' : 'speculative'
}
