/**
 * Deterministic HTTP API stub for the e2e suite.
 *
 * WHY THIS EXISTS
 * ---------------
 * The unit suites mock `apiClient` itself, so they cannot catch a broken HTTP
 * boundary, a bad response envelope, or an app that renders nothing until a
 * request resolves. These tests run the real production bundle in a real
 * browser, so the API has to answer for real. Rather than depend on the
 * backend (storage, migrations, seed data, ports), every request under `/api`
 * is intercepted here and served from in-memory fixtures.
 *
 * HOW THE APP TALKS TO THIS
 * -------------------------
 * `playwright.config.ts` builds the frontend with `VITE_API_BASE_URL=/api`, so
 * the app issues same-origin requests to the preview server. Intercepting
 * same-origin requests avoids the CORS/preflight dance a cross-origin stub
 * would need and keeps the app's request path unchanged.
 *
 * STATEFULNESS
 * ------------
 * The stub holds mutable arrays, so a write followed by React Query's
 * invalidation/refetch observes the write (see `create-event.spec.ts`). It is
 * not a general API simulator: only the endpoints the covered flows touch are
 * implemented, and an unstubbed request is answered with 404 and recorded in
 * `state.unhandled` so a test can fail loudly instead of silently drifting.
 */

import type { Page, Route } from '@playwright/test'

export interface TimelineEvent {
  id: string
  description: string
  actor: string
  target: string
  timestamp: string
  created_at: string
  updated_at: string
}

export interface TimelineArc {
  id: string
  name: string
  description: string
  start_time: string
  end_time: string
  level: number
  parent_arc_id: string | null
  created_at: string
  updated_at: string
}

export interface GraphSummary {
  id: string
  name: string
  description?: string
  status: 'active' | 'archived' | 'deleted'
  version: number
  createdAt: string
  updatedAt: string
  metadata: {
    eventCount: number
    arcCount: number
    relationshipCount: number
    pressureCount: number
  }
}

export interface CreateEventBody {
  description: string
  actor: string
  target: string
  timestamp: string
}

export interface ExtractionSource {
  type: string
  extractedAt?: string
  url?: string
}

export interface ExtractedEvent {
  tempId: string
  description: string
  actor: string
  target: string
  timestamp: string
  confidence: number
  source: ExtractionSource
  selected: boolean
  edited: boolean
}

export interface ExtractedArc {
  tempId: string
  name: string
  description: string
  start_time: string
  end_time: string
  level: number
  confidence: number
  source: ExtractionSource
  selected: boolean
  edited: boolean
}

export interface IngestResponse {
  jobId: string
  status: 'review'
  estimatedPages?: number
  validationIssues: Array<{
    entityTempId: string
    entityType: 'event' | 'arc' | 'relationship'
    severity: 'error' | 'warning'
    message: string
  }>
  extraction: {
    events: ExtractedEvent[]
    arcs: ExtractedArc[]
    relationships: unknown[]
    sources: ExtractionSource[]
    overallConfidence: number
  }
}

export interface ImportResult {
  success: boolean
  graphId: string
  graphVersion: number
  imported: { events: number; arcs: number; relationships: number; pressures: number }
  skipped: { events: number; arcs: number; relationships: number; pressures: number }
  deleted: { events: number; arcs: number; relationships: number; pressures: number }
  errors: unknown[]
  warnings: unknown[]
}

export interface ApiStubState {
  events: TimelineEvent[]
  arcs: TimelineArc[]
  graphs: GraphSummary[]
  ingestResponse: IngestResponse
  importResult: ImportResult
  createdEvents: CreateEventBody[]
  ingestedVia: string[]
  approveCalls: Array<Record<string, unknown>>
  deletedJobs: string[]
  unhandled: string[]
}

/** Fixed clock so created_at/updated_at never make a snapshot or assertion flaky. */
const FIXED_NOW = '2024-01-01T00:00:00.000Z'

export function defaultEvents(): TimelineEvent[] {
  return [
    {
      id: 'evt-hastings',
      description: 'Battle of Hastings',
      actor: 'William of Normandy',
      target: 'Harold Godwinson',
      timestamp: '1066-10-14T09:00:00.000Z',
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
    },
    {
      id: 'evt-stamford',
      description: 'Battle of Stamford Bridge',
      actor: 'Harold Godwinson',
      target: 'Harald Hardrada',
      timestamp: '1066-09-25T09:00:00.000Z',
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
    },
    {
      id: 'evt-coronation',
      description: 'Coronation of William I',
      actor: 'William of Normandy',
      target: 'England',
      timestamp: '1066-12-25T12:00:00.000Z',
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
    },
  ]
}

export function defaultArcs(): TimelineArc[] {
  return [
    {
      id: 'arc-norman-conquest',
      name: 'Norman Conquest',
      description: 'The Norman conquest of England',
      start_time: '1066-09-01T00:00:00.000Z',
      end_time: '1066-12-31T23:59:59.000Z',
      level: 1,
      parent_arc_id: null,
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
    },
  ]
}

export function defaultGraphs(): GraphSummary[] {
  return [
    {
      id: 'graph-main',
      name: 'Main Timeline',
      description: 'Default graph',
      status: 'active',
      version: 1,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      metadata: {
        eventCount: 3,
        arcCount: 1,
        relationshipCount: 0,
        pressureCount: 0,
      },
    },
  ]
}

export function defaultIngestResponse(): IngestResponse {
  const source: ExtractionSource = { type: 'wikipedia', extractedAt: FIXED_NOW }
  return {
    jobId: 'job-hastings',
    status: 'review',
    estimatedPages: 1,
    validationIssues: [
      {
        entityTempId: 'evt-2',
        entityType: 'event',
        severity: 'warning',
        message: 'Low confidence',
      },
    ],
    extraction: {
      overallConfidence: 0.8,
      sources: [source],
      events: [
        {
          tempId: 'evt-1',
          description: 'Battle of Hastings',
          actor: 'Harold Godwinson',
          target: 'William of Normandy',
          timestamp: '1066-10-14',
          confidence: 0.9,
          source,
          selected: true,
          edited: false,
        },
        {
          tempId: 'evt-2',
          description: 'Norman conquest begins',
          actor: 'William of Normandy',
          target: 'England',
          timestamp: '1066-12-25',
          confidence: 0.6,
          source,
          selected: true,
          edited: false,
        },
      ],
      arcs: [
        {
          tempId: 'arc-1',
          name: 'Norman Conquest',
          description: 'The Norman conquest of England',
          start_time: '1066-10-14',
          end_time: '1072-01-01',
          level: 1,
          confidence: 0.7,
          source,
          selected: true,
          edited: false,
        },
      ],
      relationships: [],
    },
  }
}

export function defaultImportResult(): ImportResult {
  return {
    success: true,
    graphId: 'graph-main',
    graphVersion: 2,
    imported: { events: 2, arcs: 1, relationships: 0, pressures: 0 },
    skipped: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
    deleted: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
    errors: [],
    warnings: [],
  }
}

export interface InstallApiStubOptions {
  events?: TimelineEvent[]
  arcs?: TimelineArc[]
  graphs?: GraphSummary[]
  ingestResponse?: IngestResponse
  importResult?: ImportResult
}

/**
 * Intercept every `/api/**` request for `page` and serve the fixtures above.
 * Returns the mutable state so a test can assert what the UI sent and let a
 * write be observed by the next read.
 */
export async function installApiStub(
  page: Page,
  options: InstallApiStubOptions = {},
): Promise<ApiStubState> {
  const state: ApiStubState = {
    events: options.events ?? defaultEvents(),
    arcs: options.arcs ?? defaultArcs(),
    graphs: options.graphs ?? defaultGraphs(),
    ingestResponse: options.ingestResponse ?? defaultIngestResponse(),
    importResult: options.importResult ?? defaultImportResult(),
    createdEvents: [],
    ingestedVia: [],
    approveCalls: [],
    deletedJobs: [],
    unhandled: [],
  }

  const json = (route: Route, status: number, body: unknown): Promise<void> =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const { pathname } = new URL(request.url())
    const path = pathname.replace(/^\/api/, '')

    // Events
    if (path === '/events' && method === 'GET') {
      return json(route, 200, { success: true, data: state.events })
    }
    if (path === '/events' && method === 'POST') {
      const body = request.postDataJSON() as CreateEventBody
      state.createdEvents.push(body)
      const created: TimelineEvent = {
        id: `evt-created-${state.createdEvents.length}`,
        description: body.description,
        actor: body.actor,
        target: body.target,
        timestamp: body.timestamp,
        created_at: FIXED_NOW,
        updated_at: FIXED_NOW,
      }
      state.events.push(created)
      return json(route, 201, { success: true, data: created })
    }
    if (path === '/events/search' && method === 'GET') {
      return json(route, 200, { success: true, data: state.events })
    }
    const eventMatch = /^\/events\/([^/]+)$/.exec(path)
    if (eventMatch && method === 'GET') {
      const found = state.events.find((event) => event.id === eventMatch[1])
      return found
        ? json(route, 200, { success: true, data: found })
        : json(route, 404, { success: false, message: 'event not found' })
    }
    if (eventMatch && method === 'PUT') {
      const id = eventMatch[1]
      const body = request.postDataJSON() as Partial<TimelineEvent>
      state.events = state.events.map((event) =>
        event.id === id ? { ...event, ...body, updated_at: FIXED_NOW } : event,
      )
      const found = state.events.find((event) => event.id === id)
      return json(route, 200, { success: true, data: found })
    }
    if (eventMatch && method === 'DELETE') {
      state.events = state.events.filter((event) => event.id !== eventMatch[1])
      return json(route, 200, { success: true })
    }

    // Arcs
    if (path === '/arcs' && method === 'GET') {
      return json(route, 200, { success: true, data: state.arcs })
    }
    if (path === '/arcs' && method === 'POST') {
      const body = request.postDataJSON() as Partial<TimelineArc>
      const created: TimelineArc = {
        id: `arc-created-${state.arcs.length + 1}`,
        name: body.name ?? '',
        description: body.description ?? '',
        start_time: body.start_time ?? FIXED_NOW,
        end_time: body.end_time ?? FIXED_NOW,
        level: body.level ?? 1,
        parent_arc_id: body.parent_arc_id ?? null,
        created_at: FIXED_NOW,
        updated_at: FIXED_NOW,
      }
      state.arcs.push(created)
      return json(route, 201, { success: true, data: created })
    }
    const arcMatch = /^\/arcs\/([^/]+)$/.exec(path)
    if (arcMatch && method === 'PUT') {
      const id = arcMatch[1]
      const body = request.postDataJSON() as Partial<TimelineArc>
      state.arcs = state.arcs.map((arc) =>
        arc.id === id ? { ...arc, ...body, updated_at: FIXED_NOW } : arc,
      )
      const found = state.arcs.find((arc) => arc.id === id)
      return json(route, 200, { success: true, data: found })
    }
    if (arcMatch && method === 'DELETE') {
      state.arcs = state.arcs.filter((arc) => arc.id !== arcMatch[1])
      return json(route, 200, { success: true })
    }

    // Graphs (fetched by the header's graph selector on every page)
    if (path === '/graphs' && method === 'GET') {
      return json(route, 200, {
        success: true,
        data: state.graphs,
        pagination: { total: state.graphs.length },
      })
    }
    const graphMatch = /^\/graphs\/([^/]+)$/.exec(path)
    if (graphMatch && method === 'GET') {
      const found = state.graphs.find((graph) => graph.id === graphMatch[1]) ?? state.graphs[0]
      return json(route, 200, { success: true, data: found })
    }

    // Inferred pressures (fetched by the timeline views). The flows covered
    // here do not exercise inference, so the graph has none.
    if (path === '/inference/pressures' && method === 'GET') {
      return json(route, 200, { success: true, data: [] })
    }

    // Web ingestion (Req 19)
    if (path === '/ingest/url' && method === 'POST') {
      state.ingestedVia.push(path)
      return json(route, 200, state.ingestResponse)
    }
    if (path === '/ingest/wikidata' && method === 'POST') {
      state.ingestedVia.push(path)
      return json(route, 200, state.ingestResponse)
    }
    if (path === '/ingest/text' && method === 'POST') {
      state.ingestedVia.push(path)
      return json(route, 200, state.ingestResponse)
    }
    const approveMatch = /^\/ingest\/jobs\/([^/]+)\/approve$/.exec(path)
    if (approveMatch && method === 'POST') {
      state.approveCalls.push(request.postDataJSON() as Record<string, unknown>)
      return json(route, 200, state.importResult)
    }
    const deleteJobMatch = /^\/ingest\/jobs\/([^/]+)$/.exec(path)
    if (deleteJobMatch && method === 'DELETE') {
      state.deletedJobs.push(deleteJobMatch[1])
      return json(route, 200, { success: true })
    }

    state.unhandled.push(`${method} ${path}`)
    return json(route, 404, { success: false, message: `unstubbed endpoint: ${method} ${path}` })
  })

  return state
}
