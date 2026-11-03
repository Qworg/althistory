/**
 * Visual badge indicating current WebSocket streaming status and activity stats.
 *
 * "Off" is the normal resting state (edits save over HTTP without it), so it is
 * drawn neutral -- a hollow dot on the subtle surface -- and only an actual
 * error uses the alarm colour.
 */

import React from 'react'
import type { StreamingConnectionStatus, StreamingStats } from '@/hooks/useStreamingWrite'

export interface StreamingStatusBadgeProps {
  status: StreamingConnectionStatus
  stats?: StreamingStats
  error?: string | null
  onConnect?: () => void
  onDisconnect?: () => void
  className?: string
}

const OFF_HINT =
  'Streaming writes are off. Edits still save normally; connect to send them over a live connection with per-write acknowledgement.'

const actionClass =
  'ml-0.5 rounded-sm text-xs font-medium underline underline-offset-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected transition-colors'

export const StreamingStatusBadge: React.FC<StreamingStatusBadgeProps> = ({
  status,
  stats,
  error,
  onConnect,
  onDisconnect,
  className = '',
}) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'connected':
        return {
          bg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          dot: 'bg-emerald-500',
          label: 'Streaming on',
        }
      case 'connecting':
        return {
          bg: 'bg-amber-50 text-amber-800 border-amber-200',
          dot: 'bg-amber-500 animate-pulse',
          label: 'Streaming: connecting…',
        }
      case 'error':
        return {
          bg: 'bg-rose-50 text-rose-800 border-rose-200',
          dot: 'bg-rose-500',
          label: 'Streaming error',
        }
      case 'disconnected':
      default:
        return {
          bg: 'bg-subtle text-ink-secondary border-line',
          dot: 'border border-ink-muted',
          label: 'Streaming off',
        }
    }
  }

  const config = getStatusConfig()
  const statsTitle = stats ? `Sent: ${stats.sent}, Acked: ${stats.acked}, Failed: ${stats.failed}` : undefined
  const title = error || statsTitle || (status === 'disconnected' ? OFF_HINT : undefined)

  return (
    <div
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border ${config.bg} ${className}`}
      role="status"
      aria-label={config.label}
      title={title}
    >
      <span className={`w-2 h-2 shrink-0 rounded-full ${config.dot}`} aria-hidden="true" />
      <span>{config.label}</span>

      {status === 'connected' && stats && (
        <span className="font-mono-code text-xs text-emerald-800 border-l border-emerald-200 pl-1.5 ml-0.5">
          {stats.acked}/{stats.sent}
        </span>
      )}

      {stats && stats.failed > 0 && (
        <span className="text-xs text-rose-700 font-semibold border-l border-rose-200 pl-1.5 ml-0.5" role="alert">
          {stats.failed} failed
        </span>
      )}

      {error && (
        <span className="text-xs text-rose-800 border-l border-rose-200 pl-1.5 ml-0.5 truncate max-w-40" role="alert">
          {error}
        </span>
      )}

      {status === 'disconnected' && onConnect && (
        <button type="button" onClick={onConnect} className={actionClass}>
          Connect
        </button>
      )}

      {status === 'connected' && onDisconnect && (
        <button type="button" onClick={onDisconnect} className={actionClass}>
          Disconnect
        </button>
      )}
    </div>
  )
}
