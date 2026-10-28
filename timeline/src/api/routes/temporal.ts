import { Router, Request, Response, NextFunction } from 'express';
import { ValidationError, NotFoundError } from '@/utils/errors';
import { TimeRange, IEvent } from '@/models/Event';
import { IArc } from '@/models/Arc';
import { requireGraphId, resolveGraphContext } from '@/api/middleware';
import { entityPermission, mountEntityAccessGuard } from '@/api/entityAuth';

export const temporalRoutes = Router();

// Authentication first (it mounts nothing in local execution; see
// `api/entityAuth.ts`), then the graph scope. Keeping the guard ahead of the
// lookup means a keyless caller is refused with 401 rather than learning from a
// 404 whether a graph exists.
mountEntityAccessGuard(temporalRoutes);

// Scope every route in this group to exactly one graph. `resolveGraphContext`
// resolves X-Graph-Id (falling back to the active graph) and attaches the graph
// id; the handlers below read it through the checked `requireGraphId` accessor
// so a routing change that drops the mount fails loudly instead of reading an
// unscoped value.
temporalRoutes.use(resolveGraphContext());

/** Aggregated timeline payload returned by GET /temporal/timeline. */
interface TimelineView {
  events: IEvent[];
  arcs: IArc[];
  granularity: string;
  timeRange: TimeRange;
}

/** Density metrics returned by GET /temporal/density. */
interface DensityView {
  granularity: string;
  timeRange: TimeRange;
  type: string;
  eventCount?: number;
  eventDensity?: number;
  arcCount?: number;
}

/**
 * GET /temporal/timeline - Get timeline view of events and arcs
 */
temporalRoutes.get('/timeline', ...entityPermission('read:events', 'read:arcs'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      startTime,
      endTime,
      granularity = 'day', // 'hour', 'day', 'week', 'month', 'year'
      includeArcs = 'true',
      includeEvents = 'true',
      limit = '100',
      offset = '0'
    } = req.query;

    // Validate time range
    if (!startTime || !endTime) {
      throw new ValidationError('startTime and endTime are required', 'timeRange', { startTime, endTime });
    }

    const timeRange: TimeRange = {
      start: new Date(startTime as string),
      end: new Date(endTime as string)
    };

    if (isNaN(timeRange.start.getTime()) || isNaN(timeRange.end.getTime())) {
      throw new ValidationError('Invalid date format for startTime or endTime', 'timeRange', { startTime, endTime });
    }

    if (timeRange.start >= timeRange.end) {
      throw new ValidationError('startTime must be before endTime', 'timeRange', { startTime, endTime });
    }

    // Validate granularity
    const validGranularities = ['hour', 'day', 'week', 'month', 'year'];
    if (!validGranularities.includes(granularity as string)) {
      throw new ValidationError(`Granularity must be one of: ${validGranularities.join(', ')}`, 'granularity', granularity);
    }

    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      throw new ValidationError('Limit must be a number between 1 and 1000', 'limit', limit);
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw new ValidationError('Offset must be a non-negative number', 'offset', offset);
    }

    // Repositories bound to this request's graph; never the global store.
    const { eventRepository, arcRepository } = await req.container.graphScopedRepositories(
      requireGraphId(req)
    );
    
    const timeline: TimelineView = {
      events: includeEvents === 'true'
        ? (await eventRepository.findByTimeRange(timeRange, parsedLimit, parsedOffset)).map(e => e.toJSON())
        : [],
      arcs: includeArcs === 'true'
        ? (await arcRepository.findOverlappingArcs(timeRange, parsedLimit, parsedOffset)).map(a => a.toJSON())
        : [],
      granularity: granularity as string,
      timeRange
    };

    res.json({
      success: true,
      data: timeline,
      filters: {
        timeRange: { startTime, endTime },
        granularity,
        includeArcs: includeArcs === 'true',
        includeEvents: includeEvents === 'true'
      },
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /temporal/validate-event - Validate if an event can exist within specified arcs
 */
temporalRoutes.post('/validate-event', ...entityPermission('read:events'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { eventId, arcIds } = req.body;
    
    if (!eventId || !arcIds || !Array.isArray(arcIds)) {
      throw new ValidationError(
        'eventId and arcIds (array) are required',
        undefined,
        req.body,
        ['eventId', 'arcIds'].filter(field => !req.body[field])
      );
    }

    // Get event
    const { eventRepository } = await req.container.graphScopedRepositories(requireGraphId(req));
    const event = await eventRepository.findById(eventId);
    
    if (!event) {
      throw new NotFoundError(`Event with ID ${eventId} not found`, 'Event', eventId);
    }

    // Get arcs
    const { arcRepository } = await req.container.graphScopedRepositories(requireGraphId(req));
    const arcs = await Promise.all(
      arcIds.map(async (arcId: string) => {
        const arc = await arcRepository.findById(arcId);
        if (!arc) {
          throw new NotFoundError(`Arc with ID ${arcId} not found`, 'Arc', arcId);
        }
        return arc;
      })
    );

    // Validate temporal constraints through the graph-scoped service, which is
    // built from this request's repositories rather than the global store.
    const { temporalService } = await req.container.graphScopedRepositories(requireGraphId(req));
    const validations = arcs.map(arc => ({
      arc: arc.toJSON(),
      isValid: temporalService.validateEventInArc(event, arc),
      timestamp: event.timestamp,
      arcTimeRange: {
        start: arc.start_time,
        end: arc.end_time
      }
    }));

    res.json({
      success: true,
      data: {
        event: event.toJSON(),
        validations,
        overallValid: validations.every(v => v.isValid)
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /temporal/validate-arc-nesting - Validate arc hierarchy nesting
 */
temporalRoutes.post('/validate-arc-nesting', ...entityPermission('read:arcs'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { parentArcId, childArcId } = req.body;
    
    if (!parentArcId || !childArcId) {
      throw new ValidationError(
        'parentArcId and childArcId are required',
        undefined,
        req.body,
        ['parentArcId', 'childArcId'].filter(field => !req.body[field])
      );
    }

    // Get arcs
    const { arcRepository } = await req.container.graphScopedRepositories(requireGraphId(req));
    const parentArc = await arcRepository.findById(parentArcId);
    const childArc = await arcRepository.findById(childArcId);
    
    if (!parentArc) {
      throw new NotFoundError(`Parent arc with ID ${parentArcId} not found`, 'Arc', parentArcId);
    }
    if (!childArc) {
      throw new NotFoundError(`Child arc with ID ${childArcId} not found`, 'Arc', childArcId);
    }

    // Validate nesting through the graph-scoped service.
    const { temporalService } = await req.container.graphScopedRepositories(requireGraphId(req));
    const isValid = temporalService.validateArcNesting(parentArc, childArc);

    res.json({
      success: true,
      data: {
        parent: parentArc.toJSON(),
        child: childArc.toJSON(),
        isValid,
        parentTimeRange: {
          start: parentArc.start_time,
          end: parentArc.end_time
        },
        childTimeRange: {
          start: childArc.start_time,
          end: childArc.end_time
        }
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /temporal/overlaps - Find overlapping arcs within a time range
 */
temporalRoutes.get('/overlaps', ...entityPermission('read:events', 'read:arcs'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      startTime,
      endTime,
      level,
      limit = '50',
      offset = '0'
    } = req.query;

    // Validate time range
    if (!startTime || !endTime) {
      throw new ValidationError('startTime and endTime are required', 'timeRange', { startTime, endTime });
    }

    const timeRange: TimeRange = {
      start: new Date(startTime as string),
      end: new Date(endTime as string)
    };

    if (isNaN(timeRange.start.getTime()) || isNaN(timeRange.end.getTime())) {
      throw new ValidationError('Invalid date format for startTime or endTime', 'timeRange', { startTime, endTime });
    }

    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      throw new ValidationError('Limit must be a number between 1 and 1000', 'limit', limit);
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw new ValidationError('Offset must be a non-negative number', 'offset', offset);
    }

    let parsedLevel: number | undefined;
    if (level !== undefined) {
      parsedLevel = parseInt(level as string, 10);
      if (isNaN(parsedLevel) || parsedLevel < 0) {
        throw new ValidationError('Level must be a non-negative integer', 'level', level);
      }
    }

    // Use the graph-scoped arc repository directly
    const { arcRepository } = await req.container.graphScopedRepositories(requireGraphId(req));
    let overlaps = await arcRepository.findOverlappingArcs(timeRange, parsedLimit, parsedOffset);
    
    // Filter by level if specified
    if (parsedLevel !== undefined) {
      overlaps = overlaps.filter(arc => arc.level === parsedLevel);
    }

    res.json({
      success: true,
      data: overlaps,
      filters: {
        timeRange: { startTime, endTime },
        level: parsedLevel
      },
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /temporal/gaps - Find temporal gaps between events or arcs
 */
temporalRoutes.get('/gaps', ...entityPermission('read:events', 'read:arcs'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      startTime,
      endTime,
      minGapDuration = '3600000', // 1 hour in milliseconds
      type = 'events', // 'events' or 'arcs'
      limit = '20',
      offset = '0'
    } = req.query;

    // Validate time range
    if (!startTime || !endTime) {
      throw new ValidationError('startTime and endTime are required', 'timeRange', { startTime, endTime });
    }

    const timeRange: TimeRange = {
      start: new Date(startTime as string),
      end: new Date(endTime as string)
    };

    if (isNaN(timeRange.start.getTime()) || isNaN(timeRange.end.getTime())) {
      throw new ValidationError('Invalid date format for startTime or endTime', 'timeRange', { startTime, endTime });
    }

    const parsedMinGapDuration = parseInt(minGapDuration as string, 10);
    if (isNaN(parsedMinGapDuration) || parsedMinGapDuration < 0) {
      throw new ValidationError('Min gap duration must be a non-negative number in milliseconds', 'minGapDuration', minGapDuration);
    }

    if (!['events', 'arcs'].includes(type as string)) {
      throw new ValidationError('Type must be "events" or "arcs"', 'type', type);
    }

    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new ValidationError('Limit must be a number between 1 and 100', 'limit', limit);
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw new ValidationError('Offset must be a non-negative number', 'offset', offset);
    }

    // Simple gap analysis - would need more sophisticated implementation
    const gaps = {
      gaps: [],
      note: 'Temporal gap analysis not fully implemented - would require additional service methods',
      parameters: { timeRange, minGapDuration: parsedMinGapDuration, type }
    };

    res.json({
      success: true,
      data: gaps,
      filters: {
        timeRange: { startTime, endTime },
        minGapDuration: parsedMinGapDuration,
        type
      },
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /temporal/density - Get temporal density analysis
 */
temporalRoutes.get('/density', ...entityPermission('read:events', 'read:arcs'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      startTime,
      endTime,
      granularity = 'day', // 'hour', 'day', 'week', 'month'
      type = 'events' // 'events', 'arcs', or 'both'
    } = req.query;

    // Validate time range
    if (!startTime || !endTime) {
      throw new ValidationError('startTime and endTime are required', 'timeRange', { startTime, endTime });
    }

    const timeRange: TimeRange = {
      start: new Date(startTime as string),
      end: new Date(endTime as string)
    };

    if (isNaN(timeRange.start.getTime()) || isNaN(timeRange.end.getTime())) {
      throw new ValidationError('Invalid date format for startTime or endTime', 'timeRange', { startTime, endTime });
    }

    // Validate granularity
    const validGranularities = ['hour', 'day', 'week', 'month'];
    if (!validGranularities.includes(granularity as string)) {
      throw new ValidationError(`Granularity must be one of: ${validGranularities.join(', ')}`, 'granularity', granularity);
    }

    // Validate type
    const validTypes = ['events', 'arcs', 'both'];
    if (!validTypes.includes(type as string)) {
      throw new ValidationError(`Type must be one of: ${validTypes.join(', ')}`, 'type', type);
    }

    // Basic density calculation using this graph's repositories
    const { eventRepository, arcRepository } = await req.container.graphScopedRepositories(
      requireGraphId(req)
    );
    
    const density: DensityView = { granularity: granularity as string, timeRange, type: type as string };
    
    if (type === 'events' || type === 'both') {
      const events = await eventRepository.findByTimeRange(timeRange);
      density.eventCount = events.length;
      density.eventDensity = events.length / ((timeRange.end.getTime() - timeRange.start.getTime()) / (24 * 60 * 60 * 1000)); // events per day
    }
    
    if (type === 'arcs' || type === 'both') {
      const arcs = await arcRepository.findOverlappingArcs(timeRange);
      density.arcCount = arcs.length;
    }

    res.json({
      success: true,
      data: density,
      filters: {
        timeRange: { startTime, endTime },
        granularity,
        type
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /temporal/constraints - Check temporal constraints for the entire graph
 */
temporalRoutes.get('/constraints', ...entityPermission('read:events', 'read:arcs'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { includeDetails = 'false' } = req.query;

    // Basic constraint validation
    const constraints = {
      valid: true,
      note: 'Comprehensive constraint validation not yet implemented - would require additional service methods',
      includeDetails: includeDetails === 'true'
    };

    res.json({
      success: true,
      data: constraints,
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});