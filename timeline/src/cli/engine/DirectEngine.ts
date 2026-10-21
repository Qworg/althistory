import { IEngine } from './IEngine';
import {
  HealthInfo,
  GraphSummaryDto,
  EventDto,
  ArcDto,
  CausalRelationshipDto,
  IngestTextOptions,
  IngestResultDto,
  SkippedRelationship,
  GenerateTimelineOptions,
  GenerateBranchOptions,
  GenerationResultDto,
  ValidationReportDto,
  ExportFormat,
  ExportResultDto,
  ImportResultDto,
} from '../types';
import { GraphValidator, CrossGraphLookup } from '../validation/GraphValidator';
import { GraphExporter } from '../export/GraphExporter';
import { GraphImporter } from '../export/GraphImporter';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, getContainer, Container } from '@/container';
import { NotFoundErrorCLI, ValidationErrorCLI } from '../utils/exitCodes';
import { Event, UpdateEventRequest } from '@/models';
import { CausalRelationship, CausalRelationshipType } from '@/models/relationships';
import { TextExtractor } from '@/services/ingestion/TextExtractor';
import { WikipediaExtractor } from '@/services/ingestion/WikipediaExtractor';
import { WikidataExtractor } from '@/services/ingestion/WikidataExtractor';
import { WebDocumentExtractor, isWikipediaUrl } from '@/services/ingestion/WebDocumentExtractor';
import { PublicWebHttpClient } from '@/services/ingestion/publicWebHttp';
import { mergeExtractionResults } from '@/services/ingestion/mergeExtractions';
import { FetchHttpClient, HttpClient } from '@/services/ingestion/http';
import { createLLMClient } from '@/services/llm';
import { clusterEventsIntoArcs } from '../generator/arcClustering';
import { TimelineGenerator } from '../generator/TimelineGenerator';
import { ExtractionResult } from '@/services/ingestion/types';
import {
  IngestUrlOptions,
  IngestWikidataOptions,
  GenerateExpandOptions,
  GenerateSimulateOptions,
} from '../types';
import { MS_PER_MONTH, toGenerationResultDto } from './simulationMapper';
import type { SimulationRequest } from '@/services/SimulationService';
import { isTemporalInversion } from '@/utils/causalOrder';
import { validateCausalRelationshipFields } from '@/services/CausalService';

export interface DirectEngineOptions {
  /**
   * The HTTP client the ingestion extractors use.
   *
   * The default fetches the web. A test injects a client backed by recorded
   * fixtures, so the ingestion tests never touch the network.
   */
  httpClient?: HttpClient;
}

export class DirectEngine implements IEngine {
  readonly mode = 'direct' as const;
  private containerPromise?: Promise<Container>;
  private readonly httpClient?: HttpClient;

  constructor(options: DirectEngineOptions = {}) {
    this.httpClient = options.httpClient;
  }

  private async getInitializedContainer(): Promise<Container> {
    if (!this.containerPromise) {
      this.containerPromise = (async () => {
        try {
          return getContainer();
        } catch {
          // Set local execution mode for standalone CLI execution
          process.env.LOCAL_EXECUTION_ENABLED = 'true';
          const config = loadConfig();
          const databaseManager = await initializeDatabaseManager(config.database);
          const container = initializeContainer(databaseManager, config);
          await container.initialize();
          return container;
        }
      })();
    }
    return this.containerPromise;
  }

  public async getContainer(): Promise<Container> {
    return this.getInitializedContainer();
  }

  async shutdown(): Promise<void> {
    try {
      await cleanupContainer();
    } catch {
      // Ignore errors on shutdown
    }
  }

  async getHealth(): Promise<HealthInfo> {
    const container = await this.getInitializedContainer();
    let graphsCount = 0;
    try {
      const result = await container.graphService.listGraphs({ limit: 1000, offset: 0 });
      graphsCount = result.total;
    } catch {
      // Graphs count optional
    }

    return {
      status: 'healthy',
      mode: 'local',
      executionMode: 'direct',
      uptimeSeconds: process.uptime(),
      graphsCount,
    };
  }

  async listGraphs(): Promise<GraphSummaryDto[]> {
    const container = await this.getInitializedContainer();
    const result = await container.graphService.listGraphs({ limit: 1000, offset: 0 });
    return result.graphs.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      currentVersion: 'v1',
      parentGraphId: g.parentGraphId,
      branchPointVersion: undefined,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    }));
  }

  async createGraph(name: string, description?: string): Promise<GraphSummaryDto> {
    const container = await this.getInitializedContainer();
    const created = await container.graphService.createGraph({
      name,
      description,
    });
    return {
      id: created.id,
      name: created.name,
      description: created.description,
      currentVersion: 'v1',
      parentGraphId: created.parentGraphId,
      branchPointVersion: undefined,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  async getGraph(id: string): Promise<GraphSummaryDto> {
    const container = await this.getInitializedContainer();
    const graph = await container.graphService.getGraph(id);
    if (!graph) {
      throw new NotFoundErrorCLI(`Graph not found: ${id}`);
    }
    return {
      id: graph.id,
      name: graph.name,
      description: graph.description,
      currentVersion: 'v1',
      parentGraphId: graph.parentGraphId,
      branchPointVersion: undefined,
      createdAt: graph.createdAt,
      updatedAt: graph.updatedAt,
    };
  }

  async branchGraph(id: string, name: string): Promise<GraphSummaryDto> {
    const container = await this.getInitializedContainer();
    const branched = await container.graphService.branchGraph(id, {
      name,
    });
    return {
      id: branched.id,
      name: branched.name,
      description: branched.description,
      currentVersion: 'v1',
      parentGraphId: branched.parentGraphId,
      branchPointVersion: undefined,
      createdAt: branched.createdAt,
      updatedAt: branched.updatedAt,
    };
  }

  async mergeGraph(sourceId: string, targetId: string, strategy: string = 'keep-source'): Promise<{ success: boolean; version?: string }> {
    const container = await this.getInitializedContainer();
    const validStrategy = (strategy === 'keep-target' ? 'keep-target' : 'keep-source') as 'keep-source' | 'keep-target';
    const result = await container.graphService.mergeGraph(targetId, {
      sourceGraphId: sourceId,
      conflictResolution: validStrategy,
    });
    return {
      success: result.success,
      version: result.newVersion !== undefined ? String(result.newVersion) : undefined,
    };
  }

  async diffGraph(sourceId: string, targetId: string): Promise<Record<string, unknown>> {
    const container = await this.getInitializedContainer();
    const sourceData = await container.graphRepository.checkout(sourceId);
    const targetData = await container.graphRepository.checkout(targetId);

    const sourceEvents = Object.keys(sourceData.events);
    const targetEvents = Object.keys(targetData.events);
    const addedEvents = targetEvents.filter((id) => !sourceData.events[id]);
    const deletedEvents = sourceEvents.filter((id) => !targetData.events[id]);
    const modifiedEvents = targetEvents.filter(
      (id) => sourceData.events[id] && JSON.stringify(sourceData.events[id]) !== JSON.stringify(targetData.events[id])
    );

    return {
      sourceGraphId: sourceId,
      targetGraphId: targetId,
      events: {
        added: addedEvents.length,
        modified: modifiedEvents.length,
        deleted: deletedEvents.length,
        addedIds: addedEvents,
        deletedIds: deletedEvents,
        modifiedIds: modifiedEvents,
      },
      arcs: {
        added: Object.keys(targetData.arcs).filter((id) => !sourceData.arcs[id]).length,
        deleted: Object.keys(sourceData.arcs).filter((id) => !targetData.arcs[id]).length,
      },
      relationships: {
        added: Object.keys(targetData.relationships).filter((id) => !sourceData.relationships[id]).length,
        deleted: Object.keys(sourceData.relationships).filter((id) => !targetData.relationships[id]).length,
      },
    };
  }

  async rollbackGraph(id: string, version: string): Promise<{ success: boolean; currentVersion: string }> {
    const container = await this.getInitializedContainer();
    const versionNum = parseInt(version, 10) || 0;
    const versionRef = await container.graphService.rollbackGraph(id, versionNum);
    return {
      success: true,
      currentVersion: versionRef ? String(versionRef.version) : version,
    };
  }

  async deleteGraph(id: string): Promise<void> {
    const container = await this.getInitializedContainer();
    await container.graphService.deleteGraph(id);
  }

  async createEvent(
    graphId: string,
    data: { description: string; timestamp: string; actor?: string; target?: string; importance?: number; metadata?: Record<string, unknown> }
  ): Promise<EventDto> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    const parsedDate = new Date(data.timestamp);
    if (isNaN(parsedDate.getTime())) {
      throw new ValidationErrorCLI(`Invalid timestamp: ${data.timestamp}`);
    }

    const created = await scoped.eventRepository.create({
      description: data.description,
      timestamp: parsedDate,
      actor: data.actor || 'Unknown',
      target: data.target || 'None',
      metadata: { importance: data.importance ?? 1, ...(data.metadata || {}) },
    });

    try {
      await container.graphWriteVersioningService.recordEvent(graphId, created, 'create');
    } catch {
      // Best-effort in direct mode
    }

    return {
      id: created.id,
      graphId,
      description: created.description,
      timestamp: created.timestamp.toISOString(),
      actor: created.actor,
      target: created.target,
    };
  }

  async listEvents(graphId: string, filters?: { actor?: string; from?: string; to?: string }): Promise<EventDto[]> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    let events = await scoped.eventRepository.findAll();

    if (filters?.actor) {
      events = events.filter((e) => e.actor.toLowerCase().includes(filters.actor!.toLowerCase()));
    }
    if (filters?.from) {
      const fromTime = new Date(filters.from).getTime();
      events = events.filter((e) => e.timestamp.getTime() >= fromTime);
    }
    if (filters?.to) {
      const toTime = new Date(filters.to).getTime();
      events = events.filter((e) => e.timestamp.getTime() <= toTime);
    }

    return events.map((e) => ({
      id: e.id,
      graphId,
      description: e.description,
      timestamp: e.timestamp.toISOString(),
      actor: e.actor,
      target: e.target,
    }));
  }

  async getEvent(graphId: string, eventId: string): Promise<EventDto> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    const event = await scoped.eventRepository.findById(eventId);
    if (!event) {
      throw new NotFoundErrorCLI(`Event not found: ${eventId} in graph ${graphId}`);
    }
    return {
      id: event.id,
      graphId,
      description: event.description,
      timestamp: event.timestamp.toISOString(),
      actor: event.actor,
      target: event.target,
    };
  }

  async updateEvent(
    graphId: string,
    eventId: string,
    data: Partial<{ description: string; timestamp: string; actor?: string; target?: string }>
  ): Promise<EventDto> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    const updatePayload: UpdateEventRequest = {};
    if (data.description !== undefined) updatePayload.description = data.description;
    if (data.actor !== undefined) updatePayload.actor = data.actor;
    if (data.target !== undefined) updatePayload.target = data.target;
    if (data.timestamp !== undefined) {
      const d = new Date(data.timestamp);
      if (isNaN(d.getTime())) throw new ValidationErrorCLI(`Invalid timestamp: ${data.timestamp}`);
      updatePayload.timestamp = d;
    }

    const updated = await scoped.eventRepository.update(eventId, updatePayload);
    if (!updated) {
      throw new NotFoundErrorCLI(`Event not found: ${eventId}`);
    }

    try {
      await container.graphWriteVersioningService.recordEvent(graphId, updated, 'update');
    } catch {
      // Best-effort
    }

    return {
      id: updated.id,
      graphId,
      description: updated.description,
      timestamp: updated.timestamp.toISOString(),
      actor: updated.actor,
      target: updated.target,
    };
  }

  async deleteEvent(graphId: string, eventId: string): Promise<void> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    const deleted = await scoped.eventRepository.delete(eventId);
    if (!deleted) {
      throw new NotFoundErrorCLI(`Event not found: ${eventId}`);
    }
  }

  async createArc(
    graphId: string,
    data: { name: string; startTime: string; endTime: string; description?: string; parentArcId?: string }
  ): Promise<ArcDto> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    const start = new Date(data.startTime);
    const end = new Date(data.endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new ValidationErrorCLI('Invalid start or end time for arc');
    }
    if (start.getTime() > end.getTime()) {
      throw new ValidationErrorCLI(`Arc startTime (${data.startTime}) must precede endTime (${data.endTime})`);
    }

    const created = await scoped.arcRepository.create({
      name: data.name,
      description: data.description || '',
      start_time: start,
      end_time: end,
      level: 0,
      metadata: data.parentArcId ? { parentArcId: data.parentArcId } : {},
    });

    try {
      await container.graphWriteVersioningService.recordArc(graphId, created, 'create');
    } catch {
      // Best-effort in direct mode
    }

    return {
      id: created.id,
      graphId,
      name: created.name,
      description: created.description,
      startTime: created.start_time.toISOString(),
      endTime: created.end_time.toISOString(),
      parentArcId: data.parentArcId,
    };
  }

  async listArcs(graphId: string): Promise<ArcDto[]> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    const arcs = await scoped.arcRepository.findAll();
    return arcs.map((a) => ({
      id: a.id,
      graphId,
      name: a.name,
      description: a.description,
      startTime: a.start_time.toISOString(),
      endTime: a.end_time.toISOString(),
      parentArcId: (a.metadata?.parentArcId as string) || undefined,
      level: a.level,
    }));
  }

  async getArc(graphId: string, arcId: string): Promise<ArcDto> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    const arc = await scoped.arcRepository.findById(arcId);
    if (!arc) {
      throw new NotFoundErrorCLI(`Arc not found: ${arcId} in graph ${graphId}`);
    }
    return {
      id: arc.id,
      graphId,
      name: arc.name,
      description: arc.description,
      startTime: arc.start_time.toISOString(),
      endTime: arc.end_time.toISOString(),
      parentArcId: (arc.metadata?.parentArcId as string) || undefined,
      level: arc.level,
    };
  }

  async deleteArc(graphId: string, arcId: string): Promise<void> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    const deleted = await scoped.arcRepository.delete(arcId);
    if (!deleted) {
      throw new NotFoundErrorCLI(`Arc not found: ${arcId} in graph ${graphId}`);
    }
  }

  /**
   * Put an event inside an arc.
   *
   * The arc is recorded on the event's metadata, which is where the
   * validator, the exporters and the dot renderer look for it.
   */
  async assignEventToArc(graphId: string, eventId: string, arcId: string): Promise<EventDto> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);

    const event = await scoped.eventRepository.findById(eventId);
    if (!event) {
      throw new NotFoundErrorCLI(`Event not found: ${eventId} in graph ${graphId}`);
    }
    const arc = await scoped.arcRepository.findById(arcId);
    if (!arc) {
      throw new NotFoundErrorCLI(`Arc not found: ${arcId} in graph ${graphId}`);
    }

    const updated = await scoped.eventRepository.update(eventId, {
      metadata: { ...(event.metadata || {}), arcId },
    });
    if (!updated) {
      throw new NotFoundErrorCLI(`Event not found: ${eventId}`);
    }

    try {
      await container.graphWriteVersioningService.recordEvent(graphId, updated, 'update');
    } catch {
      // Best effort
    }

    return {
      id: updated.id,
      graphId,
      description: updated.description,
      timestamp: updated.timestamp.toISOString(),
      actor: updated.actor,
      target: updated.target,
    };
  }

  async createCausalLink(
    graphId: string,
    data: { causeId: string; effectId: string; weight?: number; type?: string; reasoning?: string }
  ): Promise<CausalRelationshipDto> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);

    // Verify temporal constraint: the cause may not follow the effect
    const cause = await scoped.eventRepository.findById(data.causeId);
    const effect = await scoped.eventRepository.findById(data.effectId);
    if (!cause) throw new NotFoundErrorCLI(`Cause event not found: ${data.causeId}`);
    if (!effect) throw new NotFoundErrorCLI(`Effect event not found: ${data.effectId}`);

    if (isTemporalInversion(cause.timestamp, effect.timestamp)) {
      throw new ValidationErrorCLI(
        `Temporal ordering violation: cause timestamp (${cause.timestamp.toISOString()}) must not be after effect timestamp (${effect.timestamp.toISOString()})`
      );
    }

    const rel: CausalRelationship = {
      weight: data.weight ?? 1.0,
      evidence: data.reasoning || 'Observed historical causality',
      confidence: 1.0,
      relationship_type: (data.type as CausalRelationshipType) || 'direct',
    };

    const created = await scoped.causalService.createCausalLink(cause, effect, rel);

    try {
      await container.graphWriteVersioningService.recordRelationship(graphId, created, 'create');
    } catch {
      // Best effort
    }

    return {
      id: created.id,
      graphId,
      causeId: created.cause_event_id,
      effectId: created.effect_event_id,
      weight: created.weight,
      type: created.relationship_type,
      reasoning: created.evidence,
    };
  }

  async listCausalLinks(graphId: string): Promise<CausalRelationshipDto[]> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    const rels = await scoped.causalService.getAllRelationships();
    return rels.map((r) => ({
      id: r.id,
      graphId,
      causeId: r.cause_event_id,
      effectId: r.effect_event_id,
      weight: r.weight,
      type: r.relationship_type,
      reasoning: r.evidence,
    }));
  }

  async deleteCausalLink(graphId: string, causeId: string, effectId: string): Promise<void> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    await scoped.causalService.deleteCausalLink(causeId, effectId);
  }

  async findCausalPaths(graphId: string, fromId: string, toId: string): Promise<{ paths: string[][]; count: number }> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    const fromEvent = await scoped.eventRepository.findById(fromId);
    if (!fromEvent) throw new NotFoundErrorCLI(`Event not found: ${fromId}`);
    const toEvent = await scoped.eventRepository.findById(toId);
    if (!toEvent) throw new NotFoundErrorCLI(`Event not found: ${toId}`);

    const rels = await scoped.causalService.getAllRelationships();
    const adj = new Map<string, string[]>();
    for (const r of rels) {
      const existing = adj.get(r.cause_event_id) || [];
      existing.push(r.effect_event_id);
      adj.set(r.cause_event_id, existing);
    }

    const paths: string[][] = [];
    const maxDepth = 10;

    const dfs = (curr: string, currentPath: string[], visited: Set<string>) => {
      if (curr === toId) {
        paths.push([...currentPath]);
        return;
      }
      if (currentPath.length >= maxDepth) return;

      const neighbors = adj.get(curr) || [];
      for (const next of neighbors) {
        if (!visited.has(next)) {
          visited.add(next);
          currentPath.push(next);
          dfs(next, currentPath, visited);
          currentPath.pop();
          visited.delete(next);
        }
      }
    };

    dfs(fromId, [fromId], new Set([fromId]));

    return {
      paths,
      count: paths.length,
    };
  }

  private async persistExtractedEntities(
    targetGraphId: string,
    extracted: ExtractionResult,
    options: {
      groupArcs?: boolean;
      inferCauses?: boolean;
      minConfidence?: number;
      dryRun?: boolean;
    }
  ): Promise<IngestResultDto> {
    const container = await this.getInitializedContainer();
    const minConf = options.minConfidence ?? 0;
    const events = extracted.events.filter((e) => e.confidence >= minConf);
    let arcs = [...extracted.arcs];
    const relationships = [...extracted.relationships];

    // Group into arcs if requested and not already present
    if (options.groupArcs && arcs.length === 0 && events.length > 0) {
      arcs = clusterEventsIntoArcs(events, events[0].source);
    }

    // Infer causes if requested and not already present
    if (options.inferCauses && relationships.length === 0 && events.length >= 2) {
      const tempEvents = events.map(
        (e) =>
          new Event({
            id: e.tempId,
            description: e.description,
            timestamp: new Date(e.timestamp),
            actor: e.actor || 'Unknown',
            target: e.target || 'None',
          })
      );
      const suggestions = container.inferenceService.suggestCausalLinks(tempEvents);
      for (const s of suggestions) {
        relationships.push({
          tempId: `rel-${s.cause_event_id}-${s.effect_event_id}`,
          causeEventTempId: s.cause_event_id,
          effectEventTempId: s.effect_event_id,
          weight: s.suggested_relationship.weight,
          confidence: s.suggested_relationship.confidence,
          reasoning: s.reasoning,
          source: events[0].source,
          selected: true,
        });
      }
    }

    if (options.dryRun) {
      // The dry run has to count what the real run would create, or the two
      // disagree. The real run skips a link whose cause follows its effect,
      // and a link the server would refuse, so the dry run skips those too.
      const timestampsByTempId = new Map<string, Date>();
      for (const event of events) {
        timestampsByTempId.set(event.tempId, new Date(event.timestamp));
      }

      const creatableRelationships = relationships.filter((r) => {
        const causeTime = timestampsByTempId.get(r.causeEventTempId);
        const effectTime = timestampsByTempId.get(r.effectEventTempId);
        if (!causeTime || !effectTime) return false;
        if (isTemporalInversion(causeTime, effectTime)) return false;
        return validateCausalRelationshipFields({
          weight: r.weight ?? 1.0,
          evidence: r.reasoning || '',
          confidence: r.confidence ?? 1.0,
          relationship_type: 'direct',
        }).length === 0;
      });

      return {
        graphId: targetGraphId,
        eventsCreated: events.length,
        arcsCreated: arcs.length,
        relationshipsCreated: creatableRelationships.length,
        dryRun: true,
        entities: {
          events: events.map((e) => ({
            id: e.tempId,
            graphId: targetGraphId,
            description: e.description,
            timestamp: e.timestamp,
            actor: e.actor,
            target: e.target,
          })),
          arcs: arcs.map((a) => ({
            id: a.tempId,
            graphId: targetGraphId,
            name: a.name,
            description: a.description,
            startTime: a.start_time,
            endTime: a.end_time,
          })),
          // The links the real run would create, so that the preview and
          // the run agree.
          relationships: creatableRelationships.map((r) => ({
            id: r.tempId,
            graphId: targetGraphId,
            causeId: r.causeEventTempId,
            effectId: r.effectEventTempId,
            weight: r.weight,
            reasoning: r.reasoning,
          })),
        },
      };
    }

    // Real persistence:
    const scoped = await container.graphScopedRepositories(targetGraphId);
    const tempIdToRealEvent = new Map<string, Event>();
    const createdEventDtos: EventDto[] = [];

    for (const e of events) {
      const created = await scoped.eventRepository.create({
        description: e.description,
        timestamp: new Date(e.timestamp),
        actor: e.actor || 'Unknown',
        target: e.target || 'None',
      });
      tempIdToRealEvent.set(e.tempId, created);
      try {
        await container.graphWriteVersioningService.recordEvent(targetGraphId, created, 'create');
      } catch {
        // Best effort
      }
      createdEventDtos.push({
        id: created.id,
        graphId: targetGraphId,
        description: created.description,
        timestamp: created.timestamp.toISOString(),
        actor: created.actor,
        target: created.target,
      });
    }

    const createdArcDtos: ArcDto[] = [];
    for (const a of arcs) {
      const startTime = new Date(a.start_time);
      let endTime = new Date(a.end_time);
      if (startTime.getTime() >= endTime.getTime()) {
        endTime = new Date(startTime.getTime() + 24 * 60 * 60 * 1000);
      }
      const created = await scoped.arcRepository.create({
        name: a.name,
        description: a.description || '',
        start_time: startTime,
        end_time: endTime,
        level: a.level ?? 0,
      });
      try {
        await container.graphWriteVersioningService.recordArc(targetGraphId, created, 'create');
      } catch {
        // Best effort
      }
      createdArcDtos.push({
        id: created.id,
        graphId: targetGraphId,
        name: created.name,
        description: created.description,
        startTime: created.start_time.toISOString(),
        endTime: created.end_time.toISOString(),
      });
    }

    const createdRelDtos: CausalRelationshipDto[] = [];
    const skippedRelationships: SkippedRelationship[] = [];
    for (const r of relationships) {
      const cause = tempIdToRealEvent.get(r.causeEventTempId);
      const effect = tempIdToRealEvent.get(r.effectEventTempId);
      // The rule the whole project uses: the cause may not follow the
      // effect, but it may happen at the same moment.
      if (cause && effect && !isTemporalInversion(cause.timestamp, effect.timestamp)) {
        const linkRel: CausalRelationship = {
          weight: r.weight ?? 1.0,
          evidence: r.reasoning || '',
          confidence: r.confidence ?? 1.0,
          relationship_type: 'direct',
        };
        try {
          const created = await scoped.causalService.createCausalLink(cause, effect, linkRel);
          try {
            await container.graphWriteVersioningService.recordRelationship(targetGraphId, created, 'create');
          } catch {
            // Best effort
          }
          createdRelDtos.push({
            id: created.id,
            graphId: targetGraphId,
            causeId: created.cause_event_id,
            effectId: created.effect_event_id,
            weight: created.weight,
            reasoning: created.evidence,
          });
        } catch (error) {
          // One link that cannot be created -- a cycle, say -- must not throw
          // the whole ingest away half way through: the events and the arcs
          // are already stored. The link is skipped, and the ingest says
          // which ones it skipped.
          skippedRelationships.push({
            causeEventId: r.causeEventTempId,
            effectEventId: r.effectEventTempId,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return {
      graphId: targetGraphId,
      eventsCreated: createdEventDtos.length,
      arcsCreated: createdArcDtos.length,
      relationshipsCreated: createdRelDtos.length,
      dryRun: false,
      entities: {
        events: createdEventDtos,
        arcs: createdArcDtos,
        relationships: createdRelDtos,
      },
      ...(skippedRelationships.length > 0 ? { skippedRelationships } : {}),
    };
  }

  /**
   * The graph an ingestion writes into.
   *
   * A dry run writes nothing, so it must not create a graph either: the
   * preview names the graph it would have written to, and the graph is only
   * created when the ingestion is committed.
   */
  private async resolveTargetGraph(
    graphId: string | undefined,
    graphName: string | undefined,
    fallbackName: string,
    dryRun: boolean | undefined
  ): Promise<string> {
    if (graphId) return graphId;
    if (dryRun) return `dry-run-${fallbackName.replace(/\s+/g, '-').toLowerCase()}`;
    const created = await this.createGraph(graphName || fallbackName);
    return created.id;
  }

  /**
   * Extract events from text in the mode the caller asked for.
   *
   * The three modes are three different things:
   *
   * - `pattern` reads the text with the deterministic extractor only;
   * - `llm` asks the model, and fails when no model answered, rather than
   *   quietly reporting a pattern extraction as a model one;
   * - `hybrid` reads the text both ways and keeps the union, so a page the
   *   patterns miss still contributes its events.
   */
  private async extractText(
    text: string,
    extractor: TextExtractor,
    mode: 'pattern' | 'llm' | 'hybrid'
  ): Promise<ExtractionResult> {
    if (mode === 'pattern') {
      return extractor.extract({ text, useLLM: false });
    }

    const llmResult = await extractor.extractWithLLM({ text });

    if (mode === 'llm') {
      if (!llmResult) {
        throw new ValidationErrorCLI(
          'LLM extraction produced nothing: no provider answered the request. ' +
            'Configure a provider (--provider/--model), or use --mode hybrid, which falls back to pattern extraction.'
        );
      }
      return llmResult;
    }

    const patternResult = await extractor.extract({ text, useLLM: false });
    return mergeExtractionResults(patternResult, llmResult);
  }

  async ingestText(graphId: string | undefined, text: string, options: IngestTextOptions): Promise<IngestResultDto> {
    const targetGraphId = await this.resolveTargetGraph(
      graphId,
      options.graphName,
      'Ingested Text History',
      options.dryRun
    );
    const llmClient = options.mode !== 'pattern' ? createLLMClient({ provider: options.provider, model: options.model, temperature: options.temperature }) : null;
    const extractor = new TextExtractor({ llmClient });
    const extractionResult = await this.extractText(text, extractor, options.mode || 'hybrid');
    return this.persistExtractedEntities(targetGraphId, extractionResult, options);
  }

  async ingestUrl(graphId: string | undefined, url: string, options: IngestUrlOptions): Promise<IngestResultDto> {
    const targetGraphId = await this.resolveTargetGraph(
      graphId,
      options.graphName,
      'Web Document Ingestion',
      options.dryRun
    );
    const llmClient = createLLMClient({ provider: options.provider, model: options.model, temperature: options.temperature });
    const extractionResult = isWikipediaUrl(url)
      ? await new WikipediaExtractor({ httpClient: this.httpClient ?? new FetchHttpClient() }).extract({
          url,
          options: {
            followLinks: options.followLinks,
            linkDepth: options.depth,
            maxPages: options.maxPages,
            linkFilter: options.filter,
          },
        })
      : await new WebDocumentExtractor({
          httpClient: this.httpClient ?? new PublicWebHttpClient(),
          llmClient,
        }).extract({ url });
    return this.persistExtractedEntities(targetGraphId, extractionResult, options);
  }

  async ingestWikidata(graphId: string | undefined, options: IngestWikidataOptions): Promise<IngestResultDto> {
    const targetGraphId = await this.resolveTargetGraph(
      graphId,
      options.graphName,
      'Wikidata Ingestion',
      options.dryRun
    );
    const extractor = new WikidataExtractor({ httpClient: this.httpClient ?? new FetchHttpClient() });
    const queryType = options.sparql
      ? 'custom'
      : options.preset === 'person-timeline'
        ? 'person-timeline'
        : 'historical-events';
    const extractionResult = await extractor.extract({
      queryType,
      customQuery: options.sparql,
      limit: options.limit,
    });
    return this.persistExtractedEntities(targetGraphId, extractionResult, options);
  }

  async generateTimeline(options: GenerateTimelineOptions): Promise<GenerationResultDto> {
    const container = await this.getInitializedContainer();
    const llmClient = createLLMClient({
      provider: options.provider,
      model: options.model,
      temperature: options.temperature,
    });
    const generator = new TimelineGenerator({ llmClient });
    return generator.generateTimeline(options, container);
  }

  async generateBranch(options: GenerateBranchOptions): Promise<GenerationResultDto> {
    const container = await this.getInitializedContainer();
    const llmClient = createLLMClient({
      provider: options.provider,
      model: options.model,
    });
    const generator = new TimelineGenerator({ llmClient });
    return generator.generateBranch(options, container);
  }

  async generateExpand(options: GenerateExpandOptions): Promise<GenerationResultDto> {
    const container = await this.getInitializedContainer();
    const llmClient = createLLMClient({
      provider: options.provider,
      model: options.model,
    });
    const generator = new TimelineGenerator({ llmClient });
    return generator.generateExpand(options, container);
  }

  async generateSimulate(options: GenerateSimulateOptions): Promise<GenerationResultDto> {
    const container = await this.getInitializedContainer();

    const request: SimulationRequest = {
      graphId: options.graphId,
      steps: options.steps,
      stepDurationMs:
        options.timeAdvanceMonths !== undefined
          ? options.timeAdvanceMonths * MS_PER_MONTH
          : undefined,
      anchorEventId: options.anchorEventId,
      domain: options.domain,
      aggressiveness: options.aggressiveness,
      seedContext: options.seedContext,
    };

    // The engine validates and persists each milestone, so a direct run is the
    // same operation the HTTP route performs rather than a separate generator.
    const result = options.dryRun
      ? await container.simulationService.preview(request)
      : await container.simulationService.simulate(request);

    return toGenerationResultDto(result, 'Forward Simulation');
  }

  async validateGraph(graphId: string, strict?: boolean, autoRepair?: boolean): Promise<ValidationReportDto> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    const validator = new GraphValidator();
    return validator.validate(graphId, scoped, {
      strict,
      autoRepair,
      crossGraphLookup: this.createCrossGraphLookup(graphId),
    });
  }

  /**
   * The lookup the validator uses to name the graph a broken reference points
   * into.
   *
   * The answer is cached, because a graph can hold hundreds of references to
   * the same missing arc and the answer is the same every time. The list of
   * the graphs is fetched once for the same reason: the lookup runs per
   * broken reference, and a scan of every graph per reference is work nobody
   * asked for.
   *
   * A failure is not cached: the list of the graphs is fetched again after a
   * failed request, and the answer for an entity is looked up again after a
   * failed one. A failed lookup is not an answer, and a failed lookup that
   * was cached would make every later lookup of the run fail as well.
   */
  private createCrossGraphLookup(graphId: string): CrossGraphLookup {
    const answers = new Map<string, Promise<string | undefined>>();
    let graphIds: Promise<string[]> | null = null;

    const otherGraphIds = (): Promise<string[]> => {
      if (!graphIds) {
        const attempt = this.getInitializedContainer()
          .then((container) => container.graphService.listGraphs({ limit: 1000, offset: 0 }))
          .then((result) => result.graphs.map((graph) => graph.id).filter((id) => id !== graphId));
        graphIds = attempt;
        attempt.catch(() => {
          if (graphIds === attempt) graphIds = null;
        });
      }
      return graphIds;
    };

    return (entityId: string): Promise<string | undefined> => {
      const cached = answers.get(entityId);
      if (cached) return cached;
      const answer = otherGraphIds().then(async (ids) => {
        const container = await this.getInitializedContainer();
        for (const id of ids) {
          const scoped = await container.graphScopedRepositories(id);
          const event = await scoped.eventRepository.findById(entityId);
          if (event) return id;
          const arc = await scoped.arcRepository.findById(entityId);
          if (arc) return id;
        }
        return undefined;
      });
      answers.set(entityId, answer);
      answer.catch(() => {
        if (answers.get(entityId) === answer) answers.delete(entityId);
      });
      return answer;
    };
  }

  /**
   * Export a graph in the format the caller asked for.
   */
  async exportGraph(
    graphId: string,
    format: ExportFormat = 'json',
    outputPath?: string
  ): Promise<ExportResultDto> {
    const container = await this.getInitializedContainer();
    const graph = await container.graphRepository.findById(graphId);
    const scoped = await container.graphScopedRepositories(graphId);
    const events = await scoped.eventRepository.findAll();
    const arcs = await scoped.arcRepository.findAll();
    const rels = await scoped.causalService.getAllRelationships();

    const exporter = new GraphExporter();
    return exporter.export(
      graphId,
      graph?.name || graphId,
      graph?.description,
      events,
      arcs,
      rels,
      format,
      outputPath
    );
  }

  async importGraph(
    contentOrPath: string,
    options?: { strategy?: 'skip' | 'overwrite' | 'rename'; graphId?: string }
  ): Promise<ImportResultDto> {
    const container = await this.getInitializedContainer();
    const importer = new GraphImporter();
    return importer.import(contentOrPath, container, options);
  }
}
