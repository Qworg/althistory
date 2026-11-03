import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiClient } from '@/services/api'
import { useRollbackGraph, useInvalidateGraphData } from '@/hooks/useGraphs'
import { ModalBase } from '@/components/modals/ModalBase'
import type {
  GraphMergeResponse,
  ManualResolution,
  MergedResolution,
  MergeAnomaly,
  MergeAnomalyType,
  MergeConflict,
} from '@/types'
import {
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  FIELD,
  FOOTER_ROW,
  FOOTER_ACTIONS,
  countNoun,
  joinList,
  quoted,
} from './branchUi'

/** The ids of what each graph holds; enough to count what a merge adds. */
export interface MergeEntitySets {
  readonly events: ReadonlyArray<{ readonly id: string }>
  readonly arcs: ReadonlyArray<{ readonly id: string }>
  readonly relationships: ReadonlyArray<{ readonly id: string }>
}

export interface BranchMergeModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  /** Graph that receives the merge (the baseline). */
  readonly targetGraphId: string
  readonly targetGraphName: string
  /** Graph being merged in (the counterfactual branch). */
  readonly sourceGraphId: string
  readonly sourceGraphName: string
  /**
   * What the two graphs hold, used to say how many events, arcs and causal
   * links the merge adds. The dry run reports conflicts but not additions, and
   * a merge adds exactly the source records whose ids the target lacks.
   * Without these the summary describes the additions in general terms.
   */
  readonly targetData?: MergeEntitySets
  readonly sourceData?: MergeEntitySets
  readonly onMerged?: (result: GraphMergeResponse) => void
  /** Called after the user restores the version the merge replaced. */
  readonly onRestored?: (version: number) => void
}

type Phase = 'idle' | 'analyzing' | 'review' | 'committing' | 'done'
type RestoreState = 'idle' | 'confirming' | 'restoring' | 'restored'

interface Additions {
  events: number
  arcs: number
  relationships: number
}

const ANOMALY_LABELS: Record<MergeAnomalyType, string> = {
  causal_cycle: 'Causal loop',
  temporal_inversion: 'Effect before its cause',
  orphan_relationship: 'Link to a missing event',
  orphan_reference: 'Reference to a missing record',
}

/** Conflicts are keyed exactly the way the merge API expects. */
function conflictKey(conflict: Pick<MergeConflict, 'entityType' | 'entityId'>): string {
  return `${conflict.entityType}:${conflict.entityId}`
}

function isMerged(resolution: ManualResolution | undefined): resolution is MergedResolution {
  return typeof resolution === 'object' && resolution !== null && resolution.strategy === 'merged'
}

/** Keys whose values differ between the target and source records. */
function changedKeys(conflict: MergeConflict): string[] {
  const keys = new Set([
    ...Object.keys(conflict.targetVersion),
    ...Object.keys(conflict.sourceVersion),
  ])
  return [...keys].filter(
    key =>
      JSON.stringify(conflict.targetVersion[key]) !== JSON.stringify(conflict.sourceVersion[key])
  )
}

function conflictLabel(conflict: MergeConflict): string {
  const candidate =
    conflict.targetVersion['description'] ??
    conflict.sourceVersion['description'] ??
    conflict.targetVersion['name'] ??
    conflict.sourceVersion['name']
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : conflict.entityId
}

function anomalyLabel(type: MergeAnomalyType | string): string {
  return ANOMALY_LABELS[type as MergeAnomalyType] ?? type.replace(/_/g, ' ')
}

/** Records the merge adds: source ids the target does not have. */
function countAdditions(target: MergeEntitySets, source: MergeEntitySets): Additions {
  const missing = (have: ReadonlyArray<{ id: string }>, incoming: ReadonlyArray<{ id: string }>) => {
    const ids = new Set(have.map(item => item.id))
    return incoming.filter(item => !ids.has(item.id)).length
  }
  return {
    events: missing(target.events, source.events),
    arcs: missing(target.arcs, source.arcs),
    relationships: missing(target.relationships, source.relationships),
  }
}

/** "2 events and 1 arc"; empty when nothing is added. */
function describeAdditions(additions: Additions): string {
  const parts: string[] = []
  if (additions.events > 0) parts.push(countNoun(additions.events, 'event'))
  if (additions.arcs > 0) parts.push(countNoun(additions.arcs, 'arc'))
  if (additions.relationships > 0) parts.push(countNoun(additions.relationships, 'causal link'))
  return joinList(parts)
}

/**
 * Merge a counterfactual branch into its baseline graph, in plain terms.
 *
 * The flow is two calls to `POST /graphs/:id/merge`:
 *   1. a preview (`dryRun: true`) that reports conflicts and pre-merge
 *      anomalies without writing;
 *   2. the merge itself, carrying one `manualResolution` per conflict (keep
 *      the baseline, use the branch, or combine fields).
 * The merge writes a new version of the baseline, so the version it replaced
 * can be restored from here as well as from Version history.
 */
export const BranchMergeModal = React.memo(function BranchMergeModal({
  isOpen,
  onClose,
  targetGraphId,
  targetGraphName,
  sourceGraphId,
  sourceGraphName,
  targetData,
  sourceData,
  onMerged,
  onRestored,
}: BranchMergeModalProps) {
  const rollback = useRollbackGraph()
  const invalidateGraphData = useInvalidateGraphData()

  const [phase, setPhase] = useState<Phase>('idle')
  const [conflicts, setConflicts] = useState<MergeConflict[]>([])
  const [anomalies, setAnomalies] = useState<MergeAnomaly[]>([])
  const [resolutions, setResolutions] = useState<Record<string, ManualResolution>>({})
  /** The baseline's head version when the preview ran, if it could be read. */
  const [headVersion, setHeadVersion] = useState<number | null>(null)
  /**
   * The additions as counted when the preview ran. Held, not recomputed: once
   * the merge lands the parent reloads the baseline, which then has every
   * record it added, and a live count would report that nothing was added.
   */
  const [additions, setAdditions] = useState<Additions | null>(null)
  /**
   * Change one conflict's resolution.
   *
   * Going through one function means the anomalies detected for the previous
   * resolutions are cleared whenever a resolution changes. They described the
   * graph that was about to be committed; once the user changes an answer,
   * they are stale, and leaving them in place blocked the commit button with
   * no way to clear them.
   */
  const setResolution = useCallback((key: string, resolution: ManualResolution) => {
    setResolutions(prev => ({ ...prev, [key]: resolution }))
    setAnomalies([])
  }, [])
  const [result, setResult] = useState<GraphMergeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restoreState, setRestoreState] = useState<RestoreState>('idle')
  // The version the rollback was saved as (a rollback commits a new version)
  const [restoredAsVersion, setRestoredAsVersion] = useState<number | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  /**
   * Identifies the current preview. A preview is read-only, so the dialog may
   * be closed while one runs; a response that arrives after the dialog was
   * closed (or a newer preview started) is dropped rather than shown.
   */
  const previewRunRef = useRef(0)

  // A fresh pair of graphs means a fresh merge: drop the previous analysis.
  useEffect(() => {
    previewRunRef.current++
    if (isOpen) {
      setPhase('idle')
      setConflicts([])
      setAnomalies([])
      setResolutions({})
      setHeadVersion(null)
      setAdditions(null)
      setResult(null)
      setError(null)
      setRestoreState('idle')
      setRestoreError(null)
      setRestoredAsVersion(null)
    }
  }, [isOpen, targetGraphId, sourceGraphId])

  const currentAdditions = useMemo(
    () => (targetData && sourceData ? countAdditions(targetData, sourceData) : null),
    [targetData, sourceData]
  )

  const analyze = useCallback(async () => {
    if (!targetGraphId || !sourceGraphId) return
    const run = ++previewRunRef.current
    setPhase('analyzing')
    setError(null)

    try {
      const [preview, head] = await Promise.all([
        apiClient.graphs.mergeDetailed(targetGraphId, {
          sourceGraphId,
          conflictResolution: 'manual',
          dryRun: true,
        }),
        // The newest version is listed first. It is only used to name version
        // numbers in the summary, so failing to read it is not an error.
        Promise.resolve()
          .then(() => apiClient.graphs.getVersions(targetGraphId, 1))
          .then(versions => versions[0]?.version ?? null)
          .catch(() => null),
      ])
      if (run !== previewRunRef.current) return

      setHeadVersion(typeof head === 'number' ? head : null)
      setAdditions(currentAdditions)
      setAnomalies(preview.anomalies ?? [])
      // Conflicts start unresolved on purpose: pre-selecting the suggested side
      // would let a merge go through without the caller ever seeing which
      // records were going to be overwritten.
      setConflicts(preview.success ? [] : (preview.conflicts ?? []))
      setResolutions({})
      setPhase('review')
    } catch (err) {
      if (run !== previewRunRef.current) return
      setError(err instanceof Error ? err.message : 'Could not preview the merge')
      setPhase('idle')
    }
  }, [targetGraphId, sourceGraphId, currentAdditions])

  const resolveAll = useCallback(
    (resolution: ManualResolution) => {
      setResolutions(
        Object.fromEntries(conflicts.map(conflict => [conflictKey(conflict), resolution]))
      )
    },
    [conflicts]
  )

  const unresolvedCount = useMemo(
    () => conflicts.filter(conflict => !resolutions[conflictKey(conflict)]).length,
    [conflicts, resolutions]
  )

  const commit = useCallback(async () => {
    if (!targetGraphId || !sourceGraphId) return
    if (unresolvedCount > 0 || anomalies.length > 0) return

    setPhase('committing')
    setError(null)

    try {
      const merged = await apiClient.graphs.mergeDetailed(targetGraphId, {
        sourceGraphId,
        conflictResolution: 'manual',
        manualResolutions: resolutions,
      })

      if (!merged.success) {
        // The target may have advanced or anomalies may be blocking.
        setConflicts(merged.conflicts ?? [])
        setAnomalies(merged.anomalies ?? [])
        setPhase('review')
        setError(
          merged.anomalies && merged.anomalies.length > 0
            ? `The merge was refused: ${merged.anomalies[0]?.message ?? 'the merged graph is not consistent'}`
            : `The merge was refused because ${quoted(targetGraphName)} changed since the preview. Review the differences again.`
        )
        return
      }

      setResult(merged)
      setPhase('done')
      invalidateGraphData(targetGraphId)
      onMerged?.(merged)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The merge failed')
      setPhase('review')
    }
  }, [targetGraphId, sourceGraphId, targetGraphName, resolutions, unresolvedCount, anomalies, onMerged, invalidateGraphData])

  const newVersion = result?.newVersion ?? null
  // Versions are numbered per graph, one after another, and the merge's first
  // parent is the head it diffed, so the version it replaced is the one before.
  const replacedVersion = newVersion !== null && newVersion > 1 ? newVersion - 1 : null

  const restore = useCallback(async () => {
    if (replacedVersion === null) return
    setRestoreState('restoring')
    setRestoreError(null)
    try {
      const restored = await rollback.mutateAsync({ id: targetGraphId, version: replacedVersion })
      setRestoredAsVersion(typeof restored?.restoredAsVersion === 'number' ? restored.restoredAsVersion : null)
      setRestoreState('restored')
      onRestored?.(replacedVersion)
    } catch (err) {
      setRestoreError(
        `Could not restore version ${replacedVersion}: ${err instanceof Error ? err.message : 'the request failed'}`
      )
      setRestoreState('confirming')
    }
  }, [replacedVersion, rollback, targetGraphId, onRestored])

  const busy = phase === 'analyzing' || phase === 'committing' || restoreState === 'restoring'
  // A preview writes nothing, so it can be walked away from; a merge or a
  // restore in flight cannot, or its outcome would never be shown.
  const writing = phase === 'committing' || restoreState === 'restoring'

  if (!isOpen) return null

  const target = quoted(targetGraphName)
  const source = quoted(sourceGraphName)
  const addedText = additions ? describeAdditions(additions) : null
  const blockedWithoutConflicts = anomalies.length > 0 && conflicts.length === 0

  let footerPrimary: React.ReactNode = null
  if (phase === 'idle' || phase === 'analyzing') {
    footerPrimary = (
      <button
        type="button"
        onClick={analyze}
        disabled={busy || !targetGraphId || !sourceGraphId}
        className={PRIMARY_BUTTON}
      >
        {phase === 'analyzing' ? 'Previewing…' : 'Preview merge'}
      </button>
    )
  } else if (phase === 'review' && blockedWithoutConflicts) {
    footerPrimary = (
      <button type="button" onClick={analyze} className={PRIMARY_BUTTON}>
        Preview again
      </button>
    )
  } else if (phase === 'review' || phase === 'committing') {
    footerPrimary = (
      <button
        type="button"
        onClick={commit}
        disabled={unresolvedCount > 0 || busy || anomalies.length > 0}
        className={PRIMARY_BUTTON}
      >
        {phase === 'committing' ? 'Merging…' : 'Merge branch'}
      </button>
    )
  }

  const footer = (
    <div className={FOOTER_ROW}>
      {/* Kept mounted (it is a live region) but empty, and so collapsed, when idle. */}
      <span className="text-sm text-ink-secondary empty:hidden" aria-live="polite">
        {phase === 'review' && conflicts.length > 0
          ? `${conflicts.length - unresolvedCount} of ${conflicts.length} resolved`
          : ''}
      </span>
      <div className={FOOTER_ACTIONS}>
        <button
          type="button"
          onClick={onClose}
          disabled={writing}
          className={SECONDARY_BUTTON}
        >
          {phase === 'done' ? 'Close' : 'Cancel'}
        </button>
        {footerPrimary}
      </div>
    </div>
  )

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title="Merge branch"
      size="3xl"
      closeOnEscape={!writing}
      closeOnBackdrop={false}
      showCloseButton={!writing}
      footer={footer}
    >
      <div className="space-y-4 text-sm text-ink">
        <p className="text-ink-secondary">
          From <span className="font-semibold text-ink">{source}</span> (branch) into{' '}
          <span className="font-semibold text-ink">{target}</span> (baseline).
        </p>

        {error && (
          <p role="alert" className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md p-3">
            {error}
          </p>
        )}

        {phase === 'idle' && (
          <p className="text-ink-secondary">
            Preview the merge to see what it adds and where the two histories disagree.
            Nothing is written until you merge, and the merge can be undone afterwards.
          </p>
        )}

        {phase === 'analyzing' && (
          <div role="status" className="flex items-center gap-3 py-12 justify-center text-ink-secondary">
            <svg className="animate-spin h-5 w-5 text-baseline" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Checking what the merge would change…
          </div>
        )}

        {phase === 'review' && (
          <>
            <div data-testid="merge-summary" className="space-y-1.5">
              <p>
                {addedText === null
                  ? `Merging adds every event, arc and causal link in ${source} that ${target} does not have.`
                  : addedText.length > 0
                    ? `Merging adds ${addedText} from ${source} into ${target}.`
                    : conflicts.length === 0
                      ? `${source} has nothing that ${target} lacks, so merging adds nothing.`
                      : `Merging adds no new records from ${source} into ${target}.`}{' '}
                {conflicts.length > 0 &&
                  `${conflicts.length === 1 ? '1 record exists in both and differs' : `${conflicts.length} records exist in both and differ`}; choose below which version to keep. `}
                Nothing in {target} is deleted.
              </p>
              <p className="text-ink-secondary">
                {headVersion !== null
                  ? `This creates version ${headVersion + 1}; version ${headVersion} stays in Version history and can be restored.`
                  : 'This creates a new version; the current one stays in Version history and can be restored.'}
              </p>
            </div>

            {anomalies.length > 0 && (
              <div role="alert" className="bg-amber-50 border border-amber-300 rounded-md p-3 space-y-2 text-amber-900">
                <p className="font-semibold">
                  This merge would leave the history inconsistent ({anomalies.length})
                </p>
                <ul className="space-y-1">
                  {anomalies.map((anomaly, idx) => (
                    <li key={idx}>
                      <span className="font-semibold">{anomalyLabel(anomaly.type)}:</span> {anomaly.message}
                    </li>
                  ))}
                </ul>
                <p>
                  {conflicts.length > 0
                    ? 'Change how a difference is resolved and merge again; the merge is checked again before anything is written.'
                    : 'Fix this in either graph, then preview the merge again.'}
                </p>
              </div>
            )}

            {conflicts.length > 0 && (
              <section aria-labelledby="merge-conflicts-heading">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="merge-conflicts-heading" className="font-display text-xl font-semibold">
                    {countNoun(conflicts.length, 'difference')} to resolve
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => resolveAll('keep-target')}
                      className="text-xs px-2.5 py-1 rounded-full font-medium border border-line bg-card text-ink hover:bg-subtle"
                    >
                      Keep baseline for all
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveAll('keep-source')}
                      className="text-xs px-2.5 py-1 rounded-full font-medium border border-line bg-card text-ink hover:bg-subtle"
                    >
                      Use branch for all
                    </button>
                  </div>
                </div>

                {/* One rule-separated list, not a stack of cards inside the dialog. */}
                <ul className="mt-3 divide-y divide-line border-y border-line">
                  {conflicts.map(conflict => {
                    const key = conflictKey(conflict)
                    const differing = changedKeys(conflict)
                    const conflictResolution = resolutions[key]
                    const isHarmonized = isMerged(conflictResolution)
                    const label = conflictLabel(conflict)
                    return (
                      <li
                        key={key}
                        className="py-4"
                        data-testid={`merge-conflict-${key}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-medium text-ink-secondary border border-line rounded-full px-2 py-0.5 capitalize">
                              {conflict.entityType}
                            </span>
                            <span className="font-semibold text-ink truncate">{label}</span>
                          </div>
                          <span className="text-xs text-ink-muted font-mono-code break-all">{conflict.entityId}</span>
                        </div>
  
                        {differing.length > 0 && (
                          <p className="text-xs text-ink-secondary mt-1.5">
                            Differs on: {differing.join(', ')}
                          </p>
                        )}
                        <p className="text-xs text-ink-muted mt-0.5">
                          Suggested:{' '}
                          {conflict.suggestedResolution === 'keep-target' ? 'keep baseline' : 'use branch'}
                        </p>
  
                        <fieldset className="mt-3">
                          <legend className="sr-only">Which version of {label} to keep</legend>
                          <div className="flex flex-wrap items-center gap-4">
                            <label className="flex items-center gap-1.5 text-sm text-ink">
                              <input
                                type="radio"
                                name={`resolution-${key}`}
                                checked={conflictResolution === 'keep-target'}
                                onChange={() => setResolution(key, 'keep-target')}
                              />
                              Keep baseline
                            </label>
                            <label className="flex items-center gap-1.5 text-sm text-ink">
                              <input
                                type="radio"
                                name={`resolution-${key}`}
                                checked={conflictResolution === 'keep-source'}
                                onChange={() => setResolution(key, 'keep-source')}
                              />
                              Use branch
                            </label>
                            <label className="flex items-center gap-1.5 text-sm text-ink">
                              <input
                                type="radio"
                                name={`resolution-${key}`}
                                checked={isHarmonized}
                                onChange={() => {
                                  const initialMerged = {
                                    ...conflict.targetVersion,
                                    ...conflict.sourceVersion,
                                    id: conflict.entityId,
                                  }
                                  setResolution(key, { strategy: 'merged', value: initialMerged })
                                }}
                              />
                              Combine fields
                            </label>
                          </div>
                        </fieldset>
  
                        {isHarmonized && (
                          <div className="mt-3 p-3 bg-subtle rounded-md space-y-2">
                            <h4 className="text-base font-semibold">Choose each field</h4>
                            {differing.map(field => {
                              const currentVal = conflictResolution.value[field]
                              const targetVal = conflict.targetVersion[field]
                              const sourceVal = conflict.sourceVersion[field]
                              const isTargetSelected = JSON.stringify(currentVal) === JSON.stringify(targetVal)
                              const isSourceSelected =
                                !isTargetSelected && JSON.stringify(currentVal) === JSON.stringify(sourceVal)
                              const pick = (value: unknown) =>
                                setResolution(key, {
                                  strategy: 'merged',
                                  value: {
                                    ...((resolutions[key] as MergedResolution | undefined)?.value ?? {}),
                                    [field]: value,
                                    id: conflict.entityId,
                                  },
                                })
                              const choiceClass = (selected: boolean) =>
                                `max-w-full break-words px-2 py-1 rounded-md text-xs border transition-colors text-left ${
                                  selected
                                    ? 'bg-selected/10 border-selected text-ink font-semibold'
                                    : 'bg-card border-line text-ink-secondary hover:bg-subtle'
                                }`
                              return (
                                <div
                                  key={field}
                                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs py-1 border-b border-line last:border-0"
                                >
                                  <span className="font-mono-code text-ink-secondary font-semibold">{field}</span>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      aria-pressed={isTargetSelected}
                                      onClick={() => pick(targetVal)}
                                      className={choiceClass(isTargetSelected)}
                                    >
                                      Baseline: {String(targetVal)}
                                    </button>
                                    <button
                                      type="button"
                                      aria-pressed={isSourceSelected}
                                      onClick={() => pick(sourceVal)}
                                      className={choiceClass(isSourceSelected)}
                                    >
                                      Branch: {String(sourceVal)}
                                    </button>
                                    {/* A value of the caller's own, for a
                                        compromise that is neither side. */}
                                    <input
                                      type="text"
                                      aria-label={`Custom value for ${field}`}
                                      placeholder="Your own value"
                                      value={currentVal === undefined ? '' : String(currentVal)}
                                      onChange={e => pick(e.target.value)}
                                      className={`${FIELD} w-full sm:w-36 text-xs py-1`}
                                    />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
          </>
        )}

        {phase === 'committing' && (
          <p role="status" className="py-12 text-center text-ink-secondary">
            Merging {source} into {target}…
          </p>
        )}

        {phase === 'done' && result && (
          <section aria-labelledby="merge-outcome-heading" className="space-y-3">
            <h3 id="merge-outcome-heading" className="font-display text-xl font-semibold">
              {restoreState === 'restored' ? 'Merge undone' : 'Merged'}
            </h3>

            {restoreState === 'restored' && replacedVersion !== null ? (
              <p role="status">
                {target} has the content of version {replacedVersion} again
                {restoredAsVersion !== null ? `, saved as version ${restoredAsVersion}` : ', saved as a new version'}
                . The merged version {newVersion} is still in Version history if you want it again.
              </p>
            ) : (
              <>
                <p data-testid="merge-outcome">
                  {source} is merged into {target}.{' '}
                  {addedText ? `Added ${addedText}. ` : ''}
                  {conflicts.length > 0
                    ? `${countNoun(conflicts.length, 'difference')} resolved as you chose. `
                    : ''}
                  {newVersion !== null && `${target} is now at version ${newVersion}.`}
                </p>

                {replacedVersion !== null && restoreState === 'idle' && (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-ink-secondary">
                      Version {replacedVersion}, from before the merge, is kept in Version history.
                    </p>
                    <button
                      type="button"
                      onClick={() => setRestoreState('confirming')}
                      className={SECONDARY_BUTTON}
                    >
                      Restore version {replacedVersion}
                    </button>
                  </div>
                )}

                {replacedVersion !== null &&
                  (restoreState === 'confirming' || restoreState === 'restoring') && (
                    <div
                      role="group"
                      aria-labelledby="merge-restore-question"
                      className="rounded-md border border-line bg-subtle p-3 space-y-3"
                    >
                      <p id="merge-restore-question">
                        Restore {target} to version {replacedVersion}? This undoes the merge. Version{' '}
                        {newVersion} stays in Version history, so you can return to it.
                      </p>
                      {restoreError && (
                        <p role="alert" className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md p-2">
                          {restoreError}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={restore}
                          disabled={restoreState === 'restoring'}
                          className={PRIMARY_BUTTON}
                        >
                          {restoreState === 'restoring'
                            ? 'Restoring…'
                            : `Yes, restore version ${replacedVersion}`}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRestoreState('idle')
                            setRestoreError(null)
                          }}
                          disabled={restoreState === 'restoring'}
                          className={SECONDARY_BUTTON}
                        >
                          Keep the merge
                        </button>
                      </div>
                    </div>
                  )}
              </>
            )}
          </section>
        )}
      </div>
    </ModalBase>
  )
})
