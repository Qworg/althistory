import { Router, Response, NextFunction } from 'express';
import { CreateEventRequest, UpdateEventRequest, TimeRange } from '@/models/Event';
import { ValidationError, NotFoundError, DatabaseError } from '@/utils/errors';
import { RequestWithContainer, requireGraphId, resolveGraphContext } from '@/api/middleware';

export const eventRoutes = Router();

// Scope every route in this group to exactly one graph. `resolveGraphContext`
// resolves X-Graph-Id (falling back to the active graph) and attaches the graph
// id; the handlers below read it through the checked `requireGraphId` accessor
// so a routing change that drops the mount fails loudly instead of reading an
// unscoped value.
eventRoutes.use(resolveGraphContext());

/**
 * POST /events - Create a new event
 */
eventRoutes.post('/', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const eventData: CreateEventRequest = req.body;
    
    // Validate required fields
    if (!eventData.description || !eventData.actor || !eventData.target || !eventData.timestamp) {
      throw new ValidationError(
        'Missing required fields: description, actor, target, and timestamp are required',
        undefined,
        eventData,
        ['description', 'actor', 'target', 'timestamp'].filter(field => !eventData[field as keyof CreateEventRequest])
      );
    }

    // Convert timestamp string to Date if needed
    if (typeof eventData.timestamp === 'string') {
      eventData.timestamp = new Date(eventData.timestamp);
    }

    // Repositories bound to this request's graph; never the global store.
    const { eventRepository: repository } = await req.container.graphScopedRepositories(requireGraphId(req));
    const event = await repository.create(eventData);

    // Mirror the write into the active graph's version store so version history
    // and ExportService see UI-created events (not only imported ones).
    await req.container.graphWriteVersioningService.recordEvent(requireGraphId(req), event, 'create');
    
    res.status(201).json({
      success: true,
      data: event.toJSON(),
      message: 'Event created successfully',
      requestId: req.requestId
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Event validation failed')) {
      next(new ValidationError(error.message, undefined, req.body));
    } else {
      next(error);
    }
  }
});

/**
 * GET /events - Get events with optional filtering
 */
eventRoutes.get('/', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    // Repositories bound to this request's graph; never the global store.
    const { eventRepository: repository } = await req.container.graphScopedRepositories(requireGraphId(req));
    
    // Parse query parameters
    const {
      actor,
      target,
      startTime,
      endTime,
      limit = '50',
      offset = '0'
    } = req.query;

    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);

    // Validate pagination parameters
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      throw new ValidationError('Limit must be a number between 1 and 1000', 'limit', limit);
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw new ValidationError('Offset must be a non-negative number', 'offset', offset);
    }

    let events;
    let totalCount;

    // Handle different query scenarios
    if (startTime && endTime) {
      // Time range query
      const timeRange: TimeRange = {
        start: new Date(startTime as string),
        end: new Date(endTime as string)
      };

      // Validate time range
      if (isNaN(timeRange.start.getTime()) || isNaN(timeRange.end.getTime())) {
        throw new ValidationError('Invalid date format for startTime or endTime', 'timeRange', { startTime, endTime });
      }

      if (timeRange.start >= timeRange.end) {
        throw new ValidationError('startTime must be before endTime', 'timeRange', { startTime, endTime });
      }

      if (actor) {
        // Actor + time range query
        events = await repository.findByActorAndTimeRange(actor as string, timeRange, parsedLimit, parsedOffset);
        totalCount = await repository.countByTimeRange(timeRange); // Approximate count
      } else {
        // Time range only
        events = await repository.findByTimeRange(timeRange, parsedLimit, parsedOffset);
        totalCount = await repository.countByTimeRange(timeRange);
      }
    } else if (actor) {
      // Actor query
      events = await repository.findByActor(actor as string, parsedLimit, parsedOffset);
      totalCount = await repository.countByActor(actor as string);
    } else if (target) {
      // Target query
      events = await repository.findByTarget(target as string, parsedLimit, parsedOffset);
      totalCount = await repository.count(); // Approximate count
    } else {
      // Get all events
      events = await repository.findAll(parsedLimit, parsedOffset);
      totalCount = await repository.count();
    }

    res.json({
      success: true,
      data: events.map(event => event.toJSON()),
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        total: totalCount,
        hasMore: parsedOffset + parsedLimit < totalCount
      },
      filters: {
        actor: actor || null,
        target: target || null,
        timeRange: startTime && endTime ? { startTime, endTime } : null
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /events/stats/count - Get total count of events with optional filters
 */
eventRoutes.get('/stats/count', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const { eventRepository: repository } = await req.container.graphScopedRepositories(requireGraphId(req));
    const { actor, startTime, endTime } = req.query;

    let count;
    
    if (startTime && endTime) {
      const timeRange: TimeRange = {
        start: new Date(startTime as string),
        end: new Date(endTime as string)
      };

      if (isNaN(timeRange.start.getTime()) || isNaN(timeRange.end.getTime())) {
        throw new ValidationError('Invalid date format for startTime or endTime', 'timeRange', { startTime, endTime });
      }

      count = await repository.countByTimeRange(timeRange);
    } else if (actor) {
      count = await repository.countByActor(actor as string);
    } else {
      count = await repository.count();
    }

    res.json({
      success: true,
      data: { count },
      filters: {
        actor: actor || null,
        timeRange: startTime && endTime ? { startTime, endTime } : null
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /events/:id - Get a specific event by ID
 */
eventRoutes.get('/:id', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    if (!id || id.trim().length === 0) {
      throw new ValidationError('Event ID is required', 'id', id);
    }

    const { eventRepository: repository } = await req.container.graphScopedRepositories(requireGraphId(req));
    const event = await repository.findById(id);
    
    if (!event) {
      throw new NotFoundError(`Event with ID ${id} not found`, 'Event', id);
    }

    res.json({
      success: true,
      data: event.toJSON(),
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /events/:id - Update an existing event
 */
eventRoutes.put('/:id', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const updates: UpdateEventRequest = req.body;
    
    if (!id || id.trim().length === 0) {
      throw new ValidationError('Event ID is required', 'id', id);
    }

    // Convert timestamp string to Date if provided
    if (updates.timestamp && typeof updates.timestamp === 'string') {
      updates.timestamp = new Date(updates.timestamp);
    }

    const { eventRepository: repository } = await req.container.graphScopedRepositories(requireGraphId(req));
    
    // Check if event exists first
    const existingEvent = await repository.findById(id);
    if (!existingEvent) {
      throw new NotFoundError(`Event with ID ${id} not found`, 'Event', id);
    }

    const updatedEvent = await repository.update(id, updates);
    
    if (!updatedEvent) {
      throw new DatabaseError('Failed to update event', 'update');
    }

    await req.container.graphWriteVersioningService.recordEvent(requireGraphId(req), updatedEvent, 'update');

    res.json({
      success: true,
      data: updatedEvent.toJSON(),
      message: 'Event updated successfully',
      requestId: req.requestId
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Event validation failed')) {
      next(new ValidationError(error.message, undefined, req.body));
    } else {
      next(error);
    }
  }
});

/**
 * DELETE /events/:id - Delete an event
 */
eventRoutes.delete('/:id', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    if (!id || id.trim().length === 0) {
      throw new ValidationError('Event ID is required', 'id', id);
    }

    const { eventRepository: repository } = await req.container.graphScopedRepositories(requireGraphId(req));
    
    // Check if event exists first
    const existingEvent = await repository.findById(id);
    if (!existingEvent) {
      throw new NotFoundError(`Event with ID ${id} not found`, 'Event', id);
    }

    const deleted = await repository.delete(id);
    
    if (!deleted) {
      throw new DatabaseError('Failed to delete event', 'delete');
    }

    await req.container.graphWriteVersioningService.recordDeletion(requireGraphId(req), 'event', id);

    res.json({
      success: true,
      message: 'Event deleted successfully',
      data: { id },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});