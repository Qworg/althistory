import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { apiClient } from '@/services/api'
import { CLIENT_ID } from '@/services/clientIdentity'
import { resetLiveChangesStore, useLiveChangesStore } from '@/stores/liveChangesStore'
import { useLiveChanges } from './useLiveChanges'

/** A browser WebSocket the test can speak for the server through. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  readyState = 1
  sent: Array<Record<string, unknown>> = []
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }

  close(): void {
    this.readyState = 3
  }

  say(message: Record<string, unknown>): void {
    act(() => {
      this.onmessage?.({ data: JSON.stringify(message) })
    })
  }

  drop(): void {
    this.readyState = 3
    act(() => {
      this.onclose?.()
    })
  }
}

const latest = (): FakeWebSocket => {
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  if (!socket) throw new Error('no socket was opened')
  return socket
}

function change(seq: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'change',
    kind: 'entities',
    graphId: 'g1',
    seq,
    at: '2026-05-01T00:00:00Z',
    actor: { kind: 'agent', name: 'Claude' },
    operation: 'create',
    entities: [{ type: 'event', id: `e${seq}` }],
    summary: 'x',
    ...overrides,
  }
}

describe('useLiveChanges', () => {
  const originalWebSocket = globalThis.WebSocket
  let queryClient: QueryClient

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  /** Open the socket and have the server accept it and confirm both subscriptions. */
  async function live(): Promise<FakeWebSocket> {
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
    const socket = latest()
    socket.say({ type: 'auth_result', success: true, mode: 'feed' })
    socket.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 0, replayed: 0 })
    socket.say({ type: 'subscribed', graphId: '*', epoch: 'E1', seq: 0, replayed: 0 })
    return socket
  }

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('active_graph_id', 'g1')
    resetLiveChangesStore()
    FakeWebSocket.instances = []
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } })
    vi.spyOn(apiClient.stream, 'getToken').mockResolvedValue({
      token: 'feed-token',
      expiresIn: 300,
      graphId: 'g1',
      permissions: [],
      mode: 'feed',
      concurrentStreams: 5,
    })
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
    vi.restoreAllMocks()
    resetLiveChangesStore()
  })

  it('is on by default: it asks for a feed token for the open graph and watches it', async () => {
    renderHook(() => useLiveChanges(), { wrapper })
    const socket = await live()
    expect(apiClient.stream.getToken).toHaveBeenCalledWith('g1', 'feed')
    expect(socket.url).toContain('/api/ws/stream?token=feed-token')
    expect(socket.sent).toEqual([
      { type: 'subscribe', graphId: 'g1' },
      { type: 'subscribe', graphId: '*' },
    ])
    expect(useLiveChangesStore.getState().status).toBe('live')
  })

  it('does not connect when the person turned it off', async () => {
    localStorage.setItem('althistory.liveSync', 'off')
    resetLiveChangesStore()
    renderHook(() => useLiveChanges(), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(FakeWebSocket.instances).toEqual([])
    expect(useLiveChangesStore.getState().status).toBe('off')
  })

  it('connects when it is turned on, and closes when it is turned off', async () => {
    localStorage.setItem('althistory.liveSync', 'off')
    resetLiveChangesStore()
    renderHook(() => useLiveChanges(), { wrapper })
    act(() => useLiveChangesStore.getState().setEnabled(true))
    const socket = await live()
    act(() => useLiveChangesStore.getState().setEnabled(false))
    expect(socket.readyState).toBe(3)
    expect(useLiveChangesStore.getState().status).toBe('off')
  })

  it("refetches the timeline's queries when another writer changes the graph, without a reload", async () => {
    const events = vi.fn().mockResolvedValue([{ id: 'e0' }])
    const arcs = vi.fn().mockResolvedValue([])
    function Probe() {
      useLiveChanges()
      useQuery({ queryKey: ['events', undefined], queryFn: events })
      useQuery({ queryKey: ['arcs', undefined], queryFn: arcs })
      return null
    }
    render(<Probe />, { wrapper })
    await waitFor(() => expect(events).toHaveBeenCalledTimes(1))
    const socket = await live()
    // Watching begins with one read of the graph, for what landed while the
    // socket was being opened (see the next test).
    await waitFor(() => expect(events).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(arcs).toHaveBeenCalledTimes(2))

    // Fresh for five minutes: nothing refetches on its own.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(events).toHaveBeenCalledTimes(2)

    socket.say(change(1))
    await waitFor(() => expect(events).toHaveBeenCalledTimes(3))
    // An event is not an arc: arcs are left alone.
    expect(arcs).toHaveBeenCalledTimes(2)
  })

  it('reads the graph again once watching begins, so a commit made while the socket opened is not missed', async () => {
    const events = vi.fn().mockResolvedValueOnce([{ id: 'e0' }]).mockResolvedValue([{ id: 'e0' }, { id: 'landed-meanwhile' }])
    let seen: unknown
    function Probe() {
      useLiveChanges()
      const query = useQuery({ queryKey: ['events', undefined], queryFn: events })
      seen = query.data
      return null
    }
    render(<Probe />, { wrapper })
    await waitFor(() => expect(events).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(seen).toEqual([{ id: 'e0' }]))
    await live()
    await waitFor(() => expect(seen).toEqual([{ id: 'e0' }, { id: 'landed-meanwhile' }]))
  })

  it('highlights what arrived and says who changed what', async () => {
    renderHook(() => useLiveChanges(), { wrapper })
    const socket = await live()
    socket.say(change(1, { entities: [{ type: 'event', id: 'e1' }, { type: 'event', id: 'e2' }] }))
    await waitFor(() => expect(useLiveChangesStore.getState().notices).toHaveLength(1))
    const state = useLiveChangesStore.getState()
    expect(Object.keys(state.fresh.event).sort()).toEqual(['e1', 'e2'])
    expect(state.notices[0]?.message).toBe('An agent (Claude) added 2 events to this graph')
  })

  it("does not announce or highlight the tab's own edits, but still refetches for them", async () => {
    const events = vi.fn().mockResolvedValue([])
    function Probe() {
      useLiveChanges()
      useQuery({ queryKey: ['events', undefined], queryFn: events })
      return null
    }
    render(<Probe />, { wrapper })
    await waitFor(() => expect(events).toHaveBeenCalledTimes(1))
    const socket = await live()
    await waitFor(() => expect(events).toHaveBeenCalledTimes(2))
    socket.say(change(1, { origin: CLIENT_ID }))
    // The tag is one any writer can send, so it cannot suppress the refetch.
    await waitFor(() => expect(events).toHaveBeenCalledTimes(3), { timeout: 3000 })
    expect(useLiveChangesStore.getState().notices).toEqual([])
    expect(useLiveChangesStore.getState().fresh.event).toEqual({})
  })

  it('catches up after a dropped connection: replayed changes apply, and a gap refetches', async () => {
    const events = vi.fn().mockResolvedValue([])
    function Probe() {
      useLiveChanges()
      useQuery({ queryKey: ['events', undefined], queryFn: events })
      return null
    }
    render(<Probe />, { wrapper })
    await waitFor(() => expect(events).toHaveBeenCalledTimes(1))
    const first = await live()
    await waitFor(() => expect(events).toHaveBeenCalledTimes(2))
    first.say(change(5))
    await waitFor(() => expect(events).toHaveBeenCalledTimes(3))
    first.drop()
    expect(useLiveChangesStore.getState().status).toBe('reconnecting')

    // A new token, a new socket, and the position is sent along.
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2), { timeout: 3000 })
    const second = latest()
    second.say({ type: 'auth_result', success: true })
    expect(second.sent[0]).toEqual({ type: 'subscribe', graphId: 'g1', epoch: 'E1', since: 5 })
    second.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 8, replayed: 1 })
    second.say(change(8))
    await waitFor(() => expect(events).toHaveBeenCalledTimes(4))

    // The server could not replay: everything for the graph is read again.
    second.drop()
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(3), { timeout: 4000 })
    const third = latest()
    third.say({ type: 'auth_result', success: true })
    third.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 900, replayed: 0, resync: 'gap' })
    await waitFor(() => expect(events).toHaveBeenCalledTimes(5))
  }, 10000)

  it('moves to the graph that is opened, without reconnecting', async () => {
    renderHook(() => useLiveChanges(), { wrapper })
    const socket = await live()
    socket.sent.length = 0
    act(() => {
      localStorage.setItem('active_graph_id', 'g2')
      window.dispatchEvent(new CustomEvent('graph-switched', { detail: { graphId: 'g2' } }))
    })
    await waitFor(() =>
      expect(socket.sent).toEqual([
        { type: 'unsubscribe', graphId: 'g1' },
        { type: 'subscribe', graphId: 'g2' },
      ])
    )
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('shows an error, and does not retry, when the key may not read', async () => {
    vi.spyOn(apiClient.stream, 'getToken').mockRejectedValue(Object.assign(new Error('Missing required permissions: read:events'), { status: 403 }))
    renderHook(() => useLiveChanges(), { wrapper })
    await waitFor(() => expect(useLiveChangesStore.getState().status).toBe('error'))
    expect(useLiveChangesStore.getState().detail).toContain('read:events')
    expect(FakeWebSocket.instances).toEqual([])
  })

  it('closes the socket when the layout goes away', async () => {
    const { unmount } = renderHook(() => useLiveChanges(), { wrapper })
    const socket = await live()
    unmount()
    expect(socket.readyState).toBe(3)
  })
})
