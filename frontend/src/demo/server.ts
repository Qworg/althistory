/**
 * The API, answered in the browser, for the GitHub Pages demo.
 *
 * Two sources, in this order:
 *
 * 1. A live store of each graph's events, arcs and causal links, started from
 *    what the real backend held after seeding (`recording.json`'s `entities`)
 *    and kept in sessionStorage, so a visitor's edits last for the tab and no
 *    longer. Everything that reads or writes those three goes here, so an edit
 *    shows up everywhere the app looks.
 * 2. The real backend's recorded answers (`recording.json`'s `responses`, made
 *    by `media/src/demo/record.ts`) for every other read: graphs, versions,
 *    pressures, export stats. They describe the seeded history, not the
 *    visitor's edits; graph counts are patched from the live store.
 *
 * Branching works too: a branch made in the demo copies its parent's live
 * store under a new graph id, and the graph routes (list, active, branches,
 * versions, activate) answer for it alongside the recorded graphs.
 *
 * Anything else needs the server (ingestion, export, import, copying,
 * merging, simulation, keys) and is answered with a 405 that says so, which
 * the app shows like any other API error.
 */
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import recordingText from './recording.json?raw'
import { DEMO_STATE_KEY, REPO_URL } from './flag'

type Json = Record<string, unknown>

interface DemoEvent extends Json {
  id: string
  description: string
  actor: string
  target: string
  timestamp: string
}

interface DemoArc extends Json {
  id: string
  name: string
  start_time: string
  end_time: string
  level: number
}

interface DemoRelationship extends Json {
  id: string
  cause_event_id: string
  effect_event_id: string
  weight: number
  confidence: number
  evidence: string
  relationship_type: string
}

interface GraphState {
  events: DemoEvent[]
  arcs: DemoArc[]
  relationships: DemoRelationship[]
}

interface Recorded {
  status: number
  body: unknown
}

interface Recording {
  scenario: string
  mainGraphId: string
  branchGraphId: string
  entities: Record<string, GraphState>
  responses: Record<string, Recorded>
}

interface DemoState {
  version: number
  active: string
  graphs: Record<string, GraphState>
  /** Branches made in the demo, as the graph routes describe them. */
  madeGraphs: Record<string, Json>
  nextId: number
}

interface Reply {
  status: number
  body: unknown
}

const recording = JSON.parse(recordingText) as Recording
const STATE_VERSION = 2

/** The graph the app last showed (`demo/install.ts` sets it for `?start=branch`). */
function startingGraph(): string {
  try {
    const remembered = localStorage.getItem('active_graph_id')
    if (remembered && recording.entities[remembered]) return remembered
  } catch {
    // No storage: start on the main history.
  }
  return recording.mainGraphId
}

function initialState(): DemoState {
  return {
    version: STATE_VERSION,
    active: startingGraph(),
    graphs: structuredClone(recording.entities),
    madeGraphs: {},
    nextId: 1,
  }
}

function load(): DemoState {
  try {
    const raw = sessionStorage.getItem(DEMO_STATE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as DemoState
      if (saved.version === STATE_VERSION && saved.graphs[saved.active]) return saved
    }
  } catch {
    // Storage unavailable or corrupt: start from the recording.
  }
  return initialState()
}

const state = load()

function save(): void {
  try {
    sessionStorage.setItem(DEMO_STATE_KEY, JSON.stringify(state))
  } catch {
    // The demo still works for this page view without storage.
  }
}

function newId(prefix: string): string {
  const id = `${prefix}_demo_${state.nextId}`
  state.nextId += 1
  return id
}

/* --------------------------------------------------------------- replies --- */

const ok = (data: unknown, status = 200): Reply => ({ status, body: { success: true, data } })

const notFound = (what: string): Reply => ({
  status: 404,
  body: { success: false, error: { code: 'NOT_FOUND', message: `${what} not found` } },
})

const badRequest = (message: string): Reply => ({
  status: 400,
  body: { success: false, error: { code: 'VALIDATION_ERROR', message } },
})

/** What a request the demo cannot answer was trying to do, in the app's words. */
function describe(method: string, path: string): string {
  if (path.startsWith('/ingest')) return 'Bringing in history from text, Wikipedia or Wikidata'
  if (path.startsWith('/export')) return 'Exporting a graph'
  if (path.startsWith('/import')) return 'Importing an export file'
  if (path.startsWith('/graphs/copy')) return 'Copying a graph'
  if (path.includes('/merge')) return 'Merging branches'
  if (path.includes('/rollback')) return 'Restoring a version'
  if (path.includes('simulat')) return 'Simulating forward'
  if (path.startsWith('/causal/suggestions')) return 'Suggesting links'
  if (path.startsWith('/inference')) return 'Running the analysis again'
  if (path.startsWith('/keys')) return 'Managing API keys'
  if (path.startsWith('/graphs') && method !== 'GET') return 'Creating or changing graphs'
  return 'This'
}

function unsupported(method: string, path: string): Reply {
  const message =
    `${describe(method, path)} needs the althistory server, and this demo runs entirely in your browser. ` +
    `Run althistory on your own machine to try it: ${REPO_URL}`
  // 405, not 501: the app shows a 4xx answer's own message ("needs the
  // server"), while a 5xx reads as "failed on the server, try again", which
  // would send the visitor round in circles. 401/403/404/429 each mean
  // something specific to the app, so they are out too.
  return { status: 405, body: { success: false, message, error: { code: 'DEMO_UNSUPPORTED', message } } }
}

/* ------------------------------------------------------------- recording --- */

function recordedReply(method: string, path: string, query: string, graph: string): Reply | undefined {
  const exact = recording.responses[`${method} ${path}${query ? `?${query}` : ''} @${graph}`]
  if (exact) return withLiveCounts(exact)
  // Same route with other parameters, preferring the same graph.
  let other: Recorded | undefined
  for (const [key, value] of Object.entries(recording.responses)) {
    const at = key.lastIndexOf(' @')
    const head = key.slice(0, at)
    if (head !== `${method} ${path}` && !head.startsWith(`${method} ${path}?`)) continue
    if (key.slice(at + 2) === graph) return withLiveCounts(value)
    other ??= value
  }
  return other ? withLiveCounts(other) : undefined
}

/** A recorded graph still says how many events it had when it was recorded. */
function withLiveCounts(recorded: Recorded): Reply {
  return patchCounts({ status: recorded.status, body: structuredClone(recorded.body) })
}

/** Rewrites every graph's counts in a reply from the live store. */
function patchCounts(reply: Reply): Reply {
  const body = reply.body
  const patch = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(patch)
    if (!node || typeof node !== 'object') return
    const object = node as Json
    const live = typeof object.id === 'string' ? state.graphs[object.id] : undefined
    const metadata = object.metadata
    if (live && metadata && typeof metadata === 'object') {
      Object.assign(metadata, {
        eventCount: live.events.length,
        arcCount: live.arcs.length,
        relationshipCount: live.relationships.length,
      })
    }
    Object.values(object).forEach(patch)
  }
  patch(body)
  return reply
}

/* ---------------------------------------------------------------- graphs --- */

/** A graph as the graph routes describe it: recorded, or made in the demo. */
function graphObject(id: string): Json | undefined {
  const made = state.madeGraphs[id]
  if (made) return structuredClone(made)
  const recorded = recording.responses[`GET /graphs/${id} @${id}`]?.body as { data?: Json } | undefined
  return recorded?.data ? structuredClone(recorded.data) : undefined
}

/** The recorded graph whose answers stand in for a branch made in the demo. */
function recordedAncestor(id: string): string {
  let current = id
  for (let hops = 0; hops < 50 && state.madeGraphs[current]; hops++) {
    current = String(state.madeGraphs[current]?.parentGraphId ?? recording.mainGraphId)
  }
  return recording.entities[current] ? current : recording.mainGraphId
}

const madeChildren = (parent: string): Json[] =>
  Object.values(state.madeGraphs)
    .filter((g) => g.parentGraphId === parent)
    .map((g) => structuredClone(g))

function graphs(method: string, path: string, body: Json): Reply | undefined {
  if (path === '/graphs' && method === 'GET') {
    const recorded = recordedReply('GET', '/graphs', '', recording.mainGraphId)
    const list = ((recorded?.body as { data?: Json[] } | undefined)?.data ?? []).concat(Object.values(state.madeGraphs))
    return patchCounts(ok(list))
  }
  if (path === '/graphs/active' && method === 'GET') {
    const active = graphObject(state.active)
    return active ? patchCounts(ok(active)) : notFound('Graph')
  }
  const match = /^\/graphs\/([^/]+)(\/[a-z]+)?$/.exec(path)
  if (!match) return undefined
  const id = decodeURIComponent(match[1] ?? '')
  const action = match[2] ?? ''
  if (id === 'copy' || !state.graphs[id]) return undefined
  const made = Boolean(state.madeGraphs[id])

  if (action === '' && method === 'GET') return patchCounts(ok(graphObject(id)))
  if (action === '/activate' && method === 'POST') {
    state.active = id
    return patchCounts(ok(graphObject(id)))
  }
  if (action === '/branches' && method === 'GET') {
    const recorded = made ? undefined : recording.responses[`GET /graphs/${id}/branches @${id}`]
    const list = (((recorded?.body as { data?: Json[] } | undefined)?.data ?? []) as Json[]).concat(madeChildren(id))
    return patchCounts(ok(list))
  }
  if (action === '/versions' && method === 'GET' && made) {
    const graph = state.madeGraphs[id] as Json
    const parent = graphObject(String(graph.parentGraphId))
    return ok([
      {
        graphId: id,
        version: 1,
        timestamp: graph.createdAt,
        parentVersion: null,
        operation: 'create',
        description: `Branched from “${String(parent?.name ?? 'its parent')}”`,
        changes: { added: [], modified: [], deleted: [] },
        treeHash: '',
      },
    ])
  }
  if (action === '/branch' && method === 'POST') {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return badRequest('A branch needs a name')
    const parent = graphObject(id)
    if (!parent) return notFound('Graph')
    const now = new Date().toISOString()
    const branchId = newId('graph')
    state.graphs[branchId] = structuredClone(state.graphs[id] as GraphState)
    state.madeGraphs[branchId] = {
      ...parent,
      id: branchId,
      name,
      description: typeof body.description === 'string' ? body.description : '',
      createdAt: now,
      updatedAt: now,
      version: 1,
      parentGraphId: id,
      branchPoint: typeof parent.version === 'number' ? parent.version : 1,
      status: 'active',
    }
    return patchCounts(ok(graphObject(branchId), 201))
  }
  return undefined
}

/* ------------------------------------------------------------ live store --- */

function list<T>(items: T[], params: URLSearchParams, extra: Json = {}): Reply {
  const limit = Math.max(1, Number(params.get('limit') ?? 50) || 50)
  const offset = Math.max(0, Number(params.get('offset') ?? 0) || 0)
  return {
    status: 200,
    body: {
      success: true,
      data: items.slice(offset, offset + limit),
      pagination: { limit, offset, total: items.length, hasMore: offset + limit < items.length },
      ...extra,
    },
  }
}

const byTime = (a: DemoEvent, b: DemoEvent) => a.timestamp.localeCompare(b.timestamp)

function events(method: string, path: string, params: URLSearchParams, body: Json, graph: GraphState): Reply | undefined {
  if (path === '/events' && method === 'GET') {
    const actor = params.get('actor')
    const target = params.get('target')
    const found = graph.events
      .filter((e) => (!actor || e.actor === actor) && (!target || e.target === target))
      .sort(byTime)
    return list(found, params, { filters: { actor, target, timeRange: null } })
  }
  if (path === '/events/search' && method === 'GET') {
    const q = (params.get('q') ?? '').toLowerCase()
    return ok(graph.events.filter((e) => `${e.description} ${e.actor} ${e.target}`.toLowerCase().includes(q)).sort(byTime))
  }
  if (path === '/events' && method === 'POST') {
    if (typeof body.description !== 'string' || typeof body.timestamp !== 'string') {
      return badRequest('An event needs a description and a date')
    }
    const now = new Date().toISOString()
    const event: DemoEvent = {
      actor: '',
      target: '',
      ...body,
      id: newId('event'),
      description: body.description,
      timestamp: body.timestamp,
      created_at: now,
      updated_at: now,
    } as DemoEvent
    graph.events.push(event)
    return ok(event, 201)
  }
  const match = /^\/events\/([^/]+)$/.exec(path)
  if (!match) return undefined
  const id = decodeURIComponent(match[1] ?? '')
  const index = graph.events.findIndex((e) => e.id === id)
  if (index < 0) return notFound('Event')
  if (method === 'GET') return ok(graph.events[index])
  if (method === 'PUT' || method === 'PATCH') {
    const updated = { ...graph.events[index], ...body, id, updated_at: new Date().toISOString() } as DemoEvent
    graph.events[index] = updated
    return ok(updated)
  }
  if (method === 'DELETE') {
    graph.events.splice(index, 1)
    graph.relationships = graph.relationships.filter((r) => r.cause_event_id !== id && r.effect_event_id !== id)
    return ok({ id, deleted: true })
  }
  return undefined
}

function arcs(method: string, path: string, params: URLSearchParams, body: Json, graph: GraphState): Reply | undefined {
  const sorted = () => [...graph.arcs].sort((a, b) => a.level - b.level || a.start_time.localeCompare(b.start_time))
  if (path === '/arcs' && method === 'GET') return list(sorted(), params, { filters: { level: null, timeRange: null } })
  if (path === '/arcs/hierarchy' && method === 'GET') return ok(sorted())
  if (path === '/arcs' && method === 'POST') {
    if (typeof body.name !== 'string' || typeof body.start_time !== 'string' || typeof body.end_time !== 'string') {
      return badRequest('An arc needs a name, a start and an end')
    }
    const arc = { level: 1, ...body, id: newId('arc') } as DemoArc
    graph.arcs.push(arc)
    return ok(arc, 201)
  }
  const match = /^\/arcs\/([^/]+)$/.exec(path)
  if (!match) return undefined
  const id = decodeURIComponent(match[1] ?? '')
  const index = graph.arcs.findIndex((a) => a.id === id)
  if (index < 0) return notFound('Arc')
  if (method === 'GET') return ok(graph.arcs[index])
  if (method === 'PUT' || method === 'PATCH') {
    const updated = { ...graph.arcs[index], ...body, id } as DemoArc
    graph.arcs[index] = updated
    return ok(updated)
  }
  if (method === 'DELETE') {
    graph.arcs.splice(index, 1)
    return ok({ id, deleted: true })
  }
  return undefined
}

interface LinkBody {
  causeEventId?: string
  effectEventId?: string
  relationship?: { type?: string; relationship_type?: string; strength?: number; weight?: number; confidence?: number; evidence?: string }
}

function causal(method: string, path: string, params: URLSearchParams, body: Json, graph: GraphState): Reply | undefined {
  if (path === '/causal/relationships' && method === 'GET') {
    const eventId = params.get('event_id')
    return ok(graph.relationships.filter((r) => !eventId || r.cause_event_id === eventId || r.effect_event_id === eventId))
  }
  if (path === '/causal/link') {
    const { causeEventId, effectEventId, relationship = {} } = body as LinkBody
    if (!causeEventId || !effectEventId) return badRequest('A link needs a cause and an effect')
    const cause = graph.events.find((e) => e.id === causeEventId)
    const effect = graph.events.find((e) => e.id === effectEventId)
    if (!cause || !effect) return notFound('Event')
    const index = graph.relationships.findIndex((r) => r.cause_event_id === causeEventId && r.effect_event_id === effectEventId)
    const now = new Date().toISOString()
    if (method === 'POST') {
      if (index >= 0) return { status: 409, body: { success: false, error: { code: 'CONFLICT', message: 'Those events are already linked' } } }
      const link: DemoRelationship = {
        id: newId('link'),
        cause_event_id: causeEventId,
        effect_event_id: effectEventId,
        weight: relationship.strength ?? relationship.weight ?? 0.5,
        confidence: relationship.confidence ?? 0.5,
        evidence: relationship.evidence ?? '',
        relationship_type: relationship.type ?? relationship.relationship_type ?? 'direct',
        created_at: now,
        updated_at: now,
      }
      graph.relationships.push(link)
      return ok({ cause, effect, relationship: { ...link, type: link.relationship_type, strength: link.weight } }, 201)
    }
    if (index < 0) return notFound('Link')
    const current = graph.relationships[index] as DemoRelationship
    if (method === 'PUT') {
      const updated: DemoRelationship = {
        ...current,
        weight: relationship.weight ?? relationship.strength ?? current.weight,
        confidence: relationship.confidence ?? current.confidence,
        evidence: relationship.evidence ?? current.evidence,
        relationship_type: relationship.type ?? relationship.relationship_type ?? current.relationship_type,
        updated_at: now,
      }
      graph.relationships[index] = updated
      return ok({ cause, effect, relationship: updated })
    }
    if (method === 'DELETE') {
      graph.relationships.splice(index, 1)
      return ok({ deleted: true })
    }
    return undefined
  }
  const chain = /^\/causal\/chain\/([^/]+)$/.exec(path)
  if (chain && method === 'GET') {
    const startId = decodeURIComponent(chain[1] ?? '')
    const startEvent = graph.events.find((e) => e.id === startId)
    if (!startEvent) return notFound('Event')
    const maxDepth = Math.min(10, Math.max(1, Number(params.get('maxDepth') ?? 3) || 3))
    return ok({ startEvent, causalPaths: causalPaths(graph, startId, maxDepth), maxDepth })
  }
  return undefined
}

/** Every path forward from an event, up to `maxDepth` links long. */
function causalPaths(graph: GraphState, start: string, maxDepth: number) {
  const paths: Array<{
    events: string[]
    relationships: Array<Pick<DemoRelationship, 'weight' | 'evidence' | 'confidence' | 'relationship_type'>>
    total_strength: number
    relationship_weights: number[]
    depth: number
  }> = []
  const walk = (events: string[], links: DemoRelationship[]) => {
    if (links.length >= maxDepth) return
    const last = events[events.length - 1]
    for (const link of graph.relationships) {
      if (link.cause_event_id !== last || events.includes(link.effect_event_id)) continue
      const nextEvents = [...events, link.effect_event_id]
      const nextLinks = [...links, link]
      paths.push({
        events: nextEvents,
        relationships: nextLinks.map(({ weight, evidence, confidence, relationship_type }) => ({
          weight,
          evidence,
          confidence,
          relationship_type,
        })),
        total_strength: nextLinks.reduce((product, l) => product * l.weight, 1),
        relationship_weights: nextLinks.map((l) => l.weight),
        depth: nextLinks.length,
      })
      walk(nextEvents, nextLinks)
    }
  }
  walk([start], [])
  return paths
}

/* ---------------------------------------------------------------- router --- */

function route(method: string, path: string, params: URLSearchParams, body: Json, headerGraph: string | undefined): Reply {
  const graphId = headerGraph && state.graphs[headerGraph] ? headerGraph : state.active
  const graph = state.graphs[graphId] as GraphState
  const query = (() => {
    const sorted = new URLSearchParams(params)
    sorted.sort()
    return sorted.toString()
  })()

  const live =
    graphs(method, path, body) ??
    events(method, path, params, body, graph) ??
    arcs(method, path, params, body, graph) ??
    causal(method, path, params, body, graph)
  if (live) {
    if (method !== 'GET') save()
    return live
  }

  if (method === 'GET' || path.startsWith('/inference/')) {
    // A branch made here answers with what was recorded for its ancestor.
    const recordedPath = path.replace(graphId, recordedAncestor(graphId))
    const recorded =
      method === 'GET' || path === '/inference/pressures'
        ? recordedReply(method, recordedPath, query, recordedAncestor(graphId))
        : undefined
    if (recorded) return recorded
  }
  return unsupported(method, path)
}

function headerValue(config: InternalAxiosRequestConfig, name: string): string | undefined {
  const value = AxiosHeaders.from(config.headers).get(name)
  return typeof value === 'string' && value ? value : undefined
}

/** The axios adapter: one request in, one response (or AxiosError) out. */
export async function respond(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const method = (config.method ?? 'get').toUpperCase()
  const url = new URL(config.url ?? '/', 'http://demo.invalid/')
  const path = url.pathname.replace(/^\/api(?=\/)/, '')
  const params = new URLSearchParams(url.search)
  for (const [key, value] of Object.entries((config.params ?? {}) as Record<string, unknown>)) {
    if (value === undefined || value === null) continue
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item))
  }
  let body: Json = {}
  try {
    const raw: unknown = typeof config.data === 'string' && config.data ? JSON.parse(config.data) : config.data
    if (raw && typeof raw === 'object') body = raw as Json
  } catch {
    // A non-JSON body: no write the demo answers takes one.
  }

  const reply = route(method, path, params, body, headerValue(config, 'X-Graph-Id'))
  const response: AxiosResponse = {
    data: structuredClone(reply.body),
    status: reply.status,
    statusText: String(reply.status),
    headers: new AxiosHeaders({ 'content-type': 'application/json' }),
    config,
    request: {},
  }
  const valid = config.validateStatus ? config.validateStatus(reply.status) : reply.status >= 200 && reply.status < 300
  if (!valid) {
    throw new AxiosError(
      `Request failed with status code ${reply.status}`,
      reply.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      {},
      response
    )
  }
  return response
}
