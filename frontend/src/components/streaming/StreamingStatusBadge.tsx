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
  'Every edit is saved as you make it. Live sync also sends each edit over an open connection and shows it confirmed as it lands: useful while an agent or the CLI edits the same graph.'

const ERROR_MESSAGE =
  "Couldn't start live sync. Your edits still save as you go; retry when the server is reachable."

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
          bg: 'bg-success/10 text-success border-success/30',
          dot: 'bg-success',
          label: 'Live sync on',
        }
      case 'connecting':
        return {
          bg: 'bg-warning/10 text-warning border-warning/30',
          dot: 'bg-warning animate-pulse',
          label: 'Live sync: connecting…',
        }
      case 'error':
        return {
          bg: 'bg-danger/10 text-danger border-danger/30',
          dot: 'bg-danger',
          label: "Couldn't start live sync",
        }
      case 'disconnected':
      default:
        return {
          bg: 'bg-subtle text-ink-secondary border-line',
          dot: 'border border-ink-muted',
          label: 'Edits save as you go',
        }
    }
  }

  const config = getStatusConfig()
  const statsTitle = stats ? `${stats.acked} of ${stats.sent} edits confirmed${stats.failed ? `, ${stats.failed} failed` : ''}` : undefined
  // The server's own wording stays out of the badge; it is kept in the tooltip
  // for whoever is debugging the connection.
  const title =
    status === 'error'
      ? `${ERROR_MESSAGE}${error ? ` (Details: ${error})` : ''}`
      : statsTitle || (status === 'disconnected' ? OFF_HINT : undefined)

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
        <span className="font-mono-code text-xs text-success border-l border-success/30 pl-1.5 ml-0.5">
          {/* Words, not "0/0": what the two numbers count. */}
          {stats.sent === 0 ? 'no edits sent yet' : `${stats.acked} of ${stats.sent} confirmed`}
        </span>
      )}

      {stats && stats.failed > 0 && (
        <span className="text-xs text-danger font-semibold border-l border-danger/30 pl-1.5 ml-0.5" role="alert">
          {stats.failed} failed
        </span>
      )}

      {status === 'error' && (
        <span className="sr-only" role="alert">
          {ERROR_MESSAGE}
        </span>
      )}

      {/* The handler is wrapped so the click event never reaches onConnect as an argument. */}
      {status === 'disconnected' && onConnect && (
        <button type="button" onClick={() => onConnect()} className={actionClass}>
          Live sync
        </button>
      )}

      {status === 'error' && onConnect && (
        <button type="button" onClick={() => onConnect()} className={actionClass}>
          Retry
        </button>
      )}

      {status === 'connected' && onDisconnect && (
        <button type="button" onClick={() => onDisconnect()} className={actionClass}>
          Turn off
        </button>
      )}
    </div>
  )
}
