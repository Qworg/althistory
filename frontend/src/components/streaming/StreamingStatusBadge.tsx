/**
 * Visual badge for live sync: the connection over which the app hears what
 * other writers (an agent working through MCP, the command line, a generation
 * job) do to the open graph.
 *
 * Live sync is on by default. "Off" is what the person chose (edits still save
 * over HTTP without it), so it is drawn neutral -- a hollow dot on the subtle
 * surface -- and only an actual error uses the alarm colour. A dropped
 * connection that is being reopened is a warning, not an error: it catches up.
 */

import React from 'react'

/**
 * What the badge can say: off (`disconnected`), starting, on, reopening a
 * dropped connection, on with no graph open, on without the open graph (the
 * key lost it), or stopped.
 */
export type LiveSyncBadgeStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'waiting'
  | 'revoked'
  | 'error'

export interface StreamingStatusBadgeProps {
  status: LiveSyncBadgeStatus
  error?: string | null
  /** While `revoked`: the key lost the open graph (the default), or the graph is gone. */
  revokedReason?: 'access' | 'missing' | null
  onConnect?: () => void
  onDisconnect?: () => void
  className?: string
}

const OFF_HINT =
  "Every edit is saved as you make it. Turn on live sync to see changes made elsewhere, such as by an agent, as they happen; without it they appear only when the app next refreshes its data."

const ON_HINT = "Changes made elsewhere, such as by an agent, appear here as they happen, and are marked as new for a few seconds."

const RECONNECTING_HINT = 'The connection dropped. Reconnecting; whatever was missed is caught up when it is back.'

const WAITING_HINT = 'Live sync is on. It starts when a graph is open: a connection is made for one graph.'

const REVOKED_MESSAGE =
  "This key may no longer read this graph, so its changes no longer arrive here. The graph list is still watched. Open another graph, or retry once access is back."

const MISSING_MESSAGE = 'This graph no longer exists, so nothing more arrives for it. The graph list is still watched. Open another graph.'

const ERROR_MESSAGE =
  "Couldn't start live sync. Your edits still save as you go; retry when the server is reachable."

const actionClass =
  'ml-0.5 rounded-sm text-xs font-medium underline underline-offset-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected transition-colors'

export const StreamingStatusBadge: React.FC<StreamingStatusBadgeProps> = ({
  status,
  error,
  revokedReason,
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
      case 'reconnecting':
        return {
          bg: 'bg-warning/10 text-warning border-warning/30',
          dot: 'bg-warning animate-pulse',
          label: 'Live sync: reconnecting…',
        }
      case 'waiting':
        return {
          bg: 'bg-subtle text-ink-secondary border-line',
          dot: 'border border-ink-muted',
          label: 'Live sync: waiting for a graph',
        }
      case 'revoked':
        return {
          bg: 'bg-warning/10 text-warning border-warning/30',
          dot: 'bg-warning',
          label: 'Live sync: not watching this graph',
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
  // The server's own wording stays out of the badge; it is kept in the tooltip
  // for whoever is debugging the connection.
  const details = error ? ` (Details: ${error})` : ''
  const revokedMessage = revokedReason === 'missing' ? MISSING_MESSAGE : REVOKED_MESSAGE
  const title: string | undefined = {
    error: `${ERROR_MESSAGE}${details}`,
    revoked: `${revokedMessage}${details}`,
    reconnecting: RECONNECTING_HINT,
    waiting: WAITING_HINT,
    disconnected: OFF_HINT,
    connected: ON_HINT,
    connecting: undefined,
  }[status]

  return (
    <div
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border ${config.bg} ${className}`}
      role="status"
      aria-label={config.label}
      title={title}
    >
      <span className={`w-2 h-2 shrink-0 rounded-full ${config.dot}`} aria-hidden="true" />
      <span>{config.label}</span>

      {(status === 'error' || status === 'revoked') && (
        <span className="sr-only" role="alert">
          {status === 'error' ? ERROR_MESSAGE : revokedMessage}
        </span>
      )}

      {/* The handler is wrapped so the click event never reaches onConnect as an argument. */}
      {status === 'disconnected' && onConnect && (
        <button type="button" onClick={() => onConnect()} className={actionClass}>
          Live sync
        </button>
      )}

      {(status === 'error' || status === 'revoked') && onConnect && (
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
