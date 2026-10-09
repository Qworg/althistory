/**
 * Visual badge indicating current WebSocket streaming status and activity stats.
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
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          dot: 'bg-emerald-500 animate-pulse',
          label: 'Streaming Connected',
        }
      case 'connecting':
        return {
          bg: 'bg-amber-50 text-amber-700 border-amber-200',
          dot: 'bg-amber-500 animate-ping',
          label: 'Streaming Connecting...',
        }
      case 'error':
        return {
          bg: 'bg-rose-50 text-rose-700 border-rose-200',
          dot: 'bg-rose-500',
          label: 'Streaming Error',
        }
      case 'disconnected':
      default:
        return {
          bg: 'bg-slate-50 text-slate-600 border-slate-200',
          dot: 'bg-slate-400',
          label: 'Streaming Offline',
        }
    }
  }

  const config = getStatusConfig()

  return (
    <div
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border ${config.bg} ${className}`}
      role="status"
      aria-label={config.label}
      title={error || (stats ? `Sent: ${stats.sent}, Acked: ${stats.acked}, Failed: ${stats.failed}` : undefined)}
    >
      <span className={`w-2 h-2 rounded-full ${config.dot}`} aria-hidden="true" />
      <span>{config.label}</span>

      {status === 'connected' && stats && (
        <span className="text-[10px] text-emerald-600 border-l border-emerald-200 pl-1.5 ml-0.5">
          {stats.acked}/{stats.sent}
        </span>
      )}

      {status === 'disconnected' && onConnect && (
        <button
          type="button"
          onClick={onConnect}
          className="ml-1 text-[10px] underline hover:text-slate-900 transition-colors"
        >
          Connect
        </button>
      )}

      {status === 'connected' && onDisconnect && (
        <button
          type="button"
          onClick={onDisconnect}
          className="ml-1 text-[10px] underline hover:text-emerald-900 transition-colors"
        >
          Disconnect
        </button>
      )}
    </div>
  )
}
