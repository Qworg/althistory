/**
 * Ingestion API routes (spec Req 7-9, design "Ingestion API").
 *
 * Extraction is synchronous: each POST runs the extractor and returns an
 * {@link IngestionPreview} holding the entities and validation issues for
 * review. Approval converts the selected subset into an export and runs the
 * existing `ImportService`, so ingestion is a second front door to the import
 * path rather than a parallel entity-creation path.
 *
 * Authentication follows the batch/keys pattern: `authenticate` + `requireAuth`
 * + `authorize('ingest')` + `rateLimit` on every route. The approve route also
 * resolves the graph context and authorises access to it before importing.
 *
 * Every job is stamped with the id of the API key that created it, and every
 * job read or mutation passes that id to the orchestrator, so one key cannot
 * read another key's preview (which contains their pasted text), approve their
 * job, or delete it. A job belonging to another key answers 404, not 403, so job
 * ids cannot be probed for existence.
 *
 * The extractor registry below is the concrete wiring; the per-source
 * disclosure of what is complete, partial and unimplemented lives at the top of
 * `services/ingestion/index.ts`. It has no separate report file.
 */

import { Router, RequestHandler, Response } from 'express';
import {
  AuthenticatedRequest,
  authenticate,
  requireAuth,
  authorize,
  rateLimit,
  resolveGraphContext,
  authorizeGraphAccess,
  requireGraphId,
  asyncHandler,
} from '../middleware';
import { ValidationError, NotFoundError } from '../../utils/errors';
import { ImportService } from '../../services/ImportService';
import { FetchHttpClient, HttpClient } from '../../services/ingestion/http';
import { TextExtractor } from '../../services/ingestion/TextExtractor';
import { WikipediaExtractor } from '../../services/ingestion/WikipediaExtractor';
import { WikidataExtractor } from '../../services/ingestion/WikidataExtractor';
import {
  ApproveIngestionRequest,
  ExtractedEdit,
  InMemoryIngestionJobStore,
  IngestionJobNotFoundError,
  IngestionOrchestrator,
  IngestionValidationError,
} from '../../services/ingestion/IngestionOrchestrator';
import {
  ExtractionContext,
  TextExtractionInput,
  WikidataExtractionInput,
  WikipediaExtractionInput,
} from '../../services/ingestion/types';
import { createLLMClient, LLMClient, LLMClientFactoryConfig } from '../../services/llm';

export interface IngestRouterConfig {
  dataDir: string;
  /** Injectable HTTP boundary; defaults to a `fetch`-backed client. */
  httpClient?: HttpClient;
  /**
   * Explicit LLM client. `null` disables LLM extraction. When omitted, a client
   * is built from environment keys (and may still be null).
   */
  llmClient?: LLMClient | null;
  /** Provider/model configuration used when building the LLM client. */
  llm?: LLMClientFactoryConfig;
  /** Test seam: supply a fully wired orchestrator. */
  orchestrator?: IngestionOrchestrator;
}

/**
 * The id of the API key making the request. `authorize('ingest')` has already
 * rejected a request without a key, so a missing id here would mean the wiring
 * changed; fail loudly rather than treating the job as unowned.
 */
function ownerKeyId(req: AuthenticatedRequest): string {
  const id = req.apiKey?.id;
  if (!id) {
    throw new Error('Ingest routes require an authenticated API key with an id');
  }
  return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === 'string');
  return strings.length > 0 ? strings : undefined;
}

function parseTimeRange(value: unknown): { start: string; end: string } | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.start !== 'string' || typeof value.end !== 'string') return undefined;
  return { start: value.start, end: value.end };
}

function parseExtractionContext(value: unknown): ExtractionContext | undefined {
  if (!isRecord(value)) return undefined;
  const context: ExtractionContext = {};
  const range = parseTimeRange(value.defaultTimeRange);
  if (range) context.defaultTimeRange = range;
  const actors = stringArray(value.defaultActors);
  if (actors) context.defaultActors = actors;
  const known = stringArray(value.knownEntities);
  if (known) context.knownEntities = known;
  if (typeof value.locale === 'string') context.locale = value.locale;
  if (typeof value.instructions === 'string') context.instructions = value.instructions;
  return context;
}

function parseWikipediaOptions(value: unknown): WikipediaExtractionInput['options'] {
  if (!isRecord(value)) return undefined;
  const options: NonNullable<WikipediaExtractionInput['options']> = {};
  if (typeof value.followLinks === 'boolean') options.followLinks = value.followLinks;
  if (typeof value.linkDepth === 'number') options.linkDepth = value.linkDepth;
  if (typeof value.linkFilter === 'string') options.linkFilter = value.linkFilter;
  if (typeof value.maxPages === 'number') options.maxPages = value.maxPages;
  return options;
}

function parseParameters(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const parameters: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') parameters[key] = entry;
  }
  return Object.keys(parameters).length > 0 ? parameters : undefined;
}

function parseEdits(value: unknown): Record<string, ExtractedEdit> | undefined {
  if (!isRecord(value)) return undefined;
  const edits: Record<string, ExtractedEdit> = {};
  for (const [tempId, rawEdit] of Object.entries(value)) {
    if (!isRecord(rawEdit)) continue;
    const edit: ExtractedEdit = {};
    if (typeof rawEdit.description === 'string') edit.description = rawEdit.description;
    if (typeof rawEdit.actor === 'string') edit.actor = rawEdit.actor;
    if (typeof rawEdit.target === 'string') edit.target = rawEdit.target;
    if (typeof rawEdit.timestamp === 'string') edit.timestamp = rawEdit.timestamp;
    if (typeof rawEdit.name === 'string') edit.name = rawEdit.name;
    if (typeof rawEdit.start_time === 'string') edit.start_time = rawEdit.start_time;
    if (typeof rawEdit.end_time === 'string') edit.end_time = rawEdit.end_time;
    if (typeof rawEdit.level === 'number') edit.level = rawEdit.level;
    if (typeof rawEdit.confidence === 'number') edit.confidence = rawEdit.confidence;
    if (typeof rawEdit.selected === 'boolean') edit.selected = rawEdit.selected;
    edits[tempId] = edit;
  }
  return Object.keys(edits).length > 0 ? edits : undefined;
}

function parseApproveRequest(value: unknown): ApproveIngestionRequest {
  const body = isRecord(value) ? value : {};
  const mode = body.mode;
  const conflictResolution = body.conflictResolution;
  return {
    approvedEventIds: stringArray(body.approvedEventIds),
    approvedArcIds: stringArray(body.approvedArcIds),
    approvedRelationshipIds: stringArray(body.approvedRelationshipIds),
    edits: parseEdits(body.edits),
    targetGraphId: typeof body.targetGraphId === 'string' ? body.targetGraphId : undefined,
    mode: mode === 'merge' || mode === 'replace' || mode === 'create-new' ? mode : undefined,
    conflictResolution:
      conflictResolution === 'skip' || conflictResolution === 'overwrite' || conflictResolution === 'rename'
        ? conflictResolution
        : undefined,
    userId: typeof body.userId === 'string' ? body.userId : undefined,
  };
}

/**
 * Build the ingest router. `config.orchestrator` short-circuits all wiring
 * (used by route tests); otherwise the factory constructs the concrete
 * extractors and a dedicated `ImportService` over `config.dataDir`.
 */
export function createIngestRouter(config: IngestRouterConfig): Router {
  const router = Router();
  let orchestrator: IngestionOrchestrator;

  if (config.orchestrator) {
    orchestrator = config.orchestrator;
  } else {
    const httpClient = config.httpClient ?? new FetchHttpClient();
    const llmClient =
      config.llmClient !== undefined
        ? config.llmClient
        : createLLMClient(config.llm);
    const importService = new ImportService({ dataDir: config.dataDir });
    // The extractor registry. See the disclosure at the top of
    // `services/ingestion/index.ts` before assuming a source does more than it
    // does: `wikipedia` and the pattern half of `text` are complete; the
    // `wikidata` historical-events query is a broad heuristic; no source returns
    // arcs; `enrichDescription` is implemented but unwired; relationships come
    // only from the LLM path of `text`.
    orchestrator = new IngestionOrchestrator({
      extractors: {
        wikipedia: new WikipediaExtractor({ httpClient }),
        wikidata: new WikidataExtractor({ httpClient }),
        text: new TextExtractor({ llmClient }),
      },
      importExecutor: importService,
      jobStore: new InMemoryIngestionJobStore(),
    });
  }

  router.use(
    authenticate as RequestHandler,
    requireAuth as RequestHandler,
    authorize('ingest') as RequestHandler,
    rateLimit() as RequestHandler
  );

  /** POST /api/ingest/text — synchronous pattern/LLM extraction. */
  router.post(
    '/text',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      if (typeof body.text !== 'string' || body.text.trim().length === 0) {
        throw new ValidationError('text is required', 'text');
      }
      const input: TextExtractionInput = {
        text: body.text,
        useLLM: body.useLLM !== false,
      };
      const preview = await orchestrator.ingest(
        { source: 'text', text: input },
        parseExtractionContext(body.context),
        ownerKeyId(req)
      );
      res.status(200).json(preview);
    })
  );

  /** POST /api/ingest/url — Wikipedia extraction. */
  router.post(
    '/url',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      if (typeof body.url !== 'string' || body.url.trim().length === 0) {
        throw new ValidationError('url is required', 'url');
      }
      if (body.strategy !== undefined && body.strategy !== 'wikipedia' && body.strategy !== 'auto') {
        throw new ValidationError('strategy must be "wikipedia" or "auto"', 'strategy');
      }
      const preview = await orchestrator.ingest(
        {
          source: 'wikipedia',
          wikipedia: { url: body.url, options: parseWikipediaOptions(body.options) },
        },
        parseExtractionContext(body.context),
        ownerKeyId(req)
      );
      res.status(200).json({ ...preview, estimatedPages: preview.extraction.sources.length });
    })
  );

  /** POST /api/ingest/wikidata — SPARQL extraction. */
  router.post(
    '/wikidata',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      const queryType = body.queryType;
      if (queryType !== 'historical-events' && queryType !== 'person-timeline' && queryType !== 'custom') {
        throw new ValidationError(
          'queryType must be "historical-events", "person-timeline" or "custom"',
          'queryType'
        );
      }
      const input: WikidataExtractionInput = {
        queryType,
        parameters: parseParameters(body.parameters),
        customQuery: typeof body.customQuery === 'string' ? body.customQuery : undefined,
        limit: typeof body.limit === 'number' ? body.limit : undefined,
      };
      const preview = await orchestrator.ingest(
        { source: 'wikidata', wikidata: input },
        parseExtractionContext(body.context),
        ownerKeyId(req)
      );
      res.status(200).json(preview);
    })
  );

  /** GET /api/ingest/jobs/:id — job status. */
  router.get(
    '/jobs/:id',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const job = orchestrator.getJob(req.params.id, ownerKeyId(req));
      if (!job) throw new NotFoundError('Ingestion job not found', 'ingestionJob', req.params.id);
      res.status(200).json({
        id: job.id,
        source: job.source,
        status: job.status,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        validationIssues: job.validationIssues,
        importResult: job.importResult,
      });
    })
  );

  /** GET /api/ingest/jobs/:id/preview — extracted entities for review. */
  router.get(
    '/jobs/:id/preview',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      try {
        res.status(200).json(orchestrator.getPreview(req.params.id, ownerKeyId(req)));
      } catch (error) {
        if (error instanceof IngestionJobNotFoundError) {
          throw new NotFoundError('Ingestion job not found', 'ingestionJob', req.params.id);
        }
        throw error;
      }
    })
  );

  /**
   * POST /api/ingest/jobs/:id/approve — import the selected entities.
   *
   * The graph context is resolved and authorised first. A `targetGraphId` in
   * the body must match the resolved graph; when absent the resolved graph is
   * the target. This prevents an authenticated caller from importing into a
   * graph the key cannot access.
   */
  router.post(
    '/jobs/:id/approve',
    resolveGraphContext() as RequestHandler,
    authorizeGraphAccess((req) => requireGraphId(req)) as RequestHandler,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const approve = parseApproveRequest(req.body);
      const resolvedGraphId = requireGraphId(req);
      if (approve.targetGraphId && approve.targetGraphId !== resolvedGraphId) {
        throw new ValidationError(
          'targetGraphId does not match the resolved graph context',
          'targetGraphId',
          approve.targetGraphId
        );
      }
      approve.targetGraphId = resolvedGraphId;

      try {
        const result = await orchestrator.approve(req.params.id, approve, ownerKeyId(req));
        res.status(200).json(result);
      } catch (error) {
        if (error instanceof IngestionJobNotFoundError) {
          throw new NotFoundError('Ingestion job not found', 'ingestionJob', req.params.id);
        }
        if (error instanceof IngestionValidationError) {
          throw new ValidationError(
            error.message,
            'extraction',
            undefined,
            error.issues.map((issue) => `${issue.entityType}:${issue.entityTempId}: ${issue.message}`)
          );
        }
        throw error;
      }
    })
  );

  /** DELETE /api/ingest/jobs/:id — discard a review job. */
  router.delete(
    '/jobs/:id',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const deleted = orchestrator.deleteJob(req.params.id, ownerKeyId(req));
      res.status(200).json({ success: deleted });
    })
  );

  return router;
}

export default createIngestRouter;
