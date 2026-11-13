/**
 * The browser's end of the live change feed.
 *
 * One socket to `/api/ws/stream`, opened with a read-only (`feed`) token, over
 * which the server pushes every committed change to the graphs this client
 * watches, whoever made it. This class owns the connection and nothing else:
 * what a change does to the screen is the caller's (`onChange`).
 *
 * What it keeps right:
 *
 *   - It watches the active graph and the graph list (`*`), and moves the
 *     first when the active graph changes, over the same socket.
 *   - It remembers, per channel, the last change it saw and the server epoch it
 *     saw it from. After a drop it reconnects (a new token each time: a token
 *     is single-use), resubscribes with that position, and the server replays
 *     what was missed, or says to refetch (`onResync`). The graph list cannot
 *     be replayed, so it is always refetched after a reconnect.
 *   - It reconnects with a growing delay, and stops (status `error`) for a
 *     refusal that retrying cannot fix: a key that cannot read, or may not
 *     access the graph.
 *   - It pings, so the server's idle timeout does not end a quiet session.
 */

import type { LiveChange, ServerStreamMessage, StreamTokenResponse, StreamErrorCode } from '@/types'

export type LiveFeedStatus = 'off' | 'connecting' | 'live' | 'reconnecting' | 'error'

/** The part of a browser `WebSocket` the client uses; a test supplies its own. */
export interface FeedSocket {
  readyState: number
  send(data: string): void
  close(): void
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event?: unknown) => void) | null
  onerror: ((event?: unknown) => void) | null
}

export interface LiveFeedClientOptions {
  /** Mints a feed token for the graph the socket is bound to. */
  getToken(graphId: string): Promise<StreamTokenResponse>
  /** The socket URL for a token. */
  urlFor(token: string): string
  createSocket?(url: string): FeedSocket
  onChange(change: LiveChange): void
  /** What the client holds for `graphId` (or `*`, the graph list) may be stale: refetch it. */
  onResync(graphId: string, reason: 'gap' | 'epoch' | 'reconnect'): void
  onStatus(status: LiveFeedStatus, detail?: string): void
  /** The key may no longer read `graphId`; the server stopped sending it. */
  onAccessRevoked?(graphId: string): void
  /** First reconnect delay; it doubles up to `maxDelayMs`. Defaults to 1s. */
  baseDelayMs?: number
  maxDelayMs?: number
  /** Milliseconds between pings. Defaults to 60s (the server's idle timeout is 5 minutes). */
  pingIntervalMs?: number
}

/** The channel for changes to the graph list. */
export const GRAPH_LIST_CHANNEL = '*'

const OPEN = 1

/** Codes that retrying cannot cure: the key is not allowed, or the graph is not there. */
const FATAL_CODES: ReadonlySet<StreamErrorCode> = new Set([
  'KEY_INVALID',
  'PERMISSION_DENIED',
  'GRAPH_ACCESS_DENIED',
  'GRAPH_NOT_FOUND',
])

export class LiveFeedClient {
  private readonly options: LiveFeedClientOptions
  private socket: FeedSocket | undefined
  private status: LiveFeedStatus = 'off'
  private graphId: string | null = null
  private running = false
  /** Counts starts, so a connection attempt that began before a stop and restart knows it is stale. */
  private run = 0
  /** A connection attempt (token request or handshake) is under way. */
  private connecting = false
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private pingTimer: ReturnType<typeof setInterval> | undefined
  /** The server process the positions below come from. */
  private epoch: string | undefined
  /** The last `seq` seen per channel. */
  private readonly cursors = new Map<string, number>()
  /** Channels the server has confirmed on the current socket. */
  private readonly confirmed = new Set<string>()
  /** Whether a socket has ever been live, so a later one knows it is resuming. */
  private hasBeenLive = false
  /** Whether the current socket resumes an earlier one. */
  private resumed = false

  constructor(options: LiveFeedClientOptions) {
    this.options = options
  }

  get currentStatus(): LiveFeedStatus {
    return this.status
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.run += 1
    this.attempt = 0
    this.connectIfPossible()
  }

  stop(): void {
    this.running = false
    this.clearTimers()
    const socket = this.socket
    this.socket = undefined
    this.confirmed.clear()
    this.connecting = false
    if (socket) {
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      try {
        socket.close()
      } catch {
        // Already gone.
      }
    }
    this.setStatus('off')
  }

  /** Watch this graph (and stop watching the last). Null watches only the graph list. */
  setGraph(graphId: string | null): void {
    if (graphId === this.graphId) return
    const previous = this.graphId
    this.graphId = graphId
    if (!this.running) return
    if (this.socket && this.socket.readyState === OPEN) {
      if (previous) this.unsubscribe(previous)
      if (graphId) this.subscribe(graphId)
    } else if (!this.socket && !this.connecting) {
      // Nothing was connectable until there was a graph, or the last try was refused.
      this.attempt = 0
      this.connectIfPossible()
    }
  }

  /** Reconnect now if the socket is down (the tab came back to the front). */
  nudge(): void {
    if (!this.running || this.socket || this.connecting) return
    this.attempt = 0
    this.clearReconnect()
    this.connectIfPossible()
  }

  // --- Connecting ------------------------------------------------------------

  private connectIfPossible(): void {
    if (!this.running || this.connecting || this.socket) return
    const graphId = this.graphId
    if (!graphId) {
      this.setStatus('off')
      return
    }
    void this.connect(graphId)
  }

  private async connect(graphId: string): Promise<void> {
    this.connecting = true
    const run = this.run
    // Stopped, or stopped and started again, while a token was being fetched.
    const stale = (): boolean => !this.running || run !== this.run
    this.setStatus(this.hasBeenLive || this.attempt > 0 ? 'reconnecting' : 'connecting')
    let token: StreamTokenResponse
    try {
      token = await this.options.getToken(graphId)
    } catch (error) {
      if (stale()) return
      this.connecting = false
      const status = (error as { status?: number }).status
      if (status === 401 || status === 403 || status === 404 || status === 400) {
        // The key is missing, refused, or cannot read this graph: retrying only repeats it.
        this.setStatus('error', error instanceof Error ? error.message : 'The live feed was refused')
        return
      }
      this.scheduleReconnect(error instanceof Error ? error.message : undefined)
      return
    }
    if (stale()) return

    let socket: FeedSocket
    try {
      socket = (this.options.createSocket ?? ((url) => new WebSocket(url) as unknown as FeedSocket))(
        this.options.urlFor(token.token)
      )
    } catch (error) {
      this.connecting = false
      this.scheduleReconnect(error instanceof Error ? error.message : undefined)
      return
    }
    this.socket = socket
    socket.onmessage = (event) => this.onMessage(socket, event.data)
    socket.onerror = () => {
      // `close` follows; it decides what happens next.
    }
    socket.onclose = () => this.onClosed(socket)
  }

  private onClosed(socket: FeedSocket): void {
    if (this.socket !== socket) return
    this.socket = undefined
    this.connecting = false
    this.confirmed.clear()
    this.clearPing()
    if (!this.running) return
    if (this.status === 'error') return
    this.scheduleReconnect()
  }

  private scheduleReconnect(detail?: string): void {
    if (!this.running) return
    const base = this.options.baseDelayMs ?? 1000
    const max = this.options.maxDelayMs ?? 30000
    const delay = Math.min(max, base * 2 ** this.attempt)
    this.attempt += 1
    this.setStatus('reconnecting', detail)
    this.clearReconnect()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connectIfPossible()
    }, delay)
  }

  // --- Messages ---------------------------------------------------------------

  private onMessage(socket: FeedSocket, raw: unknown): void {
    if (this.socket !== socket || typeof raw !== 'string') return
    let message: ServerStreamMessage
    try {
      message = JSON.parse(raw) as ServerStreamMessage
    } catch {
      return
    }
    switch (message.type) {
      case 'auth_result':
        if (!message.success) {
          this.setStatus('error', message.error ?? 'The live feed was refused')
          this.closeFor(socket)
          return
        }
        this.connecting = false
        this.attempt = 0
        this.setStatus('live')
        this.startPing(socket)
        this.subscribeAll()
        return
      case 'subscribed':
        this.onSubscribed(message.graphId, message.epoch, message.seq, message.resync)
        return
      case 'unsubscribed':
        this.confirmed.delete(message.graphId)
        if (message.reason === 'access_revoked') this.options.onAccessRevoked?.(message.graphId)
        return
      case 'change':
        this.cursors.set(message.graphId, Math.max(this.cursors.get(message.graphId) ?? 0, message.seq))
        this.options.onChange(message)
        return
      case 'error':
        if (FATAL_CODES.has(message.code)) {
          this.setStatus('error', message.message)
          this.closeFor(socket)
        }
        return
      default:
        return
    }
  }

  private onSubscribed(channel: string, epoch: string, seq: number, resync: 'gap' | 'epoch' | undefined): void {
    // A different process: its numbers mean nothing against the ones held.
    if (this.epoch !== undefined && this.epoch !== epoch) this.cursors.clear()
    this.epoch = epoch
    this.cursors.set(channel, Math.max(this.cursors.get(channel) ?? 0, seq))
    this.confirmed.add(channel)
    if (resync) {
      this.options.onResync(channel, resync)
    } else if (channel === GRAPH_LIST_CHANNEL && this.resumed) {
      // The graph list is never replayed: after a reconnect it is read again.
      this.options.onResync(channel, 'reconnect')
    }
  }

  private subscribeAll(): void {
    // Whether this socket resumes an earlier one, as opposed to being the first.
    this.resumed = this.hasBeenLive
    this.hasBeenLive = true
    if (this.graphId) this.subscribe(this.graphId)
    this.subscribe(GRAPH_LIST_CHANNEL)
  }

  private subscribe(channel: string): void {
    const socket = this.socket
    if (!socket || socket.readyState !== OPEN) return
    const since = this.cursors.get(channel)
    const resuming = since !== undefined && this.epoch !== undefined && channel !== GRAPH_LIST_CHANNEL
    socket.send(
      JSON.stringify({
        type: 'subscribe',
        graphId: channel,
        ...(resuming ? { epoch: this.epoch, since } : {}),
      })
    )
  }

  private unsubscribe(channel: string): void {
    const socket = this.socket
    this.confirmed.delete(channel)
    this.cursors.delete(channel)
    if (!socket || socket.readyState !== OPEN) return
    socket.send(JSON.stringify({ type: 'unsubscribe', graphId: channel }))
  }

  // --- Housekeeping -----------------------------------------------------------

  private startPing(socket: FeedSocket): void {
    this.clearPing()
    this.pingTimer = setInterval(() => {
      if (this.socket === socket && socket.readyState === OPEN) {
        try {
          socket.send(JSON.stringify({ type: 'ping' }))
        } catch {
          // The close that follows handles it.
        }
      }
    }, this.options.pingIntervalMs ?? 60000)
  }

  private closeFor(socket: FeedSocket): void {
    if (this.socket !== socket) return
    this.socket = undefined
    this.connecting = false
    this.confirmed.clear()
    this.clearPing()
    socket.onmessage = null
    socket.onclose = null
    try {
      socket.close()
    } catch {
      // Already gone.
    }
  }

  private setStatus(status: LiveFeedStatus, detail?: string): void {
    if (this.status === status && detail === undefined) return
    this.status = status
    this.options.onStatus(status, detail)
  }

  private clearPing(): void {
    if (this.pingTimer !== undefined) clearInterval(this.pingTimer)
    this.pingTimer = undefined
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }

  private clearTimers(): void {
    this.clearPing()
    this.clearReconnect()
  }
}
