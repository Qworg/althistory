import { Router, Request, Response, NextFunction } from 'express';
import { ValidationError, NotFoundError } from '@/utils/errors';
import { CausalRelationship, CausalRelationshipType } from '@/models/relationships';
import { requireGraphId, resolveGraphContext } from '@/api/middleware';
import { entityPermission, mountEntityAccessGuard, mountEntityGraphAccess } from '@/api/entityAuth';
import { EventRepository } from '@/repositories/EventRepository';
import { CausalService } from '@/services/CausalService';
import { createLogger } from '@/utils/logger';
import { isTemporalInversion } from '@/utils/causalOrder';

const logger = createLogger('CausalRoutes');

export const causalRoutes = Router();

// Authentication first (it mounts nothing in local execution; see
// `api/entityAuth.ts`), then the graph scope. Keeping the guard ahead of the
// lookup means a keyless caller is refused with 401 rather than learning from a
// 404 whether a graph exists.
mountEntityAccessGuard(causalRoutes);

// Resolve exactly one graph for every causal request before any handler runs.
// Mounted on this router rather than globally so routes owned by other
// migrations keep their current behaviour until they are converted in turn.
causalRoutes.use(resolveGraphContext());
// The per-key graph restriction, which these groups did not apply: a key
// issued for one graph could name any graph in `X-Graph-Id`.
mountEntityGraphAccess(causalRoutes);

/**
 * Repository bound to the graph this request resolved to.
 *
 * `container.eventRepository` reads the process-wide legacy store; reaching for
 * it from a handler is the cross-graph leak this migration removes. The scoped
 * repositories come from the container's per-graph store cache, so this costs a
 * map lookup, not a file read.
 */
async function graphScopedEventRepository(req: Request): Promise<EventRepository> {
  const { eventRepository } = await req.container.graphScopedRepositories(requireGraphId(req));
  return eventRepository;
}

/**
 * `CausalService` bound to the graph this request resolved to.
 *
 * The container exposes `graphScopedRepositories`, but not yet a scoped causal
 * service, so the wrapper is built here from the same cached store those
 * repositories use. The store is shared, so the per-request service object is
 * cheap; binding it is what keeps causal reads, writes and caches inside the
 * request's graph.
 */
async function graphScopedCausalService(req: Request): Promise<CausalService> {
  const store = await req.container.graphContextStore.getStore(requireGraphId(req));
  return new CausalService({ graphStore: store, graphId: requireGraphId(req) });
}

/**
 * Narrow an untrusted request-body value to a CausalRelationshipType.
 * Anything outside the closed set falls back to 'direct', matching the
 * defaults batch.ts already applies when creating relationships.
 */
function toCausalRelationshipType(value: unknown): CausalRelationshipType {
  return value === 'direct' || value === 'indirect' || value === 'contributory' ? value : 'direct';
}

/** Narrow an untrusted value to a finite number, falling back to `fallback`. */
function toScore(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Narrow an untrusted value to a string, falling back to ''. */
function toEvidence(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * POST /causal/link - Create a causal link between two events
 */
causalRoutes.post('/link', ...entityPermission('write:relationships'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { causeEventId, effectEventId, relationship } = req.body;
    
    // Validate required fields
    if (!causeEventId || !effectEventId || !relationship) {
      throw new ValidationError(
        'Missing required fields: causeEventId, effectEventId, and relationship are required',
        undefined,
        req.body,
        ['causeEventId', 'effectEventId', 'relationship'].filter(field => !req.body[field])
      );
    }

    // Validate relationship structure
    if (!relationship.type || typeof relationship.strength !== 'number' || typeof relationship.confidence !== 'number') {
      throw new ValidationError(
        'Relationship must have type, strength (number), and confidence (number)',
        'relationship',
        relationship
      );
    }

    // Get events from the request's graph, never the process-wide store.
    const eventRepository = await graphScopedEventRepository(req);
    const causeEvent = await eventRepository.findById(causeEventId);
    const effectEvent = await eventRepository.findById(effectEventId);

    if (!causeEvent) {
      throw new NotFoundError(`Cause event with ID ${causeEventId} not found`, 'Event', causeEventId);
    }
    if (!effectEvent) {
      throw new NotFoundError(`Effect event with ID ${effectEventId} not found`, 'Event', effectEventId);
    }

    // Transform relationship fields to match CausalService expectations
    // Route accepts: type, strength, confidence, evidence
    // Service expects: relationship_type, weight, confidence, evidence
    const transformedRelationship: CausalRelationship = {
      relationship_type: toCausalRelationshipType(relationship.type || relationship.relationship_type),
      weight: toScore(relationship.strength ?? relationship.weight, 0.5),
      confidence: toScore(relationship.confidence, 0.5),
      evidence: toEvidence(relationship.evidence)
    };

    // Create causal link in the request's graph.
    const causalService = await graphScopedCausalService(req);
    const storedRelationship = await causalService.createCausalLink(
      causeEvent,
      effectEvent,
      transformedRelationship
    );

    // Mirror the write into the active graph's version store so version history
    // and ExportService see UI-created causal links (not only imported ones).
    try {
      await req.container.graphWriteVersioningService.recordRelationship(requireGraphId(req), storedRelationship, 'create');
    } catch (versionError) {
      try {
        await causalService.deleteCausalLink(causeEventId, effectEventId);
      } catch (rollbackError) {
        logger.error('Compensating rollback failed for causal relationship', {
          causeEventId,
          effectEventId,
          rollbackError,
        });
      }
      throw versionError;
    }

    res.status(201).json({
      success: true,
      data: {
        cause: causeEvent.toJSON(),
        effect: effectEvent.toJSON(),
        relationship
      },
      message: 'Causal link created successfully',
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /causal/chain/:eventId - Find causal chain starting from an event
 */
causalRoutes.get('/chain/:eventId', ...entityPermission('read:relationships', 'read:events'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { eventId } = req.params;
    const { maxDepth = '5' } = req.query;
    
    if (!eventId || eventId.trim().length === 0) {
      throw new ValidationError('Event ID is required', 'eventId', eventId);
    }

    const parsedMaxDepth = parseInt(maxDepth as string, 10);
    if (isNaN(parsedMaxDepth) || parsedMaxDepth < 1 || parsedMaxDepth > 10) {
      throw new ValidationError('Max depth must be a number between 1 and 10', 'maxDepth', maxDepth);
    }

    // Get the starting event from the request's graph.
    const eventRepository = await graphScopedEventRepository(req);
    const startEvent = await eventRepository.findById(eventId);
    
    if (!startEvent) {
      throw new NotFoundError(`Event with ID ${eventId} not found`, 'Event', eventId);
    }

    // Find causal chain within the request's graph.
    const causalService = await graphScopedCausalService(req);
    const causalPaths = await causalService.findCausalChain(startEvent, parsedMaxDepth);

    res.json({
      success: true,
      data: {
        startEvent: startEvent.toJSON(),
        causalPaths,
        maxDepth: parsedMaxDepth
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /causal/cycles - Detect causal cycles in the graph
 */
causalRoutes.get('/cycles', ...entityPermission('read:relationships'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = '10', offset = '0' } = req.query;
    
    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new ValidationError('Limit must be a number between 1 and 100', 'limit', limit);
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw new ValidationError('Offset must be a non-negative number', 'offset', offset);
    }

    const causalService = await graphScopedCausalService(req);
    const cycles = await causalService.detectCausalCycles();

    // Apply pagination
    const paginatedCycles = cycles.slice(parsedOffset, parsedOffset + parsedLimit);

    res.json({
      success: true,
      data: paginatedCycles,
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        total: cycles.length,
        hasMore: parsedOffset + parsedLimit < cycles.length
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /causal/suggestions - Get causal relationship suggestions
 */
causalRoutes.get('/suggestions', ...entityPermission('read:relationships'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { 
      minConfidence = '0.5',
      limit = '20',
      offset = '0'
    } = req.query;
    
    const parsedMinConfidence = parseFloat(minConfidence as string);
    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);

    if (isNaN(parsedMinConfidence) || parsedMinConfidence < 0 || parsedMinConfidence > 1) {
      throw new ValidationError('Min confidence must be a number between 0 and 1', 'minConfidence', minConfidence);
    }

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new ValidationError('Limit must be a number between 1 and 100', 'limit', limit);
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw new ValidationError('Offset must be a non-negative number', 'offset', offset);
    }

    const inferenceService = req.container.inferenceService;
    // Get all events first, then use inference service to suggest causal links
    const eventRepository = await graphScopedEventRepository(req);
    const events = await eventRepository.findAll(100); // Get sample of this graph's events
    // Confidence lives on the suggested relationship, not on the suggestion wrapper.
    const suggestions = inferenceService.suggestCausalLinks(events).filter(
      s => s.suggested_relationship.confidence >= parsedMinConfidence
    );

    // Apply pagination
    const paginatedSuggestions = suggestions.slice(parsedOffset, parsedOffset + parsedLimit);

    res.json({
      success: true,
      data: paginatedSuggestions,
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        total: suggestions.length,
        hasMore: parsedOffset + parsedLimit < suggestions.length
      },
      filters: {
        minConfidence: parsedMinConfidence
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /causal/validate - Validate a proposed causal relationship
 */
// Validation only: it dereferences both event ids and writes nothing, so it
// needs the two read permissions rather than a write one.
causalRoutes.post('/validate', ...entityPermission('read:events', 'read:relationships'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { causeEventId, effectEventId, relationship } = req.body;
    
    // Validate required fields
    if (!causeEventId || !effectEventId || !relationship) {
      throw new ValidationError(
        'Missing required fields: causeEventId, effectEventId, and relationship are required',
        undefined,
        req.body,
        ['causeEventId', 'effectEventId', 'relationship'].filter(field => !req.body[field])
      );
    }

    // Get events from the request's graph, never the process-wide store.
    const eventRepository = await graphScopedEventRepository(req);
    const causeEvent = await eventRepository.findById(causeEventId);
    const effectEvent = await eventRepository.findById(effectEventId);

    if (!causeEvent) {
      throw new NotFoundError(`Cause event with ID ${causeEventId} not found`, 'Event', causeEventId);
    }
    if (!effectEvent) {
      throw new NotFoundError(`Effect event with ID ${effectEventId} not found`, 'Event', effectEventId);
    }

    // Use validation service instead
    const validationService = req.container.validationService;
    const validation = validationService.validateCausalRelationship(relationship);

    // The route's own temporal check: the cause may not follow the effect,
    // but it may happen at the same moment. The rule lives in
    // `@/utils/causalOrder`, which every other path uses too.
    if (isTemporalInversion(causeEvent.timestamp, effectEvent.timestamp)) {
      validation.isValid = false;
      validation.errors.push(
        `Cause event ${causeEventId} occurs after effect event ${effectEventId}`
      );
    }

    res.json({
      success: true,
      data: {
        cause: causeEvent.toJSON(),
        effect: effectEvent.toJSON(),
        relationship,
        validation
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /causal/relationships - Get all causal relationships
 */
causalRoutes.get('/relationships', ...entityPermission('read:relationships'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const causalService = await graphScopedCausalService(req);
    const relationships = await causalService.getAllRelationships();

    res.json({
      success: true,
      data: relationships,
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /causal/relationships/:eventId - Get all causal relationships for an event
 */
causalRoutes.get('/relationships/:eventId', ...entityPermission('read:relationships'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { eventId } = req.params;
    const { direction = 'both' } = req.query; // 'cause', 'effect', or 'both'
    
    if (!eventId || eventId.trim().length === 0) {
      throw new ValidationError('Event ID is required', 'eventId', eventId);
    }

    if (!['cause', 'effect', 'both'].includes(direction as string)) {
      throw new ValidationError('Direction must be "cause", "effect", or "both"', 'direction', direction);
    }

    // Get the event from the request's graph.
    const eventRepository = await graphScopedEventRepository(req);
    const event = await eventRepository.findById(eventId);
    
    if (!event) {
      throw new NotFoundError(`Event with ID ${eventId} not found`, 'Event', eventId);
    }

    // For now, return basic structure - would need to implement relationship finding
    const relationships: { asCause: unknown[]; asEffect: unknown[]; note: string } = {
      asCause: [],
      asEffect: [],
      note: 'Relationship finding not yet implemented - would require additional service methods'
    };

    res.json({
      success: true,
      data: {
        event: event.toJSON(),
        relationships,
        direction
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /causal/link - Update a causal link between two events
 */
causalRoutes.put('/link', ...entityPermission('write:relationships'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { causeEventId, effectEventId, relationship } = req.body;

    // Validate required fields
    if (!causeEventId || !effectEventId) {
      throw new ValidationError(
        'Missing required fields: causeEventId and effectEventId are required',
        undefined,
        req.body,
        ['causeEventId', 'effectEventId'].filter(field => !req.body[field])
      );
    }

    if (!relationship || typeof relationship !== 'object') {
      throw new ValidationError(
        'Relationship updates must be provided as an object',
        'relationship',
        relationship
      );
    }

    // Get events from the request's graph to verify they exist.
    const eventRepository = await graphScopedEventRepository(req);
    const causeEvent = await eventRepository.findById(causeEventId);
    const effectEvent = await eventRepository.findById(effectEventId);

    if (!causeEvent) {
      throw new NotFoundError(`Cause event with ID ${causeEventId} not found`, 'Event', causeEventId);
    }
    if (!effectEvent) {
      throw new NotFoundError(`Effect event with ID ${effectEventId} not found`, 'Event', effectEventId);
    }

    // Update causal link in the request's graph.
    const causalService = await graphScopedCausalService(req);
    const updatedRelationship = await causalService.updateCausalLink(causeEventId, effectEventId, {
      weight: relationship.weight,
      confidence: relationship.confidence,
      evidence: relationship.evidence,
      relationship_type: relationship.type || relationship.relationship_type
    });

    await req.container.graphWriteVersioningService.recordRelationship(requireGraphId(req), updatedRelationship, 'update');

    res.json({
      success: true,
      data: {
        cause: causeEvent.toJSON(),
        effect: effectEvent.toJSON(),
        relationship: updatedRelationship
      },
      message: 'Causal link updated successfully',
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /causal/link - Remove a causal link between two events
 */
causalRoutes.delete('/link', ...entityPermission('write:relationships'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { causeEventId, effectEventId } = req.body;

    // Validate required fields
    if (!causeEventId || !effectEventId) {
      throw new ValidationError(
        'Missing required fields: causeEventId and effectEventId are required',
        undefined,
        req.body,
        ['causeEventId', 'effectEventId'].filter(field => !req.body[field])
      );
    }

    // Get events from the request's graph to verify they exist.
    const eventRepository = await graphScopedEventRepository(req);
    const causeEvent = await eventRepository.findById(causeEventId);
    const effectEvent = await eventRepository.findById(effectEventId);

    if (!causeEvent) {
      throw new NotFoundError(`Cause event with ID ${causeEventId} not found`, 'Event', causeEventId);
    }
    if (!effectEvent) {
      throw new NotFoundError(`Effect event with ID ${effectEventId} not found`, 'Event', effectEventId);
    }

    // Delete the causal link from the request's graph.
    const causalService = await graphScopedCausalService(req);
    const deletedRelationshipId = await causalService.deleteCausalLink(causeEventId, effectEventId);

    await req.container.graphWriteVersioningService.recordDeletion(requireGraphId(req), 'relationship', deletedRelationshipId);

    res.json({
      success: true,
      message: 'Causal link removed successfully',
      data: {
        cause: causeEvent.toJSON(),
        effect: effectEvent.toJSON()
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});