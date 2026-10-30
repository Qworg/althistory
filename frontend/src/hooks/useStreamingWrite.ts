/**
 * Custom React hook for high-throughput WebSocket streaming writes (Requirement 16).
 *
 * Connects to the backend WebSocket streaming endpoint (`/api/ws/stream?token=<token>`)
 * using a short-lived token acquired from `POST /api/stream/token`.
 * Provides queued request tracking, per-message ACKs, and non-blocking validation warnings.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { apiClient } from '@/services/api'
import type {
  ClientStreamMessage,
  ServerStreamMessage,
  ServerAckMessage,
  ServerWarningMessage,
  ServerErrorMessage,
} from '@/types'

export type StreamingConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface StreamingStats {
  sent: number
  acked: number
  failed: number
}

export interface UseStreamingWriteOptions {
  graphId?: string
  autoConnect?: boolean
  autoReconnect?: boolean
  onAck?: (ack: ServerAckMessage) => void
  onWarning?: (warning: ServerWarningMessage) => void
  onError?: (error: ServerErrorMessage) => void
}

interface PendingAck {
  resolve: (ack: ServerAckMessage) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface QueuedMessage {
  payload: string
  reqId: string
}

/**
 * Derives the WebSocket URL for the streaming endpoint based on the API origin.
 */
export function getWebSocketStreamUrl(token: string): string {
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
  const wsProtocol = isHttps ? 'wss:' : 'ws:'
  
  let host = typeof window !== 'undefined' ? window.location.host : 'localhost:3000'
  const customApiUrl = import.meta.env?.VITE_API_URL || import.meta.env?.VITE_API_BASE_URL
  if (customApiUrl) {
    try {
      const parsed = new URL(customApiUrl)
      host = parsed.host
    } catch {
      // Fallback to window host
    }
  }

  return `${wsProtocol}//${host}/api/ws/stream?token=${encodeURIComponent(token)}`
}

export function useStreamingWrite(options: UseStreamingWriteOptions = {}) {
  const { graphId, autoConnect = false, autoReconnect = false, onAck, onWarning, onError } = options

  const [status, setStatus] = useState<StreamingConnectionStatus>('disconnected')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<ServerWarningMessage[]>([])
  const [stats, setStats] = useState<StreamingStats>({ sent: 0, acked: 0, failed: 0 })

  const wsRef = useRef<WebSocket | null>(null)
  const pendingAcksRef = useRef<Map<string, PendingAck>>(new Map())
  const outboundQueueRef = useRef<QueuedMessage[]>([])
  const manualDisconnectRef = useRef<boolean>(false)
  const reqIdCounterRef = useRef<number>(0)

  const clearPendingAcks = useCallback(() => {
    outboundQueueRef.current = []
    pendingAcksRef.current.forEach(({ reject, timer }) => {
      clearTimeout(timer)
      reject(new Error('Streaming connection closed before ACK was received'))
    })
    pendingAcksRef.current.clear()
  }, [])

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        try {
          const closeMsg: ClientStreamMessage = { type: 'close' }
          wsRef.current.send(JSON.stringify(closeMsg))
        } catch {
          // Ignore write failure on tear-down
        }
      }
      wsRef.current.close()
      wsRef.current = null
    }
    clearPendingAcks()
    setStatus('disconnected')
    setSessionId(null)
  }, [clearPendingAcks])

  const connect = useCallback(async (targetGraphId?: string) => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return
    }

    manualDisconnectRef.current = false
    setStatus('connecting')
    setError(null)

    try {
      const activeGraphId = targetGraphId || graphId
      const tokenResponse = await apiClient.stream.getToken(activeGraphId)
      if (!tokenResponse?.token) {
        throw new Error('Failed to obtain streaming authorization token')
      }

      const streamUrl = getWebSocketStreamUrl(tokenResponse.token)
      const socket = new WebSocket(streamUrl)
      wsRef.current = socket

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as ServerStreamMessage
          switch (msg.type) {
            case 'auth_result':
              if (msg.success) {
                setStatus('connected')
                setSessionId(msg.sessionId || null)
                while (outboundQueueRef.current.length > 0 && socket.readyState === WebSocket.OPEN) {
                  const queued = outboundQueueRef.current.shift()!
                  try {
                    socket.send(queued.payload)
                    setStats((prev) => ({ ...prev, sent: prev.sent + 1 }))
                  } catch (sendErr) {
                    const pending = pendingAcksRef.current.get(queued.reqId)
                    if (pending) {
                      clearTimeout(pending.timer)
                      pendingAcksRef.current.delete(queued.reqId)
                      pending.reject(sendErr instanceof Error ? sendErr : new Error(String(sendErr)))
                    }
                  }
                }
              } else {
                setStatus('error')
                setError(msg.error || 'Streaming authorization failed')
                socket.close()
              }
              break

            case 'ack': {
              setStats((prev) => ({
                ...prev,
                acked: msg.success ? prev.acked + 1 : prev.acked,
                failed: !msg.success ? prev.failed + 1 : prev.failed,
              }))
              onAck?.(msg)

              if (msg.requestId && pendingAcksRef.current.has(msg.requestId)) {
                const pending = pendingAcksRef.current.get(msg.requestId)!
                clearTimeout(pending.timer)
                pendingAcksRef.current.delete(msg.requestId)
                if (msg.success) {
                  pending.resolve(msg)
                } else {
                  pending.reject(new Error(msg.error || `Write failed with code ${msg.code || 'UNKNOWN'}`))
                }
              }
              break
            }

            case 'warning':
              setWarnings((prev) => [...prev, msg])
              onWarning?.(msg)
              break

            case 'error':
              setError(msg.message)
              onError?.(msg)
              break

            case 'closed':
              setStatus('disconnected')
              setSessionId(null)
              break
          }
        } catch (err) {
          console.error('[useStreamingWrite] Failed to parse message:', err)
        }
      }

      socket.onerror = () => {
        setStatus('error')
        setError('WebSocket streaming error')
      }

      socket.onclose = () => {
        wsRef.current = null
        setStatus((prev) => (prev === 'error' ? 'error' : 'disconnected'))
        setSessionId(null)
        clearPendingAcks()
        if (autoReconnect && !manualDisconnectRef.current) {
          void connect(activeGraphId)
        }
      }
    } catch (err) {
      setStatus('error')
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    }
  }, [graphId, autoReconnect, onAck, onWarning, onError, clearPendingAcks])

  const sendWithAck = useCallback(
    (message: ClientStreamMessage, customRequestId?: string, timeoutMs: number = 10000): Promise<ServerAckMessage> => {
      const socket = wsRef.current
      if (!socket || (socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING)) {
        return Promise.reject(new Error('Streaming socket is not connected'))
      }

      const reqId = customRequestId || `stream_req_${++reqIdCounterRef.current}_${Date.now()}`
      const enrichedMessage = { ...message, requestId: reqId }
      const payload = JSON.stringify(enrichedMessage)

      return new Promise<ServerAckMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingAcksRef.current.delete(reqId)
          reject(new Error(`Timed out waiting for ACK for request ${reqId}`))
        }, timeoutMs)

        pendingAcksRef.current.set(reqId, { resolve, reject, timer })

        if (socket.readyState === WebSocket.CONNECTING) {
          outboundQueueRef.current.push({ payload, reqId })
          return
        }

        try {
          socket.send(payload)
          setStats((prev) => ({ ...prev, sent: prev.sent + 1 }))
        } catch (err) {
          clearTimeout(timer)
          pendingAcksRef.current.delete(reqId)
          reject(err)
        }
      })
    },
    []
  )

  const writeEvent = useCallback(
    (data: Record<string, unknown>, requestId?: string, timeoutMs?: number) => {
      return sendWithAck({ type: 'event', data }, requestId, timeoutMs)
    },
    [sendWithAck]
  )

  const writeArc = useCallback(
    (data: Record<string, unknown>, requestId?: string, timeoutMs?: number) => {
      return sendWithAck({ type: 'arc', data }, requestId, timeoutMs)
    },
    [sendWithAck]
  )

  const writeRelationship = useCallback(
    (data: Record<string, unknown>, requestId?: string, timeoutMs?: number) => {
      return sendWithAck({ type: 'relationship', data }, requestId, timeoutMs)
    },
    [sendWithAck]
  )

  useEffect(() => {
    if (autoConnect) {
      void connect()
    }
    return () => {
      disconnect()
    }
  }, [autoConnect, connect, disconnect])

  return {
    status,
    isConnected: status === 'connected',
    sessionId,
    error,
    warnings,
    stats,
    connect,
    disconnect,
    sendWithAck,
    writeEvent,
    writeArc,
    writeRelationship,
  }
}
