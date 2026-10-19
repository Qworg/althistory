/**
 * Export API Routes
 * 
 * Endpoints for exporting graph data and managing export jobs.
 * Uses dependency injection via the container pattern.
 */

import { Router, Response, NextFunction, RequestHandler } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {
  RequestWithContainer,
  authenticate,
  requireAuth,
  authorize,
  rateLimit,
  authorizeGraphAccess,
  requireGraphId,
  resolveGraphContext,
  asRequestHandler,
} from '../middleware';
import { 
  CreateExportJobRequest, 
  JobStatusResponse,
  ExportFilters,
} from '../../models/AsyncJob';
import { AlthistoryExport, ExportOptions } from '../../services/ExportService';
import type { AsyncJob } from '../../models/AsyncJob';
import { ValidationError, NotFoundError } from '../../utils/errors';

export const exportRoutes = Router();

/**
 * Auth/permission middleware for the export routes, mirroring the pattern used
 * by `batch.ts` and `keys.ts`: 401 for anonymous callers, 403 when the key
 * lacks the `export` permission.
 */
const exportAuth: RequestHandler[] = [
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('export') as RequestHandler,
  rateLimit() as RequestHandler,
];

/**
 * POST /export/jobs - Create a new export job
 */
exportRoutes.post(
  '/jobs',
  ...exportAuth,
  resolveGraphContext(),
  asRequestHandler(authorizeGraphAccess((req) => requireGraphId(req))),
  async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.jobService;

    const request = parseExportBody(req.body, requireGraphId(req));

    const result = await service.createExportJob(request);

    res.status(202).json({
      success: true,
      data: result,
      message: 'Export job created',
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /export - Export a graph (design §Export API)
 *
 * Query: `graphId`, `version`, `scope=full|filtered`, `includeProvenance`,
 * `filters[...]`.
 *
 * Req 5.4 makes the mode depend on size: at or below the entity threshold the
 * export is returned inline as the export document, above it the request
 * creates the async job the requirement asks for and answers 202 with the job
 * id. One GET for callers who should not have to choose; `POST /export/sync`
 * and `POST /export/jobs` remain the explicit variants.
 */
exportRoutes.get(
  '/',
  ...exportAuth,
  resolveGraphContext(),
  asRequestHandler(authorizeGraphAccess((req) => requireGraphId(req))),
  async (req: RequestWithContainer, res: Response, next: NextFunction) => {
    try {
      const graphId = requireGraphId(req);
      const request = parseExportQuery(req.query, graphId);
      const service = req.container.exportService;

      const { entityCount, useAsync } = await service.shouldUseAsyncExport(request);

      if (useAsync) {
        const job = await req.container.jobService.createExportJob(request);
        res.status(202).json({
          success: true,
          data: { ...job, entityCount },
          message:
            `Export has ${entityCount} entities, above the ${service.asyncExportThreshold}-entity ` +
            'synchronous limit; an export job was created',
          requestId: req.requestId,
        });
        return;
      }

      const result = await service.exportGraph(request);

      // The design specifies the export document itself, not an envelope: the
      // body is the downloaded file.
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="export_${graphId}_v${result.export.metadata.graphVersion}.json"`
      );
      res.send(JSON.stringify(result.export));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /export/jobs - List export jobs
 */
exportRoutes.get('/jobs', ...exportAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.jobService;

    const { status, limit = '50', offset = '0' } = req.query;

    const parsedLimit = Math.min(parseInt(limit as string, 10) || 50, 100);
    const parsedOffset = parseInt(offset as string, 10) || 0;

    let statusFilter = status as string | undefined;
    if (statusFilter && !['pending', 'processing', 'completed', 'failed', 'cancelled'].includes(statusFilter)) {
      statusFilter = undefined;
    }

    const jobs = await service.getJobs({
      type: 'export',
      status: statusFilter as 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | undefined,
    });

    // A key restricted to some graphs must not enumerate, download or delete
    // jobs that were created for another graph.
    const accessibleJobs = jobs.filter((job) => canAccessJobGraph(req, job));

    // Apply pagination
    const paginatedJobs = accessibleJobs.slice(parsedOffset, parsedOffset + parsedLimit);
    const responseJobs: JobStatusResponse[] = paginatedJobs.map(job => ({
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      result: job.result,
      error: job.error,
    }));

    res.json({
      success: true,
      data: responseJobs,
      pagination: {
        total: accessibleJobs.length,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: parsedOffset + paginatedJobs.length < accessibleJobs.length,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /export/jobs/:jobId - Get export job status
 */
exportRoutes.get('/jobs/:jobId', ...exportAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.jobService;

    const { jobId } = req.params;
    const job = await service.getJob(jobId);

    if (!job) {
      throw new NotFoundError('Export job not found', 'Job', jobId);
    }

    assertJobGraphAccess(req, job);

    const response: JobStatusResponse = {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      result: job.result,
      error: job.error,
    };

    res.json({
      success: true,
      data: response,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /export/jobs/:jobId - Cancel or delete an export job
 */
exportRoutes.delete('/jobs/:jobId', ...exportAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.jobService;

    const { jobId } = req.params;
    const job = await service.getJob(jobId);

    if (!job) {
      throw new NotFoundError('Export job not found', 'Job', jobId);
    }

    assertJobGraphAccess(req, job);

    // If pending/processing, cancel it; otherwise delete it
    if (job.status === 'pending' || job.status === 'processing') {
      await service.cancelJob(jobId);
      res.json({
        success: true,
        message: 'Export job cancelled',
        requestId: req.requestId,
      });
    } else {
      await service.deleteJob(jobId);
      res.json({
        success: true,
        message: 'Export job deleted',
        requestId: req.requestId,
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * GET /export/jobs/:jobId/download - Download the export file
 */
exportRoutes.get('/jobs/:jobId/download', ...exportAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.jobService;

    const { jobId } = req.params;
    const job = await service.getJob(jobId);

    if (!job) {
      throw new NotFoundError('Export job not found', 'Job', jobId);
    }

    assertJobGraphAccess(req, job);

    if (job.status !== 'completed') {
      throw new ValidationError(`Export job is not completed (status: ${job.status})`, 'status', job.status);
    }

    const filePath = await service.getExportFilePath(jobId);
    if (!filePath) {
      throw new NotFoundError('Export file not found', 'File', jobId);
    }

    // Check file exists
    try {
      await fs.promises.access(filePath);
    } catch {
      throw new NotFoundError('Export file not found', 'File', filePath);
    }

    // Get filename for download
    const filename = path.basename(filePath);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    const stream = fs.createReadStream(filePath);
    
    // Handle stream errors with proper cleanup
    stream.on('error', (streamError) => {
      stream.destroy();
      if (!res.headersSent) {
        next(streamError);
      }
    });
    
    // Clean up stream on client disconnect
    res.on('close', () => {
      if (!stream.destroyed) {
        stream.destroy();
      }
    });
    
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /export/sync - Synchronous export for small graphs
 * Returns the export data directly instead of creating a job
 */
exportRoutes.post(
  '/sync',
  ...exportAuth,
  resolveGraphContext(),
  asRequestHandler(authorizeGraphAccess((req) => requireGraphId(req))),
  async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.exportService;

    const request = parseExportBody(req.body, requireGraphId(req));
    const version = request.version;
    const exportOptions = {
      graphId: request.graphId,
      scope: request.scope,
      filters: request.filters,
      includeProvenance: request.includeProvenance ?? false,
      version,
    };

    // Req 5.4: the trigger is the entity count, not the byte estimate. A graph
    // can be over the limit while serialising small, and the synchronous path
    // is bounded by the work it does as well as the response it writes.
    const { entityCount, useAsync } = await service.shouldUseAsyncExport(exportOptions);
    if (useAsync) {
      throw new ValidationError(
        `Export has ${entityCount} entities, above the ${service.asyncExportThreshold}-entity synchronous limit. Use POST /export/jobs or GET /export instead.`,
        'entityCount',
        entityCount
      );
    }

    // Check estimated size - only allow sync for small exports
    const estimatedSize = await service.estimateExportSize({
      graphId: requireGraphId(req),
      scope: request.scope,
      filters: request.filters,
      includeProvenance: request.includeProvenance ?? false,
      version,
    });

    const maxSyncSize = 5 * 1024 * 1024; // 5MB
    if (estimatedSize > maxSyncSize) {
      throw new ValidationError(
        `Export too large for synchronous export (${Math.round(estimatedSize / 1024)}KB). Use async job endpoint instead.`,
        'size',
        estimatedSize
      );
    }

    const result = await service.exportGraph({
      graphId: requireGraphId(req),
      scope: request.scope,
      filters: request.filters,
      includeProvenance: request.includeProvenance ?? false,
      version,
    });

    res.json({
      success: true,
      data: result.export,
      size: result.size,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /export/validate - Validate an export file
 */
exportRoutes.post('/validate', ...exportAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.exportService;

    const exportData = req.body as AlthistoryExport;

    if (!exportData || typeof exportData !== 'object') {
      throw new ValidationError('Request body must be a valid export object', 'body');
    }

    const result = service.validateExport(exportData);

    res.json({
      success: true,
      data: result,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /export/stats - Get export job statistics
 *
 * Counted from the jobs this key may see, not from the store-wide totals: a
 * key restricted to one graph must not be able to infer how much work exists on
 * the others, and the store-wide figures also include import and ingest rows.
 */
exportRoutes.get('/stats', ...exportAuth, async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = req.container.jobService;

    const jobs = (await service.getJobs({ type: 'export' })).filter((job) =>
      canAccessJobGraph(req, job)
    );

    const countBy = (status: string): number =>
      jobs.filter((job) => job.status === status).length;

    res.json({
      success: true,
      data: {
        export: {
          total: jobs.length,
          pending: countBy('pending'),
          processing: countBy('processing'),
          completed: countBy('completed'),
          failed: countBy('failed'),
        },
      },
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

// Helper functions

/**
 * Reconcile the legacy body `graphId` with the resolved request scope.
 *
 * `X-Graph-Id` (resolved by `resolveGraphContext` and read back through
 * `requireGraphId`) is the single source of truth for which graph a request is
 * about. A body `graphId` is still accepted for callers that predate the
 * header, but it must agree with the resolved scope: a contradiction is a 400
 * rather than a silent re-scope, because authorisation has already been checked
 * against the resolved graph. An omitted body id is not a contradiction — the
 * header supplies it.
 */
function reconcileGraphId(request: CreateExportJobRequest, resolvedGraphId: string): void {
  const bodyGraphId: unknown = request.graphId;

  if (bodyGraphId === undefined || bodyGraphId === '') {
    request.graphId = resolvedGraphId;
    return;
  }

  if (bodyGraphId !== resolvedGraphId) {
    throw new ValidationError(
      `graphId '${String(bodyGraphId)}' in the request body contradicts the resolved graph scope '${resolvedGraphId}'`,
      'graphId',
      bodyGraphId
    );
  }
}

function validateFilters(filters: ExportFilters): void {
  if (filters.timeRange) {
    const start = new Date(filters.timeRange.start);
    const end = new Date(filters.timeRange.end);
    
    if (isNaN(start.getTime())) {
      throw new ValidationError('Invalid start date in timeRange', 'filters.timeRange.start', filters.timeRange.start);
    }
    if (isNaN(end.getTime())) {
      throw new ValidationError('Invalid end date in timeRange', 'filters.timeRange.end', filters.timeRange.end);
    }
    if (start > end) {
      throw new ValidationError('Start date must be before end date', 'filters.timeRange');
    }
  }

  if (filters.actors && !Array.isArray(filters.actors)) {
    throw new ValidationError('Actors must be an array', 'filters.actors');
  }

  if (filters.targets && !Array.isArray(filters.targets)) {
    throw new ValidationError('Targets must be an array', 'filters.targets');
  }

  if (filters.arcIds && !Array.isArray(filters.arcIds)) {
    throw new ValidationError('Arc IDs must be an array', 'filters.arcIds');
  }

  if (filters.eventIds && !Array.isArray(filters.eventIds)) {
    throw new ValidationError('Event IDs must be an array', 'filters.eventIds');
  }
}

/**
 * Whether the calling key may see a job.
 *
 * A key with `export` permission but a restricted `allowedGraphs` list must not
 * be able to list, fetch, download or delete another graph's export. Only
 * export jobs are visible here at all: import and ingest rows live in the same
 * store but are not this router's resource, so answering for them would leak
 * another subsystem's results. The check fails closed when no key is attached —
 * `exportAuth` makes that unreachable, but a future auth change must not turn
 * these routes into an anonymous listing.
 */
function canAccessJobGraph(req: RequestWithContainer, job: AsyncJob): boolean {
  if (job.type !== 'export') return false;
  if (!('graphId' in job.parameters)) return false;

  const apiKey = req.apiKey;
  return apiKey !== undefined && apiKey.canAccessGraph(job.parameters.graphId);
}

/**
 * Reject access to a job outside the key's graphs with the same 404 as a
 * missing job: a 403 would confirm that the id exists.
 */
function assertJobGraphAccess(req: RequestWithContainer, job: AsyncJob): void {
  if (!canAccessJobGraph(req, job)) {
    throw new NotFoundError('Export job not found', 'Job', job.id);
  }
}

/**
 * Validate a POST export body once, so `POST /export/jobs` and
 * `POST /export/sync` accept exactly the same inputs and reject the same ones.
 *
 * The GET parser below applies the identical scope/filter/version rules, and
 * both share `normalizeFilters`, so a value that is a 400 as a query parameter
 * is a 400 as a body field too.
 */
function parseExportBody(
  body: unknown,
  resolvedGraphId: string
): CreateExportJobRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object', 'body');
  }

  const request = { ...(body as CreateExportJobRequest) };

  // The resolved request scope is authoritative; a body graphId may only
  // agree with it (see `reconcileGraphId`).
  reconcileGraphId(request, resolvedGraphId);

  // The design makes `scope` required in a POST body (only the GET query has a
  // default), so an omitted scope is a client error rather than an implicit
  // full export.
  if (request.scope === undefined) {
    throw new ValidationError('Scope must be "full" or "filtered"', 'scope');
  }

  const scope = parseScope(request.scope);
  const includeProvenance = parseBoolean(request.includeProvenance, 'includeProvenance') ?? false;
  const filters =
    request.filters === undefined ? undefined : normalizeFilters(request.filters);
  const version = parseVersion(request.version);

  if (scope === 'filtered' && !filters) {
    throw new ValidationError('Filters are required when scope is "filtered"', 'filters');
  }
  if (scope === 'full' && filters) {
    throw new ValidationError(
      'Filters are only applied when scope is "filtered"',
      'filters'
    );
  }
  if (filters) {
    validateFilters(filters);
  }

  return {
    ...request,
    graphId: resolvedGraphId,
    scope,
    filters,
    includeProvenance,
    version,
  };
}

/**
 * Normalise a filters value from either a query string or a JSON body.
 *
 * Accepting a non-object here was the "acknowledged filter, exported
 * everything" bug in a new form: `{"scope":"filtered","filters":"x"}` passed a
 * validation that only checked array-typed keys, and `applyFilters` then
 * matched every entity.
 */
function normalizeFilters(value: unknown): ExportFilters {
  if (typeof value === 'string') {
    // Query-string form: a JSON-encoded object.
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ValidationError(
        'filters must be a JSON object or bracket-notation query parameters',
        'filters'
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ValidationError('filters must be a JSON object', 'filters');
    }
    return asExportFilters(parsed as Record<string, unknown>);
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return asExportFilters(value as Record<string, unknown>);
  }

  throw new ValidationError('filters must be an object', 'filters');
}

/**
 * Turn `GET /export`'s query string into the same request shape the POST routes
 * take, so the entity-count rule and the export service see one contract.
 *
 * `graphId` follows the `reconcileGraphId` rule used by the body variants: it is
 * optional, but when present it must agree with the resolved scope.
 */
function parseExportQuery(
  query: RequestWithContainer['query'],
  resolvedGraphId: string
): ExportOptions {
  const rawGraphId = query.graphId;
  if (rawGraphId !== undefined && typeof rawGraphId !== 'string') {
    throw new ValidationError('graphId must be a single value', 'graphId');
  }
  if (rawGraphId !== undefined && rawGraphId !== '' && rawGraphId !== resolvedGraphId) {
    throw new ValidationError(
      `graphId '${rawGraphId}' in the query contradicts the resolved graph scope '${resolvedGraphId}'`,
      'graphId',
      rawGraphId
    );
  }

  const scope = parseScope(query.scope);
  const includeProvenance = parseBoolean(query.includeProvenance, 'includeProvenance') ?? false;
  const filters = query.filters === undefined ? undefined : normalizeFilters(query.filters);
  const version = parseVersion(query.version);

  if (scope === 'filtered' && !filters) {
    throw new ValidationError('Filters are required when scope is "filtered"', 'filters');
  }
  if (scope === 'full' && filters) {
    // `exportGraph` only applies predicates when the scope says filtered, so
    // accepting filters here would acknowledge them and then export everything.
    throw new ValidationError(
      'Filters are only applied when scope is "filtered"',
      'filters'
    );
  }
  if (filters) {
    validateFilters(filters);
  }

  return { graphId: resolvedGraphId, scope, filters, includeProvenance, version };
}

/**
 * `version` pins the export to a committed graph version. Absent means the
 * latest, which is also the only case `countEntities` can answer from metadata.
 */
function parseVersion(value: unknown): number | undefined {
  if (value === undefined) return undefined;

  // A JSON body may carry a number; a query string is digits only. `Number()`
  // would otherwise accept `0x10`, `1e2`, `0b1` and `+1`.
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new ValidationError('version must be a non-negative integer', 'version', value);
  }

  return numeric;
}

function parseScope(value: unknown): 'full' | 'filtered' {
  if (value === undefined) return 'full';
  if (value === 'full' || value === 'filtered') return value;
  throw new ValidationError('Scope must be "full" or "filtered"', 'scope', value);
}

function parseBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ValidationError(`${name} must be true or false`, name, value);
}

/**
 * Accept both encodings the design implies: bracket notation
 * (`filters[actors]=a,b`, parsed by Express's query parser) and a JSON-encoded
 * `filters={"actors":["a"]}` string. List values may be a repeat/array or a
 * comma-separated string. Shared by the query and body parsers.
 */
function asExportFilters(raw: Record<string, unknown>): ExportFilters {
  const actors = toStringList(raw.actors, 'actors');
  const targets = toStringList(raw.targets, 'targets');
  const arcIds = toStringList(raw.arcIds, 'arcIds');
  const eventIds = toStringList(raw.eventIds, 'eventIds');
  const timeRange = toTimeRange(raw.timeRange);

  return {
    ...(actors ? { actors } : {}),
    ...(targets ? { targets } : {}),
    ...(arcIds ? { arcIds } : {}),
    ...(eventIds ? { eventIds } : {}),
    ...(timeRange ? { timeRange } : {}),
  };
}

function toStringList(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;

  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : null;

  if (!list) {
    throw new ValidationError(`${name} must be a string or an array of strings`, name, value);
  }

  const strings = list.map((item) => {
    if (typeof item !== 'string') {
      throw new ValidationError(`${name} must contain only strings`, name, item);
    }
    return item.trim();
  }).filter((item) => item.length > 0);

  return strings.length > 0 ? strings : undefined;
}

function toTimeRange(value: unknown): ExportFilters['timeRange'] | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(
      'filters[timeRange] must provide start and end',
      'filters.timeRange'
    );
  }

  const range = value as Record<string, unknown>;
  if (typeof range.start !== 'string' || typeof range.end !== 'string') {
    throw new ValidationError(
      'filters[timeRange] must provide string start and end values',
      'filters.timeRange'
    );
  }

  return { start: range.start, end: range.end };
}
