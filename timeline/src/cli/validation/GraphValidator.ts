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

export class GraphValidator {
  /**
   * Validates graph data and optionally performs self-healing repairs.
   */
  async validate(
    graphId: string,
    scoped: ScopedGraphServices,
    options?: { strict?: boolean; autoRepair?: boolean }
  ): Promise<ValidationReportDto> {
    const strict = options?.strict ?? false;
    const autoRepair = options?.autoRepair ?? false;

    if (autoRepair) {
      return this.validateAndRepair(graphId, scoped, strict);
    }

    return this.runValidationChecks(graphId, scoped, strict);
  }

  /**
   * Runs pure read-only validation checks on the graph.
   */
  private async runValidationChecks(
    graphId: string,
    scoped: ScopedGraphServices,
    strict: boolean
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
          issues.push({
            type: 'orphan_reference',
            severity: 'error',
            message: `Arc "${arc.name}" (${arc.id}) references non-existent parent arc ${parentArcId}`,
            entityId: arc.id,
            entityType: 'arc',
          });
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
          issues.push({
            type: 'orphan_reference',
            severity: 'error',
            message: `Event "${event.description}" (${event.id}) references non-existent arc ${arcId}`,
            entityId: event.id,
            entityType: 'event',
          });
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
        issues.push({
          type: 'orphan_reference',
          severity: 'error',
          message: `Causal relationship ${rel.id} references non-existent cause event ${rel.cause_event_id}`,
          entityId: rel.id,
          entityType: 'relationship',
        });
      }

      if (!effect) {
        issues.push({
          type: 'orphan_reference',
          severity: 'error',
          message: `Causal relationship ${rel.id} references non-existent effect event ${rel.effect_event_id}`,
          entityId: rel.id,
          entityType: 'relationship',
        });
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
   */
  private async validateAndRepair(
    graphId: string,
    scoped: ScopedGraphServices,
    strict: boolean
  ): Promise<ValidationReportDto> {
    const repairsApplied: string[] = [];
    const repairsFailed: string[] = [];

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
          // Orphan reference: clean metadata
          const updatedMeta = { ...(event.metadata || {}) };
          delete updatedMeta.arcId;
          delete updatedMeta.arc_id;
          await scoped.eventRepository.update(event.id, { metadata: updatedMeta });
          repairsApplied.push(`Removed orphan arc reference "${arcId}" from event "${event.description}" (${event.id})`);
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
    const rels = await scoped.causalService.getAllRelationships();

    for (const rel of rels) {
      // Self causation
      if (rel.cause_event_id === rel.effect_event_id) {
        await scoped.causalService.deleteCausalLink(rel.cause_event_id, rel.effect_event_id);
        repairsApplied.push(`Deleted self-causation link on event ${rel.cause_event_id}`);
        continue;
      }

      const cause = eventMap.get(rel.cause_event_id);
      const effect = eventMap.get(rel.effect_event_id);

      // Orphan endpoints
      if (!cause || !effect) {
        await scoped.causalService.deleteCausalLink(rel.cause_event_id, rel.effect_event_id);
        repairsApplied.push(
          `Deleted orphaned causal relationship ${rel.id} (${!cause ? `missing cause ${rel.cause_event_id}` : `missing effect ${rel.effect_event_id}`})`
        );
        continue;
      }

      // Temporal paradox: cause occurs after effect
      if (isTemporalInversion(cause.timestamp, effect.timestamp)) {
        const relType: CausalRelationshipType =
          rel.relationship_type === 'indirect' || rel.relationship_type === 'contributory'
            ? rel.relationship_type
            : 'direct';

        // Remove the inverted link BEFORE adding the reversed one. Leaving
        // both in place would make a two-node cycle, and the cycle breaker
        // would then have to guess which of the two to remove -- it may well
        // pick the one that was just added, and the inverted link would
        // survive.
        try {
          await scoped.causalService.deleteCausalLink(rel.cause_event_id, rel.effect_event_id);
        } catch (error) {
          // The link could not be removed, so the reversed one must not be
          // added: both would be in the graph, and the pair would be a cycle.
          // The validator still reports the paradox, so the failure is not
          // hidden.
          repairsFailed.push(
            `Could not remove temporally inverted causal link ${rel.id} (${rel.cause_event_id} -> ${rel.effect_event_id}): ${
              error instanceof Error ? error.message : String(error)
            }`
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
          repairsApplied.push(
            `Reversed temporally inverted causal link ${rel.id} to (${effect.id} -> ${cause.id})`
          );
        } catch (error) {
          // The inverted link is already gone, and it cannot be put back
          // through `createCausalLink` -- that is the call that refuses an
          // inverted pair. The report has to say that the link was removed
          // and not replaced, so that nobody is left looking for a link that
          // is not there.
          repairsFailed.push(
            `Removed temporally inverted causal link ${rel.id} (${rel.cause_event_id} -> ${rel.effect_event_id}) but could not add the reversed link (${effect.id} -> ${cause.id}): ${
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
        await scoped.causalService.deleteCausalLink(weakestRel.cause_event_id, weakestRel.effect_event_id);
        repairsApplied.push(
          `Removed weakest causal link ${weakestRel.id} (${weakestRel.cause_event_id} -> ${weakestRel.effect_event_id}) to break cycle: ${cycle.join(' -> ')}`
        );
      } else {
        // Break using last edge if not found
        const u = cycle[cycle.length - 2];
        const v = cycle[cycle.length - 1];
        await scoped.causalService.deleteCausalLink(u, v);
        repairsApplied.push(`Removed causal link (${u} -> ${v}) to break cycle`);
      }

      currentRels = await scoped.causalService.getAllRelationships();
      detectedCycles = this.detectCycles(currentRels);
    }

    // Re-run validation post-repair
    const postValidation = await this.runValidationChecks(graphId, scoped, strict);

    return {
      ...postValidation,
      repaired: repairsApplied.length > 0,
      repairsApplied,
      repairsFailed: repairsFailed.length > 0 ? repairsFailed : undefined,
    };
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
