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

  it('says plainly when something needs the server', async () => {
    const { respond } = await load()
    const error = await respond(request('post', '/ingest/text', { text: 'On 1 May 1851 the Great Exhibition opened.' })).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AxiosError)
    const response = (error as AxiosError<{ error: { message: string } }>).response
    expect(response?.status).toBe(405)
    expect(response?.data.error.message).toMatch(/^Bringing in history .* needs the althistory server/)
  })
})
