/**
 * Validation API routes for checking data integrity
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
  authorizeAny,
  asyncHandler,
} from '../middleware';
import { IEvent } from '@/models/Event';
import { IArc } from '@/models/Arc';
import { isTemporalInversion } from '@/utils/causalOrder';

export const validateRoutes = Router();

// Extended Arc interface for validation input (may include parent reference)
interface ValidationArc extends IArc {
  parent_arc_id?: string;
}

interface ValidationRequest {
  events?: IEvent[];
  arcs?: ValidationArc[];
  relationships?: Array<{
    id?: string;
    cause_event_id: string;
    effect_event_id: string;
    weight?: number;
    confidence?: number;
    relationship_type?: 'direct' | 'indirect' | 'contributory';
  }>;
  checks?: Array<'temporal' | 'causal' | 'referential' | 'all'>;
}

interface IncrementalValidationRequest {
  additions?: {
    events?: IEvent[];
    arcs?: ValidationArc[];
    relationships?: Array<{
      cause_event_id: string;
      effect_event_id: string;
      weight?: number;
      confidence?: number;
    }>;
  };
}

interface TemporalError {
  type: 'temporal';
  entityType: 'event' | 'arc';
  entityId: string;
  message: string;
  details?: Record<string, unknown>;
}

interface CausalError {
  type: 'causal';
  relationshipId?: string;
  causeEventId: string;
  effectEventId: string;
  message: string;
  details?: Record<string, unknown>;
}

interface ReferentialError {
  type: 'referential';
  entityType: 'event' | 'arc' | 'relationship';
  entityId: string;
  referencedId: string;
  referencedType: 'event' | 'arc';
  message: string;
}

interface ValidationWarning {
  type: string;
  entityType?: string;
  entityId?: string;
  message: string;
}

interface SuggestedArc {
  name: string;
  description: string;
  start_time: string;
  end_time: string;
  eventIds: string[];
  confidence: number;
  reason: string;
}

interface CausalSuggestion {
  cause_event_id: string;
  effect_event_id: string;
  confidence: number;
  reason: string;
  relationship_type: 'direct' | 'indirect' | 'contributory';
}

interface ValidationResponse {
  valid: boolean;
  errors: {
    temporal: TemporalError[];
    causal: CausalError[];
    referential: ReferentialError[];
  };
  warnings: ValidationWarning[];
  suggestions?: {
    missingArcs: SuggestedArc[];
    missingRelationships: CausalSuggestion[];
  };
}

interface IncrementalValidationResponse {
  valid: boolean;
  conflicts: Array<{
    type: string;
    entityType: string;
    entityId: string;
    message: string;
    existingEntity?: Record<string, unknown>;
  }>;
  wouldCreate: {
    events: number;
    arcs: number;
    relationships: number;
  };
}

/**
 * Validate a graph dataset
 * POST /api/validate/graph
 * Requires at least one of: read:events, read:arcs, read:relationships
 */
validateRoutes.post(
  '/graph',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorizeAny('read:events', 'read:arcs', 'read:relationships') as RequestHandler,
  rateLimit() as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const request = req.body as ValidationRequest;
      const checks = request.checks || ['all'];
      const runAllChecks = checks.includes('all');

      const response: ValidationResponse = {
        valid: true,
        errors: {
          temporal: [],
          causal: [],
          referential: [],
        },
        warnings: [],
        suggestions: {
          missingArcs: [],
          missingRelationships: [],
        },
      };

      const events = request.events || [];
      const arcs = request.arcs || [];
      const relationships = request.relationships || [];

      // Build lookup maps
      const eventMap = new Map(events.map((e) => [e.id, e]));
      const arcMap = new Map(arcs.map((a) => [a.id, a]));

      // Temporal validation
      if (runAllChecks || checks.includes('temporal')) {
        // Validate event timestamps
        for (const event of events) {
          if (!event.timestamp) {
            response.errors.temporal.push({
              type: 'temporal',
              entityType: 'event',
              entityId: event.id,
              message: 'Event missing timestamp',
            });
            continue;
          }

          const timestamp = new Date(event.timestamp);
          if (isNaN(timestamp.getTime())) {
            response.errors.temporal.push({
              type: 'temporal',
              entityType: 'event',
              entityId: event.id,
              message: `Invalid timestamp format: ${event.timestamp}`,
            });
          }
        }

        // Validate arc time ranges
        for (const arc of arcs) {
          const startTime = new Date(arc.start_time);
          const endTime = new Date(arc.end_time);

          if (isNaN(startTime.getTime())) {
            response.errors.temporal.push({
              type: 'temporal',
              entityType: 'arc',
              entityId: arc.id,
              message: `Invalid start_time format: ${arc.start_time}`,
            });
          }

          if (isNaN(endTime.getTime())) {
            response.errors.temporal.push({
              type: 'temporal',
              entityType: 'arc',
              entityId: arc.id,
              message: `Invalid end_time format: ${arc.end_time}`,
            });
          }

          if (startTime >= endTime) {
            response.errors.temporal.push({
              type: 'temporal',
              entityType: 'arc',
              entityId: arc.id,
              message: 'Arc start_time must be before end_time',
              details: { start_time: arc.start_time, end_time: arc.end_time },
            });
          }

          // Check parent arc containment
          if (arc.parent_arc_id) {
            const parentArc = arcMap.get(arc.parent_arc_id);
            if (parentArc) {
              const parentStart = new Date(parentArc.start_time);
              const parentEnd = new Date(parentArc.end_time);

              if (startTime < parentStart || endTime > parentEnd) {
                response.errors.temporal.push({
                  type: 'temporal',
                  entityType: 'arc',
                  entityId: arc.id,
                  message: 'Arc must be contained within parent arc time range',
                  details: {
                    arcRange: { start: arc.start_time, end: arc.end_time },
                    parentRange: { start: parentArc.start_time, end: parentArc.end_time },
                  },
                });
              }
            }
          }
        }
      }

      // Causal validation
      if (runAllChecks || checks.includes('causal')) {
        for (const rel of relationships) {
          const causeEvent = eventMap.get(rel.cause_event_id);
          const effectEvent = eventMap.get(rel.effect_event_id);

          // Self-referential check
          if (rel.cause_event_id === rel.effect_event_id) {
            response.errors.causal.push({
              type: 'causal',
              relationshipId: rel.id,
              causeEventId: rel.cause_event_id,
              effectEventId: rel.effect_event_id,
              message: 'Event cannot cause itself',
            });
            continue;
          }

          // Temporal causality check (the cause may not follow the effect)
          if (causeEvent && effectEvent) {
            const causeTime = new Date(causeEvent.timestamp);
            const effectTime = new Date(effectEvent.timestamp);

            if (isTemporalInversion(causeTime, effectTime)) {
              response.errors.causal.push({
                type: 'causal',
                relationshipId: rel.id,
                causeEventId: rel.cause_event_id,
                effectEventId: rel.effect_event_id,
                message: 'Cause event must not occur after the effect event',
                details: {
                  causeTimestamp: causeEvent.timestamp,
                  effectTimestamp: effectEvent.timestamp,
                },
              });
            }
          }
        }

        // Check for circular dependencies
        const circularDeps = detectCircularDependencies(relationships);
        for (const cycle of circularDeps) {
          response.errors.causal.push({
            type: 'causal',
            causeEventId: cycle[0],
            effectEventId: cycle[cycle.length - 1],
            message: `Circular causal dependency detected: ${cycle.join(' -> ')}`,
            details: { cycle },
          });
        }
      }

      // Referential validation
      if (runAllChecks || checks.includes('referential')) {
        // Check relationship references
        for (const rel of relationships) {
          if (!eventMap.has(rel.cause_event_id)) {
            response.errors.referential.push({
              type: 'referential',
              entityType: 'relationship',
              entityId: rel.id || 'unknown',
              referencedId: rel.cause_event_id,
              referencedType: 'event',
              message: `Cause event not found: ${rel.cause_event_id}`,
            });
          }

          if (!eventMap.has(rel.effect_event_id)) {
            response.errors.referential.push({
              type: 'referential',
              entityType: 'relationship',
              entityId: rel.id || 'unknown',
              referencedId: rel.effect_event_id,
              referencedType: 'event',
              message: `Effect event not found: ${rel.effect_event_id}`,
            });
          }
        }

        // Check arc parent references
        for (const arc of arcs) {
          if (arc.parent_arc_id && !arcMap.has(arc.parent_arc_id)) {
            response.errors.referential.push({
              type: 'referential',
              entityType: 'arc',
              entityId: arc.id,
              referencedId: arc.parent_arc_id,
              referencedType: 'arc',
              message: `Parent arc not found: ${arc.parent_arc_id}`,
            });
          }
        }
      }

      // Generate suggestions
      if (events.length > 0) {
        // Suggest arcs based on event clustering
        response.suggestions!.missingArcs = suggestArcs(events);

        // Suggest causal relationships
        response.suggestions!.missingRelationships = suggestRelationships(events, relationships);
      }

      // Add warnings
      if (events.length > 0 && arcs.length === 0) {
        response.warnings.push({
          type: 'structure',
          message: 'No arcs defined - consider grouping events into arcs for better organization',
        });
      }

      if (events.length > 5 && relationships.length === 0) {
        response.warnings.push({
          type: 'structure',
          message: 'No causal relationships defined - consider adding relationships between events',
        });
      }

      // Set valid flag based on errors
      response.valid =
        response.errors.temporal.length === 0 &&
        response.errors.causal.length === 0 &&
        response.errors.referential.length === 0;

      res.json(response);
    } catch (error) {
      console.error('[Validate] Error validating graph:', error);
      res.status(500).json({
        error: { message: 'Failed to validate graph' },
      });
    }
  })
);

/**
 * Validate incremental additions to existing graph
 * POST /api/validate/incremental
 * Requires at least one of: read:events, read:arcs, read:relationships
 */
validateRoutes.post(
  '/incremental',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorizeAny('read:events', 'read:arcs', 'read:relationships') as RequestHandler,
  rateLimit() as RequestHandler,
  resolveGraphContext(),
  authorizeGraphAccess((req) => requireGraphId(req)) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const request = req.body as IncrementalValidationRequest;

      const response: IncrementalValidationResponse = {
        valid: true,
        conflicts: [],
        wouldCreate: {
          events: 0,
          arcs: 0,
          relationships: 0,
        },
      };

      const { additions } = request;
      if (!additions) {
        return res.json(response);
      }

      // Read and check against the graph this request is scoped to. The scoped
      // repositories are bound to that graph's store, so no lookup can cross a
      // graph boundary even for a duplicate id that exists elsewhere.
      const { eventRepository, arcRepository } = await req.container.graphScopedRepositories(
        requireGraphId(req)
      );

      // Check for event conflicts
      if (additions.events) {
        response.wouldCreate.events = additions.events.length;

        for (const event of additions.events) {
          // Check for duplicate IDs
          if (event.id) {
            const existing = await eventRepository.findById(event.id);
            if (existing) {
              response.conflicts.push({
                type: 'duplicate_id',
                entityType: 'event',
                entityId: event.id,
                message: `Event with ID ${event.id} already exists`,
                existingEntity: existing as unknown as Record<string, unknown>,
              });
              response.valid = false;
            }
          }

          // Check timestamp validity
          if (event.timestamp) {
            const timestamp = new Date(event.timestamp);
            if (isNaN(timestamp.getTime())) {
              response.conflicts.push({
                type: 'invalid_data',
                entityType: 'event',
                entityId: event.id || 'new',
                message: `Invalid timestamp: ${event.timestamp}`,
              });
              response.valid = false;
            }
          }
        }
      }

      // Check for arc conflicts
      if (additions.arcs) {
        response.wouldCreate.arcs = additions.arcs.length;

        for (const arc of additions.arcs) {
          // Check for duplicate IDs
          if (arc.id) {
            const existing = await arcRepository.findById(arc.id);
            if (existing) {
              response.conflicts.push({
                type: 'duplicate_id',
                entityType: 'arc',
                entityId: arc.id,
                message: `Arc with ID ${arc.id} already exists`,
                existingEntity: existing as unknown as Record<string, unknown>,
              });
              response.valid = false;
            }
          }

          // Check parent arc exists
          if (arc.parent_arc_id) {
            const parentExists = await arcRepository.findById(arc.parent_arc_id);
            const parentInAdditions = additions.arcs.some((a) => a.id === arc.parent_arc_id);

            if (!parentExists && !parentInAdditions) {
              response.conflicts.push({
                type: 'missing_reference',
                entityType: 'arc',
                entityId: arc.id || 'new',
                message: `Parent arc not found: ${arc.parent_arc_id}`,
              });
              response.valid = false;
            }
          }
        }
      }

      // Check for relationship conflicts
      if (additions.relationships) {
        response.wouldCreate.relationships = additions.relationships.length;

        for (const rel of additions.relationships) {
          // Check cause event exists
          const causeExists = await eventRepository.findById(rel.cause_event_id);
          const causeInAdditions = additions.events?.some((e) => e.id === rel.cause_event_id);

          if (!causeExists && !causeInAdditions) {
            response.conflicts.push({
              type: 'missing_reference',
              entityType: 'relationship',
              entityId: 'new',
              message: `Cause event not found: ${rel.cause_event_id}`,
            });
            response.valid = false;
          }

          // Check effect event exists
          const effectExists = await eventRepository.findById(rel.effect_event_id);
          const effectInAdditions = additions.events?.some((e) => e.id === rel.effect_event_id);

          if (!effectExists && !effectInAdditions) {
            response.conflicts.push({
              type: 'missing_reference',
              entityType: 'relationship',
              entityId: 'new',
              message: `Effect event not found: ${rel.effect_event_id}`,
            });
            response.valid = false;
          }
        }
      }

      res.json(response);
    } catch (error) {
      console.error('[Validate] Error validating incremental:', error);
      res.status(500).json({
        error: { message: 'Failed to validate incremental additions' },
      });
    }
  })
);

// Helper functions

function detectCircularDependencies(
  relationships: Array<{ cause_event_id: string; effect_event_id: string }>
): string[][] {
  const graph = new Map<string, string[]>();
  const cycles: string[][] = [];
  const foundCycles = new Set<string>(); // Track unique cycles by normalized key

  // Build adjacency list
  for (const rel of relationships) {
    const causes = graph.get(rel.cause_event_id) || [];
    causes.push(rel.effect_event_id);
    graph.set(rel.cause_event_id, causes);
  }

  // DFS to detect ALL cycles (not just the first one)
  const globalVisited = new Set<string>();
  
  function dfs(startNode: string): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    function explore(node: string): void {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          explore(neighbor);
        } else if (recursionStack.has(neighbor)) {
          // Found cycle - extract it
          const cycleStart = path.indexOf(neighbor);
          const cycle = [...path.slice(cycleStart), neighbor];
          
          // Normalize cycle to avoid duplicates (sort by smallest node first)
          const minIndex = cycle.indexOf(cycle.reduce((min, node) => node < min ? node : min));
          const normalizedCycle = [...cycle.slice(minIndex, -1), ...cycle.slice(0, minIndex), cycle[minIndex]];
          const cycleKey = normalizedCycle.join('->');
          
          if (!foundCycles.has(cycleKey)) {
            foundCycles.add(cycleKey);
            cycles.push(cycle);
          }
        }
      }

      path.pop();
      recursionStack.delete(node);
    }

    if (!globalVisited.has(startNode)) {
      explore(startNode);
      // Mark all visited nodes in this DFS as globally visited
      for (const node of visited) {
        globalVisited.add(node);
      }
    }
  }

  // Run DFS from each node to find all cycles
  for (const node of graph.keys()) {
    dfs(node);
  }

  return cycles;
}

function suggestArcs(events: IEvent[]): SuggestedArc[] {
  const suggestions: SuggestedArc[] = [];

  if (events.length < 3) return suggestions;

  // Sort events by timestamp
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Simple clustering by time proximity (events within 30 days)
  const clusters: IEvent[][] = [];
  let currentCluster: IEvent[] = [sortedEvents[0]];

  for (let i = 1; i < sortedEvents.length; i++) {
    const prevTime = new Date(sortedEvents[i - 1].timestamp).getTime();
    const currTime = new Date(sortedEvents[i].timestamp).getTime();
    const daysDiff = (currTime - prevTime) / (1000 * 60 * 60 * 24);

    if (daysDiff <= 30) {
      currentCluster.push(sortedEvents[i]);
    } else {
      if (currentCluster.length >= 3) {
        clusters.push(currentCluster);
      }
      currentCluster = [sortedEvents[i]];
    }
  }

  if (currentCluster.length >= 3) {
    clusters.push(currentCluster);
  }

  // Create arc suggestions for clusters
  for (const cluster of clusters) {
    const startTime = new Date(cluster[0].timestamp).toISOString();
    const endTime = new Date(cluster[cluster.length - 1].timestamp).toISOString();

    suggestions.push({
      name: `Event cluster (${cluster.length} events)`,
      description: `Automatically suggested arc grouping ${cluster.length} related events`,
      start_time: startTime,
      end_time: endTime,
      eventIds: cluster.map((e) => e.id),
      confidence: 0.6,
      reason: 'Events are temporally clustered within 30 days',
    });
  }

  return suggestions;
}

function suggestRelationships(
  events: IEvent[],
  existingRelationships: Array<{ cause_event_id: string; effect_event_id: string }>
): CausalSuggestion[] {
  const suggestions: CausalSuggestion[] = [];

  if (events.length < 2) return suggestions;

  // Build set of existing relationships
  const existingPairs = new Set(
    existingRelationships.map((r) => `${r.cause_event_id}->${r.effect_event_id}`)
  );

  // Sort events by timestamp
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Suggest relationships between consecutive events by same actor
  const eventsByActor = new Map<string, IEvent[]>();
  for (const event of sortedEvents) {
    const actor = event.actor || 'unknown';
    const actorEvents = eventsByActor.get(actor) || [];
    actorEvents.push(event);
    eventsByActor.set(actor, actorEvents);
  }

  for (const [actor, actorEvents] of eventsByActor) {
    if (actorEvents.length < 2) continue;

    for (let i = 0; i < actorEvents.length - 1; i++) {
      const cause = actorEvents[i];
      const effect = actorEvents[i + 1];
      const pairKey = `${cause.id}->${effect.id}`;

      if (!existingPairs.has(pairKey)) {
        suggestions.push({
          cause_event_id: cause.id,
          effect_event_id: effect.id,
          confidence: 0.5,
          reason: `Sequential events by same actor: ${actor}`,
          relationship_type: 'indirect',
        });
      }
    }
  }

  // Limit suggestions
  return suggestions.slice(0, 10);
}
