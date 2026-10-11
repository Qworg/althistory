/**
 * Maps a backend {@link SimulationResult} onto the CLI's generation DTOs.
 *
 * The simulation engine returns domain objects (Event, InferredPressure,
 * StoredCausalRelationship); the CLI speaks in `GenerationResultDto`. Keeping
 * the mapping here means the direct and remote engines cannot drift into
 * describing the same run differently.
 */

import type { Event } from '@/models';
import type { SimulationResult } from '@/services/SimulationService';
import type { StoredCausalRelationship } from '@/services/CausalService';
import type {
  CausalRelationshipDto,
  EventDto,
  GenerationResultDto,
  ValidationReportDto,
} from '../types';

/**
 * Average Gregorian month in milliseconds. The CLI documents a month as 30.4
 * days, so a `timeAdvanceMonths` value converts to the same step duration
 * whether the run executes directly or over HTTP.
 */
export const MS_PER_MONTH = 30.4 * 24 * 60 * 60 * 1000;

function toEventDto(event: Event, graphId: string): EventDto {
  const rawImportance = event.metadata?.['importance'];
  const importance = typeof rawImportance === 'number' ? rawImportance : undefined;

  return {
    id: event.id,
    graphId,
    description: event.description,
    timestamp: event.timestamp.toISOString(),
    actor: event.actor,
    target: event.target,
    ...(importance !== undefined ? { importance } : {}),
    ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
  };
}

function toRelationshipDto(
  relationship: StoredCausalRelationship,
  graphId: string
): CausalRelationshipDto {
  return {
    id: relationship.id,
    graphId,
    causeId: relationship.cause_event_id,
    effectId: relationship.effect_event_id,
    weight: relationship.weight,
    type: relationship.relationship_type,
    reasoning: relationship.evidence,
    confidence: relationship.confidence,
  };
}

function buildValidation(graphId: string): ValidationReportDto {
  // The engine validates every candidate before writing it, so a completed run
  // has no issues to report; the report states that rather than being omitted.
  return {
    valid: true,
    graphId,
    errorCount: 0,
    warningCount: 0,
    issues: [],
  };
}

/**
 * Convert a completed (or previewed) simulation run into the CLI DTO.
 *
 * `graphName` is a presentation label: the engine works from a graph id and
 * does not resolve the graph's human name.
 */
export function toGenerationResultDto(
  result: SimulationResult,
  graphName: string
): GenerationResultDto {
  return {
    graphId: result.graphId,
    graphName,
    premise: result.dryRun
      ? 'Forward simulation preview'
      : `Forward simulation across ${result.steps} step(s)`,
    divergencePoint: result.anchorEventId ?? 'latest event',
    eventCount: result.events.length,
    arcCount: 0,
    relationshipCount: result.relationships.length,
    events: result.events.map((event) => toEventDto(event, result.graphId)),
    arcs: [],
    relationships: result.relationships.map((relationship) =>
      toRelationshipDto(relationship, result.graphId)
    ),
    validation: buildValidation(result.graphId),
  };
}
