/**
 * Writes the demo scenario into a running backend through its public HTTP API
 * -- the same routes the frontend and the CLI use -- so a seed that stops
 * working is a real API change, not a fixture drifting.
 */
import { scenario, type ArcSeed, type EventSeed, type LinkSeed } from './scenario.js'

export interface SeedResult {
  graphId: string
  graphName: string
  branchId: string
  branchName: string
  eventIds: Record<string, string>
  arcIds: Record<string, string>
}

class Api {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  async call<T>(method: string, path: string, body?: unknown, graphId?: string): Promise<T> {
    // Every write must be JSON, and an empty JSON body is rejected as invalid,
    // so a write with nothing to say still sends `{}`.
    if (body === undefined && method !== 'GET') body = {}
    const headers: Record<string, string> = { 'x-api-key': this.apiKey }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (graphId) headers['x-graph-id'] = graphId
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`)
    }
    const json = text ? (JSON.parse(text) as unknown) : undefined
    // Most routes answer `{ success, data }`; a few answer the entity itself.
    if (json && typeof json === 'object' && 'data' in json) {
      return (json as { data: T }).data
    }
    return json as T
  }
}

function idOf(entity: unknown, what: string): string {
  const id = (entity as { id?: unknown } | undefined)?.id
  if (typeof id !== 'string') {
    throw new Error(`The API returned no id for ${what}: ${JSON.stringify(entity).slice(0, 300)}`)
  }
  return id
}

async function createArcs(api: Api, graphId: string, arcs: ArcSeed[]): Promise<Record<string, string>> {
  const ids: Record<string, string> = {}
  // Parents first, so a child can name its parent's id.
  for (const arc of [...arcs].sort((a, b) => a.level - b.level)) {
    const created = await api.call(
      'POST',
      '/api/arcs',
      {
        name: arc.name,
        description: arc.description,
        start_time: arc.start,
        end_time: arc.end,
        level: arc.level,
        parent_arc_id: arc.parent ? ids[arc.parent] : null,
      },
      graphId
    )
    ids[arc.key] = idOf(created, `arc ${arc.key}`)
  }
  return ids
}

async function createEvents(
  api: Api,
  graphId: string,
  events: EventSeed[],
  arcIds: Record<string, string>
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {}
  for (const event of events) {
    const created = await api.call(
      'POST',
      '/api/events',
      {
        description: event.description,
        actor: event.actor,
        target: event.target,
        timestamp: event.timestamp,
        // `metadata.arcId` is where the validator, exporters and UI look for
        // an event's arc (see RemoteEngine.assignEventToArc).
        metadata: { ...(arcIds[event.arc] ? { arcId: arcIds[event.arc] } : {}), significance: event.significance ?? 0.5 },
      },
      graphId
    )
    ids[event.key] = idOf(created, `event ${event.key}`)
  }
  return ids
}

async function createLinks(
  api: Api,
  graphId: string,
  links: LinkSeed[],
  eventIds: Record<string, string>
): Promise<void> {
  for (const link of links) {
    const causeEventId = eventIds[link.cause]
    const effectEventId = eventIds[link.effect]
    if (!causeEventId || !effectEventId) {
      throw new Error(`Link ${link.cause} -> ${link.effect} names an event the scenario does not define`)
    }
    await api.call(
      'POST',
      '/api/causal/link',
      {
        causeEventId,
        effectEventId,
        // The route validates `type` and `strength` (api/routes/causal.ts); the
        // OpenAPI document's `relationship_type`/`weight` are not what it reads.
        relationship: {
          type: link.type,
          strength: link.weight,
          confidence: link.confidence,
          evidence: link.evidence,
        },
      },
      graphId
    )
  }
}

export async function seed(baseUrl: string, apiKey: string): Promise<SeedResult> {
  const api = new Api(baseUrl, apiKey)

  const graph = await api.call('POST', '/api/graphs', scenario.graph)
  const graphId = idOf(graph, 'the graph')

  const arcIds = await createArcs(api, graphId, scenario.arcs)
  const eventIds = await createEvents(api, graphId, scenario.events, arcIds)
  await createLinks(api, graphId, scenario.links, eventIds)

  // A counterfactual branch, so the graph selector and branch views have
  // something to show.
  const branch = await api.call('POST', `/api/graphs/${graphId}/branch`, {
    name: scenario.branch.name,
    description: scenario.branch.description,
  })
  const branchId = idOf(branch, 'the branch')
  // The branch's copied history lives in its version tree, but the entity
  // routes read a per-graph live store that branching does not populate, so
  // the copied events are not addressable here yet. The branch's own events
  // are created without an arc and linked only to each other.
  const branchEventIds = await createEvents(api, branchId, scenario.branch.events, {})
  await createLinks(api, branchId, scenario.branch.links, branchEventIds)

  // The main line is what the app should open on.
  await api.call('POST', `/api/graphs/${graphId}/activate`)

  return {
    graphId,
    graphName: scenario.graph.name,
    branchId,
    branchName: scenario.branch.name,
    eventIds,
    arcIds,
  }
}
