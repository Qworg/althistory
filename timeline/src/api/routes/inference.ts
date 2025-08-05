import { Router, Response, NextFunction } from 'express';
import { ValidationError, NotFoundError } from '@/utils/errors';
import { RequestWithContainer } from '@/api/middleware';
import { TimeRange } from '@/models/Event';
import { PressureType } from '@/models/InferredPressure';

export const inferenceRoutes = Router();

/**
 * POST /inference/analyze-clusters - Analyze event clusters to identify patterns
 */
inferenceRoutes.post('/analyze-clusters', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
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
    const eventRepository = req.container.eventRepository;

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
inferenceRoutes.post('/detect-patterns', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
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
    const eventRepository = req.container.eventRepository;
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
    
    const patterns = {
      pressures: pressures.map(p => p.toJSON()),
      causalSuggestions: causalSuggestions.filter(s => s.confidence >= minConfidence),
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
inferenceRoutes.get('/pressures', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const {
      type, // 'social', 'economic', 'political', 'environmental', 'technological'
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
    if (type) {
      const validTypes: PressureType[] = ['social', 'economic', 'political', 'environmental', 'technological'];
      if (!validTypes.includes(type as PressureType)) {
        throw new ValidationError(`Type must be one of: ${validTypes.join(', ')}`, 'type', type);
      }
    }

    // Get all events and analyze clusters to infer pressures
    const eventRepository = req.container.eventRepository;
    const inferenceService = req.container.inferenceService;
    
    const events = await eventRepository.findAll(1000); // Get sample of events
    let pressures = inferenceService.analyzeEventClusters(events);
    
    // Filter by type if specified
    if (type) {
      pressures = pressures.filter(p => p.type === type);
    }
    
    // Filter by strength and confidence
    pressures = pressures.filter(p => p.strength >= parsedMinStrength && p.confidence >= parsedMinConfidence);
    
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
inferenceRoutes.get('/actor-relationships', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
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
    const eventRepository = req.container.eventRepository;
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
inferenceRoutes.post('/similarity', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
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
    const eventRepository = req.container.eventRepository;
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
inferenceRoutes.get('/anomalies', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
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
inferenceRoutes.post('/predict', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
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