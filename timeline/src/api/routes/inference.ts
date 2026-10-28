import { Router, Request, Response, NextFunction } from 'express';
import { ValidationError, NotFoundError } from '@/utils/errors';
import { TimeRange } from '@/models/Event';
import { PressureType } from '@/models/InferredPressure';
import { requireGraphId, resolveGraphContext } from '@/api/middleware';
import { entityPermission, mountEntityAccessGuard, mountEntityGraphAccess } from '@/api/entityAuth';
import type { Event } from '@/models/Event';
import type { InferredPressure } from '@/models/InferredPressure';
import {
  isSimulationDomain,
  SimulationRequest,
  SimulationResult,
  SimulationStep,
} from '@/services/SimulationService';
import type { StoredCausalRelationship } from '@/services/CausalService';

export const inferenceRoutes = Router();

// Authentication first (it mounts nothing in local execution; see
// `api/entityAuth.ts`), then the graph scope. Keeping the guard ahead of the
// lookup means a keyless caller is refused with 401 rather than learning from a
// 404 whether a graph exists.
mountEntityAccessGuard(inferenceRoutes);

// Scope every route in this group to exactly one graph. `resolveGraphContext`
// resolves X-Graph-Id (falling back to the active graph) and attaches the graph
// id; the handlers below read it through the checked `requireGraphId` accessor
// so a routing change that drops the mount fails loudly instead of reading an
// unscoped value.
inferenceRoutes.use(resolveGraphContext());
// The per-key graph restriction, which these groups did not apply: a key
// issued for one graph could name any graph in `X-Graph-Id`.
mountEntityGraphAccess(inferenceRoutes);

/** Pressure types accepted by the inference API. Mirrors `PressureType`. */
const VALID_PRESSURE_TYPES: readonly PressureType[] = ['social', 'economic', 'political', 'environmental'];

/** Type guard for a string arriving from the query string. */
function isPressureType(value: string): value is PressureType {
  return (VALID_PRESSURE_TYPES as readonly string[]).includes(value);
}

/**
 * POST /inference/analyze-clusters - Analyze event clusters to identify patterns
 */
inferenceRoutes.post('/analyze-clusters', ...entityPermission('read:events'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { eventIds, timeRange } = req.body;
    
    if (!eventIds && !timeRange) {
      throw new ValidationError(
        'Either eventIds array or timeRange (startTime, endTime) is required',
        undefined,
        req.body
      );
    }

    let events;
    const { eventRepository } = await req.container.graphScopedRepositories(requireGraphId(req));

    if (eventIds) {
      if (!Array.isArray(eventIds)) {
        throw new ValidationError('eventIds must be an array', 'eventIds', eventIds);
      }
      
      // Get specific events
      events = await Promise.all(
        eventIds.map(async (eventId: string) => {
          const event = await eventRepository.findById(eventId);
          if (!event) {
            throw new NotFoundError(`Event with ID ${eventId} not found`, 'Event', eventId);
          }
          return event;
        })
      );
    } else {
      // Get events within time range
      const parsedTimeRange: TimeRange = {
        start: new Date(timeRange.startTime),
        end: new Date(timeRange.endTime)
      };

      if (isNaN(parsedTimeRange.start.getTime()) || isNaN(parsedTimeRange.end.getTime())) {
        throw new ValidationError('Invalid date format in timeRange', 'timeRange', timeRange);
      }

      events = await eventRepository.findByTimeRange(parsedTimeRange);
    }

    // Analyze clusters
    const inferenceService = req.container.inferenceService;
    const pressures = inferenceService.analyzeEventClusters(events);

    res.json({
      success: true,
      data: {
        pressures: pressures.map(p => p.toJSON()),
        eventCount: events.length,
        clustersAnalyzed: true
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /inference/detect-patterns - Detect patterns in event data
 */
inferenceRoutes.post('/detect-patterns', ...entityPermission('read:events'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { 
      timeRange, 
      actors, 
      targets,
      minClusterSize = 2,
      minConfidence = 0.3
    } = req.body;
    
    if (!timeRange) {
      throw new ValidationError('timeRange (startTime, endTime) is required', 'timeRange', timeRange);
    }

    const parsedTimeRange: TimeRange = {
      start: new Date(timeRange.startTime),
      end: new Date(timeRange.endTime)
    };

    if (isNaN(parsedTimeRange.start.getTime()) || isNaN(parsedTimeRange.end.getTime())) {
      throw new ValidationError('Invalid date format in timeRange', 'timeRange', timeRange);
    }

    // Validate parameters
    if (typeof minClusterSize !== 'number' || minClusterSize < 1) {
      throw new ValidationError('minClusterSize must be a positive number', 'minClusterSize', minClusterSize);
    }

    if (typeof minConfidence !== 'number' || minConfidence < 0 || minConfidence > 1) {
      throw new ValidationError('minConfidence must be a number between 0 and 1', 'minConfidence', minConfidence);
    }

    // Get events within criteria
    const { eventRepository } = await req.container.graphScopedRepositories(requireGraphId(req));
    let events = await eventRepository.findByTimeRange(parsedTimeRange);

    // Filter by actors if specified
    if (actors && Array.isArray(actors)) {
      events = events.filter(event => actors.includes(event.actor));
    }

    // Filter by targets if specified
    if (targets && Array.isArray(targets)) {
      events = events.filter(event => targets.includes(event.target));
    }

    // Use existing inference service to analyze clusters and suggest causal links
    const inferenceService = req.container.inferenceService;
    const pressures = inferenceService.analyzeEventClusters(events);
    const causalSuggestions = inferenceService.suggestCausalLinks(events);
    
    // Confidence lives on the suggested relationship, not on the suggestion wrapper.
    const patterns = {
      pressures: pressures.map(p => p.toJSON()),
      causalSuggestions: causalSuggestions.filter(
        s => s.suggested_relationship.confidence >= minConfidence
      ),
      eventCount: events.length,
      parameters: { minClusterSize, minConfidence }
    };

    res.json({
      success: true,
      data: patterns,
      filters: {
        timeRange,
        actors,
        targets,
        minClusterSize,
        minConfidence
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /inference/pressures - Get inferred pressures
 */
inferenceRoutes.get('/pressures', ...entityPermission('read:events'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      type, // 'social', 'economic', 'political', 'environmental'
      minStrength = '0.1',
      minConfidence = '0.3',
      limit = '50',
      offset = '0'
    } = req.query;

    const parsedMinStrength = parseFloat(minStrength as string);
    const parsedMinConfidence = parseFloat(minConfidence as string);
    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);

    // Validate parameters
    if (isNaN(parsedMinStrength) || parsedMinStrength < 0 || parsedMinStrength > 1) {
      throw new ValidationError('minStrength must be a number between 0 and 1', 'minStrength', minStrength);
    }

    if (isNaN(parsedMinConfidence) || parsedMinConfidence < 0 || parsedMinConfidence > 1) {
      throw new ValidationError('minConfidence must be a number between 0 and 1', 'minConfidence', minConfidence);
    }

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      throw new ValidationError('Limit must be a number between 1 and 1000', 'limit', limit);
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw new ValidationError('Offset must be a non-negative number', 'offset', offset);
    }

    // Validate pressure type if specified
    let typeFilter: PressureType | undefined;
    if (type) {
      // A repeated query param arrives as an array; that is never a valid type.
      const requestedType = typeof type === 'string' ? type : '';
      if (!isPressureType(requestedType)) {
        throw new ValidationError(`Type must be one of: ${VALID_PRESSURE_TYPES.join(', ')}`, 'type', type);
      }
      typeFilter = requestedType;
    }

    // Get all events and analyze clusters to infer pressures
    const { eventRepository } = await req.container.graphScopedRepositories(requireGraphId(req));
    const inferenceService = req.container.inferenceService;
    
    const events = await eventRepository.findAll(1000); // Get sample of events
    let pressures = inferenceService.analyzeEventClusters(events);
    
    // Filter by type if specified
    if (typeFilter) {
      pressures = pressures.filter(p => p.pressure_type === typeFilter);
    }
    
    // Filter by strength and confidence. InferredPressure carries a single
    // score, `confidence_score`, so both thresholds are applied to it.
    pressures = pressures.filter(
      p => p.confidence_score >= parsedMinStrength && p.confidence_score >= parsedMinConfidence
    );
    
    // Apply pagination
    const paginatedPressures = pressures.slice(parsedOffset, parsedOffset + parsedLimit);

    res.json({
      success: true,
      data: paginatedPressures.map(p => p.toJSON()),
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        total: pressures.length,
        hasMore: parsedOffset + parsedLimit < pressures.length
      },
      filters: {
        type,
        minStrength: parsedMinStrength,
        minConfidence: parsedMinConfidence
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /inference/actor-relationships - Analyze relationships between actors
 */
inferenceRoutes.get('/actor-relationships', ...entityPermission('read:events'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      actors, // array of actor names
      timeRange,
      minInteractions = '2',
      includeStrength = 'true'
    } = req.query;

    if (!actors) {
      throw new ValidationError('actors parameter is required', 'actors', actors);
    }

    let actorList: string[];
    try {
      actorList = Array.isArray(actors) ? actors as string[] : JSON.parse(actors as string);
    } catch {
      throw new ValidationError('actors must be a valid JSON array', 'actors', actors);
    }

    if (!Array.isArray(actorList) || actorList.length < 2) {
      throw new ValidationError('actors must be an array with at least 2 actors', 'actors', actorList);
    }

    const parsedMinInteractions = parseInt(minInteractions as string, 10);
    if (isNaN(parsedMinInteractions) || parsedMinInteractions < 1) {
      throw new ValidationError('minInteractions must be a positive number', 'minInteractions', minInteractions);
    }

    let parsedTimeRange: TimeRange | undefined;
    if (timeRange) {
      try {
        const tr = typeof timeRange === 'string' ? JSON.parse(timeRange) : timeRange;
        parsedTimeRange = {
          start: new Date(tr.startTime),
          end: new Date(tr.endTime)
        };

        if (isNaN(parsedTimeRange.start.getTime()) || isNaN(parsedTimeRange.end.getTime())) {
          throw new ValidationError('Invalid date format in timeRange', 'timeRange', timeRange);
        }
      } catch {
        throw new ValidationError('timeRange must be a valid JSON object with startTime and endTime', 'timeRange', timeRange);
      }
    }

    // Basic actor relationship analysis using events
    const { eventRepository } = await req.container.graphScopedRepositories(requireGraphId(req));
    let events = parsedTimeRange 
      ? await eventRepository.findByTimeRange(parsedTimeRange)
      : await eventRepository.findAll(1000);
    
    // Filter events involving the specified actors
    events = events.filter(e => actorList.includes(e.actor) || actorList.includes(e.target));
    
    // Build basic relationship matrix
    const relationships = {
      actors: actorList,
      interactions: events.length,
      timeRange: parsedTimeRange,
      note: 'Detailed actor relationship analysis not yet implemented - showing basic interaction count'
    };

    res.json({
      success: true,
      data: relationships,
      filters: {
        actors: actorList,
        timeRange: parsedTimeRange,
        minInteractions: parsedMinInteractions,
        includeStrength: includeStrength === 'true'
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /inference/similarity - Find events similar to a given event
 */
inferenceRoutes.post('/similarity', ...entityPermission('read:events'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { eventId, threshold = 0.5, limit = 10 } = req.body;
    
    if (!eventId) {
      throw new ValidationError('eventId is required', 'eventId', eventId);
    }

    if (typeof threshold !== 'number' || threshold < 0 || threshold > 1) {
      throw new ValidationError('threshold must be a number between 0 and 1', 'threshold', threshold);
    }

    if (typeof limit !== 'number' || limit < 1 || limit > 100) {
      throw new ValidationError('limit must be a number between 1 and 100', 'limit', limit);
    }

    // Get the reference event
    const { eventRepository } = await req.container.graphScopedRepositories(requireGraphId(req));
    const referenceEvent = await eventRepository.findById(eventId);
    
    if (!referenceEvent) {
      throw new NotFoundError(`Event with ID ${eventId} not found`, 'Event', eventId);
    }

    // Basic similarity analysis - would need more sophisticated implementation
    const allEvents = await eventRepository.findAll(1000);
    
    // Simple similarity based on actor/target matching
    const similarEvents = allEvents
      .filter(e => e.id !== referenceEvent.id)
      .filter(e => e.actor === referenceEvent.actor || e.target === referenceEvent.target)
      .slice(0, limit)
      .map(event => ({
        event,
        similarity: event.actor === referenceEvent.actor ? 0.8 : 0.6,
        factors: ['actor_match', 'temporal_proximity']
      }));

    res.json({
      success: true,
      data: {
        reference: referenceEvent.toJSON(),
        similar: similarEvents.map(result => ({
          event: result.event.toJSON(),
          similarity: result.similarity,
          factors: result.factors
        }))
      },
      parameters: {
        threshold,
        limit
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /inference/anomalies - Detect anomalous events or patterns
 */
inferenceRoutes.get('/anomalies', ...entityPermission('read:events'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      timeRange,
      anomalyType = 'all', // 'temporal', 'behavioral', 'statistical', 'all'
      sensitivity = '0.5',
      limit = '20',
      offset = '0'
    } = req.query;

    if (!timeRange) {
      throw new ValidationError('timeRange parameter is required', 'timeRange', timeRange);
    }

    let parsedTimeRange: TimeRange;
    try {
      const tr = typeof timeRange === 'string' ? JSON.parse(timeRange as string) : timeRange;
      parsedTimeRange = {
        start: new Date(tr.startTime),
        end: new Date(tr.endTime)
      };

      if (isNaN(parsedTimeRange.start.getTime()) || isNaN(parsedTimeRange.end.getTime())) {
        throw new ValidationError('Invalid date format in timeRange', 'timeRange', timeRange);
      }
    } catch {
      throw new ValidationError('timeRange must be a valid JSON object with startTime and endTime', 'timeRange', timeRange);
    }

    const validAnomalyTypes = ['temporal', 'behavioral', 'statistical', 'all'];
    if (!validAnomalyTypes.includes(anomalyType as string)) {
      throw new ValidationError(`anomalyType must be one of: ${validAnomalyTypes.join(', ')}`, 'anomalyType', anomalyType);
    }

    const parsedSensitivity = parseFloat(sensitivity as string);
    if (isNaN(parsedSensitivity) || parsedSensitivity < 0 || parsedSensitivity > 1) {
      throw new ValidationError('sensitivity must be a number between 0 and 1', 'sensitivity', sensitivity);
    }

    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new ValidationError('Limit must be a number between 1 and 100', 'limit', limit);
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw new ValidationError('Offset must be a non-negative number', 'offset', offset);
    }

    // Basic anomaly detection - would need more sophisticated implementation
    const anomalies = {
      anomalies: [],
      timeRange: parsedTimeRange,
      type: anomalyType,
      sensitivity: parsedSensitivity,
      note: 'Anomaly detection not yet implemented - would require additional analysis algorithms'
    };

    res.json({
      success: true,
      data: anomalies,
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset
      },
      filters: {
        timeRange: parsedTimeRange,
        anomalyType,
        sensitivity: parsedSensitivity
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /inference/predict - Make predictions based on current patterns
 */
inferenceRoutes.post('/predict', ...entityPermission('read:events'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { 
      baseTimeRange,
      predictionWindow, // in milliseconds
      confidence = 0.5,
      includeFactors = true
    } = req.body;
    
    if (!baseTimeRange || !predictionWindow) {
      throw new ValidationError(
        'baseTimeRange and predictionWindow are required',
        undefined,
        req.body,
        ['baseTimeRange', 'predictionWindow'].filter(field => !req.body[field])
      );
    }

    const parsedBaseTimeRange: TimeRange = {
      start: new Date(baseTimeRange.startTime),
      end: new Date(baseTimeRange.endTime)
    };

    if (isNaN(parsedBaseTimeRange.start.getTime()) || isNaN(parsedBaseTimeRange.end.getTime())) {
      throw new ValidationError('Invalid date format in baseTimeRange', 'baseTimeRange', baseTimeRange);
    }

    if (typeof predictionWindow !== 'number' || predictionWindow <= 0) {
      throw new ValidationError('predictionWindow must be a positive number in milliseconds', 'predictionWindow', predictionWindow);
    }

    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
      throw new ValidationError('confidence must be a number between 0 and 1', 'confidence', confidence);
    }

    // Basic prediction structure - would need machine learning implementation
    const predictions = {
      baseTimeRange: parsedBaseTimeRange,
      predictionWindow,
      confidence,
      predictions: [],
      factors: includeFactors ? ['temporal_patterns', 'causal_chains'] : undefined,
      note: 'Prediction functionality not yet implemented - would require machine learning models'
    };

    res.json({
      success: true,
      data: predictions,
      parameters: {
        baseTimeRange: parsedBaseTimeRange,
        predictionWindow,
        confidence,
        includeFactors
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});
/**
 * POST /inference/simulate - Evolve a timeline forward under inferred pressures
 *
 * Each step reads the recent causal window, infers the pressures acting on it,
 * and persists one milestone event plus a causal link to its precursor. Pass
 * `dryRun: true` to get the same plan without writes, or `stream: true` (or an
 * `Accept: text/event-stream` header) to receive each milestone as it lands.
 */
inferenceRoutes.post('/simulate', ...entityPermission('write:events', 'write:relationships'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const graphId = requireGraphId(req);
    const body = isUnknownRecord(req.body) ? req.body : {};
    const request = parseSimulationRequest(graphId, body);

    if (readOptionalBoolean(body, 'dryRun') === true) {
      const preview = await req.container.simulationService.preview(request);
      res.json({
        success: true,
        data: serializeSimulation(preview),
        requestId: req.requestId
      });
      return;
    }

    if (wantsEventStream(req, body)) {
      await streamSimulation(req, res, request);
      return;
    }

    const result = await req.container.simulationService.simulate(request);
    res.json({
      success: true,
      data: serializeSimulation(result),
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/** Read a simulation request out of an untyped body, rejecting bad fields. */
function parseSimulationRequest(graphId: string, body: Record<string, unknown>): SimulationRequest {
  const request: SimulationRequest = { graphId };

  const anchorEventId = readOptionalString(body, 'anchorEventId');
  if (anchorEventId !== undefined) request.anchorEventId = anchorEventId;

  const seedContext = readOptionalString(body, 'seedContext');
  if (seedContext !== undefined) request.seedContext = seedContext;

  const steps = readOptionalNumber(body, 'steps');
  if (steps !== undefined) request.steps = steps;

  const stepDurationMs = readOptionalNumber(body, 'stepDurationMs');
  if (stepDurationMs !== undefined) request.stepDurationMs = stepDurationMs;

  const aggressiveness = readOptionalNumber(body, 'aggressiveness');
  if (aggressiveness !== undefined) request.aggressiveness = aggressiveness;

  const domain = readOptionalString(body, 'domain');
  if (domain !== undefined) {
    if (!isSimulationDomain(domain)) {
      throw new ValidationError(
        'domain must be one of: political, military, economic, scientific, social, environmental',
        'domain',
        domain
      );
    }
    request.domain = domain;
  }

  return request;
}

function wantsEventStream(req: Request, body: Record<string, unknown>): boolean {
  if (readOptionalBoolean(body, 'stream') === true) {
    return true;
  }
  const accept = req.get('Accept');
  return typeof accept === 'string' && accept.includes('text/event-stream');
}

/**
 * Run a simulation, writing each persisted milestone to the client as an SSE
 * frame before the next hop begins.
 *
 * The response is streamed by hand rather than through the error handler
 * because headers are committed once the first frame is written: a mid-run
 * failure is reported as a `simulation_error` frame instead of a status code,
 * and the stream is always closed.
 */
async function streamSimulation(
  req: Request,
  res: Response,
  request: SimulationRequest
): Promise<void> {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const writeFrame = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await req.container.simulationService.simulate(request, (step) => {
      writeFrame('event_created', serializeSimulationStep(step));
      if (step.causalLink) {
        writeFrame('causal_link_created', serializeRelationship(step.causalLink));
      }
    });
    writeFrame('simulation_complete', serializeSimulation(result));
  } catch (error) {
    writeFrame('simulation_error', {
      message: error instanceof Error ? error.message : 'Simulation failed'
    });
  } finally {
    res.end();
  }
}

interface SerializedEvent {
  id: string;
  description: string;
  actor: string;
  target: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

function serializeEvent(event: Event): SerializedEvent {
  return {
    id: event.id,
    description: event.description,
    actor: event.actor,
    target: event.target,
    timestamp: event.timestamp.toISOString(),
    metadata: event.metadata ?? {}
  };
}

function serializePressure(pressure: InferredPressure): Record<string, unknown> {
  return {
    id: pressure.id,
    description: pressure.description,
    confidence_score: pressure.confidence_score,
    pressure_type: pressure.pressure_type,
    evidence: pressure.evidence
  };
}

function serializeRelationship(relationship: StoredCausalRelationship): Record<string, unknown> {
  return {
    id: relationship.id,
    cause_event_id: relationship.cause_event_id,
    effect_event_id: relationship.effect_event_id,
    weight: relationship.weight,
    evidence: relationship.evidence,
    confidence: relationship.confidence,
    relationship_type: relationship.relationship_type
  };
}

function serializeSimulationStep(step: SimulationStep): Record<string, unknown> {
  return {
    index: step.index,
    event: serializeEvent(step.event),
    pressure: serializePressure(step.pressure),
    causalLink: step.causalLink ? serializeRelationship(step.causalLink) : null
  };
}

function serializeSimulation(result: SimulationResult): Record<string, unknown> {
  return {
    graphId: result.graphId,
    anchorEventId: result.anchorEventId,
    domain: result.domain,
    steps: result.steps,
    stepDurationMs: result.stepDurationMs,
    aggressiveness: result.aggressiveness,
    dryRun: result.dryRun,
    events: result.events.map(serializeEvent),
    relationships: result.relationships.map(serializeRelationship),
    pressures: result.pressures.map(serializePressure)
  };
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readOptionalNumber(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  return typeof value === 'number' ? value : undefined;
}

function readOptionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  return typeof value === 'boolean' ? value : undefined;
}
