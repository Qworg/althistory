/**
 * Generation routes: `generate timeline`, `branch` and `expand` as the app's own
 * cancellable jobs (issue 23).
 *
 *   POST /api/generate/timeline        start a timeline (an alternate history or an invented world)
 *   POST /api/generate/branch          start a branch of a graph at an event
 *   POST /api/generate/expand          start an expansion of a graph, arc or window
 *   GET  /api/generate/jobs            the key's jobs
 *   GET  /api/generate/jobs/:id        one job: status, progress, and its result when done
 *   POST /api/generate/jobs/:id/cancel stop a job before its next write
 *
 * A start answers `202` with the job, which is already running. The job writes
 * as it goes and announces what it writes on the live change feed; its result
 * says whether a model or the template wrote the events (`source`).
 *
 * Who may start one. A key needs the `generate` permission, or every write
 * permission the run makes use of (`write:graphs`, `write:events`, `write:arcs`
 * and `write:relationships` for a timeline or branch; `write:events` and
 * `write:arcs` for an expansion), and must be allowed the graph a branch or expansion works on.
 * The model key is the app's: a request may choose the provider and model, never
 * supply a key. Starts are rate-limited like every authenticated route, and also
 * capped per key and app-wide (see `GenerationJobService`); a refused start is a
 * `429` with `Retry-After`.
 *
 * A job belongs to the key that started it: another key's job answers 404, as
 * ingestion's review jobs do. Reading and cancelling a job are not charged to
 * the request rate limit, because a client polls a job every second or so.
 */

import { Router, type RequestHandler, type Response } from 'express';
import {
  type AuthenticatedRequest,
  asyncHandler,
  authenticate,
  authorizeGraphAccess,
  rateLimit,
  requireAuth,
  requireGraphId,
  resolveGraphContext,
} from '../middleware';
import { getContainer } from '@/container';
import { CLIError } from '@/cli/utils/exitCodes';
import { TimelineGenerator } from '@/cli/generator/TimelineGenerator';
import type {
  GenerateBranchOptions,
  GenerateExpandOptions,
  GenerateTimelineOptions,
} from '@/cli/types';
import { NotFoundError, ValidationError } from '@/utils/errors';
import type { Permission } from '@/models/ApiKey';
import {
  GenerationLimitError,
  type GenerationKind,
  type GenerationRequest,
  type ModelChoice,
} from '@/services/GenerationJobService';

export const generateRoutes = Router();

/** The permissions a kind of generation makes use of, besides `generate` itself. */
const WRITES_OF: Record<GenerationKind, Permission[]> = {
  timeline: ['write:graphs', 'write:events', 'write:arcs', 'write:relationships'],
  branch: ['write:graphs', 'write:events', 'write:arcs', 'write:relationships'],
  expand: ['write:events', 'write:arcs'],
};

/**
 * `generate`, or every write the run makes. Either is enough: a key that may
 * write all of what a run writes gains nothing by being refused the shortcut.
 */
function authorizeGeneration(kind: GenerationKind): RequestHandler {
  return (req, res, next) => {
    const key = (req as AuthenticatedRequest).apiKey;
    if (key && (key.hasPermission('generate') || key.hasAllPermissions(WRITES_OF[kind]))) {
      next();
      return;
    }
    res.status(403).json({
      error: {
        message:
          `Generating needs the 'generate' permission, or all of: ${WRITES_OF[kind].join(', ')}`,
        timestamp: new Date().toISOString(),
        path: req.path,
        requestId: (req as AuthenticatedRequest).requestId || 'unknown',
      },
    });
  };
}

const authenticated: RequestHandler[] = [authenticate as RequestHandler, requireAuth as RequestHandler];
const startRate = rateLimit() as RequestHandler;

function ownerOf(req: AuthenticatedRequest): { keyId: string; name?: string } {
  const key = req.apiKey;
  if (!key?.id) throw new Error('Generation routes require an authenticated API key with an id');
  return { keyId: key.id, name: key.name };
}

// --- Reading the request body ------------------------------------------------

type Body = Record<string, unknown>;

function bodyOf(req: AuthenticatedRequest): Body {
  const body: unknown = req.body;
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Body) : {};
}

function readString(body: Body, field: string, max = 2000): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`, field);
  if (value.length > max) throw new ValidationError(`${field} is at most ${max} characters`, field);
  return value;
}

function readInteger(body: Body, field: string): number | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${field} must be a non-negative integer`, field);
  }
  return value;
}

function readBoolean(body: Body, field: string): boolean | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new ValidationError(`${field} must be true or false`, field);
  return value;
}

/** The model a request asks for: a provider and a model name, never a key. */
function readModel(body: Body): ModelChoice {
  const provider = readString(body, 'provider', 20);
  if (provider !== undefined && provider !== 'openai' && provider !== 'anthropic') {
    throw new ValidationError('provider must be "openai" or "anthropic"', 'provider');
  }
  const model = readString(body, 'model', 100);
  if (model !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model)) {
    throw new ValidationError('model is not a model name', 'model');
  }
  const temperature = body.temperature;
  if (temperature !== undefined && temperature !== null) {
    if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw new ValidationError('temperature must be a number from 0 to 2', 'temperature');
    }
  }
  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(typeof temperature === 'number' ? { temperature } : {}),
  };
}

/** A body's own graph id must agree with the graph the request resolved to. */
function checkNamedGraph(body: Body, field: string, resolved: string): void {
  const named = readString(body, field, 200);
  if (named !== undefined && named !== resolved) {
    throw new ValidationError(`${field} does not match the graph the request is scoped to (X-Graph-Id)`, field, named);
  }
}

// --- Starting a job -----------------------------------------------------------

function start(
  req: AuthenticatedRequest,
  res: Response,
  request: GenerationRequest,
  model: ModelChoice
): void {
  try {
    const job = getContainer().generationJobService.start(request, ownerOf(req), model);
    res.status(202).location(`/api/generate/jobs/${job.id}`).json(job);
  } catch (error) {
    if (error instanceof GenerationLimitError) {
      res
        .status(429)
        .set('Retry-After', String(error.retryAfterSeconds))
        .json({
          error: {
            message: error.message,
            retryAfter: error.retryAfterSeconds,
            timestamp: new Date().toISOString(),
            path: req.path,
            requestId: req.requestId || 'unknown',
          },
        });
      return;
    }
    throw error;
  }
}

generateRoutes.post(
  '/timeline',
  ...authenticated,
  authorizeGeneration('timeline'),
  startRate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = bodyOf(req);
    const style = readString(body, 'style', 20);
    if (style !== undefined && style !== 'academic' && style !== 'narrative' && style !== 'concise') {
      throw new ValidationError('style must be "academic", "narrative" or "concise"', 'style');
    }
    const calendar = body.calendar;
    if (calendar !== undefined && calendar !== null && (typeof calendar !== 'object' || Array.isArray(calendar))) {
      throw new ValidationError('calendar must be an object', 'calendar');
    }
    const model = readModel(body);
    const options: GenerateTimelineOptions = {
      premise: readString(body, 'premise'),
      divergencePoint: readString(body, 'divergencePoint'),
      world: readString(body, 'world'),
      ...(calendar ? { calendar: calendar as GenerateTimelineOptions['calendar'] } : {}),
      startDate: readString(body, 'startDate', 200),
      endDate: readString(body, 'endDate', 200),
      eventCount: readInteger(body, 'eventCount'),
      depth: readInteger(body, 'depth'),
      ...(style ? { style } : {}),
      ...model,
      graphName: readString(body, 'graphName', 200),
      dryRun: readBoolean(body, 'dryRun') ?? false,
    };
    // A request that cannot run is refused here, before a job exists.
    try {
      new TimelineGenerator().checkTimelineRequest(options);
    } catch (error) {
      if (error instanceof CLIError) throw new ValidationError(error.message);
      throw error;
    }
    start(req, res, { kind: 'timeline', options }, model);
  })
);

generateRoutes.post(
  '/branch',
  ...authenticated,
  authorizeGeneration('branch'),
  startRate,
  resolveGraphContext() as RequestHandler,
  authorizeGraphAccess((req) => requireGraphId(req)) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = bodyOf(req);
    const sourceGraphId = requireGraphId(req);
    checkNamedGraph(body, 'sourceGraphId', sourceGraphId);
    const divergeAtEventId = readString(body, 'divergeAtEventId', 200);
    const counterfactualPrompt = readString(body, 'counterfactualPrompt');
    const branchName = readString(body, 'branchName', 200);
    if (!divergeAtEventId) throw new ValidationError('divergeAtEventId is required', 'divergeAtEventId');
    if (!counterfactualPrompt?.trim()) {
      throw new ValidationError('counterfactualPrompt is required', 'counterfactualPrompt');
    }
    if (!branchName?.trim()) throw new ValidationError('branchName is required', 'branchName');

    // The point of divergence has to exist in the source graph.
    const { eventRepository } = await getContainer().graphScopedRepositories(sourceGraphId);
    if (!(await eventRepository.findById(divergeAtEventId))) {
      throw new NotFoundError(`Event '${divergeAtEventId}' not found in graph '${sourceGraphId}'`, 'event', divergeAtEventId);
    }

    const model = readModel(body);
    const options: GenerateBranchOptions = {
      sourceGraphId,
      divergeAtEventId,
      counterfactualPrompt,
      branchName,
      eventCount: readInteger(body, 'eventCount'),
      ...(model.provider ? { provider: model.provider } : {}),
      ...(model.model ? { model: model.model } : {}),
      dryRun: readBoolean(body, 'dryRun') ?? false,
    };
    start(req, res, { kind: 'branch', options }, model);
  })
);

generateRoutes.post(
  '/expand',
  ...authenticated,
  authorizeGeneration('expand'),
  startRate,
  resolveGraphContext() as RequestHandler,
  authorizeGraphAccess((req) => requireGraphId(req)) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = bodyOf(req);
    const graphId = requireGraphId(req);
    checkNamedGraph(body, 'graphId', graphId);
    const model = readModel(body);
    const options: GenerateExpandOptions = {
      graphId,
      arcId: readString(body, 'arcId', 200),
      timeWindow: readString(body, 'timeWindow', 400),
      eventCount: readInteger(body, 'eventCount'),
      ...(model.provider ? { provider: model.provider } : {}),
      ...(model.model ? { model: model.model } : {}),
      dryRun: readBoolean(body, 'dryRun') ?? false,
    };
    start(req, res, { kind: 'expand', options }, model);
  })
);

// --- Reading and cancelling jobs ---------------------------------------------

generateRoutes.get(
  '/jobs',
  ...authenticated,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    res.status(200).json({ jobs: getContainer().generationJobService.list(ownerOf(req).keyId) });
  })
);

generateRoutes.get(
  '/jobs/:id',
  ...authenticated,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const job = getContainer().generationJobService.get(req.params.id, ownerOf(req).keyId);
    if (!job) throw new NotFoundError('Generation job not found', 'generationJob', req.params.id);
    res.status(200).json(job);
  })
);

generateRoutes.post(
  '/jobs/:id/cancel',
  ...authenticated,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const job = getContainer().generationJobService.cancel(req.params.id, ownerOf(req).keyId);
    if (!job) throw new NotFoundError('Generation job not found', 'generationJob', req.params.id);
    res.status(200).json(job);
  })
);
