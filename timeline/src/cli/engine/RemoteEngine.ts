import axios, { AxiosInstance } from 'axios';
import { IEngine } from './IEngine';
import {
  HealthInfo,
  GraphSummaryDto,
  EventDto,
  ArcDto,
  CausalRelationshipDto,
  IngestTextOptions,
  IngestUrlOptions,
  IngestWikidataOptions,
  IngestResultDto,
  GenerateTimelineOptions,
  GenerateBranchOptions,
  GenerateExpandOptions,
  GenerateSimulateOptions,
  GenerationResultDto,
  ValidationReportDto,
  ExportFormat,
  ExportResultDto,
  ImportResultDto,
} from '../types';
import {
  ConnectionErrorCLI,
  AuthErrorCLI,
  NotFoundErrorCLI,
  ValidationErrorCLI,
  CLIError,
  ExitCode,
} from '../utils/exitCodes';
import { MS_PER_MONTH, toGenerationResultDto } from './simulationMapper';
import { GraphValidator, CrossGraphLookup, ScopedGraphServices } from '../validation/GraphValidator';
import { GraphExporter } from '../export/GraphExporter';
import { isWikipediaUrl } from '@/services/ingestion/WebDocumentExtractor';
import { parseExportDocument } from '../export/exportDocument';
import { Event } from '@/models/Event';
import { Arc } from '@/models/Arc';
import { CausalRelationship, CausalRelationshipType } from '@/models/relationships';
import type { SimulationResult } from '@/services/SimulationService';

/**
 * The header the daemon reads to scope a request to one graph.
 *
 * The daemon's `resolveGraphContext` middleware reads this header and nothing
 * else: a graph id in the body or the query string is ignored, and the request
 * is served against the *active* graph instead. Every request that names a
 * graph therefore has to send it here.
 */
export /** How long the export download may take: a large graph is a large file. */
const DOWNLOAD_TIMEOUT_MS = 120000;

const GRAPH_ID_HEADER = 'X-Graph-Id';

/** Page size for the list routes, which are paginated. */
const PAGE_LIMIT = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The shapes a daemon payload can take once the envelope is removed. */
export type ApiPayload = Record<string, unknown> | unknown[];

/**
 * Unwrap the `{ success, data }` envelope the API answers with.
 *
 * A body that is not an envelope (the export document, the health check) is
 * returned unchanged; a body that is neither an object nor an array is
 * reported as an empty object, so a caller never has to narrow it again.
 */
function unwrap(body: unknown): ApiPayload {
  const payload = isRecord(body) && typeof body.success === 'boolean' && 'data' in body ? body.data : body;
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload)) return payload;
  return {};
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/** The relationship type the daemon accepts, narrowed from untrusted input. */
function readRelationshipType(value: unknown): CausalRelationshipType {
  return value === 'indirect' || value === 'contributory' || value === 'direct' ? value : 'direct';
}

export class RemoteEngine implements IEngine {
  readonly mode = 'remote' as const;
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3000', apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers,
      timeout: 10000,
    });
  }

  /**
   * The headers that scope a request to one graph.
   *
   * An empty object means "no graph named": the daemon then serves the active
   * graph, which is what the graph-management routes (list, create) want.
   */
  private graphHeaders(graphId?: string): Record<string, string> {
    return graphId ? { [GRAPH_ID_HEADER]: graphId } : {};
  }

  private handleError(error: unknown, context: string): never {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new ConnectionErrorCLI(`Cannot connect to Althistory daemon at ${this.baseUrl} (${error.message})`);
      }
      const status = error.response?.status;
      const body = error.response?.data;
      const message =
        (isRecord(body) && isRecord(body.error) ? readString(body.error.message) : '') ||
        (isRecord(body) ? readString(body.message) : '') ||
        error.message;

      if (status === 401 || status === 403) {
        throw new AuthErrorCLI(`Authentication failed: ${message}`);
      }
      if (status === 404) {
        throw new NotFoundErrorCLI(`Resource not found: ${message}`);
      }
      if (status === 400 || status === 422) {
        throw new ValidationErrorCLI(`Validation error during ${context}: ${message}`, body);
      }
      throw new CLIError(`Remote request failed (${status || 'unknown'}): ${message}`, ExitCode.GENERAL_ERROR);
    }
    throw error as Error;
  }

  async shutdown(): Promise<void> {
    // No-op for remote HTTP client
  }

  /**
   * Fetch every page of a paginated list route.
   *
   * The list routes answer with `{ success, data: [...], pagination }`; this
   * follows `pagination.hasMore` so a caller sees the whole collection rather
   * than the first page.
   */
  private async fetchAll(
    path: string,
    graphId: string | undefined,
    params: Record<string, string | number | undefined> = {}
  ): Promise<unknown[]> {
    const items: unknown[] = [];
    let offset = 0;

    for (;;) {
      const res = await this.client.get(path, {
        params: { ...params, limit: PAGE_LIMIT, offset },
        headers: this.graphHeaders(graphId),
      });
      const payload = unwrap(res.data);
      const page = Array.isArray(payload) ? payload : [];
      items.push(...page);

      const envelope = isRecord(res.data) ? res.data : undefined;
      const pagination = envelope ? readRecord(envelope.pagination) : undefined;
      if (!pagination || pagination.hasMore !== true || page.length === 0) {
        break;
      }
      offset += page.length;
    }

    return items;
  }

  async getHealth(): Promise<HealthInfo> {
    try {
      const res = await this.client.get('/health');
      const body = isRecord(res.data) ? res.data : {};
      return {
        status: body.status === 'healthy' ? 'healthy' : 'degraded',
        mode: isRecord(body.database) && body.database.connected ? 'cloud' : 'local',
        executionMode: 'remote',
        uptimeSeconds: readNumber(body.uptime, 0),
      };
    } catch (err) {
      return this.handleError(err, 'health check');
    }
  }

  /** Map a graph record from the daemon to the CLI's summary shape. */
  private toGraphSummary(raw: unknown): GraphSummaryDto {
    const graph = isRecord(raw) ? raw : {};
    return {
      id: readString(graph.id),
      name: readString(graph.name),
      description: readOptionalString(graph.description),
      currentVersion: readString(graph.currentVersion || graph.version, 'v1'),
      parentGraphId: readOptionalString(graph.parentGraphId),
      branchPointVersion:
        typeof graph.branchPoint === 'number' ? `v${graph.branchPoint}` : undefined,
      createdAt: readString(graph.createdAt, new Date().toISOString()),
      updatedAt: readString(graph.updatedAt, new Date().toISOString()),
    };
  }

  async listGraphs(): Promise<GraphSummaryDto[]> {
    try {
      const graphs = await this.fetchAll('/api/graphs', undefined);
      return graphs.map((g) => this.toGraphSummary(g));
    } catch (err) {
      return this.handleError(err, 'listing graphs');
    }
  }

  async createGraph(name: string, description?: string): Promise<GraphSummaryDto> {
    try {
      const res = await this.client.post('/api/graphs', { name, description });
      return this.toGraphSummary(unwrap(res.data));
    } catch (err) {
      return this.handleError(err, 'creating graph');
    }
  }

  async getGraph(id: string): Promise<GraphSummaryDto> {
    try {
      const res = await this.client.get(`/api/graphs/${id}`);
      return this.toGraphSummary(unwrap(res.data));
    } catch (err) {
      return this.handleError(err, `getting graph ${id}`);
    }
  }

  async branchGraph(id: string, name: string): Promise<GraphSummaryDto> {
    try {
      const res = await this.client.post(`/api/graphs/${id}/branch`, { name });
      return this.toGraphSummary(unwrap(res.data));
    } catch (err) {
      return this.handleError(err, `branching graph ${id}`);
    }
  }

  async mergeGraph(
    sourceId: string,
    targetId: string,
    strategy: string = 'keep-source'
  ): Promise<{ success: boolean; version?: string }> {
    try {
      const res = await this.client.post(`/api/graphs/${targetId}/merge`, {
        sourceGraphId: sourceId,
        conflictResolution: strategy === 'keep-target' ? 'keep-target' : 'keep-source',
      });
      const body = isRecord(res.data) ? res.data : {};
      const newVersion = body.newVersion;
      return {
        success: body.success !== false,
        version: typeof newVersion === 'number' ? `v${newVersion}` : undefined,
      };
    } catch (err) {
      return this.handleError(err, `merging graphs ${sourceId} -> ${targetId}`);
    }
  }

  /**
   * Compute the diff between two graphs.
   *
   * The daemon has no `GET /api/graphs/diff` route: the request used to be
   * sent there and was answered by the `/:id` route, which read `diff` as a
   * graph id. The diff is therefore computed here from the two graphs' data,
   * which the daemon does serve.
   */
  async diffGraph(sourceId: string, targetId: string): Promise<Record<string, unknown>> {
    try {
      const [source, target] = await Promise.all([
        this.fetchGraphData(sourceId),
        this.fetchGraphData(targetId),
      ]);

      const sourceEvents = new Map(source.events.map((e) => [e.id, e]));
      const targetEvents = new Map(target.events.map((e) => [e.id, e]));

      const addedIds = [...targetEvents.keys()].filter((id) => !sourceEvents.has(id));
      const deletedIds = [...sourceEvents.keys()].filter((id) => !targetEvents.has(id));
      const modifiedIds = [...targetEvents.keys()].filter((id) => {
        const before = sourceEvents.get(id);
        const after = targetEvents.get(id);
        return before !== undefined && after !== undefined && JSON.stringify(before) !== JSON.stringify(after);
      });

      return {
        sourceGraphId: sourceId,
        targetGraphId: targetId,
        events: {
          added: addedIds.length,
          modified: modifiedIds.length,
          deleted: deletedIds.length,
          addedIds,
          deletedIds,
          modifiedIds,
        },
        arcs: {
          added: target.arcs.filter((a) => !source.arcs.some((b) => b.id === a.id)).length,
          modified: target.arcs.filter((a) => {
            const before = source.arcs.find((b) => b.id === a.id);
            return before !== undefined && JSON.stringify(before) !== JSON.stringify(a);
          }).length,
          deleted: source.arcs.filter((a) => !target.arcs.some((b) => b.id === a.id)).length,
        },
        relationships: {
          added: target.relationships.filter(
            (r) => !source.relationships.some((b) => b.cause_event_id === r.cause_event_id && b.effect_event_id === r.effect_event_id)
          ).length,
          deleted: source.relationships.filter(
            (r) => !target.relationships.some((b) => b.cause_event_id === r.cause_event_id && b.effect_event_id === r.effect_event_id)
          ).length,
        },
      };
    } catch (err) {
      return this.handleError(err, `diffing graphs ${sourceId} vs ${targetId}`);
    }
  }

  /** The events, arcs and relationships of one graph, from `GET /graphs/:id/data`. */
  private async fetchGraphData(graphId: string): Promise<{
    events: Record<string, unknown>[];
    arcs: Record<string, unknown>[];
    relationships: Record<string, unknown>[];
  }> {
    const res = await this.client.get(`/api/graphs/${graphId}/data`);
    const payload = unwrap(res.data);
    const data = isRecord(payload) ? payload : {};
    const asRecords = (value: unknown): Record<string, unknown>[] =>
      Array.isArray(value)
        ? value.filter((entry): entry is Record<string, unknown> => isRecord(entry))
        : [];
    return {
      events: asRecords(data.events),
      arcs: asRecords(data.arcs),
      relationships: asRecords(data.relationships),
    };
  }

  async rollbackGraph(id: string, version: string): Promise<{ success: boolean; currentVersion: string }> {
    try {
      const res = await this.client.post(`/api/graphs/${id}/rollback/${version}`);
      const graph = isRecord(unwrap(res.data)) ? (unwrap(res.data) as Record<string, unknown>) : {};
      return {
        success: true,
        currentVersion: readString(graph.version, version),
      };
    } catch (err) {
      return this.handleError(err, `rolling back graph ${id}`);
    }
  }

  async deleteGraph(id: string): Promise<void> {
    try {
      await this.client.delete(`/api/graphs/${id}`);
    } catch (err) {
      return this.handleError(err, `deleting graph ${id}`);
    }
  }

  async createEvent(
    graphId: string,
    data: {
      description: string;
      timestamp: string;
      actor?: string;
      target?: string;
      importance?: number;
      metadata?: Record<string, unknown>;
    }
  ): Promise<EventDto> {
    try {
      const res = await this.client.post(
        '/api/events',
        {
          description: data.description,
          timestamp: data.timestamp,
          actor: data.actor || 'Unknown',
          target: data.target || 'Unknown',
          metadata: {
            ...(data.metadata || {}),
            ...(data.importance !== undefined ? { importance: data.importance } : {}),
          },
        },
        { headers: this.graphHeaders(graphId) }
      );
      return this.toEventDto(unwrap(res.data), graphId);
    } catch (err) {
      return this.handleError(err, 'creating event');
    }
  }

  /** Map an event record from the daemon to the CLI's event shape. */
  private toEventDto(raw: unknown, graphId: string): EventDto {
    const event = isRecord(raw) ? raw : {};
    return {
      id: readString(event.id),
      graphId,
      description: readString(event.description),
      timestamp: readString(event.timestamp),
      actor: readOptionalString(event.actor),
      target: readOptionalString(event.target),
    };
  }

  async listEvents(
    graphId: string,
    filters?: { actor?: string; from?: string; to?: string }
  ): Promise<EventDto[]> {
    try {
      const params: Record<string, string | number | undefined> = {};
      if (filters?.actor) params.actor = filters.actor;
      if (filters?.from || filters?.to) {
        // The daemon only filters by a range when both ends are given, so a
        // one-sided filter is completed with the widest bound that keeps the
        // meaning ("from this date onwards" / "up to this date").
        params.startTime = filters?.from ?? '0000-01-01T00:00:00.000Z';
        params.endTime = filters?.to ?? '9999-12-31T23:59:59.999Z';
      }
      const events = await this.fetchAll('/api/events', graphId, params);
      return events.map((e) => this.toEventDto(e, graphId));
    } catch (err) {
      return this.handleError(err, 'listing events');
    }
  }

  async getEvent(graphId: string, eventId: string): Promise<EventDto> {
    try {
      const res = await this.client.get(`/api/events/${eventId}`, {
        headers: this.graphHeaders(graphId),
      });
      return this.toEventDto(unwrap(res.data), graphId);
    } catch (err) {
      return this.handleError(err, `getting event ${eventId}`);
    }
  }

  async updateEvent(
    graphId: string,
    eventId: string,
    data: Partial<{ description: string; timestamp: string; actor?: string; target?: string }>
  ): Promise<EventDto> {
    try {
      const res = await this.client.put(
        `/api/events/${eventId}`,
        {
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.timestamp !== undefined ? { timestamp: data.timestamp } : {}),
          ...(data.actor !== undefined ? { actor: data.actor } : {}),
          ...(data.target !== undefined ? { target: data.target } : {}),
        },
        { headers: this.graphHeaders(graphId) }
      );
      return this.toEventDto(unwrap(res.data), graphId);
    } catch (err) {
      return this.handleError(err, `updating event ${eventId}`);
    }
  }

  async deleteEvent(graphId: string, eventId: string): Promise<void> {
    try {
      await this.client.delete(`/api/events/${eventId}`, {
        headers: this.graphHeaders(graphId),
      });
    } catch (err) {
      return this.handleError(err, `deleting event ${eventId}`);
    }
  }

  async createArc(
    graphId: string,
    data: { name: string; startTime: string; endTime: string; description?: string; parentArcId?: string }
  ): Promise<ArcDto> {
    try {
      const res = await this.client.post(
        '/api/arcs',
        {
          name: data.name,
          description: data.description || '',
          start_time: data.startTime,
          end_time: data.endTime,
          level: data.parentArcId ? 1 : 0,
          metadata: data.parentArcId ? { parentArcId: data.parentArcId } : undefined,
        },
        { headers: this.graphHeaders(graphId) }
      );
      return this.toArcDto(unwrap(res.data), graphId);
    } catch (err) {
      return this.handleError(err, 'creating arc');
    }
  }

  /** Map an arc record from the daemon to the CLI's arc shape. */
  private toArcDto(raw: unknown, graphId: string): ArcDto {
    const arc = isRecord(raw) ? raw : {};
    const metadata = readRecord(arc.metadata);
    const parentArcId =
      readOptionalString(arc.parentArcId) ??
      (metadata
        ? readOptionalString(metadata.parentArcId) ?? readOptionalString(metadata.parent_arc_id)
        : undefined);
    return {
      id: readString(arc.id),
      graphId,
      name: readString(arc.name),
      description: readOptionalString(arc.description),
      startTime: readString(arc.start_time || arc.startTime),
      endTime: readString(arc.end_time || arc.endTime),
      parentArcId,
      level: typeof arc.level === 'number' ? arc.level : undefined,
    };
  }

  async listArcs(graphId: string): Promise<ArcDto[]> {
    try {
      const arcs = await this.fetchAll('/api/arcs', graphId);
      return arcs.map((a) => this.toArcDto(a, graphId));
    } catch (err) {
      return this.handleError(err, 'listing arcs');
    }
  }

  async getArc(graphId: string, arcId: string): Promise<ArcDto> {
    try {
      const res = await this.client.get(`/api/arcs/${arcId}`, {
        headers: this.graphHeaders(graphId),
      });
      return this.toArcDto(unwrap(res.data), graphId);
    } catch (err) {
      return this.handleError(err, `getting arc ${arcId}`);
    }
  }

  async deleteArc(graphId: string, arcId: string): Promise<void> {
    try {
      await this.client.delete(`/api/arcs/${arcId}`, {
        headers: this.graphHeaders(graphId),
      });
    } catch (err) {
      return this.handleError(err, `deleting arc ${arcId}`);
    }
  }

  /**
   * Put an event inside an arc.
   *
   * The arc is recorded on the event's metadata, which is where the
   * validator, the exporters and the dot renderer look for it. The event is
   * read first so that the metadata it already carries is kept, and the arc
   * is checked first so that the event is not left pointing at an arc that
   * is not there.
   */
  async assignEventToArc(graphId: string, eventId: string, arcId: string): Promise<EventDto> {
    try {
      await this.getArc(graphId, arcId);

      const current = await this.client.get(`/api/events/${eventId}`, {
        headers: this.graphHeaders(graphId),
      });
      const raw = unwrap(current.data);
      const metadata = isRecord(raw) && isRecord(raw.metadata) ? { ...raw.metadata } : {};
      metadata.arcId = arcId;

      const updated = await this.client.put(
        `/api/events/${eventId}`,
        { metadata },
        { headers: this.graphHeaders(graphId) }
      );
      return this.toEventDto(unwrap(updated.data), graphId);
    } catch (err) {
      return this.handleError(err, `assigning event ${eventId} to arc ${arcId}`);
    }
  }

  async createCausalLink(
    graphId: string,
    data: { causeId: string; effectId: string; weight?: number; type?: string; reasoning?: string }
  ): Promise<CausalRelationshipDto> {
    try {
      const res = await this.client.post(
        '/api/causal/link',
        {
          causeEventId: data.causeId,
          effectEventId: data.effectId,
          relationship: {
            type: readRelationshipType(data.type),
            strength: data.weight ?? 1,
            confidence: 1,
            evidence: data.reasoning || '',
          },
        },
        { headers: this.graphHeaders(graphId) }
      );

      const echoed = isRecord(res.data) && isRecord(res.data.data) ? res.data.data.relationship : undefined;
      const echoedRecord = isRecord(echoed) ? echoed : undefined;

      // The route echoes the relationship it was given, which carries no id, so
      // the stored link is looked up to report the id the CLI's contract
      // promises.
      const stored = await this.findStoredRelationship(graphId, data.causeId, data.effectId);

      return {
        id: stored?.id ?? readString(echoedRecord?.id, ''),
        graphId,
        causeId: data.causeId,
        effectId: data.effectId,
        weight: stored?.weight ?? data.weight,
        type: stored?.type ?? readRelationshipType(data.type),
        reasoning: stored?.reasoning ?? data.reasoning,
      };
    } catch (err) {
      return this.handleError(err, 'creating causal link');
    }
  }

  /** The stored relationship between two events, if the daemon has one. */
  private async findStoredRelationship(
    graphId: string,
    causeId: string,
    effectId: string
  ): Promise<{ id: string; weight?: number; type?: string; reasoning?: string } | undefined> {
    try {
      const relationships = await this.listCausalLinks(graphId);
      return relationships.find((r) => r.causeId === causeId && r.effectId === effectId);
    } catch {
      return undefined;
    }
  }

  async listCausalLinks(graphId: string): Promise<CausalRelationshipDto[]> {
    try {
      const res = await this.client.get('/api/causal/relationships', {
        headers: this.graphHeaders(graphId),
      });
      const payload = unwrap(res.data);
      const list = Array.isArray(payload) ? payload : [];
      return list.map((raw) => {
        const rel = isRecord(raw) ? raw : {};
        return {
          id: readString(rel.id),
          graphId,
          causeId: readString(rel.cause_event_id),
          effectId: readString(rel.effect_event_id),
          weight: typeof rel.weight === 'number' ? rel.weight : undefined,
          type: readOptionalString(rel.relationship_type),
          reasoning: readOptionalString(rel.evidence),
        };
      });
    } catch (err) {
      return this.handleError(err, 'listing causal relationships');
    }
  }

  async deleteCausalLink(graphId: string, causeId: string, effectId: string): Promise<void> {
    try {
      // The daemon reads the pair from the request body, not from the query.
      await this.client.delete('/api/causal/link', {
        data: { causeEventId: causeId, effectEventId: effectId },
        headers: this.graphHeaders(graphId),
      });
    } catch (err) {
      return this.handleError(err, 'deleting causal link');
    }
  }

  /**
   * Find the causal paths between two events.
   *
   * The daemon serves chains (`GET /api/causal/chain/:eventId`) but no route
   * that answers "every path between these two events", so the paths are
   * computed here from the graph's relationships.
   */
  async findCausalPaths(
    graphId: string,
    fromId: string,
    toId: string
  ): Promise<{ paths: string[][]; count: number }> {
    try {
      const relationships = await this.listCausalLinks(graphId);
      const adjacency = new Map<string, string[]>();
      for (const rel of relationships) {
        const neighbours = adjacency.get(rel.causeId) || [];
        neighbours.push(rel.effectId);
        adjacency.set(rel.causeId, neighbours);
      }

      const paths: string[][] = [];
      const maxDepth = 10;

      const walk = (current: string, path: string[], visited: Set<string>): void => {
        if (current === toId) {
          paths.push([...path]);
          return;
        }
        if (path.length >= maxDepth) return;
        for (const next of adjacency.get(current) || []) {
          if (visited.has(next)) continue;
          visited.add(next);
          path.push(next);
          walk(next, path, visited);
          path.pop();
          visited.delete(next);
        }
      };

      walk(fromId, [fromId], new Set([fromId]));
      return { paths, count: paths.length };
    } catch (err) {
      return this.handleError(err, 'finding causal paths');
    }
  }

  /**
   * Map the daemon's ingestion preview onto the CLI's ingestion result.
   *
   * The daemon's ingestion routes do not write anything: they run the
   * extractor and return a review job that holds the extracted entities
   * until a reviewer approves it. The CLI therefore reports a preview -- no
   * entity was created -- and names the job the entities are waiting in,
   * rather than claiming that the graph now holds them.
   */
  private toIngestResult(raw: unknown, graphId: string | undefined): IngestResultDto {
    const body = isRecord(raw) ? raw : {};
    const extraction = isRecord(body.extraction) ? body.extraction : {};
    const events = Array.isArray(extraction.events) ? extraction.events : [];
    const arcs = Array.isArray(extraction.arcs) ? extraction.arcs : [];
    const relationships = Array.isArray(extraction.relationships) ? extraction.relationships : [];
    const resolvedGraphId = graphId || 'pending-review';

    return {
      graphId: resolvedGraphId,
      eventsCreated: 0,
      arcsCreated: 0,
      relationshipsCreated: 0,
      dryRun: true,
      pendingReview: {
        jobId: readString(body.jobId, 'pending'),
        events: events.length,
        arcs: arcs.length,
        relationships: relationships.length,
      },
      entities: {
        events: events.map((entry) => {
          const event = isRecord(entry) ? entry : {};
          return {
            id: readString(event.tempId),
            graphId: resolvedGraphId,
            description: readString(event.description),
            timestamp: readString(event.timestamp),
            actor: readOptionalString(event.actor),
            target: readOptionalString(event.target),
          };
        }),
        arcs: arcs.map((entry) => {
          const arc = isRecord(entry) ? entry : {};
          return {
            id: readString(arc.tempId),
            graphId: resolvedGraphId,
            name: readString(arc.name),
            description: readOptionalString(arc.description),
            startTime: readString(arc.start_time),
            endTime: readString(arc.end_time),
          };
        }),
        relationships: relationships.map((entry) => {
          const rel = isRecord(entry) ? entry : {};
          return {
            id: readString(rel.tempId),
            graphId: resolvedGraphId,
            causeId: readString(rel.causeEventTempId),
            effectId: readString(rel.effectEventTempId),
            weight: typeof rel.weight === 'number' ? rel.weight : undefined,
            reasoning: readOptionalString(rel.reasoning),
          };
        }),
      },
    };
  }

  /**
   * Whether the daemon's answer came from the language model.
   *
   * The daemon records where every entity came from, so a preview that holds
   * no model-made event is a preview the patterns made. The model path marks
   * its events with the source type `llm` -- that is what the providers put
   * on the events they return -- and names the reading as a whole with the
   * source `llm-generated`. The pattern path marks its events `text` and
   * names the reading `text-extraction`.
   */
  private wasModelUsed(raw: unknown): boolean {
    const body = isRecord(raw) ? raw : {};
    const extraction = isRecord(body.extraction) ? body.extraction : {};
    const events = Array.isArray(extraction.events) ? extraction.events : [];
    const modelEvent = events.some((entry) => {
      const event = isRecord(entry) ? entry : {};
      const source = isRecord(event.source) ? event.source : {};
      return source.type === 'llm';
    });
    if (modelEvent) return true;

    const sources = Array.isArray(extraction.sources) ? extraction.sources : [];
    return sources.some((entry) => isRecord(entry) && entry.type === 'llm-generated');
  }

  async ingestText(
    graphId: string | undefined,
    text: string,
    options: IngestTextOptions
  ): Promise<IngestResultDto> {
    try {
      const res = await this.client.post(
        '/api/ingest/text',
        { text, useLLM: options.mode !== 'pattern' },
        { headers: this.graphHeaders(graphId) }
      );
      if (options.mode === 'llm' && !this.wasModelUsed(res.data)) {
        // The daemon read the text with its patterns, because it has no model
        // configured or the model did not answer. The direct engine refuses to
        // report a pattern extraction as a model one, and so does this.
        throw new ValidationErrorCLI(
          'LLM extraction produced nothing: no provider answered the request. ' +
            'The daemon holds the provider configuration, so configure it there, or use ' +
            '--mode hybrid, which falls back to pattern extraction.'
        );
      }
      return this.toIngestResult(res.data, graphId);
    } catch (err) {
      return this.handleError(err, 'ingesting text');
    }
  }

  async ingestUrl(
    graphId: string | undefined,
    url: string,
    options: IngestUrlOptions
  ): Promise<IngestResultDto> {
    // The daemon's ingestion route reads Wikipedia articles. A page on any
    // other site is a web document, and the daemon has no route for that, so
    // the CLI says so rather than letting the request fail as a server error.
    if (!isWikipediaUrl(url)) {
      throw new ValidationErrorCLI(
        `The daemon reads Wikipedia articles only, so "${url}" cannot be ingested in remote mode. ` +
          'Run it with --direct to read a page on any site.'
      );
    }
    try {
      const res = await this.client.post(
        '/api/ingest/url',
        {
          url,
          options: {
            followLinks: options.followLinks,
            linkDepth: options.depth,
            maxPages: options.maxPages,
            linkFilter: options.filter,
          },
        },
        { headers: this.graphHeaders(graphId) }
      );
      return this.toIngestResult(res.data, graphId);
    } catch (err) {
      return this.handleError(err, 'ingesting url');
    }
  }

  async ingestWikidata(
    graphId: string | undefined,
    options: IngestWikidataOptions
  ): Promise<IngestResultDto> {
    try {
      const res = await this.client.post(
        '/api/ingest/wikidata',
        {
          queryType: options.sparql
            ? 'custom'
            : options.preset === 'person-timeline'
              ? 'person-timeline'
              : 'historical-events',
          customQuery: options.sparql,
          limit: options.limit,
        },
        { headers: this.graphHeaders(graphId) }
      );
      return this.toIngestResult(res.data, graphId);
    } catch (err) {
      return this.handleError(err, 'ingesting wikidata');
    }
  }

  /**
   * The daemon serves no generation routes.
   *
   * `POST /api/generate/timeline`, `/branch` and `/expand` are not mounted, so
   * a request to them would be answered by the 404 handler. The CLI says so
   * instead of pointing at a route that does something else.
   */
  private unsupportedGeneration(command: string, route: string): never {
    throw new CLIError(
      `The daemon at ${this.baseUrl} does not serve ${route}, so "${command}" cannot run in remote mode. ` +
        'Run it with --direct to generate against the local store.',
      ExitCode.GENERAL_ERROR,
      'UNSUPPORTED_REMOTE_OPERATION'
    );
  }

  async generateTimeline(_options: GenerateTimelineOptions): Promise<GenerationResultDto> {
    return this.unsupportedGeneration('generate timeline', 'POST /api/generate/timeline');
  }

  async generateBranch(_options: GenerateBranchOptions): Promise<GenerationResultDto> {
    return this.unsupportedGeneration('generate branch', 'POST /api/generate/branch');
  }

  async generateExpand(_options: GenerateExpandOptions): Promise<GenerationResultDto> {
    return this.unsupportedGeneration('generate expand', 'POST /api/generate/expand');
  }

  async generateSimulate(options: GenerateSimulateOptions): Promise<GenerationResultDto> {
    try {
      const res = await this.client.post<{ success: boolean; data: SimulationResult }>(
        '/api/inference/simulate',
        {
          steps: options.steps,
          stepDurationMs:
            options.timeAdvanceMonths !== undefined
              ? options.timeAdvanceMonths * MS_PER_MONTH
              : undefined,
          anchorEventId: options.anchorEventId,
          domain: options.domain,
          aggressiveness: options.aggressiveness,
          seedContext: options.seedContext,
          dryRun: options.dryRun,
        },
        { headers: this.graphHeaders(options.graphId) }
      );
      return toGenerationResultDto(res.data.data, 'Forward Simulation');
    } catch (err) {
      return this.handleError(err, 'simulating timeline');
    }
  }

  /**
   * The graph's data, reached through the same interface the direct engine
   * uses, so both engines run the same validator.
   */
  private remoteScopedServices(graphId: string): ScopedGraphServices {
    const findEvent = async (id: string): Promise<Event | null> => {
      try {
        const res = await this.client.get(`/api/events/${id}`, {
          headers: this.graphHeaders(graphId),
        });
        return this.toEvent(unwrap(res.data));
      } catch {
        return null;
      }
    };

    const findArc = async (id: string): Promise<Arc | null> => {
      try {
        const res = await this.client.get(`/api/arcs/${id}`, {
          headers: this.graphHeaders(graphId),
        });
        return this.toArc(unwrap(res.data));
      } catch {
        return null;
      }
    };

    return {
      eventRepository: {
        findAll: async (): Promise<Event[]> => {
          const events = await this.fetchAll('/api/events', graphId);
          return events.map((raw) => this.toEvent(raw));
        },
        findById: findEvent,
        update: async (id, updates): Promise<Event | null> => {
          const res = await this.client.put(
            `/api/events/${id}`,
            {
              ...(updates.description !== undefined ? { description: updates.description } : {}),
              ...(updates.timestamp !== undefined ? { timestamp: updates.timestamp } : {}),
              ...(updates.actor !== undefined ? { actor: updates.actor } : {}),
              ...(updates.target !== undefined ? { target: updates.target } : {}),
              ...(updates.metadata !== undefined ? { metadata: updates.metadata } : {}),
            },
            { headers: this.graphHeaders(graphId) }
          );
          return this.toEvent(unwrap(res.data));
        },
        delete: async (id: string): Promise<boolean> => {
          await this.client.delete(`/api/events/${id}`, {
            headers: this.graphHeaders(graphId),
          });
          return true;
        },
      },
      arcRepository: {
        findAll: async (): Promise<Arc[]> => {
          const arcs = await this.fetchAll('/api/arcs', graphId);
          return arcs.map((raw) => this.toArc(raw));
        },
        findById: findArc,
        update: async (id, updates): Promise<Arc | null> => {
          const res = await this.client.put(
            `/api/arcs/${id}`,
            {
              ...(updates.name !== undefined ? { name: updates.name } : {}),
              ...(updates.description !== undefined ? { description: updates.description } : {}),
              ...(updates.start_time !== undefined ? { start_time: updates.start_time } : {}),
              ...(updates.end_time !== undefined ? { end_time: updates.end_time } : {}),
              ...(updates.level !== undefined ? { level: updates.level } : {}),
              ...(updates.metadata !== undefined ? { metadata: updates.metadata } : {}),
            },
            { headers: this.graphHeaders(graphId) }
          );
          return this.toArc(unwrap(res.data));
        },
        delete: async (id: string): Promise<boolean> => {
          await this.client.delete(`/api/arcs/${id}`, {
            headers: this.graphHeaders(graphId),
          });
          return true;
        },
      },
      causalService: {
        getAllRelationships: async () => {
          const res = await this.client.get('/api/causal/relationships', {
            headers: this.graphHeaders(graphId),
          });
          const payload = unwrap(res.data);
          const list = Array.isArray(payload) ? payload : [];
          return list.map((raw) => {
            const rel = isRecord(raw) ? raw : {};
            return {
              id: readString(rel.id),
              cause_event_id: readString(rel.cause_event_id),
              effect_event_id: readString(rel.effect_event_id),
              weight: readNumber(rel.weight, 1),
              confidence: readNumber(rel.confidence, 1),
              evidence: readString(rel.evidence),
              relationship_type: readString(rel.relationship_type, 'direct'),
            };
          });
        },
        createCausalLink: async (cause: Event, effect: Event, relationship: CausalRelationship) => {
          await this.client.post(
            '/api/causal/link',
            {
              causeEventId: cause.id,
              effectEventId: effect.id,
              relationship: {
                type: relationship.relationship_type,
                strength: relationship.weight,
                confidence: relationship.confidence,
                evidence: relationship.evidence,
              },
            },
            { headers: this.graphHeaders(graphId) }
          );
        },
        deleteCausalLink: async (causeId: string, effectId: string) => {
          await this.client.delete('/api/causal/link', {
            data: { causeEventId: causeId, effectEventId: effectId },
            headers: this.graphHeaders(graphId),
          });
        },
      },
    };
  }

  /** Build an event model instance from a daemon record. */
  private toEvent(raw: unknown): Event {
    const event = isRecord(raw) ? raw : {};
    return new Event({
      id: readString(event.id),
      description: readString(event.description, 'Untitled event'),
      actor: readString(event.actor, 'Unknown'),
      target: readString(event.target, 'Unknown'),
      timestamp: new Date(readString(event.timestamp)),
      metadata: readRecord(event.metadata),
    });
  }

  /** Build an arc model instance from a daemon record. */
  private toArc(raw: unknown): Arc {
    const arc = isRecord(raw) ? raw : {};
    const metadata = readRecord(arc.metadata);
    const parentArcId = readOptionalString(arc.parentArcId) ?? (metadata ? readOptionalString(metadata.parentArcId) : undefined);
    if (parentArcId && metadata) {
      metadata.parentArcId = parentArcId;
    }
    return new Arc({
      id: readString(arc.id),
      name: readString(arc.name, 'Untitled arc'),
      description: readString(arc.description),
      start_time: new Date(readString(arc.start_time)),
      end_time: new Date(readString(arc.end_time)),
      level: readNumber(arc.level, 0),
      metadata,
    });
  }

  /**
   * The graph that owns an entity, when it is not this one.
   *
   * A reference that points into a sibling graph is broken in this graph but
   * not dangling, and the difference matters: the entity has to be copied,
   * not the reference deleted. The lookup only runs for references that are
   * already broken, so a healthy graph never pays for it.
   *
   * The answer is cached, and so is the data of every graph it looks at: the
   * lookup runs per broken reference, and downloading a graph per reference
   * is a lot of traffic for an answer that does not change. The graph routes
   * are rate-limited, so a lookup that runs once per reference would also run
   * into the limit.
   *
   * A failure is not cached. The list of the graphs is fetched again after a
   * failed request, and the answer for an entity is looked up again after a
   * failed one: a single rate-limited request must not make every later
   * lookup of the run fail, and a failed lookup must never be read as "no
   * other graph holds this entity".
   */
  private createCrossGraphLookup(graphId: string): CrossGraphLookup {
    const answers = new Map<string, Promise<string | undefined>>();
    const graphData = new Map<string, Promise<{ events: Record<string, unknown>[]; arcs: Record<string, unknown>[] }>>();
    let graphs: Promise<GraphSummaryDto[]> | null = null;

    const otherGraphs = (): Promise<GraphSummaryDto[]> => {
      if (!graphs) {
        const attempt = this.listGraphs();
        graphs = attempt;
        // A failed listing is not kept: the next lookup tries again.
        attempt.catch(() => {
          if (graphs === attempt) graphs = null;
        });
      }
      return graphs.then((list) => list.filter((graph) => graph.id !== graphId));
    };

    const dataOf = (id: string) => {
      const cached = graphData.get(id);
      if (cached) return cached;
      const data = this.fetchGraphData(id);
      graphData.set(id, data);
      data.catch(() => {
        if (graphData.get(id) === data) graphData.delete(id);
      });
      return data;
    };

    return (entityId: string): Promise<string | undefined> => {
      const cached = answers.get(entityId);
      if (cached) return cached;
      const answer = otherGraphs().then(async (list) => {
        for (const graph of list) {
          const data = await dataOf(graph.id);
          const ownsEvent = data.events.some((event) => event.id === entityId);
          const ownsArc = data.arcs.some((arc) => arc.id === entityId);
          if (ownsEvent || ownsArc) return graph.id;
        }
        return undefined;
      });
      answers.set(entityId, answer);
      // A failed answer is not kept either: it is not an answer.
      answer.catch(() => {
        if (answers.get(entityId) === answer) answers.delete(entityId);
      });
      return answer;
    };
  }

  /**
   * Validate a graph that lives on the daemon.
   *
   * The daemon's own validation route is not used: `POST /api/validate/graph`
   * validates the arrays it is given and nothing else, so it cannot look at
   * the graph that is stored. The CLI therefore fetches the graph's events,
   * arcs and relationships and runs the same `GraphValidator` the direct
   * engine runs over them, which is why remote validation reports the same
   * issues -- including the causal cycles the daemon's route does not look
   * for -- and can repair them the same way.
   */
  async validateGraph(
    graphId: string,
    strict?: boolean,
    autoRepair?: boolean
  ): Promise<ValidationReportDto> {
    try {
      const validator = new GraphValidator();
      return await validator.validate(graphId, this.remoteScopedServices(graphId), {
        strict,
        autoRepair,
        crossGraphLookup: this.createCrossGraphLookup(graphId),
      });
    } catch (err) {
      return this.handleError(err, 'validating graph');
    }
  }

  async exportGraph(
    graphId: string,
    format: ExportFormat = 'json',
    outputPath?: string
  ): Promise<ExportResultDto> {
    try {
      const res = await this.client.get('/api/export', {
        headers: this.graphHeaders(graphId),
      });

      // A graph above the daemon's entity threshold is exported as a job
      // rather than inline: the daemon answers 202 with the job, and the
      // document has to be fetched once the job has finished. Treating that
      // answer as a document would write a well-formed, empty graph and
      // report success.
      const document =
        res.status === 202 ? await this.awaitExportJob(res.data, graphId) : res.data;

      let content: string;
      if (format === 'json') {
        // Validated for every format: a document that is not an export
        // document must not be written to a file as if it were one.
        parseExportDocument(document);
        // Compact: a large export is already held whole, and indenting it
        // doubles that again for no benefit to a machine-read file.
        content = typeof document === 'string' ? document : JSON.stringify(document);
      } else {
        const parsed = parseExportDocument(document);
        const exporter = new GraphExporter();
        content =
          format === 'markdown'
            ? exporter.generateMarkdown(parsed.graphId, parsed.graphName, parsed.description, parsed.events, parsed.arcs, parsed.relationships)
            : format === 'dot'
              ? exporter.generateDot(parsed.graphId, parsed.graphName, parsed.events, parsed.arcs, parsed.relationships)
              : exporter.generateGraphML(parsed.graphId, parsed.graphName, parsed.events, parsed.arcs, parsed.relationships);
      }

      if (outputPath) {
        const fs = await import('fs');
        const path = await import('path');
        const resolvedPath = path.resolve(outputPath);
        await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
        await fs.promises.writeFile(resolvedPath, content, 'utf8');
      }

      return {
        graphId,
        format,
        content,
        outputPath: outputPath ? (await import('path')).resolve(outputPath) : undefined,
        bytesWritten: Buffer.byteLength(content, 'utf8'),
      };
    } catch (err) {
      return this.handleError(err, 'exporting graph');
    }
  }

  /**
   * Wait for an export job and read the document it produced.
   *
   * The daemon answers `GET /export` with 202 and the job when the graph is
   * too large to render synchronously. The job's status is polled until it
   * finishes, and the finished export is downloaded.
   */
  private async awaitExportJob(answer: unknown, graphId: string): Promise<unknown> {
    const jobId = isRecord(answer) && isRecord(answer.data)
      ? answer.data.jobId ?? answer.data.id
      : undefined;

    if (typeof jobId !== 'string' || jobId.length === 0) {
      throw new CLIError(
        'The daemon started an asynchronous export but did not name the job',
        ExitCode.GENERAL_ERROR
      );
    }

    // The status route is behind the daemon's rate limiter, which allows 60
    // requests a minute per key by default. Polling every 250 ms would spend
    // 240 a minute and be turned away before a large export finished; two
    // seconds is 30 a minute and leaves room for the rest of the command.
    const pollIntervalMs = 2000;
    const maxAttempts = 60; // two minutes
    let lastStatus = 'pending';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.client.get(`/api/export/jobs/${jobId}`, {
        headers: this.graphHeaders(graphId),
      });
      const job = isRecord(status.data) && isRecord(status.data.data) ? status.data.data : undefined;
      const jobStatus = typeof job?.status === 'string' ? job.status : undefined;

      if (jobStatus) lastStatus = jobStatus;

      if (jobStatus === 'completed') {
        // The download is the whole document, which is the reason the job
        // ran: the default request timeout would cut a large export off.
        const download = await this.client.get(`/api/export/jobs/${jobId}/download`, {
          headers: this.graphHeaders(graphId),
          timeout: DOWNLOAD_TIMEOUT_MS,
        });
        return download.data;
      }

      if (jobStatus === 'failed' || jobStatus === 'cancelled') {
        const reason = typeof job?.error === 'string' ? `: ${job.error}` : '';
        throw new CLIError(
          `The daemon's export job ${jobId} ended as "${jobStatus}"${reason}`,
          ExitCode.GENERAL_ERROR
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // The job is still running, and this command is giving up on it: it is
    // cancelled so that it does not keep working and leave its file behind.
    await this.cancelExportJob(jobId, graphId);

    throw new CLIError(
      `The daemon's export job ${jobId} did not finish within the wait (last status: ${lastStatus}); it was cancelled`,
      ExitCode.GENERAL_ERROR
    );
  }

  /**
   * Ask the daemon to cancel an export job, without failing the command.
   *
   * This runs on a path that is already reporting a failure, so a failure to
   * cancel is not allowed to replace the reason the command failed.
   */
  private async cancelExportJob(jobId: string, graphId: string): Promise<void> {
    try {
      await this.client.delete(`/api/export/jobs/${jobId}`, {
        headers: this.graphHeaders(graphId),
      });
    } catch {
      // The command is already reporting a failure; the cancel is best effort.
    }
  }

  async importGraph(
    contentOrPath: string,
    options?: { strategy?: 'skip' | 'overwrite' | 'rename'; graphId?: string }
  ): Promise<ImportResultDto> {
    try {
      const fs = await import('fs');
      let content = contentOrPath;
      if (fs.existsSync(contentOrPath)) {
        content = await fs.promises.readFile(contentOrPath, 'utf8');
      }
      const res = await this.client.post('/api/import', {
        data: JSON.parse(content),
        targetGraphId: options?.graphId,
        mode: options?.graphId ? 'merge' : 'create-new',
        conflictResolution: options?.strategy || 'skip',
      });
      const body = isRecord(res.data) ? res.data : {};
      const imported = isRecord(body.imported) ? body.imported : {};
      const skipped = isRecord(body.skipped) ? body.skipped : {};
      return {
        graphId: readString(body.graphId, options?.graphId || 'imported'),
        imported: {
          events: readNumber(imported.events, 0),
          arcs: readNumber(imported.arcs, 0),
          relationships: readNumber(imported.relationships, 0),
        },
        skipped: {
          events: readNumber(skipped.events, 0),
          arcs: readNumber(skipped.arcs, 0),
          relationships: readNumber(skipped.relationships, 0),
        },
        conflicts: Array.isArray(body.errors) ? body.errors.length : 0,
        strategy: options?.strategy || 'skip',
      };
    } catch (err) {
      return this.handleError(err, 'importing graph');
    }
  }
}
