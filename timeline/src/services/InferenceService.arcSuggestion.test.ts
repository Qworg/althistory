/**
 * Tests for the arc-suggestion and completeness-analysis methods that
 * InferenceService hosts for the suggestions API.
 *
 * These algorithms used to live as private functions in
 * `src/api/routes/suggest.ts`; they moved here so they can be tested without
 * the router. The HTTP-level coverage stays in
 * `src/api/routes/suggest.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InferenceService } from './InferenceService';
import type {
  ArcClusterEvent,
  CausalRelationshipRef,
  CompletenessEvent,
} from './InferenceService';

const DAY_MS = 24 * 60 * 60 * 1000;

function arcEvent(
  id: string,
  timestamp: string,
  actor = 'Actor',
  target = 'Target',
  description = `Event ${id}`
): ArcClusterEvent {
  return { id, description, actor, target, timestamp: new Date(timestamp) };
}

function completenessEvent(
  id: string,
  timestamp: string,
  actor = 'Actor',
  target = 'Target',
  description = `Event ${id}`
): CompletenessEvent {
  return { id, description, actor, target, timestamp };
}

describe('InferenceService - arc suggestions', () => {
  let inferenceService: InferenceService;

  beforeEach(() => {
    inferenceService = new InferenceService();
  });

  describe('clusterEventsIntoArcs', () => {
    it('should return no suggestions for no events', () => {
      expect(inferenceService.clusterEventsIntoArcs([], 30, 3)).toEqual([]);
    });

    it('should cluster events that fall inside the temporal window', () => {
      const events = [0, 1, 2, 3, 4].map((i) =>
        arcEvent(`e${i}`, new Date(Date.UTC(1914, 5, 15) + i * 5 * DAY_MS).toISOString())
      );

      const suggestions = inferenceService.clusterEventsIntoArcs(events, 30, 3);

      expect(suggestions).toHaveLength(1);
      const [arc] = suggestions;
      expect(arc.eventIds).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
      expect(arc.name).toBe('Actor (20 days)');
      expect(arc.description).toBe('Cluster of 5 events involving Actor');
      expect(arc.start_time).toBe(new Date(Date.UTC(1914, 5, 15)).toISOString());
      expect(arc.end_time).toBe(new Date(Date.UTC(1914, 6, 5)).toISOString());
      expect(arc.confidence).toBeCloseTo(0.75, 5);
      expect(arc.reason).toBe('5 temporally related events within 30-day window');
    });

    it('should drop clusters smaller than the minimum cluster size', () => {
      const events = [
        arcEvent('e0', '1914-06-15T00:00:00.000Z'),
        arcEvent('e1', '1914-06-16T00:00:00.000Z'),
        arcEvent('e2', '1915-06-15T00:00:00.000Z'),
        arcEvent('e3', '1915-06-16T00:00:00.000Z'),
        arcEvent('e4', '1915-06-17T00:00:00.000Z'),
      ];

      const suggestions = inferenceService.clusterEventsIntoArcs(events, 30, 3);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].eventIds).toEqual(['e2', 'e3', 'e4']);
    });

    it('should start a new cluster when the window is exceeded', () => {
      const events = [
        arcEvent('e0', '1914-06-15T00:00:00.000Z'),
        arcEvent('e1', '1914-06-16T00:00:00.000Z'),
        arcEvent('e2', '1914-06-17T00:00:00.000Z'),
        arcEvent('e3', '1914-09-15T00:00:00.000Z'),
        arcEvent('e4', '1914-09-16T00:00:00.000Z'),
        arcEvent('e5', '1914-09-17T00:00:00.000Z'),
      ];

      const suggestions = inferenceService.clusterEventsIntoArcs(events, 30, 3);

      expect(suggestions).toHaveLength(2);
      expect(suggestions[0].eventIds).toEqual(['e0', 'e1', 'e2']);
      expect(suggestions[1].eventIds).toEqual(['e3', 'e4', 'e5']);
    });

    it('should chain events that are each within the window of the previous one', () => {
      // The clustering is adjacency-based: e0->e1 and e1->e2 are each inside
      // the window, so all three belong to one cluster even though the total
      // span (40 days) exceeds it.
      const events = [
        arcEvent('e0', '1914-06-15T00:00:00.000Z'),
        arcEvent('e1', '1914-07-05T00:00:00.000Z'),
        arcEvent('e2', '1914-07-25T00:00:00.000Z'),
      ];

      const suggestions = inferenceService.clusterEventsIntoArcs(events, 30, 3);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].eventIds).toEqual(['e0', 'e1', 'e2']);
      expect(suggestions[0].name).toBe('Actor (40 days)');
    });

    it('should name the arc after up to two actors and count beyond that', () => {
      const twoActors = [
        arcEvent('e0', '1914-06-15T00:00:00.000Z', 'Alice'),
        arcEvent('e1', '1914-06-16T00:00:00.000Z', 'Bob'),
        arcEvent('e2', '1914-06-17T00:00:00.000Z', 'Alice'),
      ];

      const [twoActorArc] = inferenceService.clusterEventsIntoArcs(twoActors, 30, 3);
      expect(twoActorArc.name).toBe('Alice & Bob (2 days)');
      expect(twoActorArc.description).toBe('Cluster of 3 events involving Alice & Bob');

      const threeActors = [
        arcEvent('e0', '1914-06-15T00:00:00.000Z', 'Alice'),
        arcEvent('e1', '1914-06-16T00:00:00.000Z', 'Bob'),
        arcEvent('e2', '1914-06-17T00:00:00.000Z', 'Carol'),
      ];

      const [threeActorArc] = inferenceService.clusterEventsIntoArcs(threeActors, 30, 3);
      expect(threeActorArc.name).toBe('3 actors (2 days)');
    });

    it('should cap the confidence at 0.9 for large clusters', () => {
      const events = Array.from({ length: 9 }, (_unused, i) =>
        arcEvent(`e${i}`, new Date(Date.UTC(1914, 5, 15) + i * DAY_MS).toISOString())
      );

      const [arc] = inferenceService.clusterEventsIntoArcs(events, 30, 3);

      expect(arc.confidence).toBe(0.9);
    });

    it('should not reorder the caller\'s array', () => {
      const events = [
        arcEvent('e1', '1914-06-17T00:00:00.000Z'),
        arcEvent('e0', '1914-06-15T00:00:00.000Z'),
        arcEvent('e2', '1914-06-16T00:00:00.000Z'),
      ];

      const suggestions = inferenceService.clusterEventsIntoArcs(events, 30, 3);

      expect(events.map((e) => e.id)).toEqual(['e1', 'e0', 'e2']);
      expect(suggestions[0].eventIds).toEqual(['e0', 'e2', 'e1']);
    });
  });

  describe('analyzeCompleteness', () => {
    it('should report an empty graph', () => {
      const response = inferenceService.analyzeCompleteness([], []);

      expect(response.overallCompleteness).toBe(0);
      expect(response.gaps.temporalGaps).toEqual([]);
      expect(response.gaps.actorGaps).toEqual([]);
      expect(response.gaps.causalGaps).toEqual([]);
      expect(response.suggestions).toEqual([
        'No events found. Start by adding historical events.',
      ]);
    });

    it('should find temporal gaps longer than 90 days', () => {
      const events = [
        completenessEvent('e0', '2020-01-01T00:00:00.000Z'),
        completenessEvent('e1', '2020-07-01T00:00:00.000Z'),
      ];

      const response = inferenceService.analyzeCompleteness(events, []);

      expect(response.gaps.temporalGaps).toHaveLength(1);
      expect(response.gaps.temporalGaps[0].start).toBe('2020-01-01T00:00:00.000Z');
      expect(response.gaps.temporalGaps[0].end).toBe('2020-07-01T00:00:00.000Z');
      expect(response.gaps.temporalGaps[0].durationDays).toBe(182);
      expect(response.gaps.temporalGaps[0].suggestion).toContain('182-day period');
    });

    it('should find actors that have not been seen for more than 180 days', () => {
      const events = [
        completenessEvent('e0', '2020-01-01T00:00:00.000Z', 'Alice'),
        completenessEvent('e1', '2020-01-02T00:00:00.000Z', 'Alice'),
        completenessEvent('e2', '2021-01-01T00:00:00.000Z', 'Bob'),
      ];

      const response = inferenceService.analyzeCompleteness(events, []);

      expect(response.gaps.actorGaps).toHaveLength(1);
      expect(response.gaps.actorGaps[0].actor).toBe('Alice');
      expect(response.gaps.actorGaps[0].lastSeen).toBe('2020-01-02T00:00:00.000Z');
      expect(response.gaps.actorGaps[0].daysSinceLastSeen).toBe(365);
      expect(response.gaps.actorGaps[0].suggestion).toContain('"Alice"');
    });

    it('should report causal gaps for interior events only', () => {
      const events = [
        completenessEvent('e0', '2020-01-01T00:00:00.000Z'),
        completenessEvent('e1', '2020-01-02T00:00:00.000Z'),
        completenessEvent('e2', '2020-01-03T00:00:00.000Z'),
      ];

      const response = inferenceService.analyzeCompleteness(events, []);

      expect(response.gaps.causalGaps).toHaveLength(1);
      expect(response.gaps.causalGaps[0].eventId).toBe('e1');
      expect(response.gaps.causalGaps[0].missingCause).toBe(true);
      expect(response.gaps.causalGaps[0].missingEffect).toBe(true);
      expect(response.gaps.causalGaps[0].suggestion).toBe(
        'Consider adding both cause and effect relationships'
      );
    });

    it('should distinguish a missing cause from a missing effect', () => {
      const events = [
        completenessEvent('e0', '2020-01-01T00:00:00.000Z'),
        completenessEvent('e1', '2020-01-02T00:00:00.000Z'),
        completenessEvent('e2', '2020-01-03T00:00:00.000Z'),
        completenessEvent('e3', '2020-01-04T00:00:00.000Z'),
      ];
      // e1 has a cause (e0) but no effect; e2 has an effect (e3) but no cause.
      const relationships: CausalRelationshipRef[] = [
        { cause_event_id: 'e0', effect_event_id: 'e1' },
        { cause_event_id: 'e2', effect_event_id: 'e3' },
      ];

      const response = inferenceService.analyzeCompleteness(events, relationships);

      const gaps = response.gaps.causalGaps;
      expect(gaps).toHaveLength(2);
      const first = gaps.find((g) => g.eventId === 'e1');
      const second = gaps.find((g) => g.eventId === 'e2');
      expect(first?.missingCause).toBe(false);
      expect(first?.missingEffect).toBe(true);
      expect(first?.suggestion).toBe('Consider adding an effect relationship');
      expect(second?.missingCause).toBe(true);
      expect(second?.missingEffect).toBe(false);
      expect(second?.suggestion).toBe('Consider adding a cause relationship');
    });

    it('should report a complete graph when every gap is covered', () => {
      const events = [
        completenessEvent('e0', '2020-01-01T00:00:00.000Z'),
        completenessEvent('e1', '2020-01-02T00:00:00.000Z'),
        completenessEvent('e2', '2020-01-03T00:00:00.000Z'),
      ];
      const relationships: CausalRelationshipRef[] = [
        { cause_event_id: 'e0', effect_event_id: 'e1' },
        { cause_event_id: 'e1', effect_event_id: 'e2' },
      ];

      const response = inferenceService.analyzeCompleteness(events, relationships);

      expect(response.gaps.temporalGaps).toEqual([]);
      expect(response.gaps.actorGaps).toEqual([]);
      expect(response.gaps.causalGaps).toEqual([]);
      expect(response.overallCompleteness).toBe(1);
      expect(response.suggestions).toEqual([
        'Graph looks complete! Consider reviewing for accuracy.',
      ]);
    });

    it('should keep the completeness score within [0, 1]', () => {
      const events = [
        completenessEvent('e0', '2010-01-01T00:00:00.000Z', 'Alice'),
        completenessEvent('e1', '2012-01-01T00:00:00.000Z', 'Bob'),
        completenessEvent('e2', '2014-01-01T00:00:00.000Z', 'Carol'),
        completenessEvent('e3', '2016-01-01T00:00:00.000Z', 'Dave'),
        completenessEvent('e4', '2018-01-01T00:00:00.000Z', 'Erin'),
      ];

      const response = inferenceService.analyzeCompleteness(events, []);

      expect(response.overallCompleteness).toBeGreaterThanOrEqual(0);
      expect(response.overallCompleteness).toBeLessThanOrEqual(1);
      expect(response.suggestions).toContain(
        'No causal relationships defined. Add relationships between events to show cause and effect.'
      );
    });

    it('should summarise the gaps it found', () => {
      const events = [
        completenessEvent('e0', '2020-01-01T00:00:00.000Z', 'Alice'),
        completenessEvent('e1', '2020-01-02T00:00:00.000Z', 'Alice'),
        completenessEvent('e2', '2021-01-01T00:00:00.000Z', 'Bob'),
      ];

      const response = inferenceService.analyzeCompleteness(events, []);

      expect(response.suggestions).toContain(
        'Found 1 temporal gap(s). Consider adding events to fill these periods.'
      );
      expect(response.suggestions).toContain(
        "1 actor(s) haven't appeared recently. Consider adding their recent activities."
      );
      expect(response.suggestions).toContain(
        'No causal relationships defined. Add relationships between events to show cause and effect.'
      );
    });
  });
});
