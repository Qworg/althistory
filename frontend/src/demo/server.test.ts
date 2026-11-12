import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'

/** A request as the API client's axios instance would hand it to the adapter. */
function request(method: string, url: string, data?: unknown, headers: Record<string, string> = {}): InternalAxiosRequestConfig {
  return {
    method,
    url,
    baseURL: '/api',
    headers: new AxiosHeaders(headers),
    data: data === undefined ? undefined : JSON.stringify(data),
  } as InternalAxiosRequestConfig
}

async function load() {
  // The server reads sessionStorage once, when it loads: a fresh module per test.
  vi.resetModules()
  return import('./server')
}

describe('demo server', () => {
  beforeEach(() => sessionStorage.clear())

  it('serves the seeded history', async () => {
    const { respond } = await load()
    const events = await respond(request('get', '/events', undefined))
    expect(events.status).toBe(200)
    expect(events.data.data).toHaveLength(19)
    const links = await respond(request('get', '/causal/relationships'))
    expect(links.data.data).toHaveLength(24)
  })

  it('keeps an edit for the tab, and every read sees it', async () => {
    const { respond } = await load()
    const created = await respond(
      request('post', '/events', { description: 'The engines reach Calcutta', actor: 'East India Company', target: 'Calcutta', timestamp: '1857-03-01T09:00:00.000Z' })
    )
    expect(created.status).toBe(201)
    const id = created.data.data.id as string

    const reloaded = await load()
    const events = await reloaded.respond(request('get', '/events'))
    expect(events.data.data.map((e: { id: string }) => e.id)).toContain(id)
    const graph = await reloaded.respond(request('get', '/graphs/active'))
    expect(graph.data.data.metadata.eventCount).toBe(20)
  })

  it('follows causes forward from an event', async () => {
    const { respond } = await load()
    const chain = await respond(request('get', '/causal/chain/event_noteg?maxDepth=2'))
    const paths = chain.data.data.causalPaths as Array<{ events: string[]; depth: number }>
    expect(paths.length).toBeGreaterThan(0)
    expect(paths.every((p) => p.events[0] === 'event_noteg' && p.depth <= 2)).toBe(true)
    expect(paths.some((p) => p.events.includes('event_firstrun'))).toBe(true)
  })

  it('switches the active graph', async () => {
    const { respond } = await load()
    await respond(request('post', '/graphs/graph_clerks_prevail/activate', {}))
    const events = await respond(request('get', '/events'))
    expect(events.data.data).toHaveLength(21)
    // A request that names its graph still gets that graph.
    const main = await respond(request('get', '/events', undefined, { 'X-Graph-Id': 'graph_engine_age' }))
    expect(main.data.data).toHaveLength(19)
  })

  it('makes a branch from the live state, and serves it like a recorded graph', async () => {
    const { respond } = await load()
    await respond(request('post', '/events', { description: 'A late addition', actor: 'Ada Lovelace', target: 'London', timestamp: '1850-01-01T00:00:00.000Z' }))

    const made = await respond(request('post', '/graphs/graph_engine_age/branch', { name: 'Secret engines' }))
    expect(made.status).toBe(201)
    const branch = made.data.data as { id: string; parentGraphId: string; name: string; metadata: { eventCount: number } }
    expect(branch).toMatchObject({ name: 'Secret engines', parentGraphId: 'graph_engine_age' })
    // A copy of the parent as it stands, edits included.
    expect(branch.metadata.eventCount).toBe(20)

    const list = await respond(request('get', '/graphs'))
    expect(list.data.data.map((g: { id: string }) => g.id)).toContain(branch.id)
    const children = await respond(request('get', '/graphs/graph_engine_age/branches'))
    expect(children.data.data.map((g: { id: string }) => g.id)).toEqual(['graph_clerks_prevail', branch.id])

    await respond(request('post', `/graphs/${branch.id}/activate`, {}))
    const active = await respond(request('get', '/graphs/active'))
    expect(active.data.data.id).toBe(branch.id)
    const versions = await respond(request('get', `/graphs/${branch.id}/versions?limit=100`))
    expect(versions.data.data[0].description).toMatch(/^Branched from/)
    // Reads recorded for the parent stand in for the new branch.
    const pressures = await respond(request('get', '/inference/pressures?limit=500'))
    expect(pressures.status).toBe(200)

    // Its edits stay its own.
    await respond(request('post', '/events', { description: 'Only in the branch', actor: 'x', target: 'y', timestamp: '1855-01-01T00:00:00.000Z' }))
    const parentEvents = await respond(request('get', '/events', undefined, { 'X-Graph-Id': 'graph_engine_age' }))
    expect(parentEvents.data.data).toHaveLength(20)
  })

  it('starts on the graph the app last showed', async () => {
    localStorage.setItem('active_graph_id', 'graph_clerks_prevail')
    try {
      const { respond } = await load()
      const active = await respond(request('get', '/graphs/active'))
      expect(active.data.data.id).toBe('graph_clerks_prevail')
    } finally {
      localStorage.removeItem('active_graph_id')
    }
  })

  it('serves the invented world with its calendar', async () => {
    const { respond } = await load()
    const list = await respond(request('get', '/graphs'))
    const vael = (list.data.data as Array<{ id: string; name: string; calendar?: unknown }>).find((g) => g.id === 'graph_vael')
    expect(vael).toMatchObject({ name: 'Vael', calendar: { epochYear: 1000, eraLabel: 'AR', name: 'the Reckoning of the Rising' } })

    await respond(request('post', '/graphs/graph_vael/activate', {}))
    const active = await respond(request('get', '/graphs/active'))
    expect(active.data.data).toMatchObject({ id: 'graph_vael', calendar: { epochYear: 1000, eraLabel: 'AR' } })
    const events = await respond(request('get', '/events'))
    expect(events.data.data).toHaveLength(9)
    expect(events.data.data[0]).toMatchObject({ timestamp: '1000-03-04T00:00:00.000Z' })
    expect((await respond(request('get', '/arcs'))).data.data).toHaveLength(3)
    expect((await respond(request('get', '/causal/relationships'))).data.data).toHaveLength(9)
  })

  it('keeps the calendar on a branch of the world', async () => {
    const { respond } = await load()
    const made = await respond(request('post', '/graphs/graph_vael/branch', { name: 'The Last King Lives' }))
    expect(made.status).toBe(201)
    const branch = made.data.data as { id: string; parentGraphId: string; calendar?: unknown; metadata: { eventCount: number } }
    expect(branch).toMatchObject({ parentGraphId: 'graph_vael', calendar: { epochYear: 1000, eraLabel: 'AR', name: 'the Reckoning of the Rising' } })
    expect(branch.metadata.eventCount).toBe(9)

    // And it lasts: from the list, as the active graph, and after a reload.
    const reloaded = await load()
    await reloaded.respond(request('post', `/graphs/${branch.id}/activate`, {}))
    const active = await reloaded.respond(request('get', '/graphs/active'))
    expect(active.data.data).toMatchObject({ id: branch.id, calendar: { epochYear: 1000, eraLabel: 'AR' } })
    const byId = await reloaded.respond(request('get', `/graphs/${branch.id}`))
    expect(byId.data.data.calendar).toEqual({
      epochYear: 1000,
      eraLabel: 'AR',
      name: 'the Reckoning of the Rising',
      monthNames: ['Lowtide', 'Greywater', 'Thaw', 'Seedtide', 'Brightwater', 'Highsun', 'Saltreap', 'Panfire', 'Gale', 'Ebb', 'Wrack', 'Longnight'],
    })
    // The main history still has no calendar.
    const main = await reloaded.respond(request('get', '/graphs/graph_engine_age'))
    expect(main.data.data.calendar).toBeUndefined()
  })

  it('adds the world to a tab saved before the recording had it', async () => {
    const { respond } = await load()
    await respond(request('post', '/events', { description: 'Kept', actor: 'a', target: 'b', timestamp: '1850-01-01T00:00:00.000Z' }))
    const saved = JSON.parse(sessionStorage.getItem('althistory-demo') ?? '{}') as { graphs: Record<string, unknown> }
    delete saved.graphs.graph_vael
    sessionStorage.setItem('althistory-demo', JSON.stringify(saved))

    const reloaded = await load()
    expect((await reloaded.respond(request('get', '/events'))).data.data).toHaveLength(20)
    const world = await reloaded.respond(request('get', '/events', undefined, { 'X-Graph-Id': 'graph_vael' }))
    expect(world.data.data).toHaveLength(9)
  })

  it('says plainly when something needs the server', async () => {
    const { respond } = await load()
    const error = await respond(request('post', '/ingest/text', { text: 'On 1 May 1851 the Great Exhibition opened.' })).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AxiosError)
    const response = (error as AxiosError<{ error: { message: string } }>).response
    expect(response?.status).toBe(405)
    expect(response?.data.error.message).toMatch(/^Bringing in history .* needs the althistory server/)
  })
})
