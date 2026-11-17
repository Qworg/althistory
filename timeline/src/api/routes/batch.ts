/**
 * Batch operations API routes
 */

import { type WorldCalendarSet, compareAxisTime, toAxisTime } from '@althistory/calendar';
import { newDateMetadata, readRequestTime } from '../worldDates';
import { ValidationError } from '@/utils/errors';
import { Router, Request, Response, RequestHandler } from 'express';
import {
  AuthenticatedRequest,
  authenticate,
  requireAuth,
  authorize,
  rateLimit,
  authorizeGraphAccess,
  requireGraphId,
  resolveGraphContext,
  asyncHandler,
} from '../middleware';
import { Permission } from '@/models/ApiKey';
import { IEvent } from '@/models/Event';
import { IArc } from '@/models/Arc';
import type { EventRepository } from '@/repositories/EventRepository';
import type { ArcRepository } from '@/repositories/ArcRepository';
import { CausalService, StoredCausalRelationship } from '@/services/CausalService';
import { createLogger } from '@/utils/logger';
import { ArcHierarchyService, type ArcHierarchySession, type PlanStep } from '@/services/ArcHierarchyService';
import type { BatchLiveState, BatchStep } from '@/services/GraphWriteVersioningService';

const logger = createLogger('BatchRoutes');

/** A link as the batch routes name it: by its two events. */
interface LinkPair {
  cause_event_id: string;
  effect_event_id: string;
}

/** What a batch touched, to read back from the live store once it is done. */
class Touched {
  readonly events = new Set<string>();
  readonly arcs = new Set<string>();
  readonly links = new Map<string, LinkPair>();
  /** An event or a link was deleted: the version must read every head link (`BatchLiveState.deletesLinks`). */
  deletesLinks = false;
  /** The parent the arc hierarchy decided for each arc it wrote (`BatchLiveState.parents`). */
  parents?: ReadonlyMap<string, string | null>;

  link(pair: LinkPair): void {
    this.links.set(JSON.stringify([pair.cause_event_id, pair.effect_event_id]), {
      cause_event_id: pair.cause_event_id,
      effect_event_id: pair.effect_event_id,
    });
  }
}

/** The request graph's live store, as a batch reads back what it touched. */
interface LiveReaders {
  eventRepository?: Pick<EventRepository, 'findById'>;
  arcRepository?: Pick<ArcRepository, 'findById'>;
  causalService?: Pick<CausalService, 'getAllRelationships'>;
}

/**
 * Record a batch as one version of its graph, and announce it on the live feed.
 *
 * Every other entity write goes through the versioning bridge; a batch used to
 * write the live store alone, so a rollback, merge or branch (which rebuild the
 * live store from the version head) deleted what it wrote, and an export never
 * held it. What is recorded is what the live store holds once the batch is done,
 * read back entity by entity, so a step a failure or an atomic rollback undid,
 * or a rollback that itself failed, is versioned as it stands. The bridge also
 * makes the batch's one announcement per kind of change (`steps`).
 *
 * Any failure -- reading the store back, reading the head, committing -- is
 * announced as "(not versioned)" and rethrown, unless `undoOnFailure` says the
 * caller will undo the writes: then nothing is announced, because nothing
 * stays (the caller announces whatever its undo could not remove).
 */
async function versionBatch(
  req: Request,
  live: LiveReaders,
  touched: Touched,
  steps: BatchStep[],
  { undoOnFailure = false }: { undoOnFailure?: boolean } = {}
): Promise<void> {
  const graphId = requireGraphId(req);
  const versioning = req.container.graphWriteVersioningService;
  let state: BatchLiveState;
  try {
    state = await readBack(live, touched);
  } catch (error) {
    if (!undoOnFailure) versioning.announceBatch(graphId, steps, { notVersioned: true });
    throw error;
  }
  await versioning.recordBatch(graphId, state, steps, { announceIfNotVersioned: !undoOnFailure });
}

/** What the live store now holds of what a batch touched. */
async function readBack(live: LiveReaders, touched: Touched): Promise<BatchLiveState> {
  const { eventRepository, arcRepository, causalService } = live;
  const state: BatchLiveState = { deletesLinks: touched.deletesLinks, parents: touched.parents };
  if (touched.events.size > 0 && eventRepository) {
    state.events = new Map();
    for (const id of touched.events) state.events.set(id, await eventRepository.findById(id));
  }
  if (touched.arcs.size > 0 && arcRepository) {
    state.arcs = new Map();
    for (const id of touched.arcs) state.arcs.set(id, await arcRepository.findById(id));
  }
  if (touched.links.size > 0 && causalService) {
    const all = (await causalService.getAllRelationships()) as StoredCausalRelationship[];
    state.links = [...touched.links.values()].map((pair) => ({
      ...pair,
      live: all.filter((link) => link.cause_event_id === pair.cause_event_id && link.effect_event_id === pair.effect_event_id),
    }));
  }
  return state;
}

/**
 * Version what a batch left after it failed and undid itself (an abort, an
 * atomic transaction). The response is the documented 400 whatever happens
 * here: a versioning failure is logged and announced, and does not replace it.
 */
async function versionAfterFailure(req: Request, live: LiveReaders, touched: Touched, steps: BatchStep[]): Promise<void> {
  try {
    await versionBatch(req, live, touched, steps);
  } catch (error) {
    logger.error('Could not version what a failed batch left in the store', error, { graphId: requireGraphId(req) });
  }
}

/**
 * Undo a batch's writes because they could not be versioned. Nothing is
 * announced for what the undo removed; what it could not remove stays in the
 * store, unversioned, and is announced as such.
 */
async function undoUnversioned<T>(
  req: Request,
  type: BatchStep['type'],
  written: T[],
  remove: (entity: T) => Promise<unknown>,
  idOf: (entity: T) => string
): Promise<void> {
  const left: BatchStep[] = [];
  for (const entity of [...written].reverse()) {
    try {
      await remove(entity);
    } catch (rollbackError) {
      const id = idOf(entity);
      logger.error(`Compensating rollback failed for a batch ${type}`, rollbackError, { id });
      left.push({ operation: 'create', type, id });
    }
  }
  req.container.graphWriteVersioningService.announceBatch(requireGraphId(req), left.reverse(), { notVersioned: true });
}

function touchedOf(kind: 'events' | 'arcs', ids: string[]): Touched {
  const touched = new Touched();
  ids.forEach((id) => touched[kind].add(id));
  return touched;
}

/** The ids the live store still holds. */
async function stillPresent(ids: string[], find: (id: string) => Promise<unknown>): Promise<string[]> {
  const present: string[] = [];
  for (const id of ids) {
    // One it cannot read may still be there: count it, so it is not left unannounced.
    if (await find(id).catch(() => true)) present.push(id);
  }
  return present;
}

/**
 * Version and announce the events or arcs a batch created. As a single create
 * does (`POST /api/events`), a batch that cannot be versioned is undone in the
 * live store, and the error propagates.
 */
async function versionCreated(
  req: Request,
  kind: 'events' | 'arcs',
  created: string[],
  repository: Pick<EventRepository, 'findById' | 'delete'> | Pick<ArcRepository, 'findById' | 'delete'>
): Promise<void> {
  const type = kind === 'events' ? 'event' : 'arc';
  const live: LiveReaders = kind === 'events'
    ? { eventRepository: repository as Pick<EventRepository, 'findById'> }
    : { arcRepository: repository as Pick<ArcRepository, 'findById'> };
  try {
    await versionBatch(req, live, touchedOf(kind, created), created.map((id) => ({ operation: 'create', type, id })), { undoOnFailure: true });
  } catch (versionError) {
    await undoUnversioned(req, type, created, (id) => repository.delete(id), (id) => id);
    throw versionError;
  }
}

/** The writes a transaction's steps made, as the live feed announces them. */
function stepsOf(
  results: Array<{ type: string; success: boolean; id?: string }>,
  liveIds: ReadonlyMap<string, string> = new Map()
): BatchStep[] {
  return results.flatMap((step) => {
    if (!step.success || !step.id) return [];
    const kind = /^(create|update|delete)_(event|arc|relationship)$/.exec(step.type);
    if (!kind) return [];
    const id = kind[2] === 'relationship' ? (liveIds.get(step.id) ?? step.id) : step.id;
    return [{ operation: kind[1] as BatchStep['operation'], type: kind[2] as BatchStep['type'], id }];
  });
}

/**
 * The arc steps of a transaction, as the hierarchy plan runs them. Their dates
 * are read as the steps will read them (a date the plan cannot read is left
 * out of the plan, and the step itself fails on it).
 */
async function arcPlanSteps(operations: BatchOperation[], calendarOf: ReturnType<typeof calendarLookup>): Promise<PlanStep[]> {
  const dated = async (data: Record<string, unknown>): Promise<Record<string, unknown>> => {
    try {
      return await readStepDates(data, calendarOf, 'arc');
    } catch {
      const { start_time: _s, end_time: _e, ...rest } = data;
      return rest;
    }
  };
  const steps: PlanStep[] = [];
  for (const op of operations) {
    const data = (op.data ?? {}) as Record<string, unknown>;
    if (op.type === 'create_arc') steps.push({ kind: 'create', data: (await dated(data)) as never });
    else if (op.type === 'update_arc') {
      const { id, ...rest } = data;
      if (typeof id === 'string') steps.push({ kind: 'update', id, data: (await dated(rest)) as never });
    } else if (op.type === 'delete_arc' && typeof data.id === 'string') steps.push({ kind: 'delete', id: data.id });
  }
  return steps;
}

/**
 * What the arc hierarchy wrote beyond the steps the caller named (a subtree
 * that moved, children lifted by a delete, events a deleted arc let go of),
 * to read back for the version and to announce.
 */
function absorbArcMoves(touched: Touched, session: ArcHierarchySession, steps: BatchStep[]): BatchStep[] {
  session.arcIds().forEach((id) => touched.arcs.add(id));
  touched.parents = session.parents();
  session.eventIds().forEach((id) => touched.events.add(id));
  const named = new Set(steps.map((step) => `${step.type}:${step.id}`));
  const extra: BatchStep[] = [];
  for (const id of session.moved()) if (!named.has(`arc:${id}`)) extra.push({ operation: 'update', type: 'arc', id });
  for (const id of session.eventIds()) if (!named.has(`event:${id}`)) extra.push({ operation: 'update', type: 'event', id });
  return [...steps, ...extra];
}

/** Why an arc step that was fine on its own was not applied. */
const ARC_STEPS_TOGETHER = 'not applied: another arc step in this batch failed';

export const batchRoutes = Router();

/**
 * `CausalService` bound to the graph this request resolved to.
 *
 * The container exposes `graphScopedRepositories` but not yet a scoped causal
 * service, so build one from the same cached store those repositories use.
 * Binding it keeps batch relationship reads, writes and caches inside the
 * request's graph instead of the process-wide legacy store.
 */
async function graphScopedCausalService(req: Request): Promise<CausalService> {
  const store = await req.container.graphContextStore.getStore(requireGraphId(req));
  return new CausalService({ graphStore: store, graphId: requireGraphId(req) });
}

// Batch operation types
type ValidationMode = 'strict' | 'lenient' | 'skip';
type ErrorHandlingMode = 'abort' | 'skip' | 'collect';

interface BatchEventRequest {
  graphId: string;
  events: Array<Omit<IEvent, 'id' | 'created_at' | 'updated_at'>>;
  validation?: ValidationMode;
  onError?: ErrorHandlingMode;
}

interface BatchArcRequest {
  graphId: string;
  arcs: Array<Omit<IArc, 'id' | 'created_at' | 'updated_at'>>;
  validation?: ValidationMode;
  onError?: ErrorHandlingMode;
}

interface BatchRelationshipRequest {
  graphId: string;
  relationships: Array<{
    cause_event_id: string;
    effect_event_id: string;
    weight?: number;
    evidence?: string;
    confidence?: number;
    relationship_type?: 'direct' | 'indirect' | 'contributory';
  }>;
  validation?: ValidationMode;
  onError?: ErrorHandlingMode;
}

interface BatchOperation {
  type:
    | 'create_event'
    | 'create_arc'
    | 'update_event'
    | 'update_arc'
    | 'delete_event'
    | 'delete_arc'
    | 'create_relationship'
    | 'update_relationship'
    | 'delete_relationship';
  data: Record<string, unknown>;
}

interface BatchTransactionRequest {
  graphId: string;
  operations: BatchOperation[];
  atomic?: boolean;
}

interface BatchResult {
  success: boolean;
  created: string[];
  failed: Array<{ index: number; error: string }>;
  validationWarnings?: Array<{ index: number; warning: string }>;
}

interface TransactionResult {
  success: boolean;
  results: Array<{ index: number; type: string; id?: string; success: boolean; error?: string; warning?: string }>;
  rollbackPerformed?: boolean;
}

const MAX_BATCH_SIZE = 1000;

/**
 * Standard error response format for batch operations
 */
interface BatchErrorResponse {
  error: {
    code: string;
    message: string;
    details?: {
      failedIndex?: number;
      created?: string[];
      rolledBack?: string[];
      path?: string;
      timestamp?: string;
    };
  };
}

/**
 * Create standardized batch error response
 */
function createBatchError(
  code: string,
  message: string,
  details?: BatchErrorResponse['error']['details']
): BatchErrorResponse {
  return {
    error: {
      code,
      message,
      details: {
        ...details,
        timestamp: new Date().toISOString(),
      },
    },
  };
}

/**
 * Batch create events
 * POST /api/batch/events
 */
batchRoutes.post(
  '/events',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('write:events') as RequestHandler,
  rateLimit() as RequestHandler,
  resolveGraphContext() as RequestHandler,
  authorizeGraphAccess((req) => requireGraphId(req)) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const request = req.body as BatchEventRequest;

    // Validate request
    const validationError = validateBatchRequest(request, 'events');
    if (validationError) {
      return res.status(400).json(createBatchError('VALIDATION_ERROR', validationError));
    }

    const validation = request.validation || 'strict';
    const onError = request.onError || 'abort';
    const { graphId, events } = request;

    const result: BatchResult = {
      success: true,
      created: [],
      failed: [],
      validationWarnings: [],
    };

    const { eventRepository } = await req.container.graphScopedRepositories(requireGraphId(req));

    const calendarOf = calendarLookup(req);
    for (let i = 0; i < events.length; i++) {
      let eventData = events[i];

      try {
        // Its date read as POST /api/events reads it (in a world, its notation too).
        const dated = await readDates(eventData as Record<string, unknown>, calendarOf, 'event');
        eventData = dated.data as typeof eventData;
        // A date that names nothing cannot be stored, even without validation.
        const warnings = dated.problems.length > 0 ? dated.problems : validation !== 'skip' ? validateEventData(eventData) : [];
        if (warnings.length > 0) {
          result.validationWarnings!.push(...warnings.map((w) => ({ index: i, warning: w })));
          if (validation === 'lenient') {
            continue;
          }
          throw new Error(`Validation failed: ${warnings.join(', ')}`);
        }

        // Create the event
        const createdEvent = await eventRepository.create({
          ...eventData,
          metadata: {
            ...(eventData as Record<string, unknown>).metadata as Record<string, unknown>,
            graphId,
            batchImport: true,
          },
        } as Parameters<typeof eventRepository.create>[0]);

        result.created.push(createdEvent.id);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (onError === 'abort') {
          const rolledBack = [...result.created];
          for (const createdId of [...result.created].reverse()) {
            try {
              await eventRepository.delete(createdId);
            } catch (rollbackError) {
              logger.error('Batch event rollback failed', rollbackError, { id: createdId });
            }
          }
          // Nothing, unless a rollback failed: then what it left is versioned and announced.
          const left = await stillPresent(rolledBack, (id) => eventRepository.findById(id));
          await versionAfterFailure(req, { eventRepository }, touchedOf('events', rolledBack), left.map((id) => ({ operation: 'create', type: 'event', id })));
          return res.status(400).json(createBatchError(
            'BATCH_ABORTED',
            `Batch aborted at index ${i}: ${errorMessage}`,
            { failedIndex: i, created: [], rolledBack }
          ));
        }

        if (onError === 'skip') {
          continue;
        }

        result.failed.push({ index: i, error: errorMessage });
        result.success = false;
      }
    }

    // Set success based on failure count
    result.success = result.failed.length === 0;

    await versionCreated(req, 'events', result.created, eventRepository);
    res.status(result.success ? 201 : 207).json(result);
  })
);

/**
 * Batch create arcs
 * POST /api/batch/arcs
 */
batchRoutes.post(
  '/arcs',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('write:arcs') as RequestHandler,
  rateLimit() as RequestHandler,
  resolveGraphContext() as RequestHandler,
  authorizeGraphAccess((req) => requireGraphId(req)) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const request = req.body as BatchArcRequest;

    // Validate request
    const validationError = validateBatchRequest(request, 'arcs');
    if (validationError) {
      return res.status(400).json(createBatchError('VALIDATION_ERROR', validationError));
    }

    const validation = request.validation || 'strict';
    const onError = request.onError || 'abort';
    const { graphId, arcs } = request;

    const result: BatchResult = {
      success: true,
      created: [],
      failed: [],
      validationWarnings: [],
    };

    const { arcRepository, eventRepository } = await req.container.graphScopedRepositories(requireGraphId(req));

    // Every arc's parent and level is judged once, against the state the whole
    // batch ends in (a child may come before its parent), before any is made.
    const arcSession = new ArcHierarchyService(req.container.graphWriteVersioningService).open(requireGraphId(req), { arcRepository, eventRepository });
    try {
      const calendar = calendarLookup(req);
      const planned: PlanStep[] = [];
      for (const data of arcs) {
        let read: Record<string, unknown> = data as unknown as Record<string, unknown>;
        try {
          read = (await readDates(read, calendar, 'arc')).data;
        } catch {
          // A date that cannot be read fails its own item below.
        }
        planned.push({ kind: 'create', data: read as never });
      }
      await arcSession.preflight(planned);
    } catch (error) {
      if (error instanceof ValidationError) return res.status(400).json(createBatchError('VALIDATION_ERROR', error.message));
      throw error;
    }

    const calendarOf = calendarLookup(req);
    const createdAt = new Map<string, number>();
    /** The arcs that were not made and are not in `failed` yet (skipped, or left out by lenient validation), with why. */
    const notMade = new Map<number, string>();
    for (let i = 0; i < arcs.length; i++) {
      let arcData = arcs[i];

      try {
        // Its dates read as POST /api/arcs reads them (in a world, its notation too).
        const dated = await readDates(arcData as Record<string, unknown>, calendarOf, 'arc');
        arcData = dated.data as typeof arcData;
        // A date that names nothing cannot be stored, even without validation.
        const warnings = dated.problems.length > 0 ? dated.problems : validation !== 'skip' ? validateArcData(arcData) : [];
        if (warnings.length > 0) {
          result.validationWarnings!.push(...warnings.map((w) => ({ index: i, warning: w })));
          if (validation === 'lenient') {
            notMade.set(i, `Validation failed: ${warnings.join(', ')}`);
            continue;
          }
          throw new Error(`Validation failed: ${warnings.join(', ')}`);
        }

        // Create the arc
        const createdArc = await arcSession.create({
          ...arcData,
          metadata: {
            ...(arcData as Record<string, unknown>).metadata as Record<string, unknown>,
            graphId,
            batchImport: true,
          },
        } as Parameters<typeof arcSession.create>[0]);

        result.created.push(createdArc.id);
        createdAt.set(createdArc.id, i);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (onError === 'abort') {
          const rolledBack = [...result.created];
          for (const createdId of [...result.created].reverse()) {
            try {
              await arcRepository.delete(createdId);
            } catch (rollbackError) {
              logger.error('Batch arc rollback failed', rollbackError, { id: createdId });
            }
          }
          // Nothing, unless a rollback failed: then what it left is versioned and announced.
          const left = await stillPresent(rolledBack, (id) => arcRepository.findById(id));
          await versionAfterFailure(req, { arcRepository }, touchedOf('arcs', rolledBack), left.map((id) => ({ operation: 'create', type: 'arc', id })));
          return res.status(400).json(createBatchError(
            'BATCH_ABORTED',
            `Batch aborted at index ${i}: ${errorMessage}`,
            { failedIndex: i, created: [], rolledBack }
          ));
        }

        if (onError === 'skip') {
          notMade.set(i, errorMessage);
          continue;
        }

        result.failed.push({ index: i, error: errorMessage });
        result.success = false;
      }
    }

    // The arcs of a batch are judged as one end state, so they land or fail
    // together: if any was not made, none is.
    // An arc left out says why under its own index, whatever onError is.
    for (const [index, error] of notMade) result.failed.push({ index, error });
    if (result.created.length < arcs.length && result.created.length > 0) {
      await arcSession.undo();
      for (const id of result.created) result.failed.push({ index: createdAt.get(id) ?? -1, error: ARC_STEPS_TOGETHER });
      result.created = [];
    }
    result.success = result.failed.length === 0 && result.created.length === arcs.length;

    await versionCreated(req, 'arcs', result.created, arcRepository);
    res.status(result.success ? 201 : 207).json(result);
  })
);

/**
 * Batch create relationships
 * POST /api/batch/relationships
 */
batchRoutes.post(
  '/relationships',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('write:relationships') as RequestHandler,
  rateLimit() as RequestHandler,
  resolveGraphContext() as RequestHandler,
  authorizeGraphAccess((req) => requireGraphId(req)) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const request = req.body as BatchRelationshipRequest;

    // Validate request
    const validationError = validateBatchRequest(request, 'relationships');
    if (validationError) {
      return res.status(400).json(createBatchError('VALIDATION_ERROR', validationError));
    }

    const validation = request.validation || 'strict';
    const onError = request.onError || 'abort';
    const { relationships } = request;

    // The links made, by their events and by the id the graph gave them (for
    // the announcement and the rollback; result.created keeps cause_effect keys,
    // which cannot be split again: event ids contain underscores).
    const made: StoredCausalRelationship[] = [];
    const result: BatchResult = {
      success: true,
      created: [],
      failed: [],
      validationWarnings: [],
    };

    const causalService = await graphScopedCausalService(req);
    const { eventRepository } = await req.container.graphScopedRepositories(requireGraphId(req));

    for (let i = 0; i < relationships.length; i++) {
      const relData = relationships[i];

      try {
        // Validate if not skipping
        if (validation !== 'skip') {
          const warnings = validateRelationshipData(relData);
          if (warnings.length > 0) {
            result.validationWarnings!.push(...warnings.map((w) => ({ index: i, warning: w })));
            
            if (validation === 'strict') {
              throw new Error(`Validation failed: ${warnings.join(', ')}`);
            }
            if (validation === 'lenient') {
              continue;
            }
          }
        }

        // Get cause and effect events
        const causeEvent = await eventRepository.findById(relData.cause_event_id);
        const effectEvent = await eventRepository.findById(relData.effect_event_id);

        if (!causeEvent) {
          throw new Error(`Cause event not found: ${relData.cause_event_id}`);
        }
        if (!effectEvent) {
          throw new Error(`Effect event not found: ${relData.effect_event_id}`);
        }

        // Create the relationship using createCausalLink
        const stored = await causalService.createCausalLink(
          causeEvent,
          effectEvent,
          {
            weight: relData.weight || 0.5,
            evidence: relData.evidence || '',
            confidence: relData.confidence || 0.5,
            relationship_type: relData.relationship_type || 'direct',
          }
        );

        // Generate relationship ID
        const relId = `${relData.cause_event_id}_${relData.effect_event_id}`;
        result.created.push(relId);
        // What the graph calls the link, which the response's cause_effect key is not:
        // a watcher matches its highlights on this id.
        made.push(stored);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (onError === 'abort') {
          const rolledBack = [...result.created];
          const left: typeof made = [];
          for (const link of [...made].reverse()) {
            try {
              // This link, by its id: another may join the same two events.
              await causalService.deleteCausalLinkById(link);
            } catch (rollbackError) {
              logger.error('Batch relationship rollback failed', rollbackError, { id: link.id });
              left.push(link);
            }
          }
          // Nothing, unless a rollback failed: then what it left is versioned and announced.
          const touched = new Touched();
          made.forEach((link) => touched.link(link));
          await versionAfterFailure(req, { causalService }, touched, left.map((link) => ({ operation: 'create', type: 'relationship', id: link.id })));
          return res.status(400).json(createBatchError(
            'BATCH_ABORTED',
            `Batch aborted at index ${i}: ${errorMessage}`,
            { failedIndex: i, created: [], rolledBack }
          ));
        }

        if (onError === 'skip') {
          continue;
        }

        result.failed.push({ index: i, error: errorMessage });
        result.success = false;
      }
    }

    result.success = result.failed.length === 0;

    const touched = new Touched();
    made.forEach((link) => touched.link(link));
    try {
      await versionBatch(req, { causalService }, touched, made.map((link) => ({ operation: 'create', type: 'relationship', id: link.id })), { undoOnFailure: true });
    } catch (versionError) {
      // As a single write does: a batch that cannot be versioned is undone,
      // link by link. Not through a map keyed by id: in Neo4j two links
      // between the same events share the id "cause->effect", and a map kept
      // only the second, so the undo deleted it twice and left the first.
      await undoUnversioned(req, 'relationship', made, (link) => causalService.deleteCausalLinkById(link), (link) => link.id);
      throw versionError;
    }
    res.status(result.success ? 201 : 207).json(result);
  })
);

/**
 * Determine required permissions based on operation types in transaction
 */
function getRequiredPermissions(operations: BatchOperation[]): Set<string> {
  const permissions = new Set<string>();
  
  for (const op of operations) {
    switch (op.type) {
      case 'create_event':
      case 'update_event':
      case 'delete_event':
        permissions.add('write:events');
        break;
      case 'create_arc':
      case 'update_arc':
      case 'delete_arc':
        permissions.add('write:arcs');
        break;
      case 'create_relationship':
      case 'update_relationship':
      case 'delete_relationship':
        permissions.add('write:relationships');
        break;
    }
  }
  
  return permissions;
}

/**
 * Batch transaction (atomic operations)
 * POST /api/batch/transaction
 * 
 * Permissions are checked dynamically based on operation types
 */
batchRoutes.post(
  '/transaction',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  rateLimit() as RequestHandler,
  resolveGraphContext() as RequestHandler,
  authorizeGraphAccess((req) => requireGraphId(req)) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const request = req.body as BatchTransactionRequest;
    const { eventRepository, arcRepository } = await req.container.graphScopedRepositories(
      requireGraphId(req)
    );
    const causalService = await graphScopedCausalService(req);
    
    // Dynamic permission check based on operation types
    const requiredPermissions = getRequiredPermissions(request.operations || []);
    
    if (requiredPermissions.size > 0 && req.apiKey) {
      const missingPermissions = Array.from(requiredPermissions).filter(
        (p) => !req.apiKey!.hasPermission(p as Permission)
      );
      
      if (missingPermissions.length > 0) {
        return res.status(403).json(createBatchError(
          'PERMISSION_DENIED',
          `Missing required permissions: ${missingPermissions.join(', ')}`,
          { path: req.path }
        ));
      }
    }

    // Validate request
    if (!request.graphId) {
      return res.status(400).json(createBatchError('VALIDATION_ERROR', 'graphId is required'));
    }

    if (!request.operations || !Array.isArray(request.operations)) {
      return res.status(400).json(createBatchError('VALIDATION_ERROR', 'operations array is required'));
    }

    if (request.operations.length > MAX_BATCH_SIZE) {
      return res.status(400).json(createBatchError(
        'VALIDATION_ERROR',
        `Maximum ${MAX_BATCH_SIZE} operations per transaction`
      ));
    }

    const atomic = request.atomic !== false; // Default to atomic
    const { operations } = request;

    const result: TransactionResult = {
      success: true,
      results: [],
      rollbackPerformed: false,
    };

    const createdIds: Array<{ type: 'event' | 'arc'; id: string } | { type: 'relationship'; id: string; stored: StoredCausalRelationship }> = [];
    // A link is announced under the id the graph gave it, not the cause_effect key the response uses.
    const liveIds = new Map<string, string>();
    // What a step wrote, read back for the version once the transaction is
    // done. Only a step that succeeded: one that failed wrote nothing, and
    // re-versioning it would write the live model over the head.
    const touched = new Touched();

    const calendarOf = calendarLookup(req);

    // The arc hierarchy is judged once, against the state the whole
    // transaction ends in, and before anything is written: an end state with
    // an impossible parent, or a level that does not fit its parent, refuses
    // the whole transaction, atomic or not.
    const arcSession = new ArcHierarchyService(req.container.graphWriteVersioningService).open(requireGraphId(req), { arcRepository, eventRepository });
    try {
      await arcSession.preflight(await arcPlanSteps(operations, calendarOf));
    } catch (error) {
      if (error instanceof ValidationError) return res.status(400).json(createBatchError('VALIDATION_ERROR', error.message));
      throw error;
    }

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      let opResult: { success: boolean; id?: string; error?: string } = { success: false };

      try {
        switch (op.type) {
          case 'create_event': {
            const event = await eventRepository.create(
              (await readStepDates(op.data as Record<string, unknown>, calendarOf, 'event')) as unknown as Parameters<typeof eventRepository.create>[0]
            );
            opResult = { success: true, id: event.id };
            createdIds.push({ type: 'event', id: event.id });
            touched.events.add(event.id);
            break;
          }

          case 'create_arc': {
            const arc = await arcSession.create(
              (await readStepDates(op.data as Record<string, unknown>, calendarOf, 'arc')) as unknown as Parameters<typeof arcSession.create>[0]
            );
            opResult = { success: true, id: arc.id };
            createdIds.push({ type: 'arc', id: arc.id });
            touched.arcs.add(arc.id);
            break;
          }

          case 'update_event': {
            const { id: eventId, ...eventUpdates } = op.data as { id: string } & Record<string, unknown>;
            // A new date keeps the event's other metadata, replacing only its date's precision (as PUT does).
            const current = eventUpdates.timestamp !== undefined ? await eventRepository.findById(eventId) : null;
            const dated = await readStepDates(eventUpdates, calendarOf, 'event', current ? { metadata: current.metadata } : { metadata: {} });
            const updatedEvent = await eventRepository.update(eventId, dated);
            if (updatedEvent) touched.events.add(eventId);
            opResult = { success: !!updatedEvent, id: eventId };
            break;
          }

          case 'update_arc': {
            const { id: arcId, ...arcUpdates } = op.data as { id: string } & Record<string, unknown>;
            const updatedArc = await arcSession.update(arcId, (await readStepDates(arcUpdates, calendarOf, 'arc')) as Parameters<typeof arcSession.update>[1]);
            if (updatedArc) touched.arcs.add(arcId);
            opResult = { success: !!updatedArc, id: arcId };
            break;
          }

          case 'delete_event': {
            const deleteEventId = (op.data as { id: string }).id;
            const deletedEvent = await eventRepository.delete(deleteEventId);
            if (deletedEvent) {
              touched.events.add(deleteEventId);
              // Its links went with it (DETACH DELETE).
              touched.deletesLinks = true;
            }
            opResult = { success: deletedEvent, id: deleteEventId };
            break;
          }

          case 'delete_arc': {
            const deleteArcId = (op.data as { id: string }).id;
            // Its children move up to its parent; its events stay, unassigned.
            const deletedArc = await arcSession.delete(deleteArcId);
            if (deletedArc) touched.arcs.add(deleteArcId);
            opResult = { success: deletedArc, id: deleteArcId };
            break;
          }

          case 'create_relationship': {
            const relData = op.data as {
              cause_event_id: string;
              effect_event_id: string;
              weight?: number;
              evidence?: string;
              confidence?: number;
              relationship_type?: 'direct' | 'indirect' | 'contributory';
            };
            const causeEvent = await eventRepository.findById(relData.cause_event_id);
            const effectEvent = await eventRepository.findById(relData.effect_event_id);
            if (!causeEvent) throw new Error(`Cause event not found: ${relData.cause_event_id}`);
            if (!effectEvent) throw new Error(`Effect event not found: ${relData.effect_event_id}`);
            const stored = await causalService.createCausalLink(causeEvent, effectEvent, {
              weight: relData.weight || 0.5,
              evidence: relData.evidence || '',
              confidence: relData.confidence || 0.5,
              relationship_type: relData.relationship_type || 'direct',
            });
            const relId = `${relData.cause_event_id}_${relData.effect_event_id}`;
            opResult = { success: true, id: relId };
            const pair = { cause_event_id: relData.cause_event_id, effect_event_id: relData.effect_event_id };
            createdIds.push({ type: 'relationship', id: relId, stored });
            touched.link(pair);
            liveIds.set(relId, stored.id);
            break;
          }

          case 'update_relationship': {
            // Permission accounting above recognises this operation, but the
            // transaction executor has no implementation for it yet.
            throw new Error(`Operation type not supported in transactions: ${op.type}`);
          }

          case 'delete_relationship': {
            const deleteRelData = op.data as { cause_event_id: string; effect_event_id: string };
            const deletedId = await causalService.deleteCausalLink(
              deleteRelData.cause_event_id,
              deleteRelData.effect_event_id
            );
            touched.link(deleteRelData);
            touched.deletesLinks = true;
            const relId = `${deleteRelData.cause_event_id}_${deleteRelData.effect_event_id}`;
            opResult = { success: true, id: relId };
            liveIds.set(relId, deletedId);
            break;
          }

          default:
            throw new Error(`Unknown operation type: ${op.type}`);
        }

        // A step that did not apply (an id that is not there) is a failed step, so an
        // atomic transaction rolls back and the arc steps fail together.
        if (!opResult.success) throw new Error(opResult.error ?? `Not found: ${op.type}${opResult.id ? ` ${opResult.id}` : ''}`);
        result.results.push({ index: i, type: op.type, ...opResult });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.results.push({ index: i, type: op.type, success: false, error: errorMessage });
        result.success = false;

        if (atomic) {
          // Rollback all created entities
          const rolledBack = new Set<string>();
          // The arcs go back as they were, whatever the transaction did to them
          // (created, moved, lifted, deleted), so nothing of them lands.
          const arcIds = arcSession.arcIds();
          arcIds.forEach((id) => touched.arcs.add(id));
          let arcsRestored = false;
          try {
            await arcSession.undo();
            arcsRestored = true;
          } catch (rollbackError) {
            logger.error('Rollback of the arc hierarchy failed', rollbackError);
          }
          if (arcsRestored) {
            for (const step of result.results) if (/_arc$/.test(step.type) && step.id !== undefined) rolledBack.add(step.id);
            arcIds.forEach((id) => rolledBack.add(id));
          }
          for (const created of createdIds.reverse()) {
            if (created.type === 'arc' && arcsRestored) continue;
            try {
              switch (created.type) {
                case 'event':
                  await eventRepository.delete(created.id);
                  break;
                case 'arc':
                  await arcRepository.delete(created.id);
                  break;
                case 'relationship':
                  // This link, by its id: by its events would take another
                  // link between the same two (the user's own, older one).
                  await causalService.deleteCausalLinkById(created.stored);
                  break;
              }
              rolledBack.add(created.id);
            } catch (rollbackError) {
              logger.error('Rollback failed', rollbackError, { type: created.type, id: created.id });
            }
          }

          result.rollbackPerformed = true;

          // The rollback undoes only what the transaction created. The updates
          // and deletes that ran before the failing step stay in the store, and
          // so does anything whose rollback failed: version them, and tell
          // whoever has the graph open. What was created and removed again nets
          // to nothing.
          await versionAfterFailure(
            req,
            { eventRepository, arcRepository, causalService },
            touched,
            absorbArcMoves(
              touched,
              arcSession,
              stepsOf(
                result.results.filter((step) => !(step.id !== undefined && rolledBack.has(step.id))),
                liveIds
              )
            )
          );

          return res.status(400).json({
            ...createBatchError(
              'TRANSACTION_FAILED',
              `Transaction failed at operation ${i}: ${errorMessage}`,
              { failedIndex: i }
            ),
            result,
          });
        }
      }
    }

    // The arc steps are one end state: they land or fail together, atomic or
    // not. If any failed, every arc write is put back and every arc step that
    // had succeeded is reported as not applied (the other steps keep their own
    // results). Otherwise the arcs the steps moved with the ones they named are
    // written now, as the end state has them.
    try {
      const arcStep = (step: { type: string }): boolean => /_arc$/.test(step.type);
      if (result.results.some((step) => arcStep(step) && !step.success)) {
        absorbArcMoves(touched, arcSession, []);
        await arcSession.undo();
        // An event a step put in an arc that was not made no longer names it.
        const cleared = new Set(arcSession.clearedEventIds());
        cleared.forEach((id) => touched.events.add(id));
        for (const step of result.results) {
          if (step.success && step.id !== undefined && /_event$/.test(step.type) && cleared.has(step.id)) {
            step.warning = 'its arc was not applied (another arc step in this batch failed), so the event is in no arc';
          }
        }
        for (const step of result.results) {
          if (arcStep(step) && step.success) {
            step.success = false;
            step.error = ARC_STEPS_TOGETHER;
          }
        }
        result.success = false;
      } else {
        await arcSession.finish();
      }
    } catch (error) {
      await arcSession.undo().catch((rollbackError) => logger.error('Rollback of the arc hierarchy failed', rollbackError));
      throw error;
    }

    // A transaction whose version cannot be committed is not undone (its
    // updates and deletes have no before-image here): the error propagates and
    // the feed says the change is not versioned, as for a single update.
    await versionBatch(req, { eventRepository, arcRepository, causalService }, touched, absorbArcMoves(touched, arcSession, stepsOf(result.results, liveIds)));
    res.status(result.success ? 200 : 207).json(result);
  })
);

// Validation helpers

function validateBatchRequest(
  request: BatchEventRequest | BatchArcRequest | BatchRelationshipRequest,
  type: 'events' | 'arcs' | 'relationships'
): string | null {
  if (!request.graphId) {
    return 'graphId is required';
  }

  const items = (request as unknown as Record<string, unknown[]>)[type];
  if (!items || !Array.isArray(items)) {
    return `${type} array is required`;
  }

  if (items.length === 0) {
    return `${type} array cannot be empty`;
  }

  if (items.length > MAX_BATCH_SIZE) {
    return `Maximum ${MAX_BATCH_SIZE} ${type} per batch`;
  }

  return null;
}

/** The graph's world calendars, looked up at most once per request (only a date that is not ISO 8601 needs them). */
function calendarLookup(req: Request): () => Promise<WorldCalendarSet | undefined> {
  let cached: Promise<WorldCalendarSet | undefined> | undefined;
  return () => (cached ??= req.container.graphRepository.findById(requireGraphId(req)).then((graph) => graph?.calendar));
}

/**
 * An event's or an arc's dates read as the event and arc routes read them
 * (worldDates.ts): ISO 8601, and in a world graph its notation or fields,
 * stored as ISO with a month's or year's precision (and calendar) recorded.
 * With `existing` (an update), the event's other metadata is kept and only
 * its date's precision replaced. A date that names nothing is a problem, left
 * as given: the caller fails or skips the item.
 */
async function readDates(
  data: Record<string, unknown>,
  calendarOf: () => Promise<WorldCalendarSet | undefined>,
  kind: 'event' | 'arc',
  existing?: { metadata?: Record<string, unknown> }
): Promise<{ data: Record<string, unknown>; problems: string[] }> {
  const out: Record<string, unknown> = { ...data };
  const problems: string[] = [];
  const read = async (field: string, edge: 'start' | 'end') => {
    try {
      const time = await readRequestTime(out[field], field, calendarOf, edge);
      if (Number.isNaN(time.date.getTime())) {
        problems.push(`${field} is invalid`);
        return undefined;
      }
      out[field] = time.date.toISOString();
      return time;
    } catch (error) {
      problems.push(error instanceof Error ? error.message : `${field} is invalid`);
      return undefined;
    }
  };
  if (kind === 'event' && out.timestamp !== undefined && out.timestamp !== null) {
    const time = await read('timestamp', 'start');
    if (time) {
      const dated = { precision: time.precision ?? ('day' as const), calendar: time.calendar };
      const given = typeof out.metadata === 'object' && out.metadata !== null ? (out.metadata as Record<string, unknown>) : undefined;
      if (existing) out.metadata = newDateMetadata(given, existing.metadata, dated);
      else {
        const created = newDateMetadata(given, undefined, dated);
        if (given !== undefined || Object.keys(created).length > 0) out.metadata = created;
      }
    }
  }
  if (kind === 'arc') {
    for (const [field, edge] of [['start_time', 'start'], ['end_time', 'end']] as const) {
      if (out[field] !== undefined && out[field] !== null) await read(field, edge);
    }
  }
  return { data: out, problems };
}

/** A transaction step's dates, read; a date that names nothing fails the step. */
async function readStepDates(...args: Parameters<typeof readDates>): Promise<Record<string, unknown>> {
  const { data, problems } = await readDates(...args);
  if (problems.length > 0) throw new ValidationError(problems.join('; '));
  return data;
}

function validateEventData(data: Partial<IEvent>): string[] {
  const warnings: string[] = [];

  if (!data.description || typeof data.description !== 'string') {
    warnings.push('description is required');
  }

  if (!data.timestamp) {
    warnings.push('timestamp is required');
  } else if (toAxisTime(data.timestamp) === null) {
    warnings.push('timestamp is invalid');
  }

  return warnings;
}

function validateArcData(data: Partial<IArc>): string[] {
  const warnings: string[] = [];

  if (!data.name || typeof data.name !== 'string') {
    warnings.push('name is required');
  }

  if (!data.start_time) {
    warnings.push('start_time is required');
  }

  if (!data.end_time) {
    warnings.push('end_time is required');
  }

  if (data.start_time && data.end_time) {
    // Exactly, on the axis (docs/specs/deep-time.md, Req 3): `>=` on two Dates
    // compares the nearest doubles, which past about 285,000 years can be one
    // number for two moments.
    const start = toAxisTime(data.start_time);
    const end = toAxisTime(data.end_time);
    if (start !== null && end !== null && compareAxisTime(start, end) >= 0) {
      warnings.push('start_time must be before end_time');
    }
  }

  return warnings;
}

function validateRelationshipData(data: {
  cause_event_id: string;
  effect_event_id: string;
}): string[] {
  const warnings: string[] = [];

  if (!data.cause_event_id) {
    warnings.push('cause_event_id is required');
  }

  if (!data.effect_event_id) {
    warnings.push('effect_event_id is required');
  }

  if (data.cause_event_id === data.effect_event_id) {
    warnings.push('cause_event_id and effect_event_id cannot be the same');
  }

  return warnings;
}
