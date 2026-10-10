import { IEngine } from './IEngine';
import {
  HealthInfo,
  GraphSummaryDto,
  EventDto,
  ArcDto,
  CausalRelationshipDto,
  IngestTextOptions,
  IngestResultDto,
  GenerateTimelineOptions,
  GenerateBranchOptions,
  GenerationResultDto,
  ValidationReportDto,
  ValidationIssueDto,
} from '../types';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, getContainer, Container } from '@/container';
import { NotFoundErrorCLI, ValidationErrorCLI } from '../utils/exitCodes';
import { Event, UpdateEventRequest } from '@/models';
import { CausalRelationship, CausalRelationshipType } from '@/models/relationships';
import { TextExtractor } from '@/services/ingestion/TextExtractor';
import { WikipediaExtractor } from '@/services/ingestion/WikipediaExtractor';
import { WikidataExtractor } from '@/services/ingestion/WikidataExtractor';
import { FetchHttpClient } from '@/services/ingestion/http';
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

export class DirectEngine implements IEngine {
  readonly mode = 'direct' as const;
  private containerPromise?: Promise<Container>;

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
    data: { description: string; timestamp: string; actor?: string; target?: string; importance?: number }
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
      metadata: { importance: data.importance ?? 1 },
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

  async createCausalLink(
    graphId: string,
    data: { causeId: string; effectId: string; weight?: number; type?: string; reasoning?: string }
  ): Promise<CausalRelationshipDto> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);

    // Verify temporal constraint: cause must precede effect
    const cause = await scoped.eventRepository.findById(data.causeId);
    const effect = await scoped.eventRepository.findById(data.effectId);
    if (!cause) throw new NotFoundErrorCLI(`Cause event not found: ${data.causeId}`);
    if (!effect) throw new NotFoundErrorCLI(`Effect event not found: ${data.effectId}`);

    if (cause.timestamp.getTime() >= effect.timestamp.getTime()) {
      throw new ValidationErrorCLI(
        `Temporal ordering violation: cause timestamp (${cause.timestamp.toISOString()}) must precede effect timestamp (${effect.timestamp.toISOString()})`
      );
    }

    const rel: CausalRelationship = {
      weight: data.weight ?? 1.0,
      evidence: data.reasoning || '',
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
      return {
        graphId: targetGraphId,
        eventsCreated: events.length,
        arcsCreated: arcs.length,
        relationshipsCreated: relationships.length,
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
          relationships: relationships.map((r) => ({
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
    for (const r of relationships) {
      const cause = tempIdToRealEvent.get(r.causeEventTempId);
      const effect = tempIdToRealEvent.get(r.effectEventTempId);
      if (cause && effect && cause.timestamp.getTime() < effect.timestamp.getTime()) {
        const linkRel: CausalRelationship = {
          weight: r.weight ?? 1.0,
          evidence: r.reasoning || '',
          confidence: r.confidence ?? 1.0,
          relationship_type: 'direct',
        };
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
    };
  }

  async ingestText(graphId: string | undefined, text: string, options: IngestTextOptions): Promise<IngestResultDto> {
    const targetGraphId = graphId || (await this.createGraph(options.graphName || 'Ingested Text History')).id;
    const llmClient = options.mode !== 'pattern' ? createLLMClient({ provider: options.provider, model: options.model, temperature: options.temperature }) : null;
    const extractor = new TextExtractor({ llmClient });
    const extractionResult = await extractor.extract({ text, useLLM: options.mode !== 'pattern' });
    return this.persistExtractedEntities(targetGraphId, extractionResult, options);
  }

  async ingestUrl(graphId: string | undefined, url: string, options: IngestUrlOptions): Promise<IngestResultDto> {
    const targetGraphId = graphId || (await this.createGraph(options.graphName || 'Wikipedia Ingestion')).id;
    const extractor = new WikipediaExtractor({ httpClient: new FetchHttpClient() });
    const extractionResult = await extractor.extract({
      url,
      options: {
        followLinks: options.followLinks,
        linkDepth: options.depth,
        maxPages: options.maxPages,
        linkFilter: options.filter,
      },
    });
    return this.persistExtractedEntities(targetGraphId, extractionResult, options);
  }

  async ingestWikidata(graphId: string | undefined, options: IngestWikidataOptions): Promise<IngestResultDto> {
    const targetGraphId = graphId || (await this.createGraph(options.graphName || 'Wikidata Ingestion')).id;
    const extractor = new WikidataExtractor({ httpClient: new FetchHttpClient() });
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
    const llmClient = createLLMClient({
      provider: options.provider,
      model: options.model,
    });
    const generator = new TimelineGenerator({ llmClient });
    return generator.generateSimulate(options, container);
  }

  async validateGraph(graphId: string, _strict?: boolean, _autoRepair?: boolean): Promise<ValidationReportDto> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    const events = await scoped.eventRepository.findAll();
    const arcs = await scoped.arcRepository.findAll();
    const rels = await scoped.causalService.getAllRelationships();

    const issues: ValidationIssueDto[] = [];

    // 1. Check causal order: cause < effect
    const eventMap = new Map<string, Event>(events.map((e) => [e.id, e]));
    for (const r of rels) {
      const cause = eventMap.get(r.cause_event_id);
      const effect = eventMap.get(r.effect_event_id);
      if (!cause || !effect) {
        issues.push({
          type: 'orphan_reference',
          severity: 'error',
          message: `Causal relationship ${r.id} references non-existent event (${!cause ? r.cause_event_id : r.effect_event_id})`,
          entityId: r.id,
          entityType: 'relationship',
        });
        continue;
      }
      if (cause.timestamp.getTime() >= effect.timestamp.getTime()) {
        issues.push({
          type: 'causal_direction',
          severity: 'error',
          message: `Cause "${cause.description}" (${cause.timestamp.toISOString()}) occurs at or after effect "${effect.description}" (${effect.timestamp.toISOString()})`,
          entityId: r.id,
          entityType: 'relationship',
        });
      }
    }

    // 2. Check arc boundaries
    for (const arc of arcs) {
      if (arc.start_time.getTime() > arc.end_time.getTime()) {
        issues.push({
          type: 'temporal',
          severity: 'error',
          message: `Arc "${arc.name}" has start time after end time`,
          entityId: arc.id,
          entityType: 'arc',
        });
      }
    }

    const errors = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity === 'warning');

    return {
      valid: errors.length === 0,
      graphId,
      errorCount: errors.length,
      warningCount: warnings.length,
      issues,
    };
  }

  async exportGraph(graphId: string, format: string): Promise<string> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    const events = await scoped.eventRepository.findAll();
    const arcs = await scoped.arcRepository.findAll();
    const rels = await scoped.causalService.getAllRelationships();

    if (format === 'json') {
      return JSON.stringify({ graphId, events, arcs, causalRelationships: rels }, null, 2);
    }

    if (format === 'markdown') {
      let md = `# Timeline: Graph ${graphId}\n\n`;
      md += `| Date | Event | Actor | Target |\n| :--- | :--- | :--- | :--- |\n`;
      for (const e of events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())) {
        md += `| ${e.timestamp.toISOString().split('T')[0]} | ${e.description} | ${e.actor} | ${e.target} |\n`;
      }
      return md;
    }

    return JSON.stringify({ events, arcs, rels });
  }

  async importGraph(_content: string, _options?: { strategy?: 'skip' | 'overwrite' | 'rename' }): Promise<{ success: boolean; count: number }> {
    return { success: true, count: 0 };
  }
}
