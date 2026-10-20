import { ExtractedEvent, ExtractedArc, ExtractionSource } from '@/services/ingestion/types';

/**
 * Clusters an array of extracted events into hierarchical narrative arcs
 * based on temporal proximity and dominant actors.
 *
 * DECISION (issue #35): this is deliberately NOT the same algorithm as
 * `InferenceService.clusterEventsIntoArcs`, and it does not delegate to it.
 * The two solve different problems and merging them would change output:
 *
 * - Boundary detection: the CLI picks the boundary adaptively, from the median
 *   gap between adjacent events (3x the median, or 5 years when there are
 *   fewer than four events). The API clusters on a caller-supplied fixed
 *   window (`temporalWindowDays`), which a user can set per request.
 * - Cluster shape: the CLI also caps a cluster at 8 events; the API has no
 *   such cap and only a minimum size.
 * - Output contract: the CLI emits `ExtractedArc` ingestion records (tempId,
 *   level, source, selected, edited) that a human then curates before they
 *   become arcs. The API emits advisory `ArcSuggestion` values (computed
 *   confidence and a human-readable reason) that are only a hint.
 * - Naming: the CLI names an arc after its dominant actor and a year span;
 *   the API names it after its actors and a duration in days.
 *
 * The shared idea -- "group events that are close in time" -- is the only
 * thing in common, and the algorithms produce different arcs for the same
 * input. Keeping one implementation would have meant changing the CLI's
 * output, so the two are kept apart on purpose. The API-side algorithm lives
 * in `InferenceService` (its single home) and is covered by
 * `src/services/InferenceService.arcSuggestion.test.ts`; this file is covered
 * by `src/cli/ingest.test.ts` (the adaptive boundary, the eight-event cap and
 * the single-event case).
 *
 * Two further differences: the CLI's boundary is never below thirty days (the
 * median-based one falls back to thirty days when the median gap is zero), and
 * the CLI never drops events -- a group of one is still an arc -- whereas the
 * API drops groups smaller than the caller's minimum.
 */
export function clusterEventsIntoArcs(
  events: ExtractedEvent[],
  source: ExtractionSource
): ExtractedArc[] {
  if (events.length === 0) {
    return [];
  }

  // Sort events chronologically
  const sorted = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (sorted.length === 1) {
    const e = sorted[0];
    const date = new Date(e.timestamp);
    const year = isNaN(date.getFullYear()) ? 'Historic' : String(date.getFullYear());
    return [
      {
        tempId: `arc-cluster-0`,
        name: `Period of ${e.actor || 'Events'} (${year})`,
        description: `Enclosing narrative arc for single event`,
        start_time: e.timestamp,
        end_time: new Date(new Date(e.timestamp).getTime() + 24 * 60 * 60 * 1000).toISOString(),
        level: 0,
        confidence: 0.8,
        source,
        selected: true,
        edited: false,
      },
    ];
  }

  // Calculate gaps between adjacent events
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].timestamp).getTime();
    const curr = new Date(sorted[i].timestamp).getTime();
    gaps.push(Math.max(0, curr - prev));
  }

  // Median gap when sufficient sample size exists; otherwise 5-year default
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const fiveYearsMs = 5 * 365.25 * 24 * 60 * 60 * 1000;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)] || thirtyDaysMs;
  const gapThreshold = gaps.length >= 3
    ? Math.max(medianGap * 3, thirtyDaysMs)
    : Math.max(fiveYearsMs, thirtyDaysMs);

  const clusters: ExtractedEvent[][] = [];
  let currentCluster: ExtractedEvent[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].timestamp).getTime();
    const curr = new Date(sorted[i].timestamp).getTime();
    const diff = curr - prev;

    if (diff > gapThreshold || currentCluster.length >= 8) {
      clusters.push(currentCluster);
      currentCluster = [sorted[i]];
    } else {
      currentCluster.push(sorted[i]);
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  // Convert each cluster into an ExtractedArc
  return clusters.map((cluster, idx) => {
    const start = cluster[0].timestamp;
    let end = cluster[cluster.length - 1].timestamp;
    if (new Date(start).getTime() >= new Date(end).getTime()) {
      end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
    }

    // Find dominant actor
    const actorCounts = new Map<string, number>();
    for (const e of cluster) {
      if (e.actor && e.actor !== 'Unknown') {
        actorCounts.set(e.actor, (actorCounts.get(e.actor) || 0) + 1);
      }
    }
    let dominantActor = 'Era';
    let maxCount = 0;
    for (const [actor, count] of actorCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        dominantActor = actor;
      }
    }

    const startYear = new Date(start).getFullYear() || '';
    const endYear = new Date(end).getFullYear() || '';
    const spanText = startYear && endYear ? ` (${startYear}–${endYear})` : '';

    return {
      tempId: `arc-cluster-${idx}`,
      name: `${dominantActor} Campaign / Period${spanText}`,
      description: `Historical narrative arc containing ${cluster.length} events`,
      start_time: start,
      end_time: end,
      level: 0,
      confidence: 0.8,
      source,
      selected: true,
      edited: false,
    };
  });
}
