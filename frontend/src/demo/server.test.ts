import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { type WorldCalendarSet, formatInWorld } from '@althistory/calendar'

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

  it('keeps a history of a million years in the order of time, and draws no NaN', async () => {
    const { respond } = await load()
    for (const [description, timestamp] of [
      ['The last city', '+300000-01-01T00:00:00.000Z'],
      ['The first hearths', '-499999-06-15T00:00:00.000Z'],
      ['Toba', '-070000-01-01T00:00:00.000Z'],
    ] as const) {
      const made = await respond(request('post', '/events', { description, actor: 'People', target: 'World', timestamp }))
      expect(made.status).toBe(201)
    }
    const events = (await respond(request('get', '/events'))).data.data as Array<{ description: string; timestamp: string }>
    const order = events.map((e) => e.description)
    expect(order[0]).toBe('The first hearths')
    expect(order[1]).toBe('Toba')
    expect(order[order.length - 1]).toBe('The last city')
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
    expect(vael).toMatchObject({ name: 'Vael', calendar: { version: 2, primary: 'reckoning', calendars: [{ name: 'the Reckoning of the Rising' }, { name: 'the Tide-count' }] } })

    await respond(request('post', '/graphs/graph_vael/activate', {}))
    const active = await respond(request('get', '/graphs/active'))
    expect(active.data.data).toMatchObject({ id: 'graph_vael', calendar: { version: 2, primary: 'reckoning' } })
    const events = await respond(request('get', '/events'))
    expect(events.data.data).toHaveLength(9)
    // The Rising, Thaw 4 of the Reckoning's year 1, on the timeline its days of 30 hours make.
    expect(formatInWorld(vael!.calendar as WorldCalendarSet, Date.parse(events.data.data[0].timestamp))).toBe('Thaw 4, 1 AR')
    expect((await respond(request('get', '/arcs'))).data.data).toHaveLength(3)
    expect((await respond(request('get', '/causal/relationships'))).data.data).toHaveLength(9)
  })

  it('keeps the arc hierarchy: a root is level 0, a child sits under its parent, a delete lifts, a move takes the subtree', async () => {
    const { respond } = await load()
    const make = async (body: Record<string, unknown>) => (await respond(request('post', '/arcs', { start_time: '1800-01-01T00:00:00Z', end_time: '1900-01-01T00:00:00Z', ...body }))).data.data as { id: string; level: number }
    const levels = async () => Object.fromEntries(((await respond(request('get', '/arcs'))).data.data as Array<{ id: string; level: number }>).map((arc) => [arc.id, arc.level]))
    const top = await make({ name: 'Top' })
    expect(top.level).toBe(0)
    const mid = await make({ name: 'Mid', parent_arc_id: top.id })
    const leaf = await make({ name: 'Leaf', parent_arc_id: mid.id })
    expect([mid.level, leaf.level]).toEqual([1, 2])

    // Moving Mid to the top takes Leaf with it.
    await respond(request('put', `/arcs/${mid.id}`, { level: 0, parent_arc_id: null }))
    expect(await levels()).toMatchObject({ [mid.id]: 0, [leaf.id]: 1 })

    // Deleting Mid keeps Leaf, which moves up to Mid's parent (the top: Mid has none).
    await respond(request('delete', `/arcs/${mid.id}`))
    expect(await levels()).toMatchObject({ [leaf.id]: 0 })
    expect(await levels()).not.toHaveProperty(mid.id)
  })

  it('follows the hierarchy on the path ArcDetailPanel uses: a parent named without a level, a cycle, a misfit, a delete', async () => {
    const { respond } = await load()
    const arcsNow = async () => (await respond(request('get', '/arcs'))).data.data as Array<{ id: string; level: number; parent_arc_id?: string | null }>
    const make = async (body: Record<string, unknown>) => (await respond(request('post', '/arcs', { start_time: '1800-01-01T00:00:00Z', end_time: '1900-01-01T00:00:00Z', ...body }))).data.data as { id: string; level: number }
    const a = await make({ name: 'A' })
    const b = await make({ name: 'B', parent_arc_id: a.id })
    const c = await make({ name: 'C', parent_arc_id: b.id })
    const d = await make({ name: 'D', parent_arc_id: c.id })
    const other = await make({ name: 'Other' })
    const levels = async () => Object.fromEntries((await arcsNow()).map((arc) => [arc.id, arc.level]))

    // B goes under Other with no level: it follows its parent, and C and D (three deep) follow it.
    const moved = await respond(request('put', `/arcs/${b.id}`, { parent_arc_id: other.id }))
    expect(moved.status).toBe(200)
    expect(await levels()).toMatchObject({ [b.id]: 1, [c.id]: 2, [d.id]: 3 })
    // Cleared with no level, it is top level, and its subtree comes up.
    await respond(request('put', `/arcs/${b.id}`, { parent_arc_id: null }))
    expect(await levels()).toMatchObject({ [b.id]: 0, [c.id]: 1, [d.id]: 2 })

    // A cycle, a parent that is not there, and a level that does not fit are refused.
    await expect(respond(request('put', `/arcs/${b.id}`, { parent_arc_id: d.id }))).rejects.toMatchObject({ response: { status: 400 } })
    await expect(respond(request('put', `/arcs/${b.id}`, { parent_arc_id: 'nowhere' }))).rejects.toMatchObject({ response: { status: 400 } })
    await expect(respond(request('put', `/arcs/${c.id}`, { level: 5 }))).rejects.toMatchObject({ response: { status: 400 } })
    expect(await levels()).toMatchObject({ [b.id]: 0, [c.id]: 1, [d.id]: 2 })

    // Deleting C lifts D to B, and says so in the arc itself.
    await respond(request('delete', `/arcs/${c.id}`))
    const after = await arcsNow()
    expect(after.find((arc) => arc.id === d.id)).toMatchObject({ level: 1, parent_arc_id: b.id })
  })

  it('unassigns the events of a deleted arc, which stay', async () => {
    const { respond } = await load()
    const arc = (await respond(request('post', '/arcs', { name: 'Gone', start_time: '1800-01-01T00:00:00Z', end_time: '1900-01-01T00:00:00Z' }))).data.data as { id: string }
    const event = (await respond(request('post', '/events', { description: 'In it', actor: 'A', target: 'B', timestamp: '1850-01-01T00:00:00Z', metadata: { arcId: arc.id, note: 'kept' } }))).data.data as { id: string }
    await respond(request('delete', `/arcs/${arc.id}`))
    const kept = (await respond(request('get', `/events/${event.id}`))).data.data as { metadata?: Record<string, unknown> }
    expect(kept.metadata).toEqual({ note: 'kept' })
  })

  describe('the seeded arcs and the server\'s rules', () => {
    const refused = (promise: Promise<unknown>) => expect(promise).rejects.toMatchObject({ response: { status: 400 } })

    it('lets a visitor edit every arc the recording seeded: a rename, a resize, a panel save, a drag', async () => {
      const { respond } = await load()
      const seeded = (await respond(request('get', '/arcs'))).data.data as Array<{ id: string; level: number; parent_arc_id?: string | null; start_time: string; end_time: string; name: string }>
      // The recording was made before the hierarchy was enforced: parentless arcs at levels 1 and 2 are top level here.
      expect(seeded.length).toBeGreaterThan(0)
      for (const arc of seeded) expect(arc.parent_arc_id ?? null).toBeNull()
      expect(seeded.every((arc) => arc.level === 0)).toBe(true)
      for (const arc of seeded) {
        expect((await respond(request('put', `/arcs/${arc.id}`, { name: `${arc.name} (edited)` }))).status).toBe(200)
        expect((await respond(request('put', `/arcs/${arc.id}`, { start_time: arc.start_time, end_time: '1860-01-01T00:00:00.000Z', parent_arc_id: null }))).status).toBe(200)
        // What the arc panel sends on save: the whole arc, level as it shows.
        expect((await respond(request('put', `/arcs/${arc.id}`, { name: arc.name, description: 'd', level: arc.level, start_time: arc.start_time, end_time: arc.end_time, parent_arc_id: null }))).status).toBe(200)
      }
    })

    it('judges a new arc and an edit as the server does', async () => {
      const { respond } = await load()
      const make = async (body: Record<string, unknown>) => (await respond(request('post', '/arcs', { start_time: '1800-01-01T00:00:00Z', end_time: '1900-01-01T00:00:00Z', ...body }))).data.data as { id: string; level: number; parent_arc_id: string | null; metadata?: Record<string, unknown> }
      const get = async (id: string) => (await respond(request('get', `/arcs/${id}`))).data.data as { level: number; parent_arc_id: string | null; metadata?: Record<string, unknown> }

      // A root above level 0, a child outside its parent's span, an unknown parent: refused when made.
      await refused(respond(request('post', '/arcs', { name: 'Root3', start_time: '1800-01-01T00:00:00Z', end_time: '1900-01-01T00:00:00Z', level: 3 })))
      const parent = await make({ name: 'Parent' })
      await refused(respond(request('post', '/arcs', { name: 'Outside', start_time: '1700-01-01T00:00:00Z', end_time: '1950-01-01T00:00:00Z', parent_arc_id: parent.id })))
      await refused(respond(request('post', '/arcs', { name: 'Orphan', start_time: '1800-01-01T00:00:00Z', end_time: '1900-01-01T00:00:00Z', parent_arc_id: 'nowhere' })))

      // A parent named only in metadata is shown as the arc's parent, and judged the same way.
      const child = await make({ name: 'Child', metadata: { parentArcId: parent.id } })
      expect(await get(child.id)).toMatchObject({ level: 1, parent_arc_id: parent.id })
      expect((await get(child.id)).metadata?.parentArcId).toBeUndefined()
      await refused(respond(request('put', `/arcs/${child.id}`, { metadata: { parentArcId: 'nowhere' } })))
      await refused(respond(request('put', `/arcs/${parent.id}`, { parent_arc_id: parent.id })))
      // A root edited to a level above 0 is refused too.
      await refused(respond(request('put', `/arcs/${parent.id}`, { level: 2 })))

      // Level 0 promotes a child; naming a parent no longer clears it with the metadata kept behind.
      await respond(request('put', `/arcs/${child.id}`, { level: 0 }))
      expect(await get(child.id)).toMatchObject({ level: 0, parent_arc_id: null })
      await respond(request('put', `/arcs/${child.id}`, { parent_arc_id: parent.id }))
      expect(await get(child.id)).toMatchObject({ level: 1, parent_arc_id: parent.id })
      await respond(request('put', `/arcs/${child.id}`, { parent_arc_id: null }))
      const cleared = await get(child.id)
      expect(cleared).toMatchObject({ level: 0, parent_arc_id: null })
      expect(cleared.metadata?.parentArcId).toBeUndefined()
    })

    it('unassigns events whichever way they name the arc', async () => {
      const { respond } = await load()
      const arc = (await respond(request('post', '/arcs', { name: 'Gone', start_time: '1800-01-01T00:00:00Z', end_time: '1900-01-01T00:00:00Z' }))).data.data as { id: string }
      const snake = (await respond(request('post', '/events', { description: 'Snake', actor: 'A', target: 'B', timestamp: '1850-01-01T00:00:00Z', metadata: { arc_id: arc.id, note: 'kept' } }))).data.data as { id: string }
      await respond(request('delete', `/arcs/${arc.id}`))
      expect(((await respond(request('get', `/events/${snake.id}`))).data.data as { metadata?: Record<string, unknown> }).metadata).toEqual({ note: 'kept' })
    })
  })

  describe('arcs saved in a tab before the hierarchy was enforced', () => {
    type Saved = { active: string; graphs: Record<string, { arcs: Array<Record<string, unknown>> }> }
    const arc = (id: string, level: number, parent: string | null, extra: Record<string, unknown> = {}) => ({ id, name: id, start_time: '1800-01-01T00:00:00.000Z', end_time: '1900-01-01T00:00:00.000Z', level, parent_arc_id: parent, metadata: {}, ...extra })

    /** A tab whose saved arcs are these, read back by a freshly loaded demo. */
    async function reopenWith(arcs: Array<Record<string, unknown>>) {
      const first = await load()
      await first.respond(request('post', '/arcs', { name: 'seed the saved state', start_time: '1800-01-01T00:00:00Z', end_time: '1900-01-01T00:00:00Z' }))
      const saved = JSON.parse(sessionStorage.getItem('althistory-demo') ?? '{}') as Saved
      saved.graphs[saved.active]!.arcs = arcs
      sessionStorage.setItem('althistory-demo', JSON.stringify(saved))
      const { respond } = await load()
      const shown = (await respond(request('get', '/arcs'))).data.data as Array<{ id: string; level: number; parent_arc_id: string | null }>
      return { respond, shown: Object.fromEntries(shown.map((a) => [a.id, [a.level, a.parent_arc_id]])) as Record<string, [number, string | null]> }
    }

    it('drops a parent that is itself, or not there, and levels the subtree from the top', async () => {
      const { shown } = await reopenWith([arc('self', 3, 'self'), arc('lost', 2, 'nowhere'), arc('below', 7, 'lost'), arc('deeper', 7, 'below'), arc('root', 5, null)])
      expect(shown).toEqual({ self: [0, null], lost: [0, null], below: [1, 'lost'], deeper: [2, 'below'], root: [0, null] })
    })

    it('cuts a cycle at an arc on it, and keeps the parent of one that only leads into it', async () => {
      const { shown } = await reopenWith([arc('cx', 1, 'cy'), arc('cy', 1, 'cx'), arc('leads', 2, 'cx')])
      // The first arc on the cycle is cut loose and the rest follow it; the chain keeps its parent.
      expect(shown).toEqual({ cx: [0, null], cy: [1, 'cx'], leads: [1, 'cx'] })
    })

    it('lets a legacy child be re-saved with its dates spelled another way (the same moments)', async () => {
      const { respond } = await reopenWith([arc('top', 0, null), arc('out', 1, 'top', { start_time: '1700-01-01T00:00:00.000Z', end_time: '1950-01-01T00:00:00.000Z' })])
      expect((await respond(request('put', '/arcs/out', { start_time: '1700-01-01T00:00:00Z', end_time: '1950-01-01T00:00:00Z' }))).status).toBe(200)
    })

    it('keeps the parent of a chain that is listed before the cycle it leads into', async () => {
      const { shown } = await reopenWith([arc('leads', 2, 'cx'), arc('cx', 1, 'cy'), arc('cy', 1, 'cx')])
      expect(shown.leads?.[1]).toBe('cx')
      expect(shown.cx?.[1]).toBeNull()
    })

    it('lets a legacy parent be renamed when a child already lies outside it, and when a child\'s dates cannot be read', async () => {
      const { respond } = await reopenWith([arc('top', 0, null), arc('out', 1, 'top', { start_time: '1700-01-01T00:00:00.000Z', end_time: '1950-01-01T00:00:00.000Z' })])
      expect((await respond(request('put', '/arcs/top', { name: 'renamed' }))).status).toBe(200)
      const unreadable = await reopenWith([arc('top', 0, null), arc('odd', 1, 'top', { start_time: 'not a date' })])
      // Its span shrinks: a child that cannot be read does not refuse it.
      expect((await unreadable.respond(request('put', '/arcs/top', { start_time: '1850-01-01T00:00:00Z' }))).status).toBe(200)
    })

    it('still lets an arc stored outside its parent be renamed, but judges a change of its dates', async () => {
      const { respond, shown } = await reopenWith([arc('top', 0, null), arc('out', 1, 'top', { start_time: '1700-01-01T00:00:00.000Z', end_time: '1950-01-01T00:00:00.000Z' })])
      expect(shown.out).toEqual([1, 'top'])
      expect((await respond(request('put', '/arcs/out', { name: 'renamed' }))).status).toBe(200)
      await expect(respond(request('put', '/arcs/out', { end_time: '1960-01-01T00:00:00.000Z' }))).rejects.toMatchObject({ response: { status: 400 } })
    })
  })

  describe('a span edit is judged as the server judges it', () => {
    const refused = (promise: Promise<unknown>) => expect(promise).rejects.toMatchObject({ response: { status: 400 } })
    async function family() {
      const { respond } = await load()
      const make = async (body: Record<string, unknown>) => (await respond(request('post', '/arcs', { start_time: '1800-01-01T00:00:00Z', end_time: '1900-01-01T00:00:00Z', ...body }))).data.data as { id: string }
      const parent = await make({ name: 'Parent' })
      const child = await make({ name: 'Child', parent_arc_id: parent.id, start_time: '1820-01-01T00:00:00Z', end_time: '1880-01-01T00:00:00Z' })
      return { respond, parent, child }
    }

    it('refuses a parent that shrinks past its children, on either end', async () => {
      const { respond, parent } = await family()
      await refused(respond(request('put', `/arcs/${parent.id}`, { end_time: '1850-01-01T00:00:00Z' })))
      await refused(respond(request('put', `/arcs/${parent.id}`, { start_time: '1850-01-01T00:00:00Z' })))
      expect((await respond(request('put', `/arcs/${parent.id}`, { start_time: '1810-01-01T00:00:00Z', end_time: '1890-01-01T00:00:00Z' }))).status).toBe(200)
    })

    it('refuses a child moved past its parent on either end', async () => {
      const { respond, child } = await family()
      await refused(respond(request('put', `/arcs/${child.id}`, { end_time: '1950-01-01T00:00:00Z' })))
      await refused(respond(request('put', `/arcs/${child.id}`, { start_time: '1700-01-01T00:00:00Z' })))
    })

    it('treats the same moment written another way as no change', async () => {
      const { respond, parent, child } = await family()
      // "…:00Z" and "….000Z" are one moment: neither is a span change (a child re-saved as the panel does).
      expect((await respond(request('put', `/arcs/${child.id}`, { start_time: '1820-01-01T00:00:00.000Z', end_time: '1880-01-01T00:00:00.000Z' }))).status).toBe(200)
      expect((await respond(request('put', `/arcs/${parent.id}`, { name: 'P', start_time: '1800-01-01T00:00:00.000Z', end_time: '1900-01-01T00:00:00.000Z' }))).status).toBe(200)
    })

    it('does not let level 0 hide naming a new parent', async () => {
      const { respond, child } = await family()
      const other = (await respond(request('post', '/arcs', { name: 'Other', start_time: '1800-01-01T00:00:00Z', end_time: '1900-01-01T00:00:00Z' }))).data.data as { id: string }
      await refused(respond(request('put', `/arcs/${child.id}`, { level: 0, parent_arc_id: other.id })))
    })
  })

  it('keeps the calendar on a branch of the world', async () => {
    const { respond } = await load()
    const made = await respond(request('post', '/graphs/graph_vael/branch', { name: 'The Last King Lives' }))
    expect(made.status).toBe(201)
    const branch = made.data.data as { id: string; parentGraphId: string; calendar?: unknown; metadata: { eventCount: number } }
    expect(branch).toMatchObject({ parentGraphId: 'graph_vael', calendar: { version: 2, primary: 'reckoning', calendars: [{ name: 'the Reckoning of the Rising' }, { name: 'the Tide-count' }] } })
    expect(branch.metadata.eventCount).toBe(9)

    // And it lasts: from the list, as the active graph, and after a reload.
    const reloaded = await load()
    await reloaded.respond(request('post', `/graphs/${branch.id}/activate`, {}))
    const active = await reloaded.respond(request('get', '/graphs/active'))
    expect(active.data.data).toMatchObject({ id: branch.id, calendar: { version: 2, primary: 'reckoning' } })
    const byId = await reloaded.respond(request('get', `/graphs/${branch.id}`))
    const world = await reloaded.respond(request('get', '/graphs/graph_vael'))
    expect(byId.data.data.calendar).toEqual(world.data.data.calendar)
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
