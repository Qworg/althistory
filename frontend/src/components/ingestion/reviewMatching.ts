/**
 * Matching an extraction against the graph it is about to enter.
 *
 * An extractor names things the way its source does: "Admiralty" where the
 * graph already says "British Admiralty". Imported as written, that splits one
 * actor in two, and the actor view, the filters and pressure inference then
 * treat them as strangers. Likewise an event the graph already holds would be
 * imported a second time. These helpers find both, so the review table can
 * say so before anything is written.
 */
import type { Event, ExtractedEvent } from '@/types'

const STOPWORDS = new Set(['the', 'of', 'and', 'a', 'an', 'in', 'on', 'for', 'to', 'at', 'by'])

/** Lower case, punctuation folded to spaces, a leading "the" dropped. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '')
}

function tokens(text: string): Set<string> {
  return new Set(normalizeName(text).split(' ').filter((t) => t.length > 1 && !STOPWORDS.has(t)))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / (a.size + b.size - shared)
}

export type NameMatch =
  /** The graph already has exactly this name. */
  | { kind: 'known'; name: string }
  /** The graph has a name that is probably the same party. */
  | { kind: 'similar'; name: string }

/**
 * How `value` relates to the names the graph already uses: the same name, a
 * probable variant of one (one contains the other word for word, or most of
 * their words are shared), or nothing (`null`).
 */
export function matchKnownName(value: string, known: readonly string[]): NameMatch | null {
  const normalized = normalizeName(value)
  if (normalized.length < 3) return null
  const exact = known.find((name) => normalizeName(name) === normalized)
  if (exact) return { kind: 'known', name: exact }

  const valueTokens = tokens(value)
  let best: { name: string; score: number } | null = null
  for (const name of known) {
    const candidate = normalizeName(name)
    if (candidate.length < 3) continue
    const contains =
      ` ${candidate} `.includes(` ${normalized} `) || ` ${normalized} `.includes(` ${candidate} `)
    const score = contains ? 1 : jaccard(valueTokens, tokens(name))
    if (score >= 0.5 && (!best || score > best.score)) best = { name, score }
  }
  return best ? { kind: 'similar', name: best.name } : null
}

/** The calendar day of an ISO-ish timestamp, or null if it is not one. */
function dayOf(timestamp: string): string | null {
  const match = /^(-?\d{4,6}-\d{2}-\d{2})/.exec(timestamp.trim())
  return match ? match[1]! : null
}

/**
 * The graph event an extracted event most likely repeats: the same day and
 * mostly the same words, or the very same description on any day.
 */
export function findDuplicateEvent(extracted: ExtractedEvent, existing: readonly Event[]): Event | null {
  const day = dayOf(extracted.timestamp)
  const description = normalizeName(extracted.description)
  if (!description) return null
  const words = tokens(extracted.description)
  let best: { event: Event; score: number } | null = null
  for (const event of existing) {
    if (normalizeName(event.description) === description) return event
    if (day === null || dayOf(event.timestamp) !== day) continue
    const score = jaccard(words, tokens(event.description))
    if (score >= 0.5 && (!best || score > best.score)) best = { event, score }
  }
  return best?.event ?? null
}

/** The actors and targets a graph's events name, each once, in first-seen order. */
export function knownNames(events: readonly Event[]): string[] {
  const seen = new Map<string, string>()
  for (const event of events) {
    for (const name of [event.actor, event.target]) {
      if (!name) continue
      const key = normalizeName(name)
      if (key && !seen.has(key)) seen.set(key, name)
    }
  }
  return [...seen.values()]
}
