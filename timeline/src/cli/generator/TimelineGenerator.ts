/**
 * Multi-Pass Timeline Generator Service.
 * Implements 5-pass generation for alternate history timelines:
 * Pass 1: Strategic Premise & Point of Divergence analysis
 * Pass 2: Chronological micro-event generation with strict ISO-8601 timestamps
 * Pass 3: Hierarchical narrative arc clustering based on depth
 * Pass 4: Causal ripple synthesis linking divergence causes to downstream effects
 * Pass 5: Integrity verification pass ensuring temporal constraints and DAG acyclicity
 */

import { Container } from '@/container';
import { LLMClient } from '@/services/llm/LLMClient';
import { Event } from '@/models/Event';
import { Arc } from '@/models/Arc';
import { CausalRelationship } from '@/models/relationships';
import {
  GenerateTimelineOptions,
  GenerateBranchOptions,
  GenerateExpandOptions,
  GenerateSimulateOptions,
  GenerationResultDto,
  EventDto,
  ArcDto,
  CausalRelationshipDto,
  ValidationReportDto,
  ValidationIssueDto,
} from '../types';
import { clusterEventsIntoArcs } from './arcClustering';
import { ExtractedArc, ExtractedEvent } from '@/services/ingestion/types';
import { isTemporalInversion } from '@/utils/causalOrder';

export interface TimelineGeneratorConfig {
  readonly llmClient?: LLMClient | null;
}

interface IntermediateEvent {
  description: string;
  timestamp: string;
  actor: string;
  target: string;
  importance: number;
}

interface IntermediateCausalLink {
  causeIndex: number;
  effectIndex: number;
  weight: number;
  type: 'direct' | 'indirect' | 'contributory';
  reasoning: string;
}

/** An arc together with its place in the hierarchy. */
interface StructuredArc {
  tempId: string;
  name: string;
  description: string;
  start_time: string;
  end_time: string;
  level: number;
  parentArcId?: string;
}

/** The narrative styles the generator can write in. */
type NarrativeStyle = 'academic' | 'narrative' | 'concise';

/** How each style words a milestone of the generated timeline. */
const STYLE_RENDERERS: Record<NarrativeStyle, (milestone: string, premise: string) => string> = {
  academic: (milestone, premise) => `${milestone}, a direct consequence of ${premise}.`,
  narrative: (milestone, premise) => `In the wake of ${premise}, ${lowerFirst(milestone)}.`,
  concise: (milestone) => `${milestone}.`,
};

/** What each style asks of the language model. */
const STYLE_GUIDANCE: Record<NarrativeStyle, string> = {
  academic: 'formal, analytical, precise in its claims',
  narrative: 'narrated in the voice of a historian telling the story',
  concise: 'terse, one sentence per event',
};

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Read a `start/end` time window.
 *
 * The window is two ISO-8601 instants separated by a slash (`2020-01-01T00:00:00Z/2020-12-31T00:00:00Z`).
 * A window that cannot be read is a mistake the caller has to hear about, so
 * it raises rather than falling back to the graph's own span.
 */
export function parseTimeWindow(value: string): { start: number; end: number } {
  const separator = value.includes('/') ? '/' : value.includes('..') ? '..' : null;
  if (!separator) {
    throw new Error(
      `Invalid time window "${value}": expected two ISO-8601 instants separated by a slash, for example ` +
        '"2020-01-01T00:00:00Z/2020-12-31T00:00:00Z"'
    );
  }

  const [rawStart, rawEnd] = value.split(separator);
  const start = Date.parse(rawStart.trim());
  const end = Date.parse(rawEnd.trim());

  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error(`Invalid time window "${value}": both instants must be ISO-8601 dates`);
  }
  if (start >= end) {
    throw new Error(`Invalid time window "${value}": the start must be before the end`);
  }

  return { start, end };
}

export class TimelineGenerator {
  private readonly llmClient: LLMClient | null;

  constructor(config: TimelineGeneratorConfig = {}) {
    this.llmClient = config.llmClient ?? null;
  }

  /**
   * Generates a complete alternate history timeline from a counterfactual premise.
   */
  async generateTimeline(
    options: GenerateTimelineOptions,
    container: Container
  ): Promise<GenerationResultDto> {
    const eventCount = Math.max(3, Math.min(options.eventCount || 8, 30));
    const targetGraphName = options.graphName || `What If: ${options.premise.slice(0, 40)}`;

    // Pass 1: Determine Macro Bounds & Epoch Span
    const { startMs, stepMs } = this.resolveTimeSpan(options, eventCount);

    // Pass 2: Generate Chronological Micro-Events
    const intermediateEvents = await this.generateEventsPass(
      options,
      eventCount,
      startMs,
      stepMs
    );

    // Pass 3: Narrative Arc Structuring
    const extractedEvents: ExtractedEvent[] = intermediateEvents.map((e, idx) => ({
      tempId: `gen-evt-${idx}`,
      description: e.description,
      actor: e.actor,
      target: e.target,
      timestamp: e.timestamp,
      confidence: 0.9,
      source: { type: 'llm', extractedAt: new Date().toISOString() },
      selected: true,
      edited: false,
    }));

    const clusteredArcs = clusterEventsIntoArcs(extractedEvents, {
      type: 'llm',
      extractedAt: new Date().toISOString(),
    });

    // The requested depth decides how many levels of arcs the timeline has.
    const structuredArcs = this.buildArcHierarchy(clusteredArcs, options.depth ?? 1);

    // Pass 4: Causal Ripple Synthesis
    const causalLinks = this.generateCausalRipplesPass(intermediateEvents);

    // Pass 5: Integrity Verification
    const validation = this.verifyIntegrityPass(intermediateEvents, structuredArcs, causalLinks);

    // Persist or Dry-Run
    if (options.dryRun) {
      const dryGraphId = `dry-${Date.now()}`;
      const eventDtos: EventDto[] = intermediateEvents.map((e, idx) => ({
        id: `evt-dry-${idx}`,
        graphId: dryGraphId,
        description: e.description,
        timestamp: e.timestamp,
        actor: e.actor,
        target: e.target,
        importance: e.importance,
      }));

      const dryArcIdByTempId = new Map<string, string>(
        structuredArcs.map((arc, index) => [arc.tempId, `arc-dry-${index}`])
      );
      const arcDtos: ArcDto[] = structuredArcs.map((a, idx) => ({
        id: `arc-dry-${idx}`,
        graphId: dryGraphId,
        name: a.name,
        description: a.description,
        startTime: a.start_time,
        endTime: a.end_time,
        level: a.level,
        parentArcId: a.parentArcId ? dryArcIdByTempId.get(a.parentArcId) : undefined,
      }));

      const relDtos: CausalRelationshipDto[] = causalLinks.map((l, idx) => ({
        id: `rel-dry-${idx}`,
        graphId: dryGraphId,
        causeId: `evt-dry-${l.causeIndex}`,
        effectId: `evt-dry-${l.effectIndex}`,
        weight: l.weight,
        type: l.type,
        reasoning: l.reasoning,
        confidence: 0.9,
      }));

      return {
        graphId: dryGraphId,
        graphName: targetGraphName,
        premise: options.premise,
        divergencePoint: options.divergencePoint,
        eventCount: eventDtos.length,
        arcCount: arcDtos.length,
        relationshipCount: relDtos.length,
        events: eventDtos,
        arcs: arcDtos,
        relationships: relDtos,
        validation,
      };
    }

    // Persist to Container
    const graph = await container.graphService.createGraph({
      name: targetGraphName,
      description: `Generated counterfactual: ${options.premise}`,
    });
    const graphId = graph.id;
    const scoped = await container.graphScopedRepositories(graphId);

    const domainEvents: Event[] = [];
    const persistedEvents: EventDto[] = [];
    for (const e of intermediateEvents) {
      const created = await scoped.eventRepository.create({
        description: e.description,
        timestamp: new Date(e.timestamp),
        actor: e.actor,
        target: e.target,
        metadata: { importance: e.importance },
      });
      try {
        await container.graphWriteVersioningService.recordEvent(graphId, created, 'create');
      } catch {
        // Best effort
      }
      domainEvents.push(created);
      persistedEvents.push({
        id: created.id,
        graphId,
        description: created.description,
        timestamp: created.timestamp.toISOString(),
        actor: created.actor,
        target: created.target,
        importance: e.importance,
      });
    }

    const persistedArcs: ArcDto[] = [];
    // The parents are created first, so that a child arc can name the arc it
    // belongs to by its real id.
    const arcIdByTempId = new Map<string, string>();
    const orderedArcs = [...structuredArcs].sort((a, b) => a.level - b.level);
    for (const a of orderedArcs) {
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
        level: a.level,
        metadata: a.parentArcId ? { parentArcId: arcIdByTempId.get(a.parentArcId) } : {},
      });
      arcIdByTempId.set(a.tempId, created.id);
      try {
        await container.graphWriteVersioningService.recordArc(graphId, created, 'create');
      } catch {
        // Best effort
      }
      persistedArcs.push({
        id: created.id,
        graphId,
        name: created.name,
        description: created.description,
        startTime: created.start_time.toISOString(),
        endTime: created.end_time.toISOString(),
        level: created.level,
      });
    }

    const persistedRels: CausalRelationshipDto[] = [];
    for (const l of causalLinks) {
      const cause = domainEvents[l.causeIndex];
      const effect = domainEvents[l.effectIndex];
      if (cause && effect) {
        const linkRel: CausalRelationship = {
          weight: l.weight,
          evidence: l.reasoning,
          confidence: 0.9,
          relationship_type: l.type,
        };
        const created = await scoped.causalService.createCausalLink(cause, effect, linkRel);
        try {
          await container.graphWriteVersioningService.recordRelationship(graphId, created, 'create');
        } catch {
          // Best effort
        }
        persistedRels.push({
          id: created.id,
          graphId,
          causeId: created.cause_event_id,
          effectId: created.effect_event_id,
          weight: created.weight,
          type: created.relationship_type,
          reasoning: created.evidence,
          confidence: created.confidence,
        });
      }
    }

    return {
      graphId,
      graphName: targetGraphName,
      premise: options.premise,
      divergencePoint: options.divergencePoint,
      eventCount: persistedEvents.length,
      arcCount: persistedArcs.length,
      relationshipCount: persistedRels.length,
      events: persistedEvents,
      arcs: persistedArcs,
      relationships: persistedRels,
      validation,
    };
  }

  /**
   * Build the arc hierarchy for a generated timeline.
   *
   * The clustered arcs are the deepest level. Each further level wraps the
   * level below it in an enclosing arc, so a depth of two produces a set of
   * periods inside a set of eras, and a depth of three adds a set of eras
   * inside a set of grand-eras. The levels are counted from the top: the
   * arcs with no parent are the top level, and every arc is one level below
   * its parent. A child is therefore never at the same level as its parent,
   * and never above it.
   */
  private buildArcHierarchy(baseArcs: ExtractedArc[], depth: number): StructuredArc[] {
    const maxDepth = Math.max(1, Math.min(Math.trunc(depth) || 1, 4));

    let current: StructuredArc[] = baseArcs.map((arc) => ({
      tempId: arc.tempId,
      name: arc.name,
      description: arc.description,
      start_time: arc.start_time,
      end_time: arc.end_time,
      level: 0,
    }));
    const all: StructuredArc[] = [...current];

    for (let pass = 0; pass < maxDepth - 1; pass++) {
      const groups = this.groupArcsForParents(current);
      const parents: StructuredArc[] = [];

      groups.forEach((group, index) => {
        const parentId = `arc-era-${pass}-${index}`;
        const start = group[0].start_time;
        const end = group[group.length - 1].end_time;
        const parent: StructuredArc = {
          tempId: parentId,
          name: `Era ${start.slice(0, 4)}-${end.slice(0, 4)}`,
          description: `Enclosing narrative arc for ${group.length} periods`,
          start_time: start,
          end_time: end,
          level: 0,
        };
        for (const child of group) {
          child.parentArcId = parentId;
        }
        parents.push(parent);
      });

      all.push(...parents);
      current = parents;
    }

    // The level of an arc is the number of its ancestors. Counting it from
    // the top keeps a child below its parent at every depth: the levels are
    // not the pass number, which would put a child of a grand-era on the
    // same level as the periods it holds.
    const byTempId = new Map(all.map((arc) => [arc.tempId, arc]));
    const levelOf = (arc: StructuredArc, seen: Set<string>): number => {
      if (seen.has(arc.tempId)) return 0;
      seen.add(arc.tempId);
      const parentId = arc.parentArcId;
      if (!parentId) return 0;
      const parent = byTempId.get(parentId);
      if (!parent) return 0;
      return levelOf(parent, seen) + 1;
    };
    for (const arc of all) {
      arc.level = levelOf(arc, new Set<string>());
    }

    return all;
  }

  /**
   * Group arcs into the eras that enclose them.
   *
   * The arcs that are close together in time belong to the same era, so the
   * boundary is drawn where the gap between two arcs is much larger than the
   * gaps around it.
   */
  private groupArcsForParents(arcs: StructuredArc[]): StructuredArc[][] {
    const sorted = [...arcs].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const previousEnd = new Date(sorted[i - 1].end_time).getTime();
      const currentStart = new Date(sorted[i].start_time).getTime();
      gaps.push(Math.max(0, currentStart - previousEnd));
    }
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)] || 0;
    const fiveYearsMs = 5 * 365.25 * 24 * 60 * 60 * 1000;
    const threshold = Math.max(medianGap * 3, fiveYearsMs);

    const groups: StructuredArc[][] = [];
    let current: StructuredArc[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const previousEnd = new Date(sorted[i - 1].end_time).getTime();
      const currentStart = new Date(sorted[i].start_time).getTime();
      if (currentStart - previousEnd > threshold) {
        groups.push(current);
        current = [sorted[i]];
      } else {
        current.push(sorted[i]);
      }
    }
    groups.push(current);

    return groups;
  }

  /**
   * Forks an existing graph at a specific event and synthesizes divergent history forward.
   */
  async generateBranch(
    options: GenerateBranchOptions,
    container: Container
  ): Promise<GenerationResultDto> {
    const eventCount = Math.max(3, Math.min(options.eventCount || 6, 20));
    const sourceScoped = await container.graphScopedRepositories(options.sourceGraphId);
    const pivotEvent = await sourceScoped.eventRepository.findById(options.divergeAtEventId);
    if (!pivotEvent) {
      throw new Error(`Divergence pivot event not found: ${options.divergeAtEventId}`);
    }

    const pivotTimeMs = new Date(pivotEvent.timestamp).getTime();
    const oneYearMs = 365.25 * 24 * 60 * 60 * 1000;
    const stepMs = oneYearMs * 2;

    const divergentTimelineOptions: GenerateTimelineOptions = {
      premise: options.counterfactualPrompt,
      divergencePoint: pivotEvent.description,
      startDate: new Date(pivotTimeMs + 24 * 60 * 60 * 1000).toISOString(),
      endDate: new Date(pivotTimeMs + stepMs * eventCount).toISOString(),
      eventCount,
      graphName: options.branchName,
      dryRun: options.dryRun,
    };

    if (options.dryRun) {
      return this.generateTimeline(divergentTimelineOptions, container);
    }

    // Branch source graph
    const branched = await container.graphService.branchGraph(options.sourceGraphId, {
      name: options.branchName,
    });
    const branchedGraphId = branched.id;
    const targetScoped = await container.graphScopedRepositories(branchedGraphId);

    // Copy ancestor events up to pivot into target graph store if not already present
    const sourceEvents = await sourceScoped.eventRepository.findAll();
    const pivotTime = pivotEvent.timestamp.getTime();
    const ancestorEvents = sourceEvents.filter((e) => e.timestamp.getTime() <= pivotTime);

    let branchPivotEvent = await targetScoped.eventRepository.findById(pivotEvent.id);
    for (const ancestor of ancestorEvents) {
      const existing = await targetScoped.eventRepository.findById(ancestor.id);
      if (!existing) {
        const copied = await targetScoped.eventRepository.create({
          id: ancestor.id,
          description: ancestor.description,
          timestamp: ancestor.timestamp,
          actor: ancestor.actor,
          target: ancestor.target,
          metadata: ancestor.metadata,
        });
        if (ancestor.id === pivotEvent.id) {
          branchPivotEvent = copied;
        }
      }
    }
    if (!branchPivotEvent) {
      branchPivotEvent = pivotEvent;
    }

    // Generate divergent events
    const intermediateEvents = await this.generateEventsPass(
      divergentTimelineOptions,
      eventCount,
      pivotTimeMs + 24 * 60 * 60 * 1000,
      stepMs
    );

    const domainEvents: Event[] = [];
    const persistedEvents: EventDto[] = [];
    for (const e of intermediateEvents) {
      const created = await targetScoped.eventRepository.create({
        description: e.description,
        timestamp: new Date(e.timestamp),
        actor: e.actor,
        target: e.target,
        metadata: { importance: e.importance },
      });
      try {
        await container.graphWriteVersioningService.recordEvent(branchedGraphId, created, 'create');
      } catch {
        // Best effort
      }
      domainEvents.push(created);
      persistedEvents.push({
        id: created.id,
        graphId: branchedGraphId,
        description: created.description,
        timestamp: created.timestamp.toISOString(),
        actor: created.actor,
        target: created.target,
        importance: e.importance,
      });
    }

    // Create branch causal link from pivot event to the first divergent event
    const persistedRels: CausalRelationshipDto[] = [];
    if (domainEvents.length > 0) {
      const branchRel: CausalRelationship = {
        weight: 0.95,
        confidence: 0.95,
        evidence: `Counterfactual branch point: ${options.counterfactualPrompt}`,
        relationship_type: 'direct',
      };
      const branchLink = await targetScoped.causalService.createCausalLink(
        branchPivotEvent,
        domainEvents[0],
        branchRel
      );
      persistedRels.push({
        id: branchLink.id,
        graphId: branchedGraphId,
        causeId: branchLink.cause_event_id,
        effectId: branchLink.effect_event_id,
        weight: branchLink.weight,
        type: branchLink.relationship_type,
        reasoning: branchLink.evidence,
        confidence: branchLink.confidence,
      });
    }

    // Chain newly created divergent events
    for (let i = 0; i < domainEvents.length - 1; i++) {
      const cause = domainEvents[i];
      const effect = domainEvents[i + 1];
      const linkRel: CausalRelationship = {
        weight: 0.85,
        confidence: 0.9,
        evidence: `Divergent cascade from ${cause.description}`,
        relationship_type: 'direct',
      };
      const link = await targetScoped.causalService.createCausalLink(cause, effect, linkRel);
      persistedRels.push({
        id: link.id,
        graphId: branchedGraphId,
        causeId: link.cause_event_id,
        effectId: link.effect_event_id,
        weight: link.weight,
        type: link.relationship_type,
        reasoning: link.evidence,
        confidence: link.confidence,
      });
    }

    // Create branch narrative arc
    const arc = await targetScoped.arcRepository.create({
      name: `${options.branchName} Divergence Era`,
      description: `Counterfactual divergent timeline from ${pivotEvent.actor}: ${options.counterfactualPrompt}`,
      start_time: new Date(persistedEvents[0].timestamp),
      end_time: new Date(persistedEvents[persistedEvents.length - 1].timestamp),
      level: 1,
    });
    const persistedArcs: ArcDto[] = [
      {
        id: arc.id,
        graphId: branchedGraphId,
        name: arc.name,
        description: arc.description,
        startTime: arc.start_time.toISOString(),
        endTime: arc.end_time.toISOString(),
        level: arc.level,
      },
    ];

    return {
      graphId: branchedGraphId,
      graphName: options.branchName,
      premise: options.counterfactualPrompt,
      divergencePoint: pivotEvent.description,
      eventCount: persistedEvents.length,
      arcCount: persistedArcs.length,
      relationshipCount: persistedRels.length,
      events: persistedEvents,
      arcs: persistedArcs,
      relationships: persistedRels,
      validation: {
        valid: true,
        graphId: branchedGraphId,
        errorCount: 0,
        warningCount: 0,
        issues: [],
      },
    };
  }

  /**
   * Expands an arc or time window with intermediate micro-events.
   *
   * The window is the arc's own span, the span of a `--time-window` range, or
   * the span of the graph's events, in that order of preference. The events
   * are placed inside the window and describe what happens between the
   * milestones that surround them, and the expansion is recorded as an arc of
   * its own -- a child of the arc that was expanded, when there is one.
   */
  async generateExpand(
    options: GenerateExpandOptions,
    container: Container
  ): Promise<GenerationResultDto> {
    const scoped = await container.graphScopedRepositories(options.graphId);
    const existingEvents = await scoped.eventRepository.findAll();
    if (existingEvents.length === 0) {
      throw new Error(`Cannot expand empty graph: ${options.graphId}`);
    }

    const count = Math.max(2, Math.min(options.eventCount || 3, 10));
    const sorted = [...existingEvents].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    let windowStart = sorted[0].timestamp.getTime();
    let windowEnd = sorted[sorted.length - 1].timestamp.getTime();
    let parentArc: Arc | null = null;

    if (options.arcId) {
      const arc = await scoped.arcRepository.findById(options.arcId);
      if (arc) {
        parentArc = arc;
        windowStart = arc.start_time.getTime();
        windowEnd = arc.end_time.getTime();
      }
    }

    if (options.timeWindow) {
      const parsed = parseTimeWindow(options.timeWindow);
      if (parentArc) {
        // The expansion has to stay inside the arc it expands, or the graph
        // would hold an arc that is not contained by its parent.
        const start = Math.max(parsed.start, windowStart);
        const end = Math.min(parsed.end, windowEnd);
        if (start >= end) {
          throw new Error(
            `The time window ${options.timeWindow} does not overlap the arc ${parentArc.id} ` +
              `(${parentArc.start_time.toISOString()} - ${parentArc.end_time.toISOString()})`
          );
        }
        windowStart = start;
        windowEnd = end;
      } else {
        windowStart = parsed.start;
        windowEnd = parsed.end;
      }
    }

    const interval = (windowEnd - windowStart) / (count + 1);
    const intermediateEvents: IntermediateEvent[] = [];

    for (let i = 1; i <= count; i++) {
      const timeMs = windowStart + interval * i;
      const before = [...sorted].reverse().find((e) => e.timestamp.getTime() <= timeMs);
      const after = sorted.find((e) => e.timestamp.getTime() >= timeMs);
      intermediateEvents.push({
        description: this.describeExpansion(before, after, i, count),
        timestamp: new Date(timeMs).toISOString(),
        actor: before?.actor || existingEvents[0]?.actor || 'Regional Faction',
        target: before?.target || existingEvents[0]?.target || 'Opposing Coalition',
        importance: 0.6,
      });
    }

    const expansionArcName = parentArc
      ? `Expansion within ${parentArc.name}`
      : `Expansion ${new Date(windowStart).toISOString().slice(0, 10)} to ${new Date(windowEnd).toISOString().slice(0, 10)}`;

    if (options.dryRun) {
      return {
        graphId: options.graphId,
        graphName: 'Expanded Preview',
        premise: 'Expansion',
        divergencePoint: 'Interpolation',
        eventCount: count,
        arcCount: 1,
        relationshipCount: 0,
        events: intermediateEvents.map((e, idx) => ({
          id: `evt-expand-${idx}`,
          graphId: options.graphId,
          description: e.description,
          timestamp: e.timestamp,
          actor: e.actor,
          target: e.target,
          importance: e.importance,
        })),
        arcs: [
          {
            id: 'arc-expand-preview',
            graphId: options.graphId,
            name: expansionArcName,
            description: 'Arc covering the expanded window',
            startTime: new Date(windowStart).toISOString(),
            endTime: new Date(windowEnd).toISOString(),
            parentArcId: parentArc?.id,
          },
        ],
        relationships: [],
        validation: {
          valid: true,
          graphId: options.graphId,
          errorCount: 0,
          warningCount: 0,
          issues: [],
        },
      };
    }

    // The expansion is recorded as an arc, so that the new events are
    // contained by a narrative arc rather than floating on their own.
    const createdArc = await scoped.arcRepository.create({
      name: expansionArcName,
      description: parentArc
        ? `Sub-arc of ${parentArc.name} holding ${count} interpolated events`
        : `Arc holding ${count} interpolated events`,
      start_time: new Date(windowStart),
      end_time: new Date(windowEnd),
      level: parentArc ? parentArc.level + 1 : 0,
      metadata: parentArc ? { parentArcId: parentArc.id } : {},
    });

    const createdEvents: EventDto[] = [];
    for (const e of intermediateEvents) {
      const created = await scoped.eventRepository.create({
        description: e.description,
        timestamp: new Date(e.timestamp),
        actor: e.actor,
        target: e.target,
        metadata: { importance: e.importance, arcId: createdArc.id },
      });
      createdEvents.push({
        id: created.id,
        graphId: options.graphId,
        description: created.description,
        timestamp: created.timestamp.toISOString(),
        actor: created.actor,
        target: created.target,
        importance: e.importance,
      });
    }

    const createdArcs: ArcDto[] = [
      {
        id: createdArc.id,
        graphId: options.graphId,
        name: createdArc.name,
        description: createdArc.description,
        startTime: createdArc.start_time.toISOString(),
        endTime: createdArc.end_time.toISOString(),
        parentArcId: parentArc?.id,
      },
    ];

    return {
      graphId: options.graphId,
      graphName: 'Expanded Timeline',
      premise: 'Detailed expansion of narrative window',
      divergencePoint: 'Intermediate interpolation',
      eventCount: createdEvents.length,
      arcCount: createdArcs.length,
      relationshipCount: 0,
      events: createdEvents,
      arcs: createdArcs,
      relationships: [],
      validation: {
        valid: true,
        graphId: options.graphId,
        errorCount: 0,
        warningCount: 0,
        issues: [],
      },
    };
  }

  /**
   * Describe one interpolated event by the milestones it sits between.
   *
   * The description names the events on either side, so a reader can tell
   * which gap the event fills instead of reading a numbered placeholder.
   */
  private describeExpansion(
    before: Event | undefined,
    after: Event | undefined,
    index: number,
    count: number
  ): string {
    const from = before ? `"${before.description}"` : 'the start of the window';
    const to = after ? `"${after.description}"` : 'the end of the window';
    return `Local development ${index} of ${count} between ${from} and ${to}`;
  }

  /**
   * Advances the timeline sequentially into the future.
   */
  async generateSimulate(
    options: GenerateSimulateOptions,
    container: Container
  ): Promise<GenerationResultDto> {
    const scoped = await container.graphScopedRepositories(options.graphId);
    const existingEvents = await scoped.eventRepository.findAll();
    if (existingEvents.length === 0) {
      throw new Error(`Cannot simulate advancement on empty graph: ${options.graphId}`);
    }

    const sorted = [...existingEvents].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
    const lastEvent = sorted[sorted.length - 1];
    const steps = Math.max(1, Math.min(options.steps || 3, 10));
    const advanceMs = (options.timeAdvanceMonths || 12) * 30.4 * 24 * 60 * 60 * 1000;

    const simulatedEvents: IntermediateEvent[] = [];
    for (let i = 1; i <= steps; i++) {
      const timeMs = lastEvent.timestamp.getTime() + advanceMs * i;
      simulatedEvents.push({
        description: `Simulated causal progression ${i}: long-term consequences unfold following ${lastEvent.description}`,
        timestamp: new Date(timeMs).toISOString(),
        actor: lastEvent.actor || 'Consolidated State',
        target: lastEvent.target || 'Allied Sphere',
        importance: 0.75,
      });
    }

    if (options.dryRun) {
      return {
        graphId: options.graphId,
        graphName: 'Simulation Preview',
        premise: 'Forward causal simulation',
        divergencePoint: lastEvent.description,
        eventCount: steps,
        arcCount: 0,
        relationshipCount: 0,
        events: simulatedEvents.map((e, idx) => ({
          id: `evt-sim-${idx}`,
          graphId: options.graphId,
          description: e.description,
          timestamp: e.timestamp,
          actor: e.actor,
          target: e.target,
          importance: e.importance,
        })),
        arcs: [],
        relationships: [],
        validation: {
          valid: true,
          graphId: options.graphId,
          errorCount: 0,
          warningCount: 0,
          issues: [],
        },
      };
    }

    const domainSimEvents: Event[] = [];
    const createdEvents: EventDto[] = [];
    for (const e of simulatedEvents) {
      const created = await scoped.eventRepository.create({
        description: e.description,
        timestamp: new Date(e.timestamp),
        actor: e.actor,
        target: e.target,
        metadata: { importance: e.importance },
      });
      domainSimEvents.push(created);
      createdEvents.push({
        id: created.id,
        graphId: options.graphId,
        description: created.description,
        timestamp: created.timestamp.toISOString(),
        actor: created.actor,
        target: created.target,
        importance: e.importance,
      });
    }

    // Link last historical event to first simulated event
    const createdRels: CausalRelationshipDto[] = [];
    if (domainSimEvents.length > 0) {
      const linkRel: CausalRelationship = {
        weight: 0.85,
        confidence: 0.8,
        evidence: `Forward causal simulation progression`,
        relationship_type: 'direct',
      };
      const link = await scoped.causalService.createCausalLink(
        lastEvent,
        domainSimEvents[0],
        linkRel
      );
      createdRels.push({
        id: link.id,
        graphId: options.graphId,
        causeId: link.cause_event_id,
        effectId: link.effect_event_id,
        weight: link.weight,
        type: link.relationship_type,
        reasoning: link.evidence,
        confidence: link.confidence,
      });
    }

    return {
      graphId: options.graphId,
      graphName: 'Simulated Timeline',
      premise: 'Forward simulation',
      divergencePoint: lastEvent.description,
      eventCount: createdEvents.length,
      arcCount: 0,
      relationshipCount: createdRels.length,
      events: createdEvents,
      arcs: [],
      relationships: createdRels,
      validation: {
        valid: true,
        graphId: options.graphId,
        errorCount: 0,
        warningCount: 0,
        issues: [],
      },
    };
  }

  // --- Private Helpers for Passes ---

  private resolveTimeSpan(
    options: GenerateTimelineOptions,
    eventCount: number
  ): { startMs: number; stepMs: number } {
    let startMs = Date.parse(options.startDate || '');
    if (isNaN(startMs)) {
      // Try to extract 4 digit year from divergencePoint or premise
      const yearMatch = (options.divergencePoint + ' ' + options.premise).match(/\b(1\d{3}|20\d{2})\b/);
      if (yearMatch) {
        startMs = new Date(`${yearMatch[1]}-01-01T00:00:00Z`).getTime();
      } else {
        startMs = new Date('1914-06-28T10:00:00Z').getTime();
      }
    }

    let endMs = Date.parse(options.endDate || '');
    if (isNaN(endMs)) {
      // Default to 15 years after start
      endMs = startMs + 15 * 365.25 * 24 * 60 * 60 * 1000;
    }

    const stepMs = Math.max(24 * 60 * 60 * 1000 * 30, Math.floor((endMs - startMs) / eventCount));
    return { startMs, stepMs };
  }

  private async generateEventsPass(
    options: GenerateTimelineOptions,
    eventCount: number,
    startMs: number,
    stepMs: number
  ): Promise<IntermediateEvent[]> {
    const style: NarrativeStyle = options.style || 'academic';

    // If LLM client is available, prompt LLM for structured counterfactual narrative
    if (this.llmClient) {
      try {
        const prompt = `You are an expert counterfactual historian.
Premise: ${options.premise}
Point of Divergence: ${options.divergencePoint}
Style: ${style} (${STYLE_GUIDANCE[style]})
Generate ${eventCount} chronological historical events demonstrating this counterfactual reality.`;
        const extracted = await this.llmClient.extractEvents(prompt);
        if (extracted.length >= 3) {
          const sorted = [...extracted].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          return sorted.map((e, idx) => ({
            description: e.description,
            timestamp: e.timestamp,
            actor: e.actor || 'Divergent Government',
            target: e.target || 'Opposing Power',
            importance: Math.max(0.4, 1.0 - idx * 0.05),
          }));
        }
      } catch {
        // Fall back to deterministic counterfactual heuristic synthesizer
      }
    }

    // Deterministic counterfactual progression synthesizer
    const events: IntermediateEvent[] = [];
    const actor = options.premise.includes('Napoleon')
      ? 'French Empire'
      : options.premise.includes('Rome')
        ? 'Roman Empire'
        : options.premise.includes('America') || options.premise.includes('Washington')
          ? 'United States'
          : 'Divergent Coalition';

    const target = actor === 'French Empire'
      ? 'Coalition Allies'
      : actor === 'Roman Empire'
        ? 'Germanic Tribes'
        : actor === 'United States'
          ? 'British Crown'
          : 'Continental Alliance';

    const narrativeMilestones = [
      `Point of Divergence: ${options.divergencePoint}`,
      `Immediate aftermath and consolidation following the turning point`,
      `Geopolitical realignment and formation of new strategic alliances`,
      `Economic and institutional mobilization under new leadership`,
      `Major treaty or confrontation redefining territorial sovereignty`,
      `Cultural and technological shifts emerging from the revised balance of power`,
      `Institutional entrenchment of the counterfactual status quo`,
      `Long-term legacy and global repercussions in the transformed world order`,
    ];

    for (let i = 0; i < eventCount; i++) {
      const timeMs = startMs + stepMs * i;
      const milestone = narrativeMilestones[i % narrativeMilestones.length];
      const desc =
        i === 0
          ? options.divergencePoint
          : STYLE_RENDERERS[style](milestone, options.premise.slice(0, 50));
      events.push({
        description: desc,
        timestamp: new Date(timeMs).toISOString(),
        actor: i % 2 === 0 ? actor : target,
        target: i % 2 === 0 ? target : actor,
        importance: i === 0 ? 1.0 : Math.max(0.5, 0.9 - i * 0.05),
      });
    }

    return events;
  }

  private generateCausalRipplesPass(events: IntermediateEvent[]): IntermediateCausalLink[] {
    const links: IntermediateCausalLink[] = [];

    // Chain each event sequentially to downstream events (guaranteed DAG $cause < effect$)
    for (let i = 0; i < events.length - 1; i++) {
      links.push({
        causeIndex: i,
        effectIndex: i + 1,
        weight: 0.85,
        type: 'direct',
        reasoning: `Direct consequence: ${events[i].description} catalyzed ${events[i + 1].description}`,
      });

      // Transitive ripple every 2 events
      if (i + 2 < events.length) {
        links.push({
          causeIndex: i,
          effectIndex: i + 2,
          weight: 0.65,
          type: 'indirect',
          reasoning: `Secondary causal ripple propagating across intermediate milestones`,
        });
      }
    }

    return links;
  }

  private verifyIntegrityPass(
    events: IntermediateEvent[],
    arcs: Array<{ start_time: string; end_time: string }>,
    links: IntermediateCausalLink[]
  ): ValidationReportDto {
    const issues: ValidationIssueDto[] = [];

    // Temporal order
    for (let i = 1; i < events.length; i++) {
      const prev = new Date(events[i - 1].timestamp).getTime();
      const curr = new Date(events[i].timestamp).getTime();
      if (prev >= curr) {
        issues.push({
          type: 'temporal',
          severity: 'error',
          message: `Event ${i} timestamp does not strictly advance after event ${i - 1}`,
        });
      }
    }

    // Arc bounds
    for (let idx = 0; idx < arcs.length; idx++) {
      const start = new Date(arcs[idx].start_time).getTime();
      const end = new Date(arcs[idx].end_time).getTime();
      if (start >= end) {
        issues.push({
          type: 'temporal',
          severity: 'error',
          message: `Arc ${idx} start_time is not before end_time`,
        });
      }
    }

    // Causal direction (the cause may not follow the effect)
    for (const link of links) {
      const causeTime = new Date(events[link.causeIndex].timestamp).getTime();
      const effectTime = new Date(events[link.effectIndex].timestamp).getTime();
      if (isTemporalInversion(causeTime, effectTime)) {
        issues.push({
          type: 'causal_direction',
          severity: 'error',
          message: `Causal link invalid: cause (${events[link.causeIndex].timestamp}) is after effect (${events[link.effectIndex].timestamp})`,
        });
      }
    }

    // Acyclicity: the causal links must form a directed acyclic graph. A cycle
    // is not a temporal paradox -- every link in it can point forwards in
    // time -- but it makes the timeline causally impossible, so it is
    // reported as an error of its own.
    const cycle = this.detectIndexCycle(links);
    if (cycle) {
      issues.push({
        type: 'causal_cycle',
        severity: 'error',
        message: `Causal links form a cycle: ${cycle.map((i) => i + 1).join(' -> ')}`,
        details: { cycle },
      });
    }

    return {
      valid: issues.length === 0,
      graphId: 'preview',
      errorCount: issues.filter((i) => i.severity === 'error').length,
      warningCount: issues.filter((i) => i.severity === 'warning').length,
      issues,
    };
  }

  /**
   * Find a cycle among the causal links, if there is one.
   *
   * Returns the event indexes the cycle runs through, or `null` when the
   * links are acyclic.
   */
  private detectIndexCycle(links: IntermediateCausalLink[]): number[] | null {
    const adjacency = new Map<number, number[]>();
    for (const link of links) {
      const neighbours = adjacency.get(link.causeIndex) || [];
      neighbours.push(link.effectIndex);
      adjacency.set(link.causeIndex, neighbours);
    }

    const visited = new Set<number>();
    const stack: number[] = [];
    const onStack = new Set<number>();

    const walk = (node: number): number[] | null => {
      visited.add(node);
      stack.push(node);
      onStack.add(node);

      for (const neighbour of adjacency.get(node) || []) {
        if (onStack.has(neighbour)) {
          const start = stack.indexOf(neighbour);
          return [...stack.slice(start), neighbour];
        }
        if (!visited.has(neighbour)) {
          const found = walk(neighbour);
          if (found) return found;
        }
      }

      stack.pop();
      onStack.delete(node);
      return null;
    };

    for (const node of adjacency.keys()) {
      if (visited.has(node)) continue;
      const found = walk(node);
      if (found) return found;
    }

    return null;
  }
}
