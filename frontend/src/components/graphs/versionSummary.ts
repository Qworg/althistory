/**
 * Words for a Version history row.
 *
 * Commits used to be described as `${operation} ${type} ${id}` ("create
 * relationship local_179366…"), and the counts drawn as "R: +1". The server
 * now writes a summary in words ("Added link: “Census of 1851” → “Clerks'
 * protest”"); versions committed before that still carry the old text, so they
 * are rewritten here, resolving their ids against the events, arcs and links
 * the views have loaded. An id is never shown: an entity that cannot be named
 * (deleted since, or not loaded) is described by its kind ("Added a link").
 */
import type { Arc, CausalRelationship, Event, GraphVersion } from '@/types'
import type { GraphVersionWithEntities } from '@/services/api'

export interface VersionNameLookup {
  events: ReadonlyMap<string, Pick<Event, 'description'>>
  arcs: ReadonlyMap<string, Pick<Arc, 'name'>>
  relationships: ReadonlyMap<string, Pick<CausalRelationship, 'cause_event_id' | 'effect_event_id'>>
}

export function buildVersionNameLookup(
  events: readonly Event[] = [],
  arcs: readonly Arc[] = [],
  relationships: readonly CausalRelationship[] = []
): VersionNameLookup {
  return {
    events: new Map(events.map((e) => [e.id, e])),
    arcs: new Map(arcs.map((a) => [a.id, a])),
    relationships: new Map(relationships.map((r) => [r.id, r])),
  }
}

const NAME_LIMIT = 80

function quote(text: string | undefined): string | null {
  const trimmed = text?.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  const clipped = trimmed.length > NAME_LIMIT ? `${trimmed.slice(0, NAME_LIMIT - 1).trimEnd()}…` : trimmed
  return `“${clipped}”`
}

const LEGACY_WRITE = /^(create|update|delete) (event|arc|relationship|pressure) (\S+)$/
const LEGACY_ROLLBACK = /^Rollback to version (\d+)$/
const LEGACY_MERGE = /^Merged from (.+)$/
/**
 * Ids as the stores mint them: `local_…`, `event_…`, `graph_…`, a UUID. A
 * summary that still contains one is not shown.
 */
const RAW_ID = /\b(?:local|event|arc|rel|relationship|link|graph|pressure|evt)_[A-Za-z0-9_-]{6,}|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i

const VERB = { create: 'Added', update: 'Edited', delete: 'Deleted' } as const
const ARTICLE = { event: 'an event', arc: 'an arc', relationship: 'a link', pressure: 'a pressure' } as const
const NOUN = { event: 'event', arc: 'arc', relationship: 'link', pressure: 'pressure' } as const

function describeLegacyWrite(
  operation: keyof typeof VERB,
  type: keyof typeof NOUN,
  id: string,
  lookup: VersionNameLookup
): string {
  const verb = VERB[operation]
  if (type === 'relationship') {
    const link = lookup.relationships.get(id)
    const cause = link && quote(lookup.events.get(link.cause_event_id)?.description)
    const effect = link && quote(lookup.events.get(link.effect_event_id)?.description)
    return cause && effect ? `${verb} link: ${cause} → ${effect}` : `${verb} ${ARTICLE[type]}`
  }
  const name =
    type === 'event' ? quote(lookup.events.get(id)?.description)
    : type === 'arc' ? quote(lookup.arcs.get(id)?.name)
    : null
  return name ? `${verb} ${NOUN[type]} ${name}` : `${verb} ${ARTICLE[type]}`
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * The counts in words: "5 events added", "1 link changed", "2 arcs deleted".
 * Empty when the version changed nothing countable.
 */
export function describeVersionChanges(changes: GraphVersion['changes'] | undefined): string[] {
  if (!changes) return []
  const kinds = [
    ['events', 'event', 'events'],
    ['arcs', 'arc', 'arcs'],
    ['relationships', 'link', 'links'],
  ] as const
  const actions = [
    ['Added', 'added'],
    ['Modified', 'changed'],
    ['Deleted', 'deleted'],
  ] as const
  const parts: string[] = []
  for (const [key, one, many] of kinds) {
    for (const [suffix, word] of actions) {
      const count = Number(changes[`${key}${suffix}` as keyof typeof changes]) || 0
      if (count > 0) parts.push(`${plural(count, one, many)} ${word}`)
    }
  }
  return parts
}

/** A summary from the operation and counts, for a version with no usable text. */
function describeFromCounts(version: GraphVersionWithEntities | GraphVersion, lookup: VersionNameLookup): string {
  // One entity changed: name it.
  const entities = 'entities' in version ? version.entities : undefined
  if (entities) {
    const all = [
      ...entities.added.map((e) => ['create', e] as const),
      ...entities.modified.map((e) => ['update', e] as const),
      ...entities.deleted.map((e) => ['delete', e] as const),
    ]
    const only = all.length === 1 ? all[0] : undefined
    if (only && only[1].type in NOUN) {
      return describeLegacyWrite(only[0], only[1].type as keyof typeof NOUN, only[1].id, lookup)
    }
  }
  const parts = describeVersionChanges(version.changes)
  switch (version.operation) {
    case 'import':
      return 'Imported history'
    case 'merge':
      return 'Merged a branch'
    case 'rollback':
      return 'Restored an earlier version'
    case 'branch':
      return 'Branched'
  }
  if (parts.length === 0) return version.version <= 1 ? 'Created the graph' : 'No changes recorded'
  const first = parts[0] ?? ''
  return first.charAt(0).toUpperCase() + first.slice(1)
}

/**
 * The one-line summary of a version: what a person would say happened.
 */
export function summarizeVersion(version: GraphVersionWithEntities | GraphVersion, lookup: VersionNameLookup): string {
  const message = version.message?.trim() ?? ''

  const write = LEGACY_WRITE.exec(message)
  if (write) {
    const [, operation, type, id] = write as unknown as [string, keyof typeof VERB, keyof typeof NOUN, string]
    return describeLegacyWrite(operation, type, id, lookup)
  }

  const rollback = LEGACY_ROLLBACK.exec(message)
  if (rollback) return `Restored version ${rollback[1]}`

  const merge = LEGACY_MERGE.exec(message)
  if (merge) return `Merged ${quote(merge[1]) ?? 'a branch'}`

  if (message && !RAW_ID.test(message)) return message
  return describeFromCounts(version, lookup)
}

/** True when `text` contains something that looks like an internal id. */
export function containsRawId(text: string): boolean {
  return RAW_ID.test(text)
}
