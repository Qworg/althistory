import { Event, Arc } from '@/models';
import { CausalRelationship, CausalRelationshipType } from '@/models/relationships';
import { ValidationIssueDto, ValidationReportDto } from '../types';
import { isTemporalInversion } from '@/utils/causalOrder';

export interface ScopedGraphServices {
  eventRepository: {
    findAll: () => Promise<Event[]>;
    findById: (id: string) => Promise<Event | null>;
    update: (id: string, updates: Partial<{ description: string; timestamp: Date; actor: string; target: string; metadata: Record<string, unknown> }>) => Promise<Event | null>;
    delete: (id: string) => Promise<boolean>;
  };
  arcRepository: {
    findAll: () => Promise<Arc[]>;
    findById: (id: string) => Promise<Arc | null>;
    update: (id: string, updates: Partial<{ name: string; description: string; start_time: Date; end_time: Date; level: number; metadata: Record<string, unknown> }>) => Promise<Arc | null>;
    delete: (id: string) => Promise<boolean>;
  };
  causalService: {
    getAllRelationships: () => Promise<Array<{
      id: string;
      cause_event_id: string;
      effect_event_id: string;
      weight: number;
      confidence: number;
      evidence: string;
      relationship_type: string;
    }>>;
    createCausalLink: (cause: Event, effect: Event, relationship: CausalRelationship) => Promise<unknown>;
    deleteCausalLink: (causeId: string, effectId: string) => Promise<unknown>;
  };
}

/**
 * Looks an entity id up in the graphs other than the one being validated.
 *
 * Returns the id of the graph that owns the entity, or `undefined` when no
 * graph owns it. It is only consulted for references that are already broken
 * inside the graph, so a graph with no broken references never pays for the
 * lookup.
 */
export type CrossGraphLookup = (entityId: string) => Promise<string | undefined>;

/**
 * What the cross-graph lookup says about a referenced entity.
 *
 * `owned` means the entity lives in another graph, so the reference is not
 * dangling. `dangling` means no graph holds it. `unknown` means the lookup
 * failed: the reference could not be checked, and a reference that could not
 * be checked is never treated as a dangling one.
 */
type Ownership =
  | { kind: 'owned'; graphId: string }
  | { kind: 'dangling' }
  | { kind: 'unknown'; reason: string };

/**
 * What a delete of a causal link did.
 *
 * `refused` is the one that matters for the report: the link is still there,
 * and a report that says the link was removed would be wrong.
 */
type DeleteLinkOutcome = 'deleted' | 'already-gone' | 'refused';

/** The kinds of entity a reference can name. */
type ReferenceEntityType = 'event' | 'arc';

/** A reference that points at an entity this graph does not hold. */
interface BrokenReference {
  /** The id of the entity that is referenced. */
  entityId: string;
  /** What the reference is called in the message. */
  label: string;
  /** The kind of entity that is referenced. */
  entityType: ReferenceEntityType;
  /** The message for the dangling reference. */
  message: string;
  /** The id of the entity that holds the reference. */
  referrerId?: string;
  /** The kind of entity that holds the reference. */
  referrerType?: 'event' | 'arc' | 'relationship';
}

/**
 * Whether an error says that something is not there.
 *
 * The daemon answers 404 when a link cannot be deleted because one of its
 * ends is gone, and the Neo4j store removes every link between two events at
 * once, so a second attempt to delete a link that is already gone finds
 * nothing to delete.
 */
export function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    name?: unknown;
    message?: unknown;
  };
  if (candidate.status === 404 || candidate.statusCode === 404) return true;
  if (candidate.response && typeof candidate.response === 'object' && candidate.response.status === 404) {
    return true;
  }
  if (candidate.name === 'NotFoundError' || candidate.name === 'NotFoundErrorCLI') return true;
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : '';
  return message.includes('not found') || message.includes('404');
}

/** The options a validation run takes. */
export interface ValidationOptions {
  strict?: boolean;
  autoRepair?: boolean;
  /** Finds the graph that owns an entity referenced by a broken reference. */
  crossGraphLookup?: CrossGraphLookup;
}

export class GraphValidator {
  /**
   * Validates graph data and optionally performs self-healing repairs.
   */
  async validate(
    graphId: string,
    scoped: ScopedGraphServices,
    options?: ValidationOptions
  ): Promise<ValidationReportDto> {
    const strict = options?.strict ?? false;
    const autoRepair = options?.autoRepair ?? false;

    if (autoRepair) {
      return this.validateAndRepair(graphId, scoped, strict, options?.crossGraphLookup);
    }

    return this.runValidationChecks(graphId, scoped, strict, options?.crossGraphLookup);
  }

  /**
   * Runs pure read-only validation checks on the graph.
   */
  private async runValidationChecks(
    graphId: string,
    scoped: ScopedGraphServices,
    strict: boolean,
    crossGraphLookup?: CrossGraphLookup
  ): Promise<ValidationReportDto> {
    const events = await scoped.eventRepository.findAll();
    const arcs = await scoped.arcRepository.findAll();
    const rels = await scoped.causalService.getAllRelationships();

    const issues: ValidationIssueDto[] = [];
    const eventMap = new Map<string, Event>(events.map((e) => [e.id, e]));
    const arcMap = new Map<string, Arc>(arcs.map((a) => [a.id, a]));

    // 1. Temporal checks: event timestamps
    for (const event of events) {
      if (!event.timestamp || isNaN(event.timestamp.getTime())) {
        issues.push({
          type: 'temporal',
          severity: 'error',
          message: `Event "${event.description}" (${event.id}) has invalid or missing timestamp`,
          entityId: event.id,
          entityType: 'event',
        });
      }
    }

    // 2. Temporal & containment checks: arcs
    for (const arc of arcs) {
      if (!arc.start_time || isNaN(arc.start_time.getTime()) || !arc.end_time || isNaN(arc.end_time.getTime())) {
        issues.push({
          type: 'temporal',
          severity: 'error',
          message: `Arc "${arc.name}" (${arc.id}) has invalid temporal boundaries`,
          entityId: arc.id,
          entityType: 'arc',
        });
        continue;
      }

      if (arc.start_time.getTime() > arc.end_time.getTime()) {
        issues.push({
          type: 'temporal',
          severity: 'error',
          message: `Arc "${arc.name}" (${arc.id}) start_time (${arc.start_time.toISOString()}) is after end_time (${arc.end_time.toISOString()})`,
          entityId: arc.id,
          entityType: 'arc',
          details: {
            startTime: arc.start_time.toISOString(),
            endTime: arc.end_time.toISOString(),
          },
        });
      }

      // Parent arc nesting check
      const parentArcId = (arc.metadata?.parent_arc_id || arc.metadata?.parentArcId) as string | undefined;
      if (parentArcId) {
        const parent = arcMap.get(parentArcId);
        if (!parent) {
          await this.reportBrokenReference(
            issues,
            {
              entityId: parentArcId,
              label: 'parent arc',
              entityType: 'arc',
              message: `Arc "${arc.name}" (${arc.id}) references non-existent parent arc ${parentArcId}`,
              referrerId: arc.id,
              referrerType: 'arc',
            },
            crossGraphLookup
          );
        } else if (arc.start_time.getTime() < parent.start_time.getTime() || arc.end_time.getTime() > parent.end_time.getTime()) {
          issues.push({
            type: 'containment',
            severity: 'error',
            message: `Child arc "${arc.name}" (${arc.id}) extends outside parent arc "${parent.name}" (${parent.id}) bounds`,
            entityId: arc.id,
            entityType: 'arc',
            details: {
              childRange: { start: arc.start_time.toISOString(), end: arc.end_time.toISOString() },
              parentRange: { start: parent.start_time.toISOString(), end: parent.end_time.toISOString() },
            },
          });
        }
      }
    }

    // 3. Containment checks: event in arc
    for (const event of events) {
      const arcId = (event.metadata?.arcId || event.metadata?.arc_id) as string | undefined;
      if (arcId) {
        const arc = arcMap.get(arcId);
        if (!arc) {
          await this.reportBrokenReference(
            issues,
            {
              entityId: arcId,
              label: 'arc',
              entityType: 'arc',
              message: `Event "${event.description}" (${event.id}) references non-existent arc ${arcId}`,
              referrerId: event.id,
              referrerType: 'event',
            },
            crossGraphLookup
          );
        } else {
          const eventTime = event.timestamp.getTime();
          if (eventTime < arc.start_time.getTime() || eventTime > arc.end_time.getTime()) {
            issues.push({
              type: 'containment',
              severity: 'error',
              message: `Event "${event.description}" (${event.id}, ${event.timestamp.toISOString()}) falls outside arc "${arc.name}" bounds (${arc.start_time.toISOString()} - ${arc.end_time.toISOString()})`,
              entityId: event.id,
              entityType: 'event',
              details: {
                eventTimestamp: event.timestamp.toISOString(),
                arcStartTime: arc.start_time.toISOString(),
                arcEndTime: arc.end_time.toISOString(),
                arcId: arc.id,
              },
            });
          }
        }
      }
    }

    // 4. Causal direction and orphan endpoints
    for (const rel of rels) {
      if (rel.cause_event_id === rel.effect_event_id) {
        issues.push({
          type: 'causal_direction',
          severity: 'error',
          message: `Self-causation detected: event ${rel.cause_event_id} cannot cause itself`,
          entityId: rel.id,
          entityType: 'relationship',
        });
        continue;
      }

      const cause = eventMap.get(rel.cause_event_id);
      const effect = eventMap.get(rel.effect_event_id);

      if (!cause) {
        await this.reportBrokenReference(
          issues,
          {
            entityId: rel.cause_event_id,
            label: 'cause event',
            entityType: 'event',
            message: `Causal relationship ${rel.id} references non-existent cause event ${rel.cause_event_id}`,
            referrerId: rel.id,
            referrerType: 'relationship',
          },
          crossGraphLookup
        );
      }

      if (!effect) {
        await this.reportBrokenReference(
          issues,
          {
            entityId: rel.effect_event_id,
            label: 'effect event',
            entityType: 'event',
            message: `Causal relationship ${rel.id} references non-existent effect event ${rel.effect_event_id}`,
            referrerId: rel.id,
            referrerType: 'relationship',
          },
          crossGraphLookup
        );
      }

      if (cause && effect) {
        if (isTemporalInversion(cause.timestamp, effect.timestamp)) {
          issues.push({
            type: 'causal_direction',
            severity: 'error',
            message: `Temporal paradox: cause "${cause.description}" (${cause.timestamp.toISOString()}) occurs after effect "${effect.description}" (${effect.timestamp.toISOString()})`,
            entityId: rel.id,
            entityType: 'relationship',
            details: {
              causeId: cause.id,
              effectId: effect.id,
              causeTimestamp: cause.timestamp.toISOString(),
              effectTimestamp: effect.timestamp.toISOString(),
            },
          });
        }
      }
    }

    // 5. Causal cycle detection (DAG validation)
    const cycles = this.detectCycles(rels);
    for (const cycle of cycles) {
      issues.push({
        type: 'causal_cycle',
        severity: 'error',
        message: `Causal cycle detected: ${cycle.join(' -> ')}`,
        details: { cycle },
      });
    }

    // 6. Structural warnings
    if (events.length > 0 && arcs.length === 0) {
      issues.push({
        type: 'containment',
        severity: 'warning',
        message: `Graph has ${events.length} events but no narrative arcs defined`,
      });
    }

    if (events.length > 3 && rels.length === 0) {
      issues.push({
        type: 'causal_direction',
        severity: 'warning',
        message: `Graph has ${events.length} events but no causal relationships defined`,
      });
    }

    const errors = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity === 'warning');
    const valid = strict ? issues.length === 0 : errors.length === 0;

    return {
      valid,
      graphId,
      errorCount: errors.length,
      warningCount: warnings.length,
      issues,
    };
  }

  /**
   * Runs validation and executes self-healing repairs.
   *
   * The repairs that were made are reported in `repairsApplied`, and the ones
   * that were not -- because the reference points into another graph, because
   * the lookup that would say so failed, or because the store refused the
   * delete -- are reported in `repairFailures`. A repair that was not made is
   * never counted as one.
   */
  private async validateAndRepair(
    graphId: string,
    scoped: ScopedGraphServices,
    strict: boolean,
    crossGraphLookup?: CrossGraphLookup
  ): Promise<ValidationReportDto> {
    const repairsApplied: string[] = [];
    const repairFailures: string[] = [];

    // Step 1: Repair arc temporal inversions (start > end)
    const initialArcs = await scoped.arcRepository.findAll();
    for (const arc of initialArcs) {
      if (arc.start_time && arc.end_time && arc.start_time.getTime() > arc.end_time.getTime()) {
        const swappedStart = arc.end_time;
        const swappedEnd = arc.start_time;
        await scoped.arcRepository.update(arc.id, {
          start_time: swappedStart,
          end_time: swappedEnd,
        });
        repairsApplied.push(`Swapped inverted start and end times for arc "${arc.name}" (${arc.id})`);
      }
    }

    // Step 2: Repair orphan arc references in events and arc bounds containment
    const refreshedArcs = await scoped.arcRepository.findAll();
    const arcMap = new Map<string, Arc>(refreshedArcs.map((a) => [a.id, a]));
    const events = await scoped.eventRepository.findAll();

    for (const event of events) {
      const arcId = (event.metadata?.arcId || event.metadata?.arc_id) as string | undefined;
      if (arcId) {
        const arc = arcMap.get(arcId);
        if (!arc) {
          const ownership = await this.resolveOwnership(arcId, crossGraphLookup);
          if (ownership.kind === 'owned') {
            // The arc lives in another graph. The reference is not dangling,
            // and deleting it would throw away the only thing that says
            // where the arc is: the fix is to copy the arc, not to delete the
            // link.
            repairFailures.push(
              `Kept the reference to arc ${arcId} of event "${event.description}" (${event.id}): ` +
                `the arc lives in graph ${ownership.graphId}, so copy it into this graph rather than delete the link`
            );
          } else if (ownership.kind === 'unknown') {
            // The lookup failed, so the reference could not be checked. It is
            // left alone: a reference nobody could check is not a reference
            // that is known to be dangling.
            repairFailures.push(
              `Left the reference to arc ${arcId} of event "${event.description}" (${event.id}) alone: ` +
                `the cross-graph lookup failed (${ownership.reason}), so the reference could not be checked`
            );
          } else {
            // Orphan reference: clean metadata
            const updatedMeta = { ...(event.metadata || {}) };
            delete updatedMeta.arcId;
            delete updatedMeta.arc_id;
            await scoped.eventRepository.update(event.id, { metadata: updatedMeta });
            repairsApplied.push(`Removed orphan arc reference "${arcId}" from event "${event.description}" (${event.id})`);
          }
        } else {
          // Containment: expand arc bounds if event falls outside
          const eventTime = event.timestamp.getTime();
          let needsUpdate = false;
          let newStart = arc.start_time;
          let newEnd = arc.end_time;

          if (eventTime < arc.start_time.getTime()) {
            newStart = new Date(eventTime);
            needsUpdate = true;
          }
          if (eventTime > arc.end_time.getTime()) {
            newEnd = new Date(eventTime);
            needsUpdate = true;
          }

          if (needsUpdate) {
            await scoped.arcRepository.update(arc.id, {
              start_time: newStart,
              end_time: newEnd,
            });
            arcMap.set(arc.id, new Arc({
              id: arc.id,
              name: arc.name,
              description: arc.description,
              start_time: newStart,
              end_time: newEnd,
              level: arc.level,
              metadata: arc.metadata,
            }));
            repairsApplied.push(
              `Expanded arc "${arc.name}" (${arc.id}) boundaries to [${newStart.toISOString()} - ${newEnd.toISOString()}] to enclose event ${event.id}`
            );
          }
        }
      }
    }

    // Step 3: Repair causal endpoint orphans, self-causation, and temporal inversions
    const refreshedEvents = await scoped.eventRepository.findAll();
    const eventMap = new Map<string, Event>(refreshedEvents.map((e) => [e.id, e]));
    // The links as they are now. The list is kept up to date as the repairs
    // are made, because a repair can remove or add a link that the next
    // repair has to know about.
    let rels = await scoped.causalService.getAllRelationships();

    for (const rel of [...rels]) {
      // Self causation
      if (rel.cause_event_id === rel.effect_event_id) {
        const outcome = await this.deleteLink(scoped, rel.cause_event_id, rel.effect_event_id);
        if (outcome === 'refused') {
          repairFailures.push(
            `Could not delete the self-causation link on event ${rel.cause_event_id}: ` +
              `the store refused to delete it, so the link is still there`
          );
          continue;
        }
        rels = rels.filter(
          (entry) =>
            !(entry.cause_event_id === rel.cause_event_id && entry.effect_event_id === rel.effect_event_id)
        );
        repairsApplied.push(`Deleted self-causation link on event ${rel.cause_event_id}`);
        continue;
      }

      const cause = eventMap.get(rel.cause_event_id);
      const effect = eventMap.get(rel.effect_event_id);

      // Orphan endpoints
      if (!cause || !effect) {
        const missing = !cause ? rel.cause_event_id : rel.effect_event_id;
        const label = !cause ? `missing cause ${missing}` : `missing effect ${missing}`;
        // The end of the link may live in another graph. The lookup has to be
        // consulted before the link is deleted: a link into a sibling graph
        // is not an orphan, and deleting it would throw away the only thing
        // that says where the event is.
        const ownership = await this.resolveOwnership(missing, crossGraphLookup);
        if (ownership.kind === 'owned') {
          repairFailures.push(
            `Kept the causal relationship ${rel.id} (${label}): the event lives in graph ${ownership.graphId}, ` +
              `so copy it into this graph rather than delete the link`
          );
          continue;
        }
        if (ownership.kind === 'unknown') {
          repairFailures.push(
            `Left the causal relationship ${rel.id} (${label}) alone: the cross-graph lookup failed ` +
              `(${ownership.reason}), so the link could not be checked`
          );
          continue;
        }
        const outcome = await this.deleteLink(scoped, rel.cause_event_id, rel.effect_event_id);
        if (outcome === 'refused') {
          // The store refused the delete -- the daemon looks its ends up
          // before it deletes a link, and one of them is gone -- so the link
          // is still there and the report has to say so.
          repairFailures.push(
            `Could not delete the orphaned causal relationship ${rel.id} (${label}): ` +
              `the store refused to delete a link whose end is gone, so the link is still there`
          );
          continue;
        }
        rels = rels.filter(
          (entry) =>
            !(entry.cause_event_id === rel.cause_event_id && entry.effect_event_id === rel.effect_event_id)
        );
        if (outcome === 'deleted') {
          repairsApplied.push(
            `Deleted orphaned causal relationship ${rel.id} (${label})`
          );
        } else {
          repairFailures.push(`Causal relationship ${rel.id} (${label}) was already gone`);
        }
        continue;
      }

      // Temporal paradox: cause occurs after effect
      if (isTemporalInversion(cause.timestamp, effect.timestamp)) {
        // Reverse the relationship: the earlier event becomes the cause. The
        // original link is removed first -- adding the reversed link and
        // keeping the original would leave a two-node cycle (a -> b and
        // b -> a) in place of the single paradox that was to be repaired.
        const relType: CausalRelationshipType =
          rel.relationship_type === 'indirect' || rel.relationship_type === 'contributory'
            ? rel.relationship_type
            : 'direct';

        const outcome = await this.deleteLink(scoped, rel.cause_event_id, rel.effect_event_id);
        if (outcome === 'refused') {
          // The link is still there, so the reversed link would only add a
          // cycle to the one that is already there.
          repairFailures.push(
            `Could not reverse the temporally inverted causal link ${rel.id} (${rel.cause_event_id} -> ${rel.effect_event_id}): ` +
              `the store refused to delete it, so the link is still there`
          );
          continue;
        }

        rels = rels.filter(
          (entry) =>
            !(entry.cause_event_id === rel.cause_event_id && entry.effect_event_id === rel.effect_event_id)
        );
        const alreadyReversed = rels.some(
          (entry) => entry.cause_event_id === effect.id && entry.effect_event_id === cause.id
        );
        if (alreadyReversed) {
          // The store removes every link between two events at once, so a
          // second paradoxical link between the same pair is already gone
          // with the first one. The reversed link is not added twice.
          repairsApplied.push(
            `Removed temporally inverted causal link ${rel.id} (${rel.cause_event_id} -> ${rel.effect_event_id}); ` +
              `the reversed link (${effect.id} -> ${cause.id}) was already there`
          );
          continue;
        }

        try {
          await scoped.causalService.createCausalLink(effect, cause, {
            weight: rel.weight,
            confidence: rel.confidence,
            evidence: rel.evidence || 'Auto-repaired causal direction',
            relationship_type: relType,
          });
          rels.push({
            id: `reversed-${effect.id}-${cause.id}`,
            cause_event_id: effect.id,
            effect_event_id: cause.id,
            weight: rel.weight,
            confidence: rel.confidence,
            evidence: rel.evidence || 'Auto-repaired causal direction',
            relationship_type: relType,
          });
          repairsApplied.push(
            `Reversed temporally inverted causal link ${rel.id} to (${effect.id} -> ${cause.id})`
          );
        } catch (error) {
          // The inverted link is already gone, and it cannot be put back
          // through `createCausalLink` -- that is the call that refuses an
          // inverted pair. The report says that the link was removed and not
          // replaced, so that nobody is left looking for a link that is not
          // there.
          repairsApplied.push(
            `Removed temporally inverted causal link ${rel.id} (${rel.cause_event_id} -> ${rel.effect_event_id})`
          );
          repairFailures.push(
            `The reversed link (${effect.id} -> ${cause.id}) could not be created: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
      // A simultaneous pair is not an error: the cause and the effect can be
      // part of the same occurrence, and the validator does not report it, so
      // the repair leaves it alone.
    }

    // Step 4: Repair causal cycles
    let currentRels = await scoped.causalService.getAllRelationships();
    let detectedCycles = this.detectCycles(currentRels);
    let cyclePass = 0;

    while (detectedCycles.length > 0 && cyclePass < 10) {
      cyclePass++;
      const cycle = detectedCycles[0];
      // Find the weakest link in this cycle
      let weakestRel: (typeof currentRels)[0] | null = null;
      let minScore = Infinity;

      for (let i = 0; i < cycle.length - 1; i++) {
        const u = cycle[i];
        const v = cycle[i + 1];
        const link = currentRels.find((r) => r.cause_event_id === u && r.effect_event_id === v);
        if (link) {
          const score = (link.confidence ?? 0.5) * (link.weight ?? 0.5);
          if (score < minScore) {
            minScore = score;
            weakestRel = link;
          }
        }
      }

      if (weakestRel) {
        const outcome = await this.deleteLink(scoped, weakestRel.cause_event_id, weakestRel.effect_event_id);
        if (outcome === 'refused') {
          repairFailures.push(
            `Could not remove the weakest causal link ${weakestRel.id} (${weakestRel.cause_event_id} -> ${weakestRel.effect_event_id}) to break the cycle: ` +
              `the store refused to delete it, so the cycle is still there`
          );
          break;
        }
        repairsApplied.push(
          `Removed weakest causal link ${weakestRel.id} (${weakestRel.cause_event_id} -> ${weakestRel.effect_event_id}) to break cycle: ${cycle.join(' -> ')}`
        );
      } else {
        // Break using last edge if not found
        const u = cycle[cycle.length - 2];
        const v = cycle[cycle.length - 1];
        const outcome = await this.deleteLink(scoped, u, v);
        if (outcome === 'refused') {
          repairFailures.push(
            `Could not remove the causal link (${u} -> ${v}) to break the cycle: ` +
              `the store refused to delete it, so the cycle is still there`
          );
          break;
        }
        repairsApplied.push(`Removed causal link (${u} -> ${v}) to break cycle`);
      }

      currentRels = await scoped.causalService.getAllRelationships();
      detectedCycles = this.detectCycles(currentRels);
    }

    // Re-run validation post-repair
    const postValidation = await this.runValidationChecks(graphId, scoped, strict, crossGraphLookup);

    return {
      ...postValidation,
      repaired: repairsApplied.length > 0,
      repairsApplied,
      ...(repairFailures.length > 0 ? { repairFailures } : {}),
    };
  }

  /**
   * Report a reference that this graph does not hold.
   *
   * A reference to an entity that is not in this graph is broken here, but it
   * may exist in a sibling graph. That is a different mistake from a dangling
   * id, and it is worth naming: the fix is to copy the entity, not to delete
   * the link. Only one issue is reported either way, so a broken reference is
   * counted once.
   *
   * A lookup that fails is neither of those: the reference could not be
   * checked. It is reported as a warning and nothing else, because a
   * reference nobody checked is not a reference that is known to be broken.
   */
  private async reportBrokenReference(
    issues: ValidationIssueDto[],
    reference: BrokenReference,
    crossGraphLookup?: CrossGraphLookup
  ): Promise<void> {
    if (crossGraphLookup) {
      const ownership = await this.resolveOwnership(reference.entityId, crossGraphLookup);
      if (ownership.kind === 'unknown') {
        // The lookup can fail -- the daemon rate-limits the graph routes, for
        // one. That is reported rather than swallowed, because a reference
        // that quietly stops being checked is a reference nobody repairs.
        issues.push({
          type: 'orphan_reference',
          severity: 'warning',
          message:
            `The cross-graph lookup for ${reference.label} ${reference.entityId} failed, ` +
            `so it could not be checked: ${ownership.reason}`,
          entityId: reference.entityId,
          entityType: reference.entityType,
        });
        return;
      }
      if (ownership.kind === 'owned') {
        issues.push({
          type: 'cross_graph_reference',
          severity: 'error',
          message: `Reference to ${reference.label} ${reference.entityId} points into graph ${ownership.graphId}, not into this graph`,
          entityId: reference.entityId,
          entityType: reference.entityType,
          details: {
            owningGraphId: ownership.graphId,
            referencedEntityId: reference.entityId,
            ...(reference.referrerId ? { referrerId: reference.referrerId } : {}),
            ...(reference.referrerType ? { referrerType: reference.referrerType } : {}),
          },
        });
        return;
      }
    }

    issues.push({
      type: 'orphan_reference',
      severity: 'error',
      message: reference.message,
      entityId: reference.entityId,
      entityType: reference.entityType,
      details: {
        referencedEntityId: reference.entityId,
        ...(reference.referrerId ? { referrerId: reference.referrerId } : {}),
        ...(reference.referrerType ? { referrerType: reference.referrerType } : {}),
      },
    });
  }

  /**
   * The graph that owns a referenced entity, when it is another one.
   *
   * A failure of the lookup is not an answer: the reference is then left
   * alone, because deleting it would throw away a reference that may well
   * point at an entity of a sibling graph.
   */
  private async resolveOwnership(
    entityId: string,
    crossGraphLookup?: CrossGraphLookup
  ): Promise<Ownership> {
    if (!crossGraphLookup) return { kind: 'dangling' };
    try {
      const ownerGraphId = await crossGraphLookup(entityId);
      return ownerGraphId ? { kind: 'owned', graphId: ownerGraphId } : { kind: 'dangling' };
    } catch (error) {
      return { kind: 'unknown', reason: (error as Error).message };
    }
  }

  /**
   * Delete a causal link.
   *
   * The answer says what happened, because the three outcomes are different
   * things:
   *
   * - `deleted`: the link is gone;
   * - `already-gone`: the link was not there to begin with;
   * - `refused`: the store would not delete it and the link is still there.
   *
   * The daemon answers 404 when one of the ends of the link is missing -- it
   * looks the ends up before it deletes anything -- and the Neo4j store
   * removes every link between two events at once, so a second attempt to
   * delete a link that is already gone finds nothing to delete. The two are
   * told apart by looking at the links that are left: a link that is still
   * there was refused, not deleted.
   */
  private async deleteLink(
    scoped: ScopedGraphServices,
    causeId: string,
    effectId: string
  ): Promise<DeleteLinkOutcome> {
    try {
      await scoped.causalService.deleteCausalLink(causeId, effectId);
      return 'deleted';
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      const remaining = await scoped.causalService.getAllRelationships();
      const stillThere = remaining.some(
        (entry) => entry.cause_event_id === causeId && entry.effect_event_id === effectId
      );
      return stillThere ? 'refused' : 'already-gone';
    }
  }

  /**
   * Detects all unique directed cycles in the causal graph.
   */
  private detectCycles(
    relationships: Array<{ cause_event_id: string; effect_event_id: string }>
  ): string[][] {
    const adj = new Map<string, string[]>();
    for (const rel of relationships) {
      const list = adj.get(rel.cause_event_id) || [];
      list.push(rel.effect_event_id);
      adj.set(rel.cause_event_id, list);
    }

    const cycles: string[][] = [];
    const foundCycles = new Set<string>();
    const globalVisited = new Set<string>();

    for (const startNode of adj.keys()) {
      if (globalVisited.has(startNode)) continue;

      const visited = new Set<string>();
      const recursionStack = new Set<string>();
      const path: string[] = [];

      const dfs = (node: string): void => {
        visited.add(node);
        recursionStack.add(node);
        path.push(node);

        const neighbors = adj.get(node) || [];
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            dfs(neighbor);
          } else if (recursionStack.has(neighbor)) {
            const cycleStart = path.indexOf(neighbor);
            const cycle = [...path.slice(cycleStart), neighbor];

            // Normalize cycle key to prevent duplicate detection
            const nodesWithoutEnd = cycle.slice(0, -1);
            const minNode = nodesWithoutEnd.reduce((m, n) => (n < m ? n : m), nodesWithoutEnd[0]);
            const minIdx = nodesWithoutEnd.indexOf(minNode);
            const normalized = [...nodesWithoutEnd.slice(minIdx), ...nodesWithoutEnd.slice(0, minIdx), minNode];
            const cycleKey = normalized.join('->');

            if (!foundCycles.has(cycleKey)) {
              foundCycles.add(cycleKey);
              cycles.push(cycle);
            }
          }
        }

        path.pop();
        recursionStack.delete(node);
      };

      dfs(startNode);
      for (const v of visited) {
        globalVisited.add(v);
      }
    }

    return cycles;
  }
}
