/**
 * Graph Management API Routes
 * 
 * Endpoints for managing multiple graphs, versions, branching, and merging.
 * Uses dependency injection via the container pattern.
 */

import { Router, Response, NextFunction, RequestHandler } from 'express';
import {
  RequestWithContainer,
  AuthenticatedRequest,
  authenticate,
  requireAuth,
  authorize,
  rateLimit,
  authorizeGraphAccess,
} from '../middleware';
import {
  CreateGraphRequest,
  UpdateGraphRequest,
  BranchGraphRequest,
  MergeGraphRequest,
  IGraph,
  findInvalidManualResolutions,
} from '../../models/Graph';
import type { CopyResult as GraphCopyResult, EntityFilter } from '../../services/GraphCopyService';
import { ValidationError } from '../../utils/errors';

export const graphRoutes = Router();

/**
 * Auth/permission middleware shared by the graph routes, mirroring the pattern
 * used by `batch.ts` and `keys.ts`: `authenticate` resolves the API key,
 * `requireAuth` answers 401 for anonymous callers and `authorize` answers 403
 * for authenticated callers that lack the permission.
 */
const readGraphsAuth: RequestHandler[] = [
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('read:graphs') as RequestHandler,
  rateLimit() as RequestHandler,
];

const writeGraphsAuth: RequestHandler[] = [
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('write:graphs') as RequestHandler,
  rateLimit() as RequestHandler,
];

/**
 * Scope a graph-id route to the graphs the API key is allowed to access. The
 * graph id is always the `:id` path parameter, except for the copy-status route
 * which uses `:copyId`.
 */
const graphIdFromParams = (req: AuthenticatedRequest): string | undefined => req.params?.id;
const copyIdFromParams = (req: AuthenticatedRequest): string | undefined => req.params?.copyId;

const readGraphAuth = [
  ...readGraphsAuth,
  authorizeGraphAccess(graphIdFromParams) as RequestHandler,
];

const writeGraphAuth = [
  ...writeGraphsAuth,
  authorizeGraphAccess(graphIdFromParams) as RequestHandler,
];

/**
 * Request body accepted by POST /graphs/copy. `sourceGraphId` is optional: the
 * copy modal copies the graph the user is currently looking at and does not
 * send a source id, so the active graph is used when it is omitted.
 */
interface CopyGraphRequest {
  targetName?: string;
  description?: string;
  sourceGraphId?: string;
  copyType?: 'full' | 'time_range' | 'filtered';
  timeRange?: { start?: string; end?: string };
  filter?: EntityFilter;
}

/**
 * Map the synchronous GraphCopyService result onto the copy-job shape the
 * frontend `CopyResult` type expects. The service is synchronous, so a copy is
 * `completed` or `failed` the moment the request returns; `id` is the target
 * graph id so the client can poll `GET /graphs/copy/:id`.
 */
function toCopyResponse(targetGraph: IGraph, result: GraphCopyResult) {
  return {
    id: targetGraph.id,
    name: targetGraph.name,
    status: result.success ? ('completed' as const) : ('failed' as const),
    progress: result.success ? 100 : 0,
    created_at: targetGraph.createdAt,
    completed_at: new Date().toISOString(),
    ...(result.success ? {} : { error_message: (result.errors || []).join('; ') }),
    sourceGraphId: result.sourceGraphId,
    targetGraphId: targetGraph.id,
    copiedNodes: result.copiedNodes,
    copiedRelationships: result.copiedRelationships,
    duration: result.duration,
  };
}

/**
 * GET /graphs - List all graphs
 */
graphRoutes.get('/', ...readGraphsAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.graphService;

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
graphRoutes.post('/', ...writeGraphsAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.graphService;

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
 * POST /graphs/copy - Copy a graph (the active one by default) into a new graph
 *
 * The multi-graph copy modal creates a synchronous copy, so this route creates
 * the target graph, delegates the data copy to the already-registered
 * `GraphCopyService`, and returns a copy-job-shaped payload. Its `id` is the
 * target graph id, which the client then polls through GET /graphs/copy/:id.
 */
graphRoutes.post(
  '/copy',
  ...writeGraphsAuth,
  authorizeGraphAccess((req) => (req as AuthenticatedRequest).body?.sourceGraphId) as RequestHandler,
  async (req: RequestWithContainer, res: Response, next: NextFunction) => {
    try {
      const graphService = req.container.graphService;
      const copyService = req.container.graphCopyService;
      const request = req.body as CopyGraphRequest;

      const targetName = typeof request.targetName === 'string' ? request.targetName.trim() : '';
      if (targetName.length === 0) {
        throw new ValidationError('Target graph name is required', 'targetName');
      }

      const copyType = request.copyType ?? 'full';
      if (!['full', 'time_range', 'filtered'].includes(copyType)) {
        throw new ValidationError('Copy type must be one of: full, time_range, filtered', 'copyType', copyType);
      }

      let sourceGraphId = request.sourceGraphId;
      if (sourceGraphId) {
        await graphService.getGraph(sourceGraphId);
      } else {
        const activeGraph = await graphService.getActiveGraph();
        if (!activeGraph) {
          throw new ValidationError('No active graph available to copy', 'sourceGraphId');
        }
        sourceGraphId = activeGraph.id;
      }

      const targetGraph = await graphService.createGraph({
        name: targetName,
        description: request.description,
      });

      let result: GraphCopyResult;
      if (copyType === 'time_range') {
        const start = request.timeRange?.start;
        const end = request.timeRange?.end;
        if (!start || !end) {
          throw new ValidationError('timeRange.start and timeRange.end are required for a time_range copy', 'timeRange');
        }
        const startDate = new Date(start);
        const endDate = new Date(end);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          throw new ValidationError('timeRange.start and timeRange.end must be valid dates', 'timeRange');
        }
        result = await copyService.copyByTimeRange(sourceGraphId, { start: startDate, end: endDate }, targetGraph.id);
      } else if (copyType === 'filtered') {
        if (!request.filter) {
          throw new ValidationError('filter is required for a filtered copy', 'filter');
        }
        result = await copyService.copyByEntityFilter(sourceGraphId, request.filter, targetGraph.id);
      } else {
        result = await copyService.copyFullGraph(sourceGraphId, targetGraph.id);
      }

      res.status(201).json({
        success: true,
        data: toCopyResponse(targetGraph, result),
        message: result.success ? 'Graph copy completed successfully' : 'Graph copy completed with errors',
        requestId: req.requestId,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /graphs/copy/:copyId - Report the status of a copy operation
 *
 * Copy is synchronous, so once the target graph exists the operation is done.
 * The copy id returned by POST /graphs/copy is the target graph id.
 */
graphRoutes.get(
  '/copy/:copyId',
  ...readGraphsAuth,
  authorizeGraphAccess(copyIdFromParams) as RequestHandler,
  async (req: RequestWithContainer, res: Response, next: NextFunction) => {
    try {
      const graph = await req.container.graphService.getGraph(req.params.copyId);

      res.json({
        success: true,
        data: {
          id: graph.id,
          name: graph.name,
          status: 'completed',
          progress: 100,
          created_at: graph.createdAt,
          completed_at: graph.updatedAt,
        },
        requestId: req.requestId,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /graphs/active - Get the currently active graph
 */
graphRoutes.get('/active', ...readGraphsAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.graphService;

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
graphRoutes.get('/:id', ...readGraphAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.graphService;

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
graphRoutes.put('/:id', ...writeGraphAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.graphService;

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
graphRoutes.delete('/:id', ...writeGraphAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.graphService;

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
graphRoutes.post('/:id/activate', ...writeGraphAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.graphService;

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
graphRoutes.get('/:id/versions', ...readGraphAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.graphService;

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
graphRoutes.post('/:id/rollback/:version', ...writeGraphAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.graphService;

    const version = parseInt(req.params.version, 10);

    if (isNaN(version) || version < 0) {
      throw new ValidationError('Version must be a non-negative integer', 'version', req.params.version);
    }

    const versionRef = await service.rollbackGraph(req.params.id, version);

    // The client stores the response as the graph detail, so return the graph's
    // post-rollback state (plus the version record) rather than the version
    // record alone.
    const graph = await service.getGraph(req.params.id);

    res.json({
      success: true,
      data: graph,
      version: versionRef,
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
graphRoutes.post('/:id/branch', ...writeGraphAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.graphService;

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
 * GET /graphs/:id/branches - List graphs created as branches of this graph
 */
graphRoutes.get('/:id/branches', ...readGraphAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.graphService;

    // 404 when the source graph does not exist, rather than returning an empty
    // list for an unknown id.
    await service.getGraph(req.params.id);

    // GraphRepository has no parent filter, so list the graphs (the API caps
    // listings at 1000) and select the ones branched from this graph.
    const result = await service.listGraphs({ limit: 1000, offset: 0 });
    const branches = result.graphs.filter((graph) => graph.parentGraphId === req.params.id);

    res.json({
      success: true,
      data: branches,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /graphs/:id/merge - Merge a source graph into this graph
 *
 * A merge reads the source graph (its entities land in the target, and a
 * conflict report quotes them), so the key must be allowed the source as well
 * as the target.
 */
graphRoutes.post(
  '/:id/merge',
  ...writeGraphAuth,
  authorizeGraphAccess((req) => (req as AuthenticatedRequest).body?.sourceGraphId) as RequestHandler,
  async (req: RequestWithContainer, res: Response, next: NextFunction) => {
    try {
      const service = req.container.graphService;

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

      if (request.dryRun !== undefined && typeof request.dryRun !== 'boolean') {
        throw new ValidationError('dryRun must be a boolean', 'dryRun', request.dryRun);
      }

      // The route validates the values as well as the service, because a service
      // that is only safe when its one caller validates is not safe. An invalid
      // value must be rejected here rather than reach the merge's keep-target
      // fallback.
      const invalidManualResolutions = findInvalidManualResolutions(request.manualResolutions);
      if (invalidManualResolutions.length > 0) {
        throw new ValidationError(
          'manualResolutions values must be "keep-source", "keep-target", or { strategy: "merged", value: { ... } }',
          'manualResolutions',
          request.manualResolutions,
          invalidManualResolutions.map(key => `manualResolutions[${key}] is not a valid resolution`)
        );
      }

      const result = await service.mergeGraph(req.params.id, request);

      if (!result.success) {
        res.status(409).json({
          success: false,
          conflicts: result.conflicts,
          anomalies: result.anomalies,
          message: 'Merge has conflicts or validation anomalies that need resolution',
          requestId: req.requestId,
        });
        return;
      }

      res.json({
        success: true,
        data: result.mergedGraph,
        newVersion: result.newVersion,
        conflicts: result.conflicts,
        anomalies: result.anomalies,
        // Present (and true) only for a preview, so a client that asked for a dry
        // run can tell it apart from a commit even when there were no conflicts.
        dryRun: result.dryRun === true,
        message: result.dryRun === true ? 'Merge preview generated' : 'Merge completed successfully',
        requestId: req.requestId,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /graphs/:id/data - Get the full data for a graph
 */
graphRoutes.get('/:id/data', ...readGraphAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.graphService;

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
graphRoutes.post('/:id/gc', ...writeGraphAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.graphService;

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
