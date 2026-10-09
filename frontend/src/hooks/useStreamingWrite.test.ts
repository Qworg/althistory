import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStreamingWrite, getWebSocketStreamUrl } from './useStreamingWrite'
import { apiClient } from '@/services/api'

// Mock apiClient
vi.mock('@/services/api', () => ({
  apiClient: {
    stream: {
      getToken: vi.fn(),
    },
  },
}))

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static OPEN = 1
  static CLOSED = 3
  static CONNECTING = 0

  readyState = MockWebSocket.CONNECTING
  url: string
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: ((error: unknown) => void) | null = null
  onclose: (() => void) | null = null
  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  // Helper to simulate incoming messages
  simulateMessage(msg: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }
}

describe('useStreamingWrite', () => {
  const originalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    vi.clearAllMocks()
    MockWebSocket.instances = []
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
  })

  it('derives the stream WebSocket URL correctly', () => {
    const url = getWebSocketStreamUrl('test-token-123')
    expect(url).toContain('/api/ws/stream?token=test-token-123')
    expect(url.startsWith('ws://') || url.startsWith('wss://')).toBe(true)
  })

  it('starts in disconnected state', () => {
    const { result } = renderHook(() => useStreamingWrite())
    expect(result.current.status).toBe('disconnected')
    expect(result.current.isConnected).toBe(false)
    expect(result.current.sessionId).toBeNull()
  })

  it('connects, exchanges token, and handles auth_result success', async () => {
    vi.mocked(apiClient.stream.getToken).mockResolvedValueOnce({
      token: 'valid-stream-token',
      expiresIn: 300,
      graphId: 'graph-1',
      permissions: ['write:events'],
      concurrentStreams: 5,
    })

    const { result } = renderHook(() => useStreamingWrite())

    await act(async () => {
      await result.current.connect('graph-1')
    })

    expect(apiClient.stream.getToken).toHaveBeenCalledWith('graph-1')
    expect(MockWebSocket.instances).toHaveLength(1)
    const socket = MockWebSocket.instances[0]!
    expect(socket.url).toContain('token=valid-stream-token')

    // Simulate auth_result message
    act(() => {
      socket.simulateOpen()
      socket.simulateMessage({
        type: 'auth_result',
        success: true,
        sessionId: 'sess-abc',
      })
    })

    expect(result.current.status).toBe('connected')
    expect(result.current.isConnected).toBe(true)
    expect(result.current.sessionId).toBe('sess-abc')
  })

  it('handles auth_result failure', async () => {
    vi.mocked(apiClient.stream.getToken).mockResolvedValueOnce({
      token: 'bad-token',
      expiresIn: 300,
      graphId: 'graph-1',
      permissions: [],
      concurrentStreams: 5,
    })

    const { result } = renderHook(() => useStreamingWrite())

    await act(async () => {
      await result.current.connect('graph-1')
    })

    const socket = MockWebSocket.instances[0]!
    act(() => {
      socket.simulateOpen()
      socket.simulateMessage({
        type: 'auth_result',
        success: false,
        error: 'Permission denied',
        code: 'PERMISSION_DENIED',
      })
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Permission denied')
  })

  it('sends events and receives correlated acks', async () => {
    vi.mocked(apiClient.stream.getToken).mockResolvedValueOnce({
      token: 'valid-token',
      expiresIn: 300,
      graphId: 'graph-1',
      permissions: ['write:events'],
      concurrentStreams: 5,
    })

    const onAck = vi.fn()
    const { result } = renderHook(() => useStreamingWrite({ onAck }))

    await act(async () => {
      await result.current.connect('graph-1')
    })

    const socket = MockWebSocket.instances[0]!
    act(() => {
      socket.simulateOpen()
      socket.simulateMessage({
        type: 'auth_result',
        success: true,
        sessionId: 'sess-abc',
      })
    })

    let ackPromise: Promise<unknown>
    act(() => {
      ackPromise = result.current.writeEvent({ description: 'Battle of Hastings' }, 'req-1')
    })

    expect(socket.sentMessages).toHaveLength(1)
    const sent = JSON.parse(socket.sentMessages[0]!)
    expect(sent).toMatchObject({
      type: 'event',
      requestId: 'req-1',
      data: { description: 'Battle of Hastings' },
    })

    // Simulate server ACK
    await act(async () => {
      socket.simulateMessage({
        type: 'ack',
        requestId: 'req-1',
        entityType: 'event',
        entityId: 'ev-new-1',
        success: true,
      })
      await ackPromise
    })

    expect(onAck).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ack',
        requestId: 'req-1',
        entityId: 'ev-new-1',
        success: true,
      })
    )
    expect(result.current.stats.sent).toBe(1)
    expect(result.current.stats.acked).toBe(1)
    expect(result.current.stats.failed).toBe(0)
  })

  it('handles validation warnings without failing the connection', async () => {
    vi.mocked(apiClient.stream.getToken).mockResolvedValueOnce({
      token: 'valid-token',
      expiresIn: 300,
      graphId: 'graph-1',
      permissions: ['write:events'],
      concurrentStreams: 5,
    })

    const onWarning = vi.fn()
    const { result } = renderHook(() => useStreamingWrite({ onWarning }))

    await act(async () => {
      await result.current.connect('graph-1')
    })

    const socket = MockWebSocket.instances[0]!
    act(() => {
      socket.simulateOpen()
      socket.simulateMessage({
        type: 'auth_result',
        success: true,
        sessionId: 'sess-abc',
      })
    })

    act(() => {
      socket.simulateMessage({
        type: 'warning',
        message: 'Versioning write timed out; entity persisted but unversioned',
        entityId: 'ev-1',
      })
    })

    expect(onWarning).toHaveBeenCalled()
    expect(result.current.warnings).toHaveLength(1)
    expect(result.current.status).toBe('connected')
  })

  it('sends close message and disconnects cleanly', async () => {
    vi.mocked(apiClient.stream.getToken).mockResolvedValueOnce({
      token: 'valid-token',
      expiresIn: 300,
      graphId: 'graph-1',
      permissions: ['write:events'],
      concurrentStreams: 5,
    })

    const { result } = renderHook(() => useStreamingWrite())

    await act(async () => {
      await result.current.connect('graph-1')
    })

    const socket = MockWebSocket.instances[0]!
    act(() => {
      socket.simulateOpen()
      socket.simulateMessage({
        type: 'auth_result',
        success: true,
        sessionId: 'sess-abc',
      })
    })

    act(() => {
      result.current.disconnect()
    })

    expect(result.current.status).toBe('disconnected')
    expect(result.current.sessionId).toBeNull()
    const lastSent = JSON.parse(socket.sentMessages[socket.sentMessages.length - 1]!)
    expect(lastSent).toEqual({ type: 'close' })
  })
})
