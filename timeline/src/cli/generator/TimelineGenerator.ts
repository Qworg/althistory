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
import { GraphCalendar, formatWorldYear, normalizeCalendar } from '@/utils/worldCalendar';
import { ValidationErrorCLI } from '../utils/exitCodes';

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

/**
 * What a `generate timeline` request comes to once it is checked: an alternate
 * history turning away from real history, or the chronicle of an invented world.
 */
interface GenerationPlan {
  kind: 'counterfactual' | 'world';
  /** The premise, or the invented world. */
  subject: string;
  /** Where real history turns; empty for an invented world. */
  divergencePoint: string;
  /** The world's calendar; only an invented world has one. */
  calendar?: GraphCalendar;
  startMs: number;
  endMs: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_YEAR = 365.25 * MS_PER_DAY;

/** How long an invented world's chronicle runs when no end date is given. */
const WORLD_DEFAULT_SPAN_YEARS = 300;

/** An arc that ends where it starts (or before) is given a day, so it has a width. */
function widenedEnd(startMs: number, endMs: number): number {
  return startMs >= endMs ? startMs + MS_PER_DAY : endMs;
}

/** The last instant a four-digit stored year can hold. */
const LAST_STORED_INSTANT = Date.parse('9999-12-31T23:59:59.999Z');

/**
 * An ISO-8601 instant, NaN when absent or unreadable. A date-time written
 * without a zone is read as UTC, like every historical date here: `Date.parse`
 * would read it in the host's zone, and in Tokyo "1000-01-01T00:00" is the
 * last day of 999.
 */
function parseInstant(value: string | undefined): number {
  if (!value) return NaN;
  const trimmed = value.trim();
  const zoneless = /^[+-]?\d{4,6}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed);
  return Date.parse(zoneless ? `${trimmed}Z` : trimmed);
}

/** The stored year an invented world's year 1 falls on when nothing says otherwise. */
const WORLD_DEFAULT_EPOCH_YEAR = 1000;

/** The ages a template chronicle of an invented world moves through. */
const WORLD_MILESTONES = [
  'The founding age, when the first peoples of the world settle the land',
  'Rival powers rise and contest the land',
  'A pact or law sets the order of the age',
  'War, schism or catastrophe breaks the old order',
  'A new faith, craft or discovery changes daily life',
  'Old enemies become allies against a new threat',
  'An age of trade and learning',
  'Decline, and the seeds of the next age',
];

/** How each style words a milestone of an invented world's template chronicle. */
const WORLD_STYLE_RENDERERS: Record<NarrativeStyle, (milestone: string, world: string) => string> = {
  academic: (milestone, world) => `${milestone}, as recorded in the chronicle of ${world}.`,
  narrative: (milestone, world) => `In the chronicle of ${world}, ${lowerFirst(milestone)}.`,
  concise: (milestone) => `${milestone}.`,
};

/**
 * Who wrote a generated timeline: a model, or the template used when there is
 * no model key or the model's answer could not be used. A template is a
 * skeleton to rewrite, and the result says so, so an agent does not present it
 * as a history.
 */
type GenerationSource = 'model' | 'template';

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

/** Text cut to at most `max` characters at a word boundary, with an ellipsis when cut. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

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
    // Pass 1: Determine Macro Bounds & Epoch Span
    return this.generateFromPlan(options, this.resolvePlan(options), container);
  }

  /** Passes 2 to 5, and the write, for a checked request. */
  private async generateFromPlan(
    options: GenerateTimelineOptions,
    plan: GenerationPlan,
    container: Container
  ): Promise<GenerationResultDto> {
    const eventCount = Math.max(3, Math.min(options.eventCount || 8, 30));
    const { startMs } = plan;
    const stepMs = Math.max(30 * MS_PER_DAY, Math.floor((plan.endMs - plan.startMs) / eventCount));
    const targetGraphName =
      options.graphName ||
      (plan.kind === 'world' ? `World: ${clip(plan.subject, 40)}` : `What If: ${plan.subject.slice(0, 40)}`);

    // Pass 2: Generate Chronological Micro-Events
    const { events: intermediateEvents, source } = await this.generateEventsPass(
      options,
      plan,
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

    const clusteredArcs = clusterEventsIntoArcs(
      extractedEvents,
      { type: 'llm', extractedAt: new Date().toISOString() },
      { calendar: plan.calendar }
    );

    // The requested depth decides how many levels of arcs the timeline has.
    const structuredArcs = this.buildArcHierarchy(clusteredArcs, options.depth ?? 1, plan.calendar);

    // Pass 4: Causal Ripple Synthesis
    const causalLinks = this.generateCausalRipplesPass(intermediateEvents);

    // Pass 5: Integrity Verification
    const validation = this.verifyIntegrityPass(intermediateEvents, structuredArcs, causalLinks);

    // Persist or Dry-Run
    if (options.dryRun) {
      const dryGraphId = `dry-${Date.now()}`;
      const dryArcIdByTempId = new Map<string, string>(
        structuredArcs.map((arc, index) => [arc.tempId, `arc-dry-${index}`])
      );
      // The preview places each event as the write would: in the innermost
      // arc that holds it (an arc that ends where it starts is widened to a
      // day, as there).
      const dryArcIdOf = (timestamp: string): string | undefined => {
        const time = new Date(timestamp).getTime();
        const holding = structuredArcs
          .filter((arc) => {
            const start = Date.parse(arc.start_time);
            const end = widenedEnd(start, Date.parse(arc.end_time));
            return start <= time && time <= end;
          })
          .sort((a, b) => b.level - a.level);
        return holding[0] ? dryArcIdByTempId.get(holding[0].tempId) : undefined;
      };
      const eventDtos: EventDto[] = intermediateEvents.map((e, idx) => {
        const arcId = dryArcIdOf(e.timestamp);
        return {
          id: `evt-dry-${idx}`,
          graphId: dryGraphId,
          description: e.description,
          timestamp: e.timestamp,
          actor: e.actor,
          target: e.target,
          importance: e.importance,
          metadata: { importance: e.importance, ...(arcId ? { arcId } : {}) },
        };
      });
      const arcDtos: ArcDto[] = structuredArcs.map((a, idx) => ({
        id: `arc-dry-${idx}`,
        graphId: dryGraphId,
        name: a.name,
        description: a.description,
        startTime: a.start_time,
        endTime: new Date(widenedEnd(Date.parse(a.start_time), Date.parse(a.end_time))).toISOString(),
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
        premise: plan.subject,
        divergencePoint: plan.divergencePoint,
        ...this.worldFields(plan),
        source,
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
      description:
        plan.kind === 'world' ? `Invented world: ${plan.subject}` : `Generated counterfactual: ${plan.subject}`,
      calendar: plan.calendar,
    });
    const graphId = graph.id;
    const scoped = await container.graphScopedRepositories(graphId);

    const persistedArcs: ArcDto[] = [];
    // The parents are created first, so that a child arc can name the arc it
    // belongs to by its real id.
    const arcIdByTempId = new Map<string, string>();
    const orderedArcs = [...structuredArcs].sort((a, b) => a.level - b.level);
    for (const a of orderedArcs) {
      const startTime = new Date(a.start_time);
      let endTime = new Date(a.end_time);
      endTime = new Date(widenedEnd(startTime.getTime(), endTime.getTime()));
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

    // Each event goes in the innermost arc that holds it, which is what the app
    // and the exports read (`metadata.arcId`); otherwise every event was left
    // outside the arcs that were drawn around it.
    const arcIdOf = (timestamp: string): string | undefined => {
      const time = new Date(timestamp).getTime();
      const holding = persistedArcs
        .filter((arc) => Date.parse(arc.startTime) <= time && time <= Date.parse(arc.endTime))
        .sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
      return holding[0]?.id;
    };

    const domainEvents: Event[] = [];
    const persistedEvents: EventDto[] = [];
    for (const e of intermediateEvents) {
      const created = await scoped.eventRepository.create({
        description: e.description,
        timestamp: new Date(e.timestamp),
        actor: e.actor,
        target: e.target,
        metadata: { importance: e.importance, ...(arcIdOf(e.timestamp) ? { arcId: arcIdOf(e.timestamp) } : {}) },
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
        metadata: created.metadata,
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
      premise: plan.subject,
      divergencePoint: plan.divergencePoint,
      ...this.worldFields(plan),
      source,
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
  private buildArcHierarchy(baseArcs: ExtractedArc[], depth: number, calendar?: GraphCalendar): StructuredArc[] {
    const yearOf = (timestamp: string): string => {
      const year = new Date(timestamp).getUTCFullYear();
      return calendar ? formatWorldYear(year, calendar) : timestamp.slice(0, 4);
    };
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
          name: calendar ? `Era ${yearOf(start)}–${yearOf(end)}` : `Era ${yearOf(start)}-${yearOf(end)}`,
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

    // A branch of an invented world is still that world: it is written as one,
    // in its calendar, rather than as a turn away from real history.
    const sourceGraph = await container.graphService.getGraph(options.sourceGraphId);
    const branchPlan: GenerationPlan = {
      kind: sourceGraph.calendar ? 'world' : 'counterfactual',
      subject: options.counterfactualPrompt,
      divergencePoint: pivotEvent.description,
      calendar: sourceGraph.calendar,
      startMs: pivotTimeMs + MS_PER_DAY,
      endMs: pivotTimeMs + stepMs * eventCount,
    };

    // Generate divergent events
    const { events: intermediateEvents, source } = await this.generateEventsPass(
      divergentTimelineOptions,
      branchPlan,
      eventCount,
      pivotTimeMs + MS_PER_DAY,
      stepMs
    );
    const times = intermediateEvents.map((e) => new Date(e.timestamp).getTime());
    const arcStart = Math.min(...times);
    const arcEnd = Math.max(Math.max(...times), arcStart + MS_PER_DAY);
    const branchArcName = `${options.branchName} Divergence Era`;
    const branchArcDescription = branchPlan.calendar
      ? `Another course for the chronicle from ${pivotEvent.actor}: ${options.counterfactualPrompt}`
      : `Counterfactual divergent timeline from ${pivotEvent.actor}: ${options.counterfactualPrompt}`;

    // The preview is what the write below makes: the same events, one arc
    // holding them, a link from the pivot and a chain through them.
    if (options.dryRun) {
      const dryGraphId = `dry-${Date.now()}`;
      const arcId = 'arc-dry-0';
      const events: EventDto[] = intermediateEvents.map((e, idx) => ({
        id: `evt-dry-${idx}`,
        graphId: dryGraphId,
        description: e.description,
        timestamp: e.timestamp,
        actor: e.actor,
        target: e.target,
        importance: e.importance,
        metadata: { importance: e.importance, arcId },
      }));
      const chain: IntermediateCausalLink[] = intermediateEvents.slice(1).map((_, idx) => ({
        causeIndex: idx,
        effectIndex: idx + 1,
        weight: 0.85,
        type: 'direct',
        reasoning: `Divergent cascade from ${intermediateEvents[idx].description}`,
      }));
      const relationships: CausalRelationshipDto[] = [
        ...(events.length > 0
          ? [
              {
                id: 'rel-dry-pivot',
                graphId: dryGraphId,
                causeId: pivotEvent.id,
                effectId: events[0].id,
                weight: 0.95,
                type: 'direct',
                reasoning: `Counterfactual branch point: ${options.counterfactualPrompt}`,
                confidence: 0.95,
              },
            ]
          : []),
        ...chain.map((link, idx) => ({
          id: `rel-dry-${idx}`,
          graphId: dryGraphId,
          causeId: events[link.causeIndex].id,
          effectId: events[link.effectIndex].id,
          weight: link.weight,
          type: link.type,
          reasoning: link.reasoning,
          confidence: 0.9,
        })),
      ];
      const arcPreview = { start_time: new Date(arcStart).toISOString(), end_time: new Date(arcEnd).toISOString() };
      return {
        graphId: dryGraphId,
        graphName: options.branchName,
        premise: options.counterfactualPrompt,
        divergencePoint: pivotEvent.description,
        ...(branchPlan.calendar ? { calendar: branchPlan.calendar } : {}),
        source,
        eventCount: events.length,
        arcCount: 1,
        relationshipCount: relationships.length,
        events,
        arcs: [
          {
            id: arcId,
            graphId: dryGraphId,
            name: branchArcName,
            description: branchArcDescription,
            startTime: arcPreview.start_time,
            endTime: arcPreview.end_time,
            level: 0,
          },
        ],
        relationships,
        validation: { ...this.verifyIntegrityPass(intermediateEvents, [arcPreview], chain), graphId: dryGraphId },
      };
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

    // The branch's arc holds the events it adds, so it is made first and each
    // event is placed in it. A top-level arc: it has no parent, so it is level
    // 0 (an export of a level-1 arc without a parent fails the import's
    // hierarchy check). It is recorded like the events, or an export of the
    // branch would leave it out.
    const arc = await targetScoped.arcRepository.create({
      name: branchArcName,
      description: branchArcDescription,
      start_time: new Date(arcStart),
      end_time: new Date(arcEnd),
      level: 0,
    });
    try {
      await container.graphWriteVersioningService.recordArc(branchedGraphId, arc, 'create');
    } catch {
      // Best effort
    }
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

    const domainEvents: Event[] = [];
    const persistedEvents: EventDto[] = [];
    for (const e of intermediateEvents) {
      const created = await targetScoped.eventRepository.create({
        description: e.description,
        timestamp: new Date(e.timestamp),
        actor: e.actor,
        target: e.target,
        metadata: { importance: e.importance, arcId: arc.id },
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
        metadata: created.metadata,
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
      // Recorded, like the events and the arc: otherwise a diff cannot see the
      // link, a merge leaves it behind, and a rollback of the branch loses it.
      try {
        await container.graphWriteVersioningService.recordRelationship(branchedGraphId, branchLink, 'create');
      } catch {
        // Best effort
      }
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
      try {
        await container.graphWriteVersioningService.recordRelationship(branchedGraphId, link, 'create');
      } catch {
        // Best effort
      }
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

    return {
      graphId: branchedGraphId,
      graphName: options.branchName,
      premise: options.counterfactualPrompt,
      divergencePoint: pivotEvent.description,
      ...(branchPlan.calendar ? { calendar: branchPlan.calendar } : {}),
      source,
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
    // Recorded in the graph's history, like everything else the generator
    // writes: a merge or rollback rebuilds the live store from that history,
    // and an unrecorded expansion vanished from the graph.
    try {
      await container.graphWriteVersioningService.recordArc(options.graphId, createdArc, 'create');
    } catch {
      // Best effort
    }

    const createdEvents: EventDto[] = [];
    for (const e of intermediateEvents) {
      const created = await scoped.eventRepository.create({
        description: e.description,
        timestamp: new Date(e.timestamp),
        actor: e.actor,
        target: e.target,
        metadata: { importance: e.importance, arcId: createdArc.id },
      });
      try {
        await container.graphWriteVersioningService.recordEvent(options.graphId, created, 'create');
      } catch {
        // Best effort
      }
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

  /**
   * Check a `generate timeline` request and settle what it will write: which
   * kind of timeline, the span it covers and, for an invented world, its
   * calendar.
   */
  private resolvePlan(options: GenerateTimelineOptions): GenerationPlan {
    const world = options.world?.trim() ?? '';
    const premise = options.premise?.trim() ?? '';
    const divergencePoint = options.divergencePoint?.trim() ?? '';
    const startParsed = parseInstant(options.startDate);
    const endParsed = parseInstant(options.endDate);
    if (options.startDate && Number.isNaN(startParsed)) {
      throw new ValidationErrorCLI(`Invalid start date "${options.startDate}": expected an ISO-8601 date`);
    }
    if (options.endDate && Number.isNaN(endParsed)) {
      throw new ValidationErrorCLI(`Invalid end date "${options.endDate}": expected an ISO-8601 date`);
    }

    if (world) {
      if (premise || divergencePoint) {
        throw new ValidationErrorCLI(
          'Give either a world to invent, or a premise and a point of divergence, not both'
        );
      }
      const startYear = Number.isNaN(startParsed) ? undefined : new Date(startParsed).getUTCFullYear();
      let calendar: GraphCalendar;
      try {
        calendar = normalizeCalendar({
          ...options.calendar,
          epochYear: options.calendar?.epochYear ?? startYear ?? WORLD_DEFAULT_EPOCH_YEAR,
        });
      } catch (err) {
        throw new ValidationErrorCLI((err as Error).message);
      }
      const startMs = Number.isNaN(startParsed)
        ? Date.parse(`${String(calendar.epochYear).padStart(4, '0')}-01-01T00:00:00Z`)
        : startParsed;
      // A stored year has four digits; past 9999 a timestamp needs an expanded
      // year, which the rest of the system does not read. The default span
      // stops there, and an end date past it is refused.
      if (!Number.isNaN(endParsed) && endParsed > LAST_STORED_INSTANT) {
        throw new ValidationErrorCLI('The end date must be no later than the year 9999');
      }
      const endMs = Number.isNaN(endParsed)
        ? Math.min(startMs + WORLD_DEFAULT_SPAN_YEARS * MS_PER_YEAR, LAST_STORED_INSTANT)
        : endParsed;
      if (endMs <= startMs) {
        throw new ValidationErrorCLI('The end date must be after the start date');
      }
      return { kind: 'world', subject: world, divergencePoint: '', calendar, startMs, endMs };
    }

    if (!premise || !divergencePoint) {
      throw new ValidationErrorCLI(
        'Give a premise and a point of divergence for an alternate history, or a world to invent one from scratch'
      );
    }
    if (options.calendar) {
      throw new ValidationErrorCLI(
        'A calendar is for an invented world; an alternate history keeps the real calendar'
      );
    }

    let startMs = startParsed;
    if (Number.isNaN(startMs)) {
      // Try to extract 4 digit year from divergencePoint or premise
      const yearMatch = (divergencePoint + ' ' + premise).match(/\b(1\d{3}|20\d{2})\b/);
      if (yearMatch) {
        startMs = new Date(`${yearMatch[1]}-01-01T00:00:00Z`).getTime();
      } else {
        startMs = new Date('1914-06-28T10:00:00Z').getTime();
      }
    }

    // Default to 15 years after start
    const endMs = Number.isNaN(endParsed) ? startMs + 15 * MS_PER_YEAR : endParsed;
    if (endMs <= startMs) {
      throw new ValidationErrorCLI('The end date must be after the start date');
    }

    return { kind: 'counterfactual', subject: premise, divergencePoint, startMs, endMs };
  }

  /** The result fields only an invented world has. */
  private worldFields(plan: GenerationPlan): Pick<GenerationResultDto, 'world' | 'calendar'> {
    return plan.kind === 'world' ? { world: plan.subject, calendar: plan.calendar } : {};
  }

  private async generateEventsPass(
    options: GenerateTimelineOptions,
    plan: GenerationPlan,
    eventCount: number,
    startMs: number,
    stepMs: number
  ): Promise<{ events: IntermediateEvent[]; source: GenerationSource }> {
    const style: NarrativeStyle = options.style || 'academic';
    const isWorld = plan.kind === 'world';

    // If LLM client is available, prompt LLM for a structured narrative
    if (this.llmClient) {
      try {
        const prompt = isWorld
          ? this.worldPrompt(plan, style, eventCount)
          : `You are an expert counterfactual historian.
Premise: ${plan.subject}
Point of Divergence: ${plan.divergencePoint}
Style: ${style} (${STYLE_GUIDANCE[style]})
Generate ${eventCount} chronological historical events demonstrating this counterfactual reality.`;
        const extracted = await this.llmClient.extractEvents(prompt, {
          defaultTimeRange: {
            start: new Date(plan.startMs).toISOString(),
            end: new Date(plan.endMs).toISOString(),
          },
        });
        if (extracted.length >= 3) {
          const sorted = [...extracted].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          const events = sorted.map((e, idx) => ({
            description: e.description,
            timestamp: e.timestamp,
            actor: e.actor || (isWorld ? 'Unnamed Realm' : 'Divergent Government'),
            target: e.target || (isWorld ? 'Unnamed People' : 'Opposing Power'),
            importance: Math.max(0.4, 1.0 - idx * 0.05),
          }));
          return { events, source: 'model' };
        }
      } catch {
        // Fall back to the deterministic template below
      }
    }

    if (isWorld) {
      return { events: this.worldTemplateEvents(plan, style, eventCount, startMs, stepMs), source: 'template' };
    }

    // Deterministic counterfactual progression synthesizer
    const events: IntermediateEvent[] = [];
    const premise = plan.subject;
    const actor = premise.includes('Napoleon')
      ? 'French Empire'
      : premise.includes('Rome')
        ? 'Roman Empire'
        : premise.includes('America') || premise.includes('Washington')
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
      `Point of Divergence: ${plan.divergencePoint}`,
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
          ? plan.divergencePoint
          : STYLE_RENDERERS[style](milestone, premise.slice(0, 50));
      events.push({
        description: desc,
        timestamp: new Date(timeMs).toISOString(),
        actor: i % 2 === 0 ? actor : target,
        target: i % 2 === 0 ? target : actor,
        importance: i === 0 ? 1.0 : Math.max(0.5, 0.9 - i * 0.05),
      });
    }

    return { events, source: 'template' };
  }

  /**
   * What the model is asked for when it chronicles an invented world. The
   * world is not Earth, so it is told not to borrow real history, and it is
   * told how the world's years are stored so its dates land where they belong.
   */
  private worldPrompt(plan: GenerationPlan, style: NarrativeStyle, eventCount: number): string {
    const calendar = plan.calendar as GraphCalendar;
    const offset = calendar.epochYear - 1;
    const yearWord = calendar.eraLabel ? `"312 ${calendar.eraLabel}"` : '"Year 312"';
    const months = calendar.monthNames
      ? ` Its months are the ISO months under other names (${calendar.monthNames.map((name, index) => `${index + 1} = ${name}`).join('; ')}); use those names in descriptions, and the ISO months in timestamps.`
      : '';
    const calendarLine = `Calendar: ${calendar.name ? `${calendar.name}. ` : ''}The world's year 1 is stored as ISO year ${calendar.epochYear}, so the world's year N is ISO year N + ${offset} (the world writes year 312 as ${yearWord}, stored as ${312 + offset}).${months}`;
    const range = `between ${new Date(plan.startMs).toISOString()} and ${new Date(plan.endMs).toISOString()}`;
    if (plan.divergencePoint) {
      return `You are a worldbuilder writing another course for the chronicle of an invented world. It is not Earth: do not borrow real people, nations, places or events.
The chronicle turns at: ${plan.divergencePoint}
In this telling: ${plan.subject}
${calendarLine}
Style: ${style} (${STYLE_GUIDANCE[style]})
Generate ${eventCount} chronological events that follow from this turn, dated with ISO-8601 timestamps ${range}. Give each a named actor and target from the world itself.`;
    }
    return `You are a worldbuilder writing the chronicle of an invented world. It is not Earth: do not borrow real people, nations, places or events.
World: ${plan.subject}
${calendarLine}
Style: ${style} (${STYLE_GUIDANCE[style]})
Generate ${eventCount} chronological events of this world's history, from its founding onwards, dated with ISO-8601 timestamps ${range}. Give each a named actor and target from the world itself.`;
  }

  /**
   * A template chronicle of an invented world, for when there is no model to
   * write one: the ages a world's history commonly moves through, spaced over
   * the span, for the author to rewrite.
   */
  private worldTemplateEvents(
    plan: GenerationPlan,
    style: NarrativeStyle,
    eventCount: number,
    startMs: number,
    stepMs: number
  ): IntermediateEvent[] {
    const world = clip(plan.subject, 50);
    const events: IntermediateEvent[] = [];
    for (let i = 0; i < eventCount; i++) {
      const milestone = WORLD_MILESTONES[i % WORLD_MILESTONES.length];
      events.push({
        description:
          i === 0
            ? plan.divergencePoint
              ? `The chronicle turns: ${plan.subject}`
              : `The founding of the world: ${plan.subject}`
            : WORLD_STYLE_RENDERERS[style](milestone, world),
        // At midnight: a template date is a day, and an hour would show as one.
        timestamp: new Date(Math.floor((startMs + stepMs * i) / MS_PER_DAY) * MS_PER_DAY).toISOString(),
        actor: i % 2 === 0 ? 'Founding People' : 'Rival Realm',
        target: i % 2 === 0 ? 'Rival Realm' : 'Founding People',
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
