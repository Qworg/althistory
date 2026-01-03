/**
 * Suggestion API routes for AI-powered recommendations
 */

import { Router, Response, RequestHandler, NextFunction } from 'express';
import {
  AuthenticatedRequest,
  authenticate,
  requireAuth,
  rateLimit,
  authorizeGraphAccess,
  authorize,
  asyncHandler,
} from '../middleware';
import { Event } from '@/models/Event';

// Completeness analysis thresholds (in days)
const TEMPORAL_GAP_THRESHOLD_DAYS = 90;
const ACTOR_GAP_THRESHOLD_DAYS = 180;

// Helper: Convert days to milliseconds
const daysToMs = (days: number): number => days * 24 * 60 * 60 * 1000;

export const suggestRoutes = Router();

interface RelationshipSuggestionRequest {
  graphId?: string;
  events?: Array<{
    id: string;
    description: string;
    actor: string;
    target: string;
    timestamp: string;
  }>;
  options?: {
    minConfidence?: number;
    maxSuggestions?: number;
    includeIndirect?: boolean;
  };
}

interface ArcSuggestionRequest {
  graphId?: string;
  events?: Array<{
    id: string;
    description: string;
    actor: string;
    target: string;
    timestamp: string;
  }>;
  options?: {
    minClusterSize?: number;
    temporalWindow?: string; // ISO duration format, e.g., 'P30D' for 30 days
  };
}

interface CompletenessRequest {
  graphId: string;
}

interface RelationshipSuggestion {
  cause_event_id: string;
  effect_event_id: string;
  confidence: number;
  reason: string;
  relationship_type: 'direct' | 'indirect' | 'contributory';
}

interface ArcSuggestion {
  name: string;
  description: string;
  start_time: string;
  end_time: string;
  eventIds: string[];
  confidence: number;
  reason: string;
}

interface TemporalGap {
  start: string;
  end: string;
  durationDays: number;
  suggestion: string;
}

interface ActorGap {
  actor: string;
  lastSeen: string;
  daysSinceLastSeen: number;
  suggestion: string;
}

interface CausalGap {
  eventId: string;
  description: string;
  missingCause: boolean;
  missingEffect: boolean;
  suggestion: string;
}

interface CompletenessResponse {
  gaps: {
    temporalGaps: TemporalGap[];
    actorGaps: ActorGap[];
    causalGaps: CausalGap[];
  };
  overallCompleteness: number;
  suggestions: string[];
}

/**
 * Get relationship suggestions
 * POST /api/suggest/relationships
 * Requires read:events permission
 */
suggestRoutes.post(
  '/relationships',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('read:events') as RequestHandler,
  rateLimit() as RequestHandler,
  authorizeGraphAccess((req) => req.body?.graphId) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const request = req.body as RelationshipSuggestionRequest;
      const options = request.options || {};
      const minConfidence = options.minConfidence || 0.3;
      const maxSuggestions = Math.min(options.maxSuggestions || 10, 50);
      const includeIndirect = options.includeIndirect !== false;

      let events: Event[] = [];

      // Get events from request or from graph
      if (request.events && request.events.length > 0) {
        events = request.events.map(
          (e) =>
            new Event({
              id: e.id,
              description: e.description,
              actor: e.actor,
              target: e.target,
              timestamp: new Date(e.timestamp),
            })
        );
      } else if (request.graphId) {
        // Load events from graph, filtered by graphId
        const allEvents = await req.container.eventRepository.findAll({
          graphId: request.graphId,
        });
        events = allEvents.map(
          (e) =>
            new Event({
              id: e.id,
              description: e.description,
              actor: e.actor,
              target: e.target,
              timestamp: new Date(e.timestamp),
            })
        );
      }

      if (events.length < 2) {
        return res.json({ suggestions: [] });
      }

      // Use inference service to get suggestions
      const inferenceService = req.container.inferenceService;
      const allSuggestions = inferenceService.suggestCausalLinks(events);

      // Filter and transform suggestions
      const suggestions: RelationshipSuggestion[] = allSuggestions
        .filter((s) => {
          if (s.suggested_relationship.confidence < minConfidence) return false;
          if (!includeIndirect && s.suggested_relationship.relationship_type === 'indirect') {
            return false;
          }
          return true;
        })
        .slice(0, maxSuggestions)
        .map((s) => ({
          cause_event_id: s.cause_event_id,
          effect_event_id: s.effect_event_id,
          confidence: s.suggested_relationship.confidence,
          reason: s.reasoning,
          relationship_type: s.suggested_relationship.relationship_type,
        }));

      res.json({ suggestions });
    } catch (error) {
      console.error('[Suggest] Error getting relationship suggestions:', error);
      res.status(500).json({
        error: { message: 'Failed to get relationship suggestions' },
      });
    }
  })
);

/**
 * Get arc suggestions (event clustering)
 * POST /api/suggest/arcs
 * Requires read:events permission
 */
suggestRoutes.post(
  '/arcs',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('read:events') as RequestHandler,
  rateLimit() as RequestHandler,
  authorizeGraphAccess((req) => req.body?.graphId) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const request = req.body as ArcSuggestionRequest;
      const options = request.options || {};
      const minClusterSize = options.minClusterSize || 3;
      const temporalWindowDays = parseTemporalWindow(options.temporalWindow) || 30;

      let events: Array<{
        id: string;
        description: string;
        actor: string;
        target: string;
        timestamp: Date;
      }> = [];

      // Get events from request or from graph
      if (request.events && request.events.length > 0) {
        events = request.events.map((e) => ({
          id: e.id,
          description: e.description,
          actor: e.actor,
          target: e.target,
          timestamp: new Date(e.timestamp),
        }));
      } else if (request.graphId) {
        const allEvents = await req.container.eventRepository.findAll({
          graphId: request.graphId,
        });
        events = allEvents.map((e) => ({
          id: e.id,
          description: e.description,
          actor: e.actor,
          target: e.target,
          timestamp: new Date(e.timestamp),
        }));
      }

      if (events.length < minClusterSize) {
        return res.json({ suggestions: [] });
      }

      // Cluster events by temporal proximity
      const suggestions = clusterEventsIntoArcs(events, temporalWindowDays, minClusterSize);

      res.json({ suggestions });
    } catch (error) {
      console.error('[Suggest] Error getting arc suggestions:', error);
      res.status(500).json({
        error: { message: 'Failed to get arc suggestions' },
      });
    }
  })
);

/**
 * Get completeness analysis
 * POST /api/suggest/completeness
 * Requires read:events permission
 */
suggestRoutes.post(
  '/completeness',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('read:events') as RequestHandler,
  rateLimit() as RequestHandler,
  authorizeGraphAccess((req) => req.body?.graphId) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const request = req.body as CompletenessRequest;

      if (!request.graphId) {
        return res.status(400).json({
          error: { message: 'graphId is required' },
        });
      }

      // Load graph data filtered by graphId
      const events = await req.container.eventRepository.findAll({
        graphId: request.graphId,
      });
      const causalService = req.container.causalService;

      // Get all causal relationships by checking causal chains
      const relationships: Array<{ cause_event_id: string; effect_event_id: string }> = [];
      
      // Use findCausalChain to get relationships
      const eventEntities = events.map(e => new Event({
        id: e.id,
        description: e.description,
        actor: e.actor,
        target: e.target,
        timestamp: new Date(e.timestamp),
      }));
      
      for (const event of eventEntities) {
        try {
          const chains = await causalService.findCausalChain(event, 1);
          for (const chain of chains) {
            // chain.events is an array of event IDs (strings)
            if (chain.events.length > 1) {
              relationships.push({
                cause_event_id: chain.events[0],
                effect_event_id: chain.events[1],
              });
            }
          }
        } catch {
          // Ignore errors for individual events
        }
      }

      // Convert events to the format expected by analyzeCompleteness
      const eventsForAnalysis = events.map(e => ({
        id: e.id,
        description: e.description,
        actor: e.actor,
        target: e.target,
        timestamp: new Date(e.timestamp).toISOString(),
      }));

      const response = analyzeCompleteness(eventsForAnalysis, relationships);

      res.json(response);
    } catch (error) {
      console.error('[Suggest] Error analyzing completeness:', error);
      res.status(500).json({
        error: { message: 'Failed to analyze completeness' },
      });
    }
  })
);

/**
 * Get pressure analysis for events
 * POST /api/suggest/pressures
 * Requires read:events permission
 */
suggestRoutes.post(
  '/pressures',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('read:events') as RequestHandler,
  rateLimit() as RequestHandler,
  authorizeGraphAccess((req) => req.body?.graphId) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const request = req.body as { graphId?: string; events?: unknown[] };

      let events: Event[] = [];

      // Get events from request or from graph
      if (request.events && request.events.length > 0) {
        events = (request.events as Array<{
          id: string;
          description: string;
          actor: string;
          target: string;
          timestamp: string;
        }>).map(
          (e) =>
            new Event({
              id: e.id,
              description: e.description,
              actor: e.actor,
              target: e.target,
              timestamp: new Date(e.timestamp),
            })
        );
      } else if (request.graphId) {
        const allEvents = await req.container.eventRepository.findAll({
          graphId: request.graphId,
        });
        events = allEvents.map(
          (e) =>
            new Event({
              id: e.id,
              description: e.description,
              actor: e.actor,
              target: e.target,
              timestamp: new Date(e.timestamp),
            })
        );
      }

      if (events.length < 2) {
        return res.json({ pressures: [] });
      }

      // Use inference service to analyze pressures
      const inferenceService = req.container.inferenceService;
      const pressures = inferenceService.analyzeEventClusters(events);

      res.json({
        pressures: pressures.map((p) => ({
          description: p.description,
          confidence_score: p.confidence_score,
          pressure_type: p.pressure_type,
          evidence: p.evidence,
        })),
      });
    } catch (error) {
      console.error('[Suggest] Error analyzing pressures:', error);
      res.status(500).json({
        error: { message: 'Failed to analyze pressures' },
      });
    }
  })
);

// Helper functions

function parseTemporalWindow(window?: string): number | null {
  if (!window) return null;

  // Parse ISO 8601 duration format (e.g., 'P30D' for 30 days)
  const match = window.match(/^P(\d+)D$/i);
  if (match) {
    return parseInt(match[1], 10);
  }

  // Also accept simple number (days)
  const days = parseInt(window, 10);
  if (!isNaN(days)) {
    return days;
  }

  return null;
}

function clusterEventsIntoArcs(
  events: Array<{
    id: string;
    description: string;
    actor: string;
    target: string;
    timestamp: Date;
  }>,
  temporalWindowDays: number,
  minClusterSize: number
): ArcSuggestion[] {
  const suggestions: ArcSuggestion[] = [];
  const windowMs = temporalWindowDays * 24 * 60 * 60 * 1000;

  // Sort events by timestamp
  const sortedEvents = [...events].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );

  // Cluster by temporal proximity
  const clusters: typeof events[] = [];
  let currentCluster: typeof events = [sortedEvents[0]];

  for (let i = 1; i < sortedEvents.length; i++) {
    const prevTime = sortedEvents[i - 1].timestamp.getTime();
    const currTime = sortedEvents[i].timestamp.getTime();

    if (currTime - prevTime <= windowMs) {
      currentCluster.push(sortedEvents[i]);
    } else {
      if (currentCluster.length >= minClusterSize) {
        clusters.push(currentCluster);
      }
      currentCluster = [sortedEvents[i]];
    }
  }

  if (currentCluster.length >= minClusterSize) {
    clusters.push(currentCluster);
  }

  // Create arc suggestions for each cluster
  for (const cluster of clusters) {
    const startTime = cluster[0].timestamp;
    const endTime = cluster[cluster.length - 1].timestamp;
    const actors = [...new Set(cluster.map((e) => e.actor))];
    const durationDays = Math.ceil(
      (endTime.getTime() - startTime.getTime()) / (24 * 60 * 60 * 1000)
    );

    // Generate a descriptive name based on actors and time
    const actorStr = actors.length <= 2 ? actors.join(' & ') : `${actors.length} actors`;
    const name = `${actorStr} (${durationDays} days)`;

    suggestions.push({
      name,
      description: `Cluster of ${cluster.length} events involving ${actorStr}`,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      eventIds: cluster.map((e) => e.id),
      confidence: Math.min(0.9, 0.5 + cluster.length * 0.05),
      reason: `${cluster.length} temporally related events within ${temporalWindowDays}-day window`,
    });
  }

  return suggestions;
}

function analyzeCompleteness(
  events: Array<{
    id: string;
    description: string;
    actor: string;
    target: string;
    timestamp: string;
  }>,
  relationships: Array<{ cause_event_id: string; effect_event_id: string }>
): CompletenessResponse {
  const response: CompletenessResponse = {
    gaps: {
      temporalGaps: [],
      actorGaps: [],
      causalGaps: [],
    },
    overallCompleteness: 0,
    suggestions: [],
  };

  if (events.length === 0) {
    response.suggestions.push('No events found. Start by adding historical events.');
    return response;
  }

  // Sort events by timestamp
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Find temporal gaps (periods > TEMPORAL_GAP_THRESHOLD_DAYS with no events)
  const temporalGapThreshold = daysToMs(TEMPORAL_GAP_THRESHOLD_DAYS);
  for (let i = 1; i < sortedEvents.length; i++) {
    const prevTime = new Date(sortedEvents[i - 1].timestamp).getTime();
    const currTime = new Date(sortedEvents[i].timestamp).getTime();
    const gap = currTime - prevTime;

    if (gap > temporalGapThreshold) {
      const durationDays = Math.round(gap / (24 * 60 * 60 * 1000));
      response.gaps.temporalGaps.push({
        start: sortedEvents[i - 1].timestamp,
        end: sortedEvents[i].timestamp,
        durationDays,
        suggestion: `Consider adding events for the ${durationDays}-day period between these events`,
      });
    }
  }

  // Find actor gaps (actors not seen in last 180 days)
  const actorLastSeen = new Map<string, string>();
  for (const event of sortedEvents) {
    actorLastSeen.set(event.actor, event.timestamp);
  }

  const latestEventTime = new Date(sortedEvents[sortedEvents.length - 1].timestamp).getTime();
  const actorGapThreshold = daysToMs(ACTOR_GAP_THRESHOLD_DAYS);

  for (const [actor, lastSeen] of actorLastSeen) {
    const lastSeenTime = new Date(lastSeen).getTime();
    const gap = latestEventTime - lastSeenTime;

    if (gap > actorGapThreshold) {
      const daysSince = Math.round(gap / (24 * 60 * 60 * 1000));
      response.gaps.actorGaps.push({
        actor,
        lastSeen,
        daysSinceLastSeen: daysSince,
        suggestion: `Actor "${actor}" hasn't appeared in ${daysSince} days. Consider adding recent events.`,
      });
    }
  }

  // Find causal gaps (events with no causes or effects)
  const causesSet = new Set(relationships.map((r) => r.effect_event_id));
  const effectsSet = new Set(relationships.map((r) => r.cause_event_id));

  // Skip first and last events (natural to not have cause/effect)
  for (let i = 1; i < sortedEvents.length - 1; i++) {
    const event = sortedEvents[i];
    const hasCause = causesSet.has(event.id);
    const hasEffect = effectsSet.has(event.id);

    if (!hasCause || !hasEffect) {
      response.gaps.causalGaps.push({
        eventId: event.id,
        description: event.description.substring(0, 100),
        missingCause: !hasCause,
        missingEffect: !hasEffect,
        suggestion: !hasCause && !hasEffect
          ? 'Consider adding both cause and effect relationships'
          : !hasCause
            ? 'Consider adding a cause relationship'
            : 'Consider adding an effect relationship',
      });
    }
  }

  // Calculate overall completeness score
  let completenessScore = 1.0;

  // Deduct for temporal gaps
  completenessScore -= Math.min(0.3, response.gaps.temporalGaps.length * 0.1);

  // Deduct for actor gaps
  completenessScore -= Math.min(0.2, response.gaps.actorGaps.length * 0.05);

  // Deduct for causal gaps
  const causalGapRatio = response.gaps.causalGaps.length / Math.max(1, events.length - 2);
  completenessScore -= Math.min(0.4, causalGapRatio * 0.4);

  // Bonus for having relationships
  if (relationships.length > 0) {
    const relationshipRatio = relationships.length / events.length;
    completenessScore = Math.min(1.0, completenessScore + relationshipRatio * 0.1);
  }

  response.overallCompleteness = Math.max(0, Math.min(1, completenessScore));

  // Generate overall suggestions
  if (response.gaps.temporalGaps.length > 0) {
    response.suggestions.push(
      `Found ${response.gaps.temporalGaps.length} temporal gap(s). Consider adding events to fill these periods.`
    );
  }

  if (response.gaps.actorGaps.length > 0) {
    response.suggestions.push(
      `${response.gaps.actorGaps.length} actor(s) haven't appeared recently. Consider adding their recent activities.`
    );
  }

  if (response.gaps.causalGaps.length > 0) {
    response.suggestions.push(
      `${response.gaps.causalGaps.length} event(s) lack causal relationships. Consider adding connections.`
    );
  }

  if (events.length > 0 && relationships.length === 0) {
    response.suggestions.push(
      'No causal relationships defined. Add relationships between events to show cause and effect.'
    );
  }

  if (response.suggestions.length === 0) {
    response.suggestions.push('Graph looks complete! Consider reviewing for accuracy.');
  }

  return response;
}
