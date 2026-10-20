/**
 * Suggestion API routes for AI-powered recommendations
 */

import { Router, Response, RequestHandler } from 'express';
import {
  AuthenticatedRequest,
  authenticate,
  requireAuth,
  rateLimit,
  requireGraphId,
  resolveGraphContext,
  authorizeGraphAccess,
  authorize,
  asyncHandler,
} from '../middleware';
import { Event } from '@/models/Event';
import type {
  ArcClusterEvent,
  ArcSuggestion,
  CausalRelationshipRef,
  CompletenessEvent,
  CompletenessResponse,
} from '@/services/InferenceService';

export const suggestRoutes = Router();

interface RelationshipSuggestionRequest {
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

interface RelationshipSuggestion {
  cause_event_id: string;
  effect_event_id: string;
  confidence: number;
  reason: string;
  relationship_type: 'direct' | 'indirect' | 'contributory';
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
  resolveGraphContext(),
  authorizeGraphAccess((req) => requireGraphId(req)) as RequestHandler,
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
      } else {
        const { eventRepository } = await req.container.graphScopedRepositories(requireGraphId(req));
        const allEvents = await eventRepository.findAll();
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
  resolveGraphContext(),
  authorizeGraphAccess((req) => requireGraphId(req)) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const request = req.body as ArcSuggestionRequest;
      const options = request.options || {};
      const minClusterSize = options.minClusterSize || 3;
      const temporalWindowDays = parseTemporalWindow(options.temporalWindow) || 30;

      let events: ArcClusterEvent[] = [];

      // Get events from request or from graph
      if (request.events && request.events.length > 0) {
        events = request.events.map((e) => ({
          id: e.id,
          description: e.description,
          actor: e.actor,
          target: e.target,
          timestamp: new Date(e.timestamp),
        }));
      } else {
        const { eventRepository } = await req.container.graphScopedRepositories(requireGraphId(req));
        const allEvents = await eventRepository.findAll();
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

      // Cluster events by temporal proximity. The algorithm lives in
      // InferenceService, and its result IS the response body for this route
      // (the service's type is the wire format). The route does not map it.
      const suggestions: ArcSuggestion[] = req.container.inferenceService.clusterEventsIntoArcs(
        events,
        temporalWindowDays,
        minClusterSize
      );

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
  resolveGraphContext(),
  authorizeGraphAccess((req) => requireGraphId(req)) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Read from the graph this request is scoped to. The scoped repository
      // is bound to that graph's store, so the read cannot leak across graphs.
      const { eventRepository, causalService } = await req.container.graphScopedRepositories(
        requireGraphId(req)
      );
      const events = await eventRepository.findAll();

      // Get all causal relationships by checking causal chains
      const relationships: CausalRelationshipRef[] = [];
      
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

      // Convert events to the format expected by the completeness analysis
      const eventsForAnalysis: CompletenessEvent[] = events.map(e => ({
        id: e.id,
        description: e.description,
        actor: e.actor,
        target: e.target,
        timestamp: new Date(e.timestamp).toISOString(),
      }));

      const response: CompletenessResponse = req.container.inferenceService.analyzeCompleteness(
        eventsForAnalysis,
        relationships
      );

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
  resolveGraphContext(),
  authorizeGraphAccess((req) => requireGraphId(req)) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const request = req.body as { events?: unknown[] };

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
      } else {
        const { eventRepository } = await req.container.graphScopedRepositories(requireGraphId(req));
        const allEvents = await eventRepository.findAll();
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
