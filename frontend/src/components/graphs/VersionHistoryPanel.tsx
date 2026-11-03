/**
 * VersionHistoryPanel Component
 *
 * The current graph's Version history, newest first, with restore.
 *
 * Every number here is a Version-history number (the head commit and the
 * versions below it), never `Graph.version`, which is an internal change
 * counter that runs ahead of it: the panel used to show that counter as
 * "Current version v52" over a list whose newest entry was version 48.
 */

import { useState, useCallback, useMemo, memo, useId } from 'react'
import {
  useGraphVersions,
  useRollbackGraph,
  useActiveGraphId,
  useActiveGraph,
  useGraphHeadVersion,
} from '@/hooks/useGraphs'
import { useEvents, useArcs, useCausalRelationships } from '@/hooks/useAPI'
import { ModalBase } from '@/components/modals/ModalBase'
import { GraphVersion } from '@/types'
import { buildVersionNameLookup, describeVersionChanges, summarizeVersion } from './versionSummary'

interface VersionHistoryPanelProps {
  className?: string
  maxVersions?: number
  onVersionSelect?: (version: GraphVersion) => void
  /**
   * Omit the panel's own collapsible "Version history" header, for hosts that
   * already title it (e.g. a side panel). The list is then always shown.
   */
  hideHeader?: boolean
}

interface RestoreOutcome {
  from: number
  savedAs: number | null
}

export const VersionHistoryPanel = memo(function VersionHistoryPanel({
  className = '',
  maxVersions = 20,
  onVersionSelect,
  hideHeader = false,
}: VersionHistoryPanelProps) {
  const [expandedState, setIsExpanded] = useState(true)
  const isExpanded = hideHeader || expandedState
  const [restoreTarget, setRestoreTarget] = useState<number | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<RestoreOutcome | null>(null)

  const activeGraphId = useActiveGraphId()
  const { data: activeGraph } = useActiveGraph()
  const { data: versions, isLoading, error } = useGraphVersions(activeGraphId, maxVersions)
  const rollbackMutation = useRollbackGraph()
  const historyHead = useGraphHeadVersion(activeGraphId, activeGraph?.version)
  // The list is newest first, so its first entry is the head too; it stands in
  // until the head query answers.
  const headVersion = historyHead ?? versions?.[0]?.version ?? null

  // Names for versions whose text still carries ids. Same queries (and keys)
  // the views use, so they are normally already cached.
  const { data: events } = useEvents({ limit: 1000 })
  const { data: arcs } = useArcs()
  const { data: relationships } = useCausalRelationships()
  const lookup = useMemo(
    () => buildVersionNameLookup(events, arcs, relationships),
    [events, arcs, relationships]
  )

  const graphName = activeGraph?.name

  const openRestore = useCallback((version: number) => {
    setRestoreError(null)
    setOutcome(null)
    setRestoreTarget(version)
  }, [])

  const closeRestore = useCallback(() => {
    if (rollbackMutation.isPending) return
    setRestoreTarget(null)
    setRestoreError(null)
  }, [rollbackMutation.isPending])

  const handleRestore = useCallback(async () => {
    if (!activeGraphId || restoreTarget === null) return
    const target = restoreTarget
    setRestoreError(null)
    try {
      const result = await rollbackMutation.mutateAsync({ id: activeGraphId, version: target })
      // The rollback route returns the version it saved the restore as.
      const savedAs = typeof result?.restoredAsVersion === 'number' ? result.restoredAsVersion : null
      setOutcome({ from: target, savedAs })
      setRestoreTarget(null)
    } catch (err) {
      console.error('Rollback failed:', err)
      const reason = err instanceof Error && err.message.trim() ? err.message.trim() : 'The server did not say why.'
      setRestoreError(/[.!?]$/.test(reason) ? reason : `${reason}.`)
    }
  }, [activeGraphId, restoreTarget, rollbackMutation])

  const handleVersionClick = useCallback((version: GraphVersion) => {
    onVersionSelect?.(version)
  }, [onVersionSelect])

  if (!activeGraphId) {
    return (
      <div className={`${hideHeader ? '' : 'bg-card border border-line rounded-lg'} p-4 ${className}`}>
        <div className="text-ink-muted text-sm">No graph selected</div>
      </div>
    )
  }

  return (
    <div className={`${hideHeader ? '' : 'bg-card border border-line rounded-lg'} overflow-hidden ${className}`}>
      {/* Header */}
      {hideHeader ? (
        headVersion !== null && (
          <div className="px-4 py-2 border-b border-line text-xs text-ink-muted">
            Current version{' '}
            <span className="font-mono-code text-ink">v{headVersion}</span>
          </div>
        )
      ) : (
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className="w-full px-4 py-3 flex items-center justify-between bg-subtle hover:bg-canvas transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="font-medium text-ink">Version history</span>
        </div>
        <div className="flex items-center gap-2">
          {headVersion !== null && (
            <span className="font-mono-code text-xs text-ink-secondary bg-card px-2 py-0.5 rounded">
              v{headVersion}
            </span>
          )}
          <svg
            className={`w-4 h-4 text-ink-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      )}

      {/* The outcome of a restore, with the number it was really saved as. */}
      <div role="status" aria-live="polite" className={outcome ? 'px-4 py-2 border-b border-line text-sm text-ink' : 'sr-only'}>
        {outcome && (
          outcome.savedAs !== null
            ? <>Restored version <span className="font-mono-code">{outcome.from}</span>. Saved as version <span className="font-mono-code">{outcome.savedAs}</span>, now the current version.</>
            : <>Restored version <span className="font-mono-code">{outcome.from}</span> as a new version.</>
        )}
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-ink-muted">
              <svg className="animate-spin h-5 w-5 mx-auto mb-2" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Loading history...
            </div>
          ) : error ? (
            <div className="p-4 text-center text-red-700 dark:text-red-300">
              Failed to load version history
            </div>
          ) : !versions || versions.length === 0 ? (
            <div className="p-4 text-center text-ink-muted text-sm">
              No version history available
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {versions.map((version) => (
                <VersionItem
                  key={`${version.version}-${version.commitHash}`}
                  version={version}
                  summary={summarizeVersion(version, lookup)}
                  isCurrent={version.version === headVersion}
                  onClick={() => handleVersionClick(version)}
                  onRestoreClick={() => openRestore(version.version)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {restoreTarget !== null && (
        <RestoreVersionDialog
          graphName={graphName}
          target={restoreTarget}
          headVersion={headVersion}
          isRestoring={rollbackMutation.isPending}
          error={restoreError}
          onConfirm={handleRestore}
          onCancel={closeRestore}
        />
      )}
    </div>
  )
})

interface RestoreVersionDialogProps {
  graphName: string | undefined
  target: number
  headVersion: number | null
  isRestoring: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The consequences of a restore, in the words the merge preview uses: a
 * restore never rewrites history, it saves the old content as a new version.
 */
function RestoreVersionDialog({
  graphName,
  target,
  headVersion,
  isRestoring,
  error,
  onConfirm,
  onCancel,
}: RestoreVersionDialogProps) {
  const descriptionId = useId()
  const graph = graphName ? `“${graphName}”` : 'this graph'
  const next = headVersion !== null ? headVersion + 1 : null
  const kept =
    headVersion === null || headVersion <= target
      ? null
      : headVersion === target + 1
        ? `version ${headVersion} stays`
        : `versions ${target + 1}–${headVersion} stay`

  const footer = (
    <div className="flex flex-wrap justify-end gap-3">
      <button
        type="button"
        onClick={onCancel}
        disabled={isRestoring}
        className="inline-flex items-center justify-center rounded-md border border-line bg-card px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={isRestoring}
        aria-describedby={descriptionId}
        className="inline-flex items-center justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-selected focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRestoring ? 'Restoring…' : `Restore version ${target}`}
      </button>
    </div>
  )

  return (
    <ModalBase
      isOpen
      onClose={onCancel}
      title={`Restore version ${target}?`}
      size="md"
      footer={footer}
      closeOnEscape={!isRestoring}
      closeOnBackdrop={!isRestoring}
    >
      <div className="space-y-3 text-sm text-ink-secondary">
        <p id={descriptionId} className="text-ink">
          Restore {graph} to version {target}? Its content becomes what it was at version {target}
          {next !== null ? `, saved as a new version ${next}` : ', saved as a new version'}
          {kept ? `; ${kept} in Version history.` : '.'}
        </p>
        <p>Nothing is deleted: you can restore any of these versions again later.</p>
        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-200"
          >
            Couldn't restore version {target}: {error} Nothing was changed; try again.
          </p>
        )}
      </div>
    </ModalBase>
  )
}

interface VersionItemProps {
  version: GraphVersion
  summary: string
  isCurrent: boolean
  onClick: () => void
  onRestoreClick: () => void
}

const VersionItem = memo(function VersionItem({
  version,
  summary,
  isCurrent,
  onClick,
  onRestoreClick,
}: VersionItemProps) {
  const timestamp = new Date(version.timestamp)
  const timeAgo = getTimeAgo(timestamp)
  const changes = describeVersionChanges(version.changes)

  return (
    <li
      className={`
        px-4 py-3 cursor-pointer transition-colors
        ${isCurrent ? 'bg-selected/10' : 'hover:bg-subtle'}
      `}
      aria-current={isCurrent ? 'true' : undefined}
      onClick={onClick}
    >
      {/* Version Header */}
      <div className="flex items-center gap-2">
        <span className="font-medium font-mono-code text-ink">v{version.version}</span>
        {isCurrent && (
          <span className="text-xs bg-selected/15 text-selected px-1.5 py-0.5 rounded">
            Current
          </span>
        )}
      </div>

      {/* What happened, in words */}
      <p className="text-sm text-ink mt-1 break-words">{summary}</p>

      {changes.length > 0 && (
        <p className="text-xs text-ink-secondary mt-1">{changes.join(' · ')}</p>
      )}

      {/* Timestamp and Author */}
      {/* A commit time is wall-clock time, not historical time, so it is
          shown in the viewer's zone (see utils/historicalTime). */}
      <div className="flex items-center gap-2 mt-1 text-xs text-ink-muted">
        <time
          className="font-mono-code"
          dateTime={Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString()}
          title={timestamp.toLocaleString()}
        >
          {timeAgo}
        </time>
        {version.author && (
          <>
            <span aria-hidden="true">·</span>
            <span>{version.author}</span>
          </>
        )}
      </div>

      {!isCurrent && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRestoreClick()
          }}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink-secondary hover:bg-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
            />
          </svg>
          Restore version {version.version}…
        </button>
      )}
    </li>
  )
})

// Helper function
function getTimeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString()
}

export default VersionHistoryPanel
