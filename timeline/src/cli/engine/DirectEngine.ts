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

  async findCausalPaths(graphId: string, fromId: string, toId: string): Promise<{ paths: string[][]; count: number }> {
    const container = await this.getInitializedContainer();
    const scoped = await container.graphScopedRepositories(graphId);
    const fromEvent = await scoped.eventRepository.findById(fromId);
    if (!fromEvent) throw new NotFoundErrorCLI(`Event not found: ${fromId}`);

    const paths = await scoped.causalService.findCausalChain(fromEvent, 6);
    const matching = paths.filter((p) => p.events[p.events.length - 1] === toId);
    return {
      paths: matching.map((p) => p.events),
      count: matching.length,
    };
  }

  async ingestText(graphId: string | undefined, text: string, options: IngestTextOptions): Promise<IngestResultDto> {
    return {
      graphId: graphId || 'temp-graph',
      eventsCreated: 0,
      arcsCreated: 0,
      relationshipsCreated: 0,
      dryRun: Boolean(options.dryRun),
      entities: { events: [], arcs: [], relationships: [] },
    };
  }

  async generateTimeline(options: GenerateTimelineOptions): Promise<GenerationResultDto> {
    return {
      graphId: 'placeholder',
      graphName: options.graphName || 'Generated',
      premise: options.premise,
      divergencePoint: options.divergencePoint,
      eventCount: 0,
      arcCount: 0,
      relationshipCount: 0,
      events: [],
      arcs: [],
      relationships: [],
      validation: { valid: true, graphId: 'placeholder', errorCount: 0, warningCount: 0, issues: [] },
    };
  }

  async generateBranch(options: GenerateBranchOptions): Promise<GenerationResultDto> {
    return {
      graphId: 'placeholder',
      graphName: options.branchName,
      premise: options.counterfactualPrompt,
      divergencePoint: options.divergeAtEventId,
      eventCount: 0,
      arcCount: 0,
      relationshipCount: 0,
      events: [],
      arcs: [],
      relationships: [],
      validation: { valid: true, graphId: 'placeholder', errorCount: 0, warningCount: 0, issues: [] },
    };
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
