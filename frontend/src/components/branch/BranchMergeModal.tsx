import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '@/services/api'
import type {
  GraphMergeResponse,
  ManualResolution,
  MergeConflict,
} from '@/types'

export interface BranchMergeModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  /** Graph that receives the merge (the baseline). */
  readonly targetGraphId: string
  readonly targetGraphName: string
  /** Graph being merged in (the counterfactual branch). */
  readonly sourceGraphId: string
  readonly sourceGraphName: string
  readonly onMerged?: (result: GraphMergeResponse) => void
}

type Phase = 'idle' | 'analyzing' | 'conflicts' | 'committing' | 'done'

/** Conflicts are keyed exactly the way the merge API expects. */
function conflictKey(conflict: Pick<MergeConflict, 'entityType' | 'entityId'>): string {
  return `${conflict.entityType}:${conflict.entityId}`
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

/**
 * Git-style conflict resolver for merging a counterfactual branch into a
 * baseline graph.
 *
 * The flow is two calls to `POST /graphs/:id/merge`:
 *   1. a dry run (`dryRun: true`) that reports the conflicts without writing;
 *   2. a commit carrying one `manualResolution` per conflict.
 *
 * The merge API resolves a conflict per entity by choosing a side, so those are
 * the only two controls offered. A field-level "harmonized compromise" would
 * need the API to accept a merged payload, which it does not today; offering
 * such a button would silently degrade to one of the two sides, so it is
 * deliberately absent.
 */
export const BranchMergeModal = React.memo(function BranchMergeModal({
  isOpen,
  onClose,
  targetGraphId,
  targetGraphName,
  sourceGraphId,
  sourceGraphName,
  onMerged,
}: BranchMergeModalProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [conflicts, setConflicts] = useState<MergeConflict[]>([])
  const [resolutions, setResolutions] = useState<Record<string, ManualResolution>>({})
  const [result, setResult] = useState<GraphMergeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A fresh pair of graphs means a fresh merge: drop the previous analysis.
  useEffect(() => {
    if (isOpen) {
      setPhase('idle')
      setConflicts([])
      setResolutions({})
      setResult(null)
      setError(null)
    }
  }, [isOpen, targetGraphId, sourceGraphId])

  const analyze = useCallback(async () => {
    if (!targetGraphId || !sourceGraphId) return
    setPhase('analyzing')
    setError(null)

    try {
      const preview = await apiClient.graphs.mergeDetailed(targetGraphId, {
        sourceGraphId,
        conflictResolution: 'manual',
        dryRun: true,
      })

      if (preview.success) {
        setConflicts([])
        setResolutions({})
        setPhase('conflicts')
        return
      }

      setConflicts(preview.conflicts ?? [])
      // Conflicts start unresolved on purpose: pre-selecting the suggested side
      // would let a commit go through without the caller ever seeing which
      // entities were going to be overwritten.
      setResolutions({})
      setPhase('conflicts')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not analyze the merge')
      setPhase('idle')
    }
  }, [targetGraphId, sourceGraphId])

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
    if (unresolvedCount > 0) return

    setPhase('committing')
    setError(null)

    try {
      const merged = await apiClient.graphs.mergeDetailed(targetGraphId, {
        sourceGraphId,
        conflictResolution: 'manual',
        manualResolutions: resolutions,
      })

      if (!merged.success) {
        // The target may have advanced since the dry run. Re-seed the resolver
        // with the fresh conflicts rather than retrying blindly.
        setConflicts(merged.conflicts ?? [])
        setPhase('conflicts')
        setError('The merge was refused because conflicts changed. Review them and try again.')
        return
      }

      setResult(merged)
      setPhase('done')
      onMerged?.(merged)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Merge failed')
      setPhase('conflicts')
    }
  }, [targetGraphId, sourceGraphId, resolutions, unresolvedCount, onMerged])

  if (!isOpen) return null

  const direction = `${sourceGraphName} → ${targetGraphName}`
  const busy = phase === 'analyzing' || phase === 'committing'

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-gray-200">
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <span>🔀</span> Merge Branch
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{direction}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-md transition-colors"
            aria-label="Close dialog"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50 space-y-4">
          {error && (
            <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-3">
              {error}
            </p>
          )}

          {phase === 'idle' && (
            <div className="bg-white rounded-lg border border-gray-200 p-4 text-xs text-gray-600">
              <p>
                Analyze the branch against the baseline before writing anything. The dry run
                reports every entity that differs so you can decide which side survives.
              </p>
              <button
                type="button"
                onClick={analyze}
                disabled={busy || !targetGraphId || !sourceGraphId}
                className="mt-3 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 rounded-lg transition-colors"
              >
                Analyze Merge
              </button>
            </div>
          )}

          {phase === 'analyzing' && (
            <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
              <svg className="animate-spin h-6 w-6 mr-3 text-indigo-600" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Running pre-merge analysis…
            </div>
          )}

          {phase === 'conflicts' && (
            <>
              {conflicts.length === 0 ? (
                <div className="bg-white rounded-lg border border-green-200 p-4">
                  <h3 className="text-sm font-bold text-green-800">Fast-forward merge</h3>
                  <p className="text-xs text-gray-600 mt-1">
                    No conflicting entities were found. Committing applies every branch addition
                    and modification.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-gray-900">
                      {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'} to resolve
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => resolveAll('keep-target')}
                        className="text-[11px] px-2.5 py-1 rounded-full font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-100"
                      >
                        Keep all baseline
                      </button>
                      <button
                        type="button"
                        onClick={() => resolveAll('keep-source')}
                        className="text-[11px] px-2.5 py-1 rounded-full font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-100"
                      >
                        Accept all branch
                      </button>
                    </div>
                  </div>

                  {conflicts.map(conflict => {
                    const key = conflictKey(conflict)
                    const differing = changedKeys(conflict)
                    return (
                      <div
                        key={key}
                        className="bg-white rounded-lg border border-gray-200 p-4"
                        data-testid={`merge-conflict-${key}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                              {conflict.entityType}
                            </span>
                            <span className="text-xs font-semibold text-gray-900">
                              {conflictLabel(conflict)}
                            </span>
                          </div>
                          <span className="text-[10px] text-gray-400">{conflict.entityId}</span>
                        </div>

                        {differing.length > 0 && (
                          <p className="text-[11px] text-gray-500 mt-1.5">
                            Differs on: {differing.join(', ')}
                          </p>
                        )}
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          Suggested:{' '}
                          {conflict.suggestedResolution === 'keep-target'
                            ? 'keep baseline'
                            : 'accept counterfactual'}
                        </p>

                        <div className="flex flex-wrap items-center gap-4 mt-3">
                          <label className="flex items-center gap-1.5 text-xs text-gray-700">
                            <input
                              type="radio"
                              name={`resolution-${key}`}
                              checked={resolutions[key] === 'keep-target'}
                              onChange={() => setResolutions(prev => ({ ...prev, [key]: 'keep-target' }))}
                            />
                            Keep baseline
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-gray-700">
                            <input
                              type="radio"
                              name={`resolution-${key}`}
                              checked={resolutions[key] === 'keep-source'}
                              onChange={() => setResolutions(prev => ({ ...prev, [key]: 'keep-source' }))}
                            />
                            Accept counterfactual
                          </label>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="text-[11px] text-gray-500">
                A field-level harmonized compromise needs the merge API to accept a merged
                payload, which it does not today. Resolve by choosing a side, then edit the
                surviving entity afterward if you want to blend the two.
              </div>
            </>
          )}

          {phase === 'committing' && (
            <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
              Committing merge…
            </div>
          )}

          {phase === 'done' && result?.graph && (
            <div className="bg-white rounded-lg border border-green-200 p-4">
              <h3 className="text-sm font-bold text-green-800">Merge complete</h3>
              <p className="text-xs text-gray-600 mt-1">
                {targetGraphName} is now version {result.newVersion ?? result.graph.version}.
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {phase === 'conflicts' && conflicts.length > 0
              ? `${conflicts.length - unresolvedCount}/${conflicts.length} resolved`
              : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
            >
              {phase === 'done' ? 'Close' : 'Cancel'}
            </button>
            {phase === 'conflicts' && (
              <button
                type="button"
                onClick={commit}
                disabled={unresolvedCount > 0 || busy}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {conflicts.length === 0 ? 'Merge Branch' : 'Commit Resolutions'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
