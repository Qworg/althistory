/**
 * Human-readable labels for rows in an ingestion review.
 *
 * An extraction refers to its own entities by `tempId` ("temp-1"), which means
 * nothing to a reviewer. These helpers turn a tempId into the text the review
 * table and the wizard's issue list show, falling back to the tempId only when
 * the entity it names is not in the extraction.
 */

import type {
  ExtractedArc,
  ExtractedEvent,
  ExtractedRelationship,
  ExtractionResult,
} from '@/types'

export type ReviewEventLookup =
  | ReadonlyMap<string, ExtractedEvent>
  | Readonly<Record<string, ExtractedEvent>>

/** Resolves a tempId through either lookup shape. */
export function findExtractedEvent(
  lookup: ReviewEventLookup | undefined,
  tempId: string
): ExtractedEvent | undefined {
  if (!lookup) return undefined
  if (lookup instanceof Map) return lookup.get(tempId)
  const record = lookup as Readonly<Record<string, ExtractedEvent>>
  return Object.prototype.hasOwnProperty.call(record, tempId) ? record[tempId] : undefined
}

/** "Battle of Hastings (Harold → William)". */
export function describeExtractedEvent(event: ExtractedEvent): string {
  return `${event.description} (${event.actor} → ${event.target})`
}

/** The event's readable label, or the tempId when it is not in the lookup. */
export function eventLabel(lookup: ReviewEventLookup | undefined, tempId: string): string {
  const event = findExtractedEvent(lookup, tempId)
  return event ? describeExtractedEvent(event) : tempId
}

/** "Battle of Hastings → Norman conquest begins", with tempId fallbacks. */
export function relationshipLabel(
  relationship: ExtractedRelationship,
  lookup: ReviewEventLookup | undefined
): string {
  const cause = findExtractedEvent(lookup, relationship.causeEventTempId)
  const effect = findExtractedEvent(lookup, relationship.effectEventTempId)
  return `${cause?.description ?? relationship.causeEventTempId} → ${
    effect?.description ?? relationship.effectEventTempId
  }`
}

/** Builds the tempId → event lookup for an extraction. */
export function buildEventLookup(events: readonly ExtractedEvent[]): Map<string, ExtractedEvent> {
  return new Map(events.map((event) => [event.tempId, event]))
}

/**
 * The label for any entity in an extraction, by type and tempId; the tempId
 * itself when the entity is missing.
 */
export function entityLabel(
  extraction: Pick<ExtractionResult, 'events' | 'arcs' | 'relationships'>,
  entityType: 'event' | 'arc' | 'relationship',
  tempId: string,
  lookup: ReviewEventLookup = buildEventLookup(extraction.events)
): string {
  if (entityType === 'event') {
    return findExtractedEvent(lookup, tempId)?.description ?? tempId
  }
  if (entityType === 'arc') {
    const arc: ExtractedArc | undefined = extraction.arcs.find((item) => item.tempId === tempId)
    return arc?.name ?? tempId
  }
  const relationship = extraction.relationships.find((item) => item.tempId === tempId)
  return relationship ? relationshipLabel(relationship, lookup) : tempId
}

/** DOM id of a review-table row, shared by the table and the issue list. */
export function reviewRowId(entityType: 'event' | 'arc' | 'relationship', tempId: string): string {
  return `review-row-${entityType}-${tempId.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

const ISO_MIDNIGHT = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})T00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00)$/
const ISO_WHOLE_MINUTE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::00(?:\.0+)?)?Z$/

/**
 * The value a review date field shows and edits: the extraction's ISO
 * timestamp without the parts that carry nothing. "1870-02-14T00:00:00.000Z"
 * (a date, stored as its UTC midnight) is "1870-02-14", and a whole-minute time
 * keeps only its minutes ("1870-02-14T09:30Z"). Both parse back to the same
 * instant, so an untouched field round-trips; anything else (including what the
 * reviewer is typing) is shown as it is.
 */
export function compactReviewDate(raw: string): string {
  const value = raw.trim()
  const midnight = ISO_MIDNIGHT.exec(value)
  if (midnight) return `${midnight[1]}-${midnight[2]}-${midnight[3]}`
  const minute = ISO_WHOLE_MINUTE.exec(value)
  if (minute) return `${minute[1]}T${minute[2]}Z`
  return raw
}

/** True when `raw` is a date the importer can read. */
export function isReadableReviewDate(raw: string): boolean {
  return raw.trim() !== '' && !Number.isNaN(new Date(raw.trim()).getTime())
}
