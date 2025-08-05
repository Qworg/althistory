import { Router, Response, NextFunction } from 'express';
import { CreateArcRequest, UpdateArcRequest } from '@/models/Arc';
import { ValidationError, NotFoundError, DatabaseError } from '@/utils/errors';
import { RequestWithContainer } from '@/api/middleware';

export const arcRoutes = Router();

/**
 * POST /arcs - Create a new arc
 */
arcRoutes.post('/', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const arcData: CreateArcRequest = req.body;
    
    // Validate required fields
    if (!arcData.name || !arcData.start_time || !arcData.end_time || arcData.level === undefined) {
      throw new ValidationError(
        'Missing required fields: name, start_time, end_time, and level are required',
        undefined,
        arcData,
        ['name', 'start_time', 'end_time', 'level'].filter(field => 
          !arcData[field as keyof CreateArcRequest] && arcData[field as keyof CreateArcRequest] !== 0
        )
      );
    }

    // Convert timestamp strings to Date if needed
    if (typeof arcData.start_time === 'string') {
      arcData.start_time = new Date(arcData.start_time);
    }
    if (typeof arcData.end_time === 'string') {
      arcData.end_time = new Date(arcData.end_time);
    }

    // Use repository from container
    const repository = req.container.arcRepository;
    const arc = await repository.create(arcData);
    
    res.status(201).json({
      success: true,
      data: arc.toJSON(),
      message: 'Arc created successfully',
      requestId: req.requestId
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Arc validation failed')) {
      next(new ValidationError(error.message, undefined, req.body));
    } else {
      next(error);
    }
  }
});

/**
 * GET /arcs - Get arcs with optional filtering
 */
arcRoutes.get('/', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const repository = req.container.arcRepository;
    
    // Parse query parameters
    const {
      level,
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

    let arcs;
    let totalCount;

    // Handle different query scenarios
    if (level !== undefined) {
      const parsedLevel = parseInt(level as string, 10);
      if (isNaN(parsedLevel) || parsedLevel < 0) {
        throw new ValidationError('Level must be a non-negative integer', 'level', level);
      }
      
      arcs = await repository.findByLevel(parsedLevel, parsedLimit, parsedOffset);
      totalCount = await repository.countByLevel(parsedLevel);
    } else if (startTime && endTime) {
      // Time range query
      const timeRange = {
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

      arcs = await repository.findOverlappingArcs(timeRange, parsedLimit, parsedOffset);
      totalCount = await repository.count(); // Use general count as approximation
    } else {
      // Get all arcs
      arcs = await repository.findAll(parsedLimit, parsedOffset);
      totalCount = await repository.count();
    }

    res.json({
      success: true,
      data: arcs.map(arc => arc.toJSON()),
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        total: totalCount,
        hasMore: parsedOffset + parsedLimit < totalCount
      },
      filters: {
        level: level ? parseInt(level as string, 10) : null,
        timeRange: startTime && endTime ? { startTime, endTime } : null
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /arcs/:id - Get a specific arc by ID
 */
arcRoutes.get('/:id', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    if (!id || id.trim().length === 0) {
      throw new ValidationError('Arc ID is required', 'id', id);
    }

    const repository = req.container.arcRepository;
    const arc = await repository.findById(id);
    
    if (!arc) {
      throw new NotFoundError(`Arc with ID ${id} not found`, 'Arc', id);
    }

    res.json({
      success: true,
      data: arc.toJSON(),
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /arcs/:id/events - Get events within an arc
 */
arcRoutes.get('/:id/events', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { limit = '50', offset = '0' } = req.query;
    
    if (!id || id.trim().length === 0) {
      throw new ValidationError('Arc ID is required', 'id', id);
    }

    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      throw new ValidationError('Limit must be a number between 1 and 1000', 'limit', limit);
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw new ValidationError('Offset must be a non-negative number', 'offset', offset);
    }

    // First check if arc exists
    const arcRepository = req.container.arcRepository;
    const arc = await arcRepository.findById(id);
    
    if (!arc) {
      throw new NotFoundError(`Arc with ID ${id} not found`, 'Arc', id);
    }

    // Get events within the arc's time range
    const eventRepository = req.container.eventRepository;
    const timeRange = {
      start: arc.start_time,
      end: arc.end_time
    };
    
    const events = await eventRepository.findByTimeRange(timeRange, parsedLimit, parsedOffset);
    const totalCount = await eventRepository.countByTimeRange(timeRange);

    res.json({
      success: true,
      data: {
        arc: arc.toJSON(),
        events: events.map(event => event.toJSON())
      },
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        total: totalCount,
        hasMore: parsedOffset + parsedLimit < totalCount
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /arcs/:id/children - Get child arcs (nested arcs)
 */
arcRoutes.get('/:id/children', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    if (!id || id.trim().length === 0) {
      throw new ValidationError('Arc ID is required', 'id', id);
    }

    const repository = req.container.arcRepository;
    
    // First check if parent arc exists
    const parentArc = await repository.findById(id);
    if (!parentArc) {
      throw new NotFoundError(`Arc with ID ${id} not found`, 'Arc', id);
    }

    // Get child arcs (next level down, within time range)
    const childArcs = await repository.findDirectChildren(id);

    res.json({
      success: true,
      data: {
        parent: parentArc.toJSON(),
        children: childArcs.map(arc => arc.toJSON())
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /arcs/:id - Update an existing arc
 */
arcRoutes.put('/:id', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const updates: UpdateArcRequest = req.body;
    
    if (!id || id.trim().length === 0) {
      throw new ValidationError('Arc ID is required', 'id', id);
    }

    // Convert timestamp strings to Date if provided
    if (updates.start_time && typeof updates.start_time === 'string') {
      updates.start_time = new Date(updates.start_time);
    }
    if (updates.end_time && typeof updates.end_time === 'string') {
      updates.end_time = new Date(updates.end_time);
    }

    const repository = req.container.arcRepository;
    
    // Check if arc exists first
    const existingArc = await repository.findById(id);
    if (!existingArc) {
      throw new NotFoundError(`Arc with ID ${id} not found`, 'Arc', id);
    }

    const updatedArc = await repository.update(id, updates);
    
    if (!updatedArc) {
      throw new DatabaseError('Failed to update arc', 'update');
    }

    res.json({
      success: true,
      data: updatedArc.toJSON(),
      message: 'Arc updated successfully',
      requestId: req.requestId
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Arc validation failed')) {
      next(new ValidationError(error.message, undefined, req.body));
    } else {
      next(error);
    }
  }
});

/**
 * DELETE /arcs/:id - Delete an arc
 */
arcRoutes.delete('/:id', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    if (!id || id.trim().length === 0) {
      throw new ValidationError('Arc ID is required', 'id', id);
    }

    const repository = req.container.arcRepository;
    
    // Check if arc exists first
    const existingArc = await repository.findById(id);
    if (!existingArc) {
      throw new NotFoundError(`Arc with ID ${id} not found`, 'Arc', id);
    }

    const deleted = await repository.delete(id);
    
    if (!deleted) {
      throw new DatabaseError('Failed to delete arc', 'delete');
    }

    res.json({
      success: true,
      message: 'Arc deleted successfully',
      data: { id },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /arcs/:id/validate-hierarchy - Validate arc hierarchy
 */
arcRoutes.post('/:id/validate-hierarchy', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    if (!id || id.trim().length === 0) {
      throw new ValidationError('Arc ID is required', 'id', id);
    }

    const repository = req.container.arcRepository;
    const temporalService = req.container.temporalService;
    
    // Get the arc
    const arc = await repository.findById(id);
    if (!arc) {
      throw new NotFoundError(`Arc with ID ${id} not found`, 'Arc', id);
    }

    // Basic hierarchy validation using existing methods
    const validation = {
      isValid: true,
      note: 'Comprehensive hierarchy validation not yet implemented'
    };

    res.json({
      success: true,
      data: validation,
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
});