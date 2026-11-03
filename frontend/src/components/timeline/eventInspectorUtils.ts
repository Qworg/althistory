import type { Arc, CausalRelationship, Event } from '@/types'

/**
 * What the Selected Event inspector says about *why* an event is there
 * (PRODUCT.md, Principle 1): how sure the record is, which period holds it,
 * where it came from, and what it caused and was caused by. Pure, so the
 * inspector stays a rendering of these answers.
 */

/** The event's confidence on the 0–1 scale, when the record carries one. */
export function eventConfidence(event: Event): number | null {
  const value = event.metadata?.confidence
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export interface ContainingArcs {
  /** Outermost first. */
  arcs: Arc[]
  /** `assigned` when the event names its arc (`metadata.arcId`); `date` when inferred from time bounds. */
  basis: 'assigned' | 'date'
}

/**
 * The arcs that contain `event`.
 *
 * An explicit assignment (`metadata.arcId`, the key the CLI and exporter use)
 * wins, with that arc's ancestors above it; otherwise every arc whose time
 * bounds contain the event's timestamp.
 */
export function containingArcs(event: Event, arcs: readonly Arc[]): ContainingArcs {
  const byId = new Map(arcs.map((arc) => [arc.id, arc]))
  const assignedId = event.metadata?.arcId
  if (typeof assignedId === 'string') {
    const chain: Arc[] = []
    const seen = new Set<string>()
    let current = byId.get(assignedId)
    while (current && !seen.has(current.id)) {
      chain.unshift(current)
      seen.add(current.id)
      current = current.parent_arc_id ? byId.get(current.parent_arc_id) : undefined
    }
    if (chain.length > 0) return { arcs: chain, basis: 'assigned' }
  }

  const time = new Date(event.timestamp).getTime()
  if (Number.isNaN(time)) return { arcs: [], basis: 'date' }
  const holding = arcs
    .filter((arc) => {
      const start = new Date(arc.start_time).getTime()
      const end = new Date(arc.end_time).getTime()
      return start <= time && time <= end
    })
    .sort((a, b) => a.level - b.level || new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
  return { arcs: holding, basis: 'date' }
}

export interface EventSource {
  /** A link to the source document, when the record has one. */
  url?: string
  /** The source's title, or the URL when it has none. */
  title?: string
  /** How the event got into the graph, in words ("Extracted from Wikipedia by an LLM"). */
  origin?: string
}

const EXTRACTION_LABELS: Record<string, string> = {
  wikipedia: 'Wikipedia',
  wikidata: 'Wikidata',
  text: 'pasted text',
}

/** Where the event's record came from, or null when it says nothing about that. */
export function eventSource(event: Event): EventSource | null {
  const meta = event.metadata ?? {}
  const str = (key: string) => (typeof meta[key] === 'string' && meta[key] !== '' ? (meta[key] as string) : undefined)

  const url = str('sourceUrl')
  const title = str('articleTitle') ?? url

  let origin: string | undefined
  if (meta.simulated === true) {
    const pressure = str('pressureType')
    origin = pressure
      ? `Simulated forward from ${/^[aeiou]/i.test(pressure) ? 'an' : 'a'} ${pressure} pressure`
      : 'Simulated'
  } else {
    const extraction = str('extractionSource')
    if (extraction && extraction !== 'llm') {
      const label = EXTRACTION_LABELS[extraction] ?? extraction
      origin = meta.aiGenerated === true ? `Extracted from ${label} by an LLM` : `Extracted from ${label}`
    } else if (extraction === 'llm' || meta.aiGenerated === true) {
      origin = 'Extracted by an LLM'
    }
  }

  if (!url && !title && !origin) return null
  return { url, title, origin }
}

export interface CausalNeighbour {
  relationship: CausalRelationship
  event: Event
}

/**
 * The events that caused `eventId` and the events it caused, each in date
 * order. A link whose other end is not in `events` (deleted, or in another
 * graph) is left out: there is nothing on this timeline to select.
 */
export function causesAndEffects(
  eventId: string,
  relationships: readonly CausalRelationship[],
  events: readonly Event[]
): { causes: CausalNeighbour[]; effects: CausalNeighbour[] } {
  const byId = new Map(events.map((event) => [event.id, event]))
  const causes: CausalNeighbour[] = []
  const effects: CausalNeighbour[] = []
  for (const relationship of relationships) {
    if (relationship.effect_event_id === eventId) {
      const cause = byId.get(relationship.cause_event_id)
      if (cause) causes.push({ relationship, event: cause })
    } else if (relationship.cause_event_id === eventId) {
      const effect = byId.get(relationship.effect_event_id)
      if (effect) effects.push({ relationship, event: effect })
    }
  }
  const byTime = (a: CausalNeighbour, b: CausalNeighbour) =>
    new Date(a.event.timestamp).getTime() - new Date(b.event.timestamp).getTime()
  return { causes: causes.sort(byTime), effects: effects.sort(byTime) }
}
