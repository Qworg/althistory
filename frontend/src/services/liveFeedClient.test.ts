import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LiveChange, StreamTokenResponse } from '@/types'
import { LiveFeedClient, type FeedSocket, type LiveFeedStatus } from './liveFeedClient'

class FakeSocket implements FeedSocket {
  static all: FakeSocket[] = []
  readyState = 1
  sent: Array<Record<string, unknown>> = []
  closed = false
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event?: unknown) => void) | null = null
  onerror: ((event?: unknown) => void) | null = null

  constructor(public readonly url: string) {
    FakeSocket.all.push(this)
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }

  close(): void {
    this.closed = true
    this.readyState = 3
  }

  /** What the server says. */
  say(message: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  /** The connection drops. */
  drop(): void {
    this.readyState = 3
    this.onclose?.()
  }
}

function socketAt(index: number): FakeSocket {
  const socket = FakeSocket.all[index]
  if (!socket) throw new Error(`socket ${index} was never opened`)
  return socket
}

const lastSocket = (): FakeSocket => socketAt(FakeSocket.all.length - 1)

const token = (value = 't'): StreamTokenResponse => ({
  token: value,
  expiresIn: 300,
  graphId: 'g1',
  permissions: [],
  mode: 'feed',
  concurrentStreams: 5,
})

function change(graphId: string, seq: number, id = `e${seq}`): LiveChange {
  return {
    kind: 'entities',
    graphId,
    seq,
    at: 'x',
    actor: { kind: 'agent' },
    operation: 'create',
    entities: [{ type: 'event', id }],
    summary: 'x',
  }
}

interface Harness {
  client: LiveFeedClient
  changes: LiveChange[]
  resyncs: Array<[string, string]>
  statuses: LiveFeedStatus[]
  revoked: string[]
  /** Each report: the channel and why (the key lost it, or the graph is gone). */
  reports: Array<[string, string]>
  watching: string[]
  getToken: ReturnType<typeof vi.fn>
}

function harness(overrides: Partial<ConstructorParameters<typeof LiveFeedClient>[0]> = {}): Harness {
  const changes: LiveChange[] = []
  const resyncs: Array<[string, string]> = []
  const statuses: LiveFeedStatus[] = []
  const revoked: string[] = []
  const reports: Array<[string, string]> = []
  const watching: string[] = []
  const getToken = vi.fn(async () => token())
  const client = new LiveFeedClient({
    getToken,
    urlFor: (t) => `ws://test/api/ws/stream?token=${t}`,
    createSocket: (url) => new FakeSocket(url),
    onChange: (c) => changes.push(c),
    onResync: (graphId, reason) => resyncs.push([graphId, reason]),
    onStatus: (status) => statuses.push(status),
    onAccessRevoked: (graphId, reason) => {
      revoked.push(graphId)
      reports.push([graphId, reason])
    },
    onWatching: (graphId) => watching.push(graphId),
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    pingIntervalMs: 60000,
    ...overrides,
  })
  return { client, changes, resyncs, statuses, revoked, reports, watching, getToken }
}

/** Let the token request and the socket creation run. */
async function connected(h: Harness, graph = 'g1'): Promise<FakeSocket> {
  h.client.setGraph(graph)
  h.client.start()
  await vi.advanceTimersByTimeAsync(0)
  const socket = lastSocket()
  socket.say({ type: 'auth_result', success: true, mode: 'feed' })
  return socket
}

describe('LiveFeedClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.all = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('connecting', () => {
    it('asks for a feed token for the graph, opens the socket with it, and watches the graph and the graph list', async () => {
      const h = harness()
      const socket = await connected(h)
      expect(h.getToken).toHaveBeenCalledWith('g1')
      expect(socket.url).toBe('ws://test/api/ws/stream?token=t')
      expect(socket.sent).toEqual([
        { type: 'subscribe', graphId: 'g1' },
        { type: 'subscribe', graphId: '*' },
      ])
      expect(h.statuses).toEqual(['connecting', 'live'])
    })

    it('waits for a graph: nothing to watch, nothing to connect', async () => {
      const h = harness()
      h.client.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(h.getToken).not.toHaveBeenCalled()
      expect(h.client.currentStatus).toBe('off')
      h.client.setGraph('g1')
      await vi.advanceTimersByTimeAsync(0)
      expect(h.getToken).toHaveBeenCalledWith('g1')
    })

    it('does not connect when stopped, and closes the socket when it stops', async () => {
      const h = harness()
      const socket = await connected(h)
      h.client.stop()
      expect(socket.closed).toBe(true)
      expect(h.client.currentStatus).toBe('off')
      await vi.advanceTimersByTimeAsync(60000)
      expect(h.getToken).toHaveBeenCalledTimes(1)
    })

    it('opens one socket when it is stopped and started again while a token is still being fetched', async () => {
      let release!: (value: StreamTokenResponse) => void
      const getToken = vi.fn(
        () =>
          new Promise<StreamTokenResponse>((resolve) => {
            release = resolve
          })
      )
      const h = harness({ getToken })
      h.client.setGraph('g1')
      h.client.start()
      await vi.advanceTimersByTimeAsync(0)
      const firstRelease = release
      h.client.stop()
      h.client.start()
      await vi.advanceTimersByTimeAsync(0)
      // The first request answers late; the second answers too.
      firstRelease(token('late'))
      release(token('current'))
      await vi.advanceTimersByTimeAsync(0)
      expect(FakeSocket.all.map((socket) => socket.url)).toEqual(['ws://test/api/ws/stream?token=current'])
    })

    it('stops and says so when the key may not read: retrying would only repeat it', async () => {
      const getToken = vi.fn(async () => {
        throw Object.assign(new Error('Missing required permissions: read:events'), { status: 403 })
      })
      const h = harness({ getToken })
      h.client.setGraph('g1')
      h.client.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(h.client.currentStatus).toBe('error')
      // The graph's token, then one for the graph list alone; then nothing more.
      expect(getToken.mock.calls).toEqual([['g1'], ['*']])
      // The key reads nothing: no graph was revoked, so none is reported as if it were.
      expect(h.revoked).toEqual([])
      await vi.advanceTimersByTimeAsync(60000)
      expect(getToken).toHaveBeenCalledTimes(2)
      expect(FakeSocket.all).toHaveLength(0)
    })

    it('watches the graph list alone when the open graph cannot mint a token, and says the graph is not watched', async () => {
      const getToken = vi.fn(async (channel: string) => {
        if (channel === 'g1') throw Object.assign(new Error("Access to graph 'g1' is not allowed"), { status: 403 })
        return token('list')
      })
      const h = harness({ getToken })
      h.client.setGraph('g1')
      h.client.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(getToken.mock.calls).toEqual([['g1'], ['*']])
      expect(h.revoked).toEqual(['g1'])
      const socket = lastSocket()
      expect(socket.url).toBe('ws://test/api/ws/stream?token=list')
      socket.say({ type: 'auth_result', success: true, mode: 'feed', graphId: '*' })
      expect(socket.sent).toEqual([{ type: 'subscribe', graphId: '*' }])
      expect(h.client.currentStatus).toBe('revoked')

      // Opening a graph the key may read watches it over the same socket.
      h.client.setGraph('g2')
      expect(socket.sent).toContainEqual({ type: 'subscribe', graphId: 'g2' })
      socket.say({ type: 'subscribed', graphId: 'g2', epoch: 'E1', seq: 1, replayed: 0 })
      expect(h.client.currentStatus).toBe('live')
    })

    it('connects for the graph opened while the last one\'s token was refused', async () => {
      let refuse!: () => void
      const getToken = vi.fn((channel: string) =>
        channel === 'g1'
          ? new Promise<StreamTokenResponse>((_resolve, reject) => {
              refuse = () => reject(Object.assign(new Error('no'), { status: 403 }))
            })
          : Promise.resolve(token(channel))
      )
      const h = harness({ getToken })
      h.client.setGraph('g1')
      h.client.start()
      await vi.advanceTimersByTimeAsync(0)
      h.client.setGraph('g2')
      refuse()
      await vi.advanceTimersByTimeAsync(0)
      expect(getToken.mock.calls).toEqual([['g1'], ['g2']])
      const socket = lastSocket()
      socket.say({ type: 'auth_result', success: true })
      expect(socket.sent).toContainEqual({ type: 'subscribe', graphId: 'g2' })
      expect(h.revoked).toEqual([])
    })

    it('retries a token request that failed for another reason, with a growing delay', async () => {
      let calls = 0
      const getToken = vi.fn(async () => {
        calls += 1
        if (calls < 3) throw new Error('network down')
        return token()
      })
      const h = harness({ getToken })
      h.client.setGraph('g1')
      h.client.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(getToken).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(999)
      expect(getToken).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(getToken).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1999)
      expect(getToken).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(getToken).toHaveBeenCalledTimes(3)
      expect(FakeSocket.all).toHaveLength(1)
    })
  })

  describe('changes', () => {
    it('hands every change to the caller, and remembers the last seq per graph', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 10, replayed: 0 })
      socket.say({ type: 'change', ...change('g1', 11) })
      socket.say({ type: 'change', ...change('g1', 14) })
      expect(h.changes.map((c) => c.seq)).toEqual([11, 14])

      socket.drop()
      await vi.advanceTimersByTimeAsync(1000)
      const next = socketAt(1)
      next.say({ type: 'auth_result', success: true })
      expect(next.sent[0]).toEqual({ type: 'subscribe', graphId: 'g1', epoch: 'E1', since: 14 })
    })

    it('ignores what is not JSON and messages from a socket it has left', async () => {
      const h = harness()
      const first = await connected(h)
      first.onmessage?.({ data: 'not json' })
      first.onmessage?.({ data: 42 })
      first.drop()
      await vi.advanceTimersByTimeAsync(1000)
      first.say({ type: 'change', ...change('g1', 1) })
      expect(h.changes).toEqual([])
    })
  })

  describe('reconnecting', () => {
    it('reopens with a new token, resumes from where it was, and asks for the graph list again', async () => {
      const h = harness()
      const first = await connected(h)
      first.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 5, replayed: 0 })
      first.say({ type: 'subscribed', graphId: '*', epoch: 'E1', seq: 5, replayed: 0 })
      // The graph was read before the socket opened, and nothing is replayed to
      // a first subscription: it is read again. The graph list needs nothing yet.
      expect(h.resyncs).toEqual([['g1', 'subscribe']])
      h.resyncs.length = 0

      first.drop()
      expect(h.client.currentStatus).toBe('reconnecting')
      await vi.advanceTimersByTimeAsync(1000)
      expect(h.getToken).toHaveBeenCalledTimes(2)

      const second = socketAt(1)
      second.say({ type: 'auth_result', success: true })
      expect(second.sent).toEqual([
        { type: 'subscribe', graphId: 'g1', epoch: 'E1', since: 5 },
        // The graph list has no position: it cannot be replayed.
        { type: 'subscribe', graphId: '*' },
      ])
      second.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 9, replayed: 2 })
      second.say({ type: 'change', ...change('g1', 7) })
      second.say({ type: 'change', ...change('g1', 8) })
      second.say({ type: 'subscribed', graphId: '*', epoch: 'E1', seq: 9, replayed: 0 })

      // The missed changes arrived as changes; the graph list is read again.
      expect(h.changes.map((c) => c.seq)).toEqual([7, 8])
      expect(h.resyncs).toEqual([['*', 'reconnect']])
      expect(h.client.currentStatus).toBe('live')
    })

    it('keeps its position behind a replay that was cut off, so the next try asks for the rest', async () => {
      const h = harness()
      const first = await connected(h)
      first.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 5, replayed: 0 })
      first.drop()
      await vi.advanceTimersByTimeAsync(1000)

      const second = socketAt(1)
      second.say({ type: 'auth_result', success: true })
      // Three changes are owed, up to seq 9; one arrives and the socket drops.
      second.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 9, replayed: 3 })
      second.say({ type: 'change', ...change('g1', 7) })
      second.drop()
      await vi.advanceTimersByTimeAsync(2000)

      const third = socketAt(2)
      third.say({ type: 'auth_result', success: true })
      expect(third.sent[0]).toEqual({ type: 'subscribe', graphId: 'g1', epoch: 'E1', since: 7 })
    })

    it('takes the server\'s position once the whole replay is in', async () => {
      const h = harness()
      const first = await connected(h)
      first.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 5, replayed: 0 })
      first.drop()
      await vi.advanceTimersByTimeAsync(1000)
      const second = socketAt(1)
      second.say({ type: 'auth_result', success: true })
      second.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 9, replayed: 2 })
      second.say({ type: 'change', ...change('g1', 7) })
      second.say({ type: 'change', ...change('g1', 8) })
      // Nothing was committed for this graph after 8 that the feed counted for it, but the
      // server's position is 9: the next resume starts there.
      second.drop()
      await vi.advanceTimersByTimeAsync(2000)
      const third = socketAt(2)
      third.say({ type: 'auth_result', success: true })
      expect(third.sent[0]).toEqual({ type: 'subscribe', graphId: 'g1', epoch: 'E1', since: 9 })
    })

    it('refetches when the server cannot replay: too much happened, or it restarted', async () => {
      const h = harness()
      const first = await connected(h)
      first.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 5, replayed: 0 })
      h.resyncs.length = 0
      first.drop()
      await vi.advanceTimersByTimeAsync(1000)
      const second = socketAt(1)
      second.say({ type: 'auth_result', success: true })
      second.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 900, replayed: 0, resync: 'gap' })
      expect(h.resyncs).toEqual([['g1', 'gap']])

      second.drop()
      await vi.advanceTimersByTimeAsync(1000)
      const third = socketAt(2)
      third.say({ type: 'auth_result', success: true })
      third.say({ type: 'subscribed', graphId: 'g1', epoch: 'E2', seq: 3, replayed: 0, resync: 'epoch' })
      expect(h.resyncs).toContainEqual(['g1', 'epoch'])
      // A new process counts from its own start: the old positions are forgotten.
      third.drop()
      await vi.advanceTimersByTimeAsync(1000)
      const fourth = socketAt(3)
      fourth.say({ type: 'auth_result', success: true })
      expect(fourth.sent[0]).toEqual({ type: 'subscribe', graphId: 'g1', epoch: 'E2', since: 3 })
    })

    it('doubles its delay up to a limit, and starts again once connected', async () => {
      const h = harness()
      const first = await connected(h)
      first.drop()
      for (const delay of [1000, 2000, 4000, 8000, 8000]) {
        const before = h.getToken.mock.calls.length
        await vi.advanceTimersByTimeAsync(delay - 1)
        expect(h.getToken.mock.calls.length).toBe(before)
        await vi.advanceTimersByTimeAsync(1)
        expect(h.getToken.mock.calls.length).toBe(before + 1)
        // The socket opens and drops before it is ever accepted.
        lastSocket().drop()
      }
      await vi.advanceTimersByTimeAsync(8000)
      lastSocket().say({ type: 'auth_result', success: true })
      lastSocket().drop()
      const before = h.getToken.mock.calls.length
      await vi.advanceTimersByTimeAsync(1000)
      expect(h.getToken.mock.calls.length).toBe(before + 1)
    })

    it('does not reconnect after the server says the key may not watch', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.say({ type: 'error', code: 'KEY_INVALID', message: 'The API key is revoked' })
      expect(h.client.currentStatus).toBe('error')
      await vi.advanceTimersByTimeAsync(60000)
      expect(h.getToken).toHaveBeenCalledTimes(1)
    })

    it('does not end the feed for a refusal about a graph the tab has left', async () => {
      const h = harness()
      const socket = await connected(h)
      h.client.setGraph('g2')
      h.client.setGraph('g3')
      socket.say({ type: 'error', code: 'GRAPH_NOT_FOUND', message: 'gone', graphId: 'g2' })
      expect(h.client.currentStatus).toBe('live')
      expect(socket.closed).toBe(false)
    })

    it('keeps the graph subscription when only the graph list is refused', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.say({ type: 'error', code: 'PERMISSION_DENIED', message: 'no', graphId: '*' })
      expect(h.client.currentStatus).toBe('live')
      expect(socket.closed).toBe(false)
      // The graph refused too, nothing is left to watch: the feed stops, and says so.
      socket.say({ type: 'error', code: 'GRAPH_ACCESS_DENIED', message: 'no', graphId: 'g1' })
      expect(h.client.currentStatus).toBe('error')
      expect(h.revoked).toEqual(['g1'])
      expect(socket.closed).toBe(true)
    })

    it('keeps the list when only the open graph is refused, and ends the feed for a refusal of the key', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.say({ type: 'subscribed', graphId: '*', epoch: 'E1', seq: 1, replayed: 0 })
      socket.say({ type: 'error', code: 'GRAPH_ACCESS_DENIED', message: 'no', graphId: 'g1' })
      expect(h.client.currentStatus).toBe('revoked')
      expect(h.revoked).toEqual(['g1'])
      expect(socket.closed).toBe(false)
      socket.say({ type: 'error', code: 'PERMISSION_DENIED', message: 'no', graphId: 'g1' })
      expect(h.client.currentStatus).toBe('error')
      expect(socket.closed).toBe(true)
    })

    it('reconnects when the server ends an expired session', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.say({ type: 'error', code: 'SESSION_EXPIRED', message: 'expired' })
      socket.drop()
      await vi.advanceTimersByTimeAsync(1000)
      expect(h.getToken).toHaveBeenCalledTimes(2)
    })

    it('can be nudged to reconnect at once, when the tab comes back', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.drop()
      h.client.nudge()
      await vi.advanceTimersByTimeAsync(0)
      expect(h.getToken).toHaveBeenCalledTimes(2)
      // A live connection is left alone.
      const live = socketAt(1)
      live.say({ type: 'auth_result', success: true })
      h.client.nudge()
      await vi.advanceTimersByTimeAsync(0)
      expect(h.getToken).toHaveBeenCalledTimes(2)
    })
  })

  describe('which graph', () => {
    it('moves the subscription to the graph that is opened, over the same socket', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.sent.length = 0
      h.client.setGraph('g2')
      expect(socket.sent).toEqual([
        { type: 'unsubscribe', graphId: 'g1' },
        { type: 'subscribe', graphId: 'g2' },
      ])
      expect(h.getToken).toHaveBeenCalledTimes(1)
    })

    it('reads a graph again when it is first watched, at the start and on switching to it', async () => {
      const h = harness()
      const socket = await connected(h)
      // The server replays nothing to a subscription that names no position, so
      // what was committed between the view's reads and this registration would
      // otherwise reach no one.
      socket.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 0, replayed: 0 })
      expect(h.resyncs).toEqual([['g1', 'subscribe']])

      h.client.setGraph('g2')
      socket.say({ type: 'subscribed', graphId: 'g2', epoch: 'E1', seq: 4, replayed: 0 })
      expect(h.resyncs).toEqual([
        ['g1', 'subscribe'],
        ['g2', 'subscribe'],
      ])
    })

    it('does not read a graph again for a subscription the server replayed', async () => {
      const h = harness()
      const first = await connected(h)
      first.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 5, replayed: 0 })
      h.resyncs.length = 0
      first.drop()
      await vi.advanceTimersByTimeAsync(1000)
      const second = socketAt(1)
      second.say({ type: 'auth_result', success: true })
      second.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 6, replayed: 1 })
      expect(h.resyncs).toEqual([])
    })

    it('tells the caller when the server stops sending a graph', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.say({ type: 'unsubscribed', graphId: 'g1', reason: 'access_revoked' })
      expect(h.revoked).toEqual(['g1'])
      socket.say({ type: 'unsubscribed', graphId: 'g1', reason: 'requested' })
      expect(h.revoked).toEqual(['g1'])
    })
  })

  describe('access revoked', () => {
    it('reports a refused graph only once a token for the graph list is granted', async () => {
      let grant!: (value: StreamTokenResponse) => void
      const getToken = vi.fn((channel: string) =>
        channel === 'g1'
          ? Promise.reject(Object.assign(new Error('no'), { status: 403 }))
          : new Promise<StreamTokenResponse>((resolve) => (grant = resolve))
      )
      const h = harness({ getToken })
      h.client.setGraph('g1')
      h.client.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(getToken.mock.calls).toEqual([['g1'], ['*']])
      expect(h.revoked).toEqual([])
      grant(token('list'))
      await vi.advanceTimersByTimeAsync(0)
      expect(h.reports).toEqual([['g1', 'access']])
    })

    it('says a graph that is gone is gone, not that the key lost it', async () => {
      const getToken = vi.fn(async (channel: string) => {
        if (channel === 'g1') throw Object.assign(new Error("Graph 'g1' not found"), { status: 404 })
        return token('list')
      })
      const h = harness({ getToken })
      h.client.setGraph('g1')
      h.client.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(h.reports).toEqual([['g1', 'missing']])

      const other = harness()
      const socket = await connected(other, 'g2')
      socket.say({ type: 'error', code: 'GRAPH_NOT_FOUND', message: "Graph 'g2' not found", graphId: 'g2' })
      expect(other.reports).toEqual([['g2', 'missing']])
      expect(other.client.currentStatus).toBe('revoked')
    })

    it('says live, with no graph open, only once the list-only socket has authenticated', async () => {
      const getToken = vi.fn(async (channel: string) => {
        if (channel === 'g1') throw Object.assign(new Error('no'), { status: 403 })
        return token('list')
      })
      const h = harness({ getToken })
      h.client.setGraph('g1')
      h.client.start()
      await vi.advanceTimersByTimeAsync(0)
      const socket = lastSocket()
      // The socket is open; the server has not answered yet.
      h.client.setGraph(null)
      expect(h.client.currentStatus).not.toBe('live')
      socket.say({ type: 'auth_result', success: true, mode: 'feed' })
      expect(h.client.currentStatus).toBe('live')
      expect(socket.sent.filter((message) => message.type === 'subscribe')).toEqual([{ type: 'subscribe', graphId: '*' }])
    })

    it('stops, saying so, when the graph list is refused on a socket that watches nothing else', async () => {
      const getToken = vi.fn(async (channel: string) => {
        if (channel === 'g1') throw Object.assign(new Error('no'), { status: 403 })
        return token('list')
      })
      const h = harness({ getToken })
      h.client.setGraph('g1')
      h.client.start()
      await vi.advanceTimersByTimeAsync(0)
      const socket = lastSocket()
      socket.say({ type: 'auth_result', success: true, mode: 'feed' })
      expect(h.client.currentStatus).toBe('revoked')
      socket.say({ type: 'error', code: 'PERMISSION_DENIED', message: "The API key no longer has the 'read:graphs' permission", graphId: '*' })
      expect(h.client.currentStatus).toBe('error')
      expect(socket.closed).toBe(true)
      await vi.advanceTimersByTimeAsync(60000)
      expect(FakeSocket.all).toHaveLength(1)
    })

    it('stops when the graph list is revoked on a socket whose graph already was', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 1, replayed: 0 })
      socket.say({ type: 'subscribed', graphId: '*', epoch: 'E1', seq: 1, replayed: 0 })
      socket.say({ type: 'unsubscribed', graphId: 'g1', reason: 'access_revoked' })
      expect(h.client.currentStatus).toBe('revoked')
      socket.say({ type: 'unsubscribed', graphId: '*', reason: 'access_revoked' })
      expect(h.client.currentStatus).toBe('error')
      expect(socket.closed).toBe(true)
    })

    it('never says live in between when a graph waiting on a retry is then refused', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.say({ type: 'subscribed', graphId: '*', epoch: 'E1', seq: 1, replayed: 0 })
      socket.say({ type: 'error', code: 'RATE_LIMITED', message: 'slow down', graphId: 'g1', retryAfter: 5 })
      expect(h.client.currentStatus).toBe('reconnecting')
      h.statuses.length = 0
      socket.say({ type: 'error', code: 'GRAPH_ACCESS_DENIED', message: 'no', graphId: 'g1' })
      expect(h.statuses).toEqual(['revoked'])
    })

    it('tells the caller when the open graph is watched again', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 1, replayed: 0 })
      socket.say({ type: 'subscribed', graphId: '*', epoch: 'E1', seq: 1, replayed: 0 })
      expect(h.watching).toEqual(['g1', '*'])
    })

    it('stops saying live when the open graph is revoked, and says live again for a graph that is watched', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 1, replayed: 0 })
      expect(h.client.currentStatus).toBe('live')
      socket.say({ type: 'unsubscribed', graphId: 'g1', reason: 'access_revoked' })
      expect(h.client.currentStatus).toBe('revoked')
      h.client.setGraph('g2')
      socket.say({ type: 'subscribed', graphId: 'g2', epoch: 'E1', seq: 1, replayed: 0 })
      expect(h.client.currentStatus).toBe('live')
    })

    it('reconnects to the graph list alone when the socket closes after the open graph was revoked', async () => {
      // The server refuses a token for the revoked graph, as it does: a token
      // for the list alone is the only one it will mint.
      const getToken = vi.fn(async (channel: string) => {
        if (channel === 'g1' && FakeSocket.all.length > 0) {
          throw Object.assign(new Error("Access to graph 'g1' is not allowed"), { status: 403 })
        }
        return token(channel === '*' ? 'list' : 't')
      })
      const h = harness({ getToken })
      const socket = await connected(h)
      socket.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 1, replayed: 0 })
      socket.say({ type: 'subscribed', graphId: '*', epoch: 'E1', seq: 1, replayed: 0 })
      socket.say({ type: 'unsubscribed', graphId: 'g1', reason: 'access_revoked' })
      expect(h.client.currentStatus).toBe('revoked')
      socket.drop()
      expect(h.client.currentStatus).toBe('reconnecting')
      await vi.advanceTimersByTimeAsync(1000)
      expect(getToken.mock.calls).toEqual([['g1'], ['*']])
      const second = socketAt(1)
      expect(second.url).toBe('ws://test/api/ws/stream?token=list')
      second.say({ type: 'auth_result', success: true, graphId: '*' })
      expect(second.sent).toEqual([{ type: 'subscribe', graphId: '*' }])
      second.say({ type: 'subscribed', graphId: '*', epoch: 'E1', seq: 2, replayed: 0 })
      expect(h.resyncs).toContainEqual(['*', 'reconnect'])
      expect(h.client.currentStatus).toBe('revoked')
      // It settles there: no further tries.
      await vi.advanceTimersByTimeAsync(60000)
      expect(getToken).toHaveBeenCalledTimes(2)
    })

    it('keeps saying live when only the graph list is revoked', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 1, replayed: 0 })
      socket.say({ type: 'unsubscribed', graphId: '*', reason: 'access_revoked' })
      expect(h.revoked).toEqual(['*'])
      expect(h.client.currentStatus).toBe('live')
    })
  })

  describe('a subscribe the server refuses', () => {
    it('says the feed is not whole, asks again after the delay the server named, and is live once it is confirmed', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.say({ type: 'subscribed', graphId: '*', epoch: 'E1', seq: 0, replayed: 0 })
      socket.sent.length = 0
      socket.say({ type: 'error', code: 'RATE_LIMITED', message: 'Rate limit exceeded: 60/minute', graphId: 'g1', retryAfter: 20 })
      expect(h.client.currentStatus).toBe('reconnecting')
      await vi.advanceTimersByTimeAsync(19000)
      expect(socket.sent).toEqual([])
      await vi.advanceTimersByTimeAsync(1000)
      expect(socket.sent).toEqual([{ type: 'subscribe', graphId: 'g1' }])
      socket.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 3, replayed: 0 })
      expect(h.client.currentStatus).toBe('live')
      // The graph was never watched, so it is read once it is.
      expect(h.resyncs).toContainEqual(['g1', 'subscribe'])
    })

    it('backs off further when it is refused again, and retries a full subscription table too', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.sent.length = 0
      socket.say({ type: 'error', code: 'SUBSCRIPTION_LIMIT', message: 'too many', graphId: 'g1' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(socket.sent).toHaveLength(1)
      socket.say({ type: 'error', code: 'SUBSCRIPTION_LIMIT', message: 'too many', graphId: 'g1' })
      await vi.advanceTimersByTimeAsync(1999)
      expect(socket.sent).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(socket.sent).toHaveLength(2)
      expect(h.client.currentStatus).toBe('reconnecting')
    })

    it('stops retrying a graph the tab moved away from, and ignores a refusal it cannot place', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.say({ type: 'error', code: 'RATE_LIMITED', message: 'x', graphId: 'g1', retryAfter: 5 })
      h.client.setGraph('g2')
      socket.sent.length = 0
      await vi.advanceTimersByTimeAsync(60000)
      expect(socket.sent.filter((m) => m.type === 'subscribe')).toEqual([])
      expect(h.client.currentStatus).toBe('live')
      // An error that names no channel (or one not wanted) changes nothing.
      socket.say({ type: 'error', code: 'RATE_LIMITED', message: 'x' })
      socket.say({ type: 'error', code: 'RATE_LIMITED', message: 'x', graphId: 'g1' })
      expect(h.client.currentStatus).toBe('live')
    })

    it('drops a pending retry when the socket goes, and the new socket subscribes afresh', async () => {
      const h = harness()
      const first = await connected(h)
      first.say({ type: 'error', code: 'RATE_LIMITED', message: 'x', graphId: 'g1', retryAfter: 30 })
      first.drop()
      await vi.advanceTimersByTimeAsync(1000)
      const second = socketAt(1)
      second.say({ type: 'auth_result', success: true })
      second.sent.length = 0
      await vi.advanceTimersByTimeAsync(60000)
      expect(second.sent.filter((m) => m.type === 'subscribe')).toEqual([])
      expect(h.client.currentStatus).toBe('live')
    })
  })

  describe('resume positions', () => {
    it('does not keep a position for a graph it only hears of on the graph list', async () => {
      const h = harness()
      const socket = await connected(h)
      socket.say({ type: 'subscribed', graphId: 'g1', epoch: 'E1', seq: 0, replayed: 0 })
      socket.say({ type: 'subscribed', graphId: '*', epoch: 'E1', seq: 0, replayed: 0 })
      // Graph y is made by someone else; the record arrives on '*'.
      socket.say({ ...change('y', 40), kind: 'graph', operation: 'create' })
      h.client.setGraph('y')
      expect(socket.sent.filter((m) => m.graphId === 'y')).toEqual([{ type: 'subscribe', graphId: 'y' }])
    })
  })

  describe('keeping the session alive', () => {
    it('pings on an interval, and stops pinging when the socket goes', async () => {
      const h = harness({ pingIntervalMs: 1000 })
      const socket = await connected(h)
      socket.sent.length = 0
      await vi.advanceTimersByTimeAsync(3000)
      expect(socket.sent).toEqual([{ type: 'ping' }, { type: 'ping' }, { type: 'ping' }])
      socket.drop()
      socket.sent.length = 0
      await vi.advanceTimersByTimeAsync(3000)
      expect(socket.sent).toEqual([])
    })
  })
})
