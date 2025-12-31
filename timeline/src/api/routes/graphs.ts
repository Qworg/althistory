/**
 * Graph Management API Routes
 * 
 * Endpoints for managing multiple graphs, versions, branching, and merging.
 */

import { Router, Response, NextFunction } from 'express';
import { RequestWithContainer } from '../middleware';
import {
  CreateGraphRequest,
  UpdateGraphRequest,
  BranchGraphRequest,
  MergeGraphRequest,
} from '../../models/Graph';
import { GraphService } from '../../services/GraphService';
import { ValidationError, NotFoundError } from '../../utils/errors';
import { AppConfig } from '../../utils/config';

export const graphRoutes = Router();

// GraphService instance (initialized lazily)
let graphService: GraphService | null = null;

function getGraphService(config: AppConfig): GraphService {
  if (!graphService) {
    graphService = new GraphService({
      dataDir: config.localExecution.dataDirectory,
    });
  }
  return graphService;
}

/**
 * GET /graphs - List all graphs
 */
graphRoutes.get('/', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getGraphService(req.container.config);
    await service.initialize();

    const { status, limit = '50', offset = '0' } = req.query;

    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      throw new ValidationError('Limit must be a number between 1 and 1000', 'limit', limit);
    }

    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw new ValidationError('Offset must be a non-negative number', 'offset', offset);
    }

    const result = await service.listGraphs({
      status: status as 'active' | 'archived' | 'deleted' | undefined,
      limit: parsedLimit,
      offset: parsedOffset,
    });

    res.json({
      success: true,
      data: result.graphs,
      pagination: {
        total: result.total,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: parsedOffset + result.graphs.length < result.total,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /graphs - Create a new graph
 */
graphRoutes.post('/', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getGraphService(req.container.config);
    await service.initialize();

    const request: CreateGraphRequest = req.body;

    if (!request.name || request.name.trim().length === 0) {
      throw new ValidationError('Graph name is required', 'name');
    }

    const graph = await service.createGraph(request);

    res.status(201).json({
      success: true,
      data: graph,
      message: 'Graph created successfully',
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /graphs/active - Get the currently active graph
 */
graphRoutes.get('/active', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getGraphService(req.container.config);
    await service.initialize();

    const graph = await service.getActiveGraph();

    if (!graph) {
      res.json({
        success: true,
        data: null,
        message: 'No active graph',
        requestId: req.requestId,
      });
      return;
    }

    res.json({
      success: true,
      data: graph,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /graphs/:id - Get a specific graph
 */
graphRoutes.get('/:id', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getGraphService(req.container.config);
    await service.initialize();

    const graph = await service.getGraph(req.params.id);

    res.json({
      success: true,
      data: graph,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /graphs/:id - Update a graph
 */
graphRoutes.put('/:id', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getGraphService(req.container.config);
    await service.initialize();

    const request: UpdateGraphRequest = req.body;
    const graph = await service.updateGraph(req.params.id, request);

    res.json({
      success: true,
      data: graph,
      message: 'Graph updated successfully',
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /graphs/:id - Soft delete a graph
 */
graphRoutes.delete('/:id', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getGraphService(req.container.config);
    await service.initialize();

    await service.deleteGraph(req.params.id);

    res.json({
      success: true,
      message: 'Graph deleted successfully',
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /graphs/:id/activate - Set a graph as the active graph
 */
graphRoutes.post('/:id/activate', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getGraphService(req.container.config);
    await service.initialize();

    await service.setActiveGraph(req.params.id);

    res.json({
      success: true,
      message: 'Graph activated successfully',
      activeGraphId: req.params.id,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /graphs/:id/versions - Get version history for a graph
 */
graphRoutes.get('/:id/versions', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getGraphService(req.container.config);
    await service.initialize();

    const { limit = '50', offset = '0' } = req.query;

    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      throw new ValidationError('Limit must be a number between 1 and 1000', 'limit', limit);
    }

    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw new ValidationError('Offset must be a non-negative number', 'offset', offset);
    }

    const result = await service.getVersionHistory(req.params.id, parsedLimit, parsedOffset);

    res.json({
      success: true,
      data: result.versions,
      pagination: {
        total: result.total,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: parsedOffset + result.versions.length < result.total,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /graphs/:id/rollback/:version - Rollback to a specific version
 */
graphRoutes.post('/:id/rollback/:version', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getGraphService(req.container.config);
    await service.initialize();

    const version = parseInt(req.params.version, 10);

    if (isNaN(version) || version < 0) {
      throw new ValidationError('Version must be a non-negative integer', 'version', req.params.version);
    }

    const versionRef = await service.rollbackGraph(req.params.id, version);

    res.json({
      success: true,
      data: versionRef,
      message: `Rolled back to version ${version}`,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /graphs/:id/branch - Create a branch from a graph
 */
graphRoutes.post('/:id/branch', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getGraphService(req.container.config);
    await service.initialize();

    const request: BranchGraphRequest = req.body;

    if (!request.name || request.name.trim().length === 0) {
      throw new ValidationError('Branch name is required', 'name');
    }

    const branchGraph = await service.branchGraph(req.params.id, request);

    res.status(201).json({
      success: true,
      data: branchGraph,
      message: 'Branch created successfully',
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /graphs/:id/merge - Merge a source graph into this graph
 */
graphRoutes.post('/:id/merge', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getGraphService(req.container.config);
    await service.initialize();

    const request: MergeGraphRequest = req.body;

    if (!request.sourceGraphId) {
      throw new ValidationError('Source graph ID is required', 'sourceGraphId');
    }

    if (!request.conflictResolution || !['keep-target', 'keep-source', 'manual'].includes(request.conflictResolution)) {
      throw new ValidationError(
        'Conflict resolution must be one of: keep-target, keep-source, manual',
        'conflictResolution'
      );
    }

    const result = await service.mergeGraph(req.params.id, request);

    if (!result.success) {
      res.status(409).json({
        success: false,
        conflicts: result.conflicts,
        message: 'Merge has conflicts that need resolution',
        requestId: req.requestId,
      });
      return;
    }

    res.json({
      success: true,
      data: result.mergedGraph,
      newVersion: result.newVersion,
      message: 'Merge completed successfully',
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /graphs/:id/data - Get the full data for a graph
 */
graphRoutes.get('/:id/data', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getGraphService(req.container.config);
    await service.initialize();

    const { version } = req.query;

    let parsedVersion: number | undefined;
    if (version !== undefined) {
      parsedVersion = parseInt(version as string, 10);
      if (isNaN(parsedVersion) || parsedVersion < 0) {
        throw new ValidationError('Version must be a non-negative integer', 'version', version);
      }
    }

    const data = await service.getGraphData(req.params.id, parsedVersion);

    res.json({
      success: true,
      data: {
        events: Object.values(data.events),
        arcs: Object.values(data.arcs),
        relationships: Object.values(data.relationships),
        pressures: Object.values(data.pressures),
      },
      counts: {
        events: Object.keys(data.events).length,
        arcs: Object.keys(data.arcs).length,
        relationships: Object.keys(data.relationships).length,
        pressures: Object.keys(data.pressures).length,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /graphs/:id/gc - Run garbage collection on a graph
 */
graphRoutes.post('/:id/gc', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getGraphService(req.container.config);
    await service.initialize();

    const result = await service.gcGraph(req.params.id);

    res.json({
      success: true,
      data: result,
      message: `Garbage collection completed: removed ${result.removedObjects} objects, freed ${result.freedBytes} bytes`,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});
