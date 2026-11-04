import React, { useState, useCallback, useId } from 'react'
import { useGraphCopy } from '@/hooks/useGraphCopy'
import { useActiveGraph, useBranchGraph, useSwitchGraph } from '@/hooks/useGraphs'
import { useGlobalStore } from '@/stores/globalStore'
import { useEvents, useArcs } from '@/hooks/useAPI'
import { TimeRangeSelector } from '@/components/filters/TimeRangeSelector'
import { ModalBase } from '@/components/modals/ModalBase'
import { EntityFilter, Graph } from '@/types'

interface GraphCopyModalProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * What the dialog makes. A branch (POST /graphs/:id/branch) records the graph
 * it came from, so it is listed among that graph's branches; the three copies
 * (POST /graphs/copy) are independent graphs with no link back.
 */
type CopyType = 'branch' | 'full' | 'time_range' | 'filtered'

const EMPTY_FILTER: EntityFilter = {
  actors: [],
  targets: [],
  event_types: [],
  confidence_threshold: 0.5
}

/**
 * "Branch or copy this graph" (Graph menu, Shift+B).
 *
 * The default is a branch: a what-if fork of the whole graph that keeps the
 * active graph as its baseline. The other three options are plain copies,
 * named as copies, because that is all they are.
 */
export const GraphCopyModal: React.FC<GraphCopyModalProps> = ({ isOpen, onClose }) =>
  // Mounted only while open: every opening starts from a fresh form, and a
  // closed dialog runs no queries.
  isOpen ? <GraphCopyDialog onClose={onClose} /> : null

const GraphCopyDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  // The views read entities through React Query, not the global store (which
  // nothing fills), so the store's lists made this dialog say "0 events, 0
  // arcs". Same query and key as the Timeline view, so it is usually cached.
  const activeFilters = useGlobalStore((state) => state.activeFilters)
  const { data: events = [] } = useEvents({ limit: 1000 })
  const { data: arcs = [] } = useArcs()
  const {
    copyState,
    setCopyName,
    setSelectedTimeRange,
    setSelectedFilter,
    createFullCopy,
    createTimeRangeCopy,
    createFilteredCopy,
    isCreatingCopy
  } = useGraphCopy()
  const { data: activeGraph } = useActiveGraph()
  const branchGraph = useBranchGraph()
  const switchGraph = useSwitchGraph()

  const nameId = useId()
  const descriptionId = useId()
  const kindLabelId = useId()

  const [selectedCopyType, setSelectedCopyType] = useState<CopyType>('branch')
  const [filterConfig, setFilterConfig] = useState<EntityFilter>(EMPTY_FILTER)
  const [branchDescription, setBranchDescription] = useState('')
  const [createdBranch, setCreatedBranch] = useState<Graph | null>(null)
  const [branchError, setBranchError] = useState<string | null>(null)

  // Get unique actors and targets for filter options
  const uniqueActors = Array.from(new Set(events.map(e => e.actor))).sort()
  const uniqueTargets = Array.from(new Set(events.map(e => e.target))).sort()

  const graphName = activeGraph?.name ?? 'the active graph'
  // The graph's own counts are the whole graph; the lists above are capped by
  // the API's page size, so they are only the fallback while the graph loads.
  const eventCount = activeGraph?.metadata?.eventCount ?? events.length
  const arcCount = activeGraph?.metadata?.arcCount ?? arcs.length
  const countSummary = `${eventCount} ${eventCount === 1 ? 'event' : 'events'}, ${arcCount} ${arcCount === 1 ? 'arc' : 'arcs'}`
  const isBranch = selectedCopyType === 'branch'
  const isBusy = isCreatingCopy || branchGraph.isPending
  const trimmedName = copyState.copyName.trim()
  const canSubmit = trimmedName.length > 0 && !isBusy && (!isBranch || !!activeGraph)

  const handleCreateBranch = useCallback(async () => {
    if (!activeGraph) return
    setBranchError(null)
    try {
      const branch = await branchGraph.mutateAsync({
        id: activeGraph.id,
        data: {
          branchName: copyState.copyName.trim(),
          description: branchDescription.trim() || undefined
        }
      })
      setCreatedBranch(branch)
      setCopyName('')
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : ''
      setBranchError(message ? (/[.!?]$/.test(message) ? message : `${message}.`) : 'The server did not say why.')
    }
  }, [activeGraph, branchGraph, copyState.copyName, branchDescription, setCopyName])

  const handleCreateCopy = useCallback(async () => {
    try {
      switch (selectedCopyType) {
        case 'branch':
          await handleCreateBranch()
          // The dialog stays open to offer "Switch to branch".
          return
        case 'full':
          await createFullCopy()
          break
        case 'time_range':
          await createTimeRangeCopy()
          break
        case 'filtered':
          // Pass the configured filter directly rather than relying on the
          // store round-trip, which has not committed within this same tick.
          await createFilteredCopy(filterConfig)
          break
      }
      // A copy is announced by the completion notice, so the dialog closes.
      onClose()
    } catch (error) {
      // Don't close on error - let the hook handle error state
      console.error('Failed to create copy:', error)
    }
  }, [
    selectedCopyType,
    handleCreateBranch,
    createFullCopy,
    createTimeRangeCopy,
    createFilteredCopy,
    filterConfig,
    onClose
  ])

  const handleUseCurrentFilters = useCallback(() => {
    const currentFilter: EntityFilter = {
      actors: activeFilters.actors,
      targets: activeFilters.targets,
      event_types: activeFilters.eventTypes,
      confidence_threshold: activeFilters.confidenceThreshold
    }
    setFilterConfig(currentFilter)
    setSelectedFilter(currentFilter)
  }, [activeFilters, setSelectedFilter])

  const handleSwitchToBranch = useCallback(() => {
    if (createdBranch) switchGraph.mutate(createdBranch.id)
    onClose()
  }, [createdBranch, switchGraph, onClose])

  const buttonBase =
    'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-selected focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
  const primaryButton = `${buttonBase} bg-baseline text-on-accent hover:bg-baseline/80`
  const secondaryButton = `${buttonBase} border border-line bg-card text-ink-secondary hover:bg-subtle hover:text-ink`
  const fieldClass =
    'w-full px-3 py-2 border border-line bg-card text-ink rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-selected'

  const options: { value: CopyType; label: string; detail: string }[] = [
    {
      value: 'branch',
      label: 'Branch',
      detail: `A what-if fork of the whole graph (${countSummary}). It keeps ${graphName} as its baseline, so you can compare the two and merge the branch back later.`
    },
    {
      value: 'full',
      label: 'Full copy',
      detail: 'An independent duplicate of every event, arc and relationship, with no link back to this graph.'
    },
    {
      value: 'time_range',
      label: 'Time-range copy',
      detail: 'Only the events and arcs inside a time period, as an independent graph.'
    },
    {
      value: 'filtered',
      label: 'Filtered copy',
      detail: 'Only the events matching actors, targets and a confidence threshold, as an independent graph.'
    }
  ]

  const submitLabel = isBranch
    ? (branchGraph.isPending ? 'Creating branch…' : 'Create branch')
    : (isCreatingCopy ? 'Creating copy…' : 'Create copy')

  const footer = createdBranch ? (
    <div className="flex flex-wrap justify-end gap-3">
      <button type="button" onClick={onClose} className={secondaryButton}>
        Stay on {graphName}
      </button>
      <button type="button" onClick={handleSwitchToBranch} className={primaryButton}>
        Switch to branch
      </button>
    </div>
  ) : (
    <div className="flex flex-wrap justify-end gap-3">
      <button type="button" onClick={onClose} className={secondaryButton} disabled={isBusy}>
        Cancel
      </button>
      <button
        type="button"
        onClick={handleCreateCopy}
        disabled={!canSubmit}
        className={primaryButton}
      >
        {isBusy && (
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        )}
        {submitLabel}
      </button>
    </div>
  )

  return (
    <ModalBase
      isOpen
      onClose={onClose}
      title="Branch or copy this graph"
      size="2xl"
      footer={footer}
      closeOnEscape={!isBusy}
      closeOnBackdrop={!isBusy}
    >
      {createdBranch ? (
        <div role="status" className="space-y-2 text-sm text-ink-secondary">
          <p className="text-ink">
            Branch <span className="font-medium">{createdBranch.name}</span> created.
          </p>
          <p>{graphName} is unchanged. Switch to the branch to start changing its history.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* What to make */}
          <div>
            <p id={kindLabelId} className="block text-sm font-medium text-ink mb-3">
              What to make
            </p>
            <div role="radiogroup" aria-labelledby={kindLabelId} className="space-y-3">
              {options.map((option) => (
                <label key={option.value} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="copyType"
                    value={option.value}
                    checked={selectedCopyType === option.value}
                    onChange={(e) => setSelectedCopyType(e.target.value as CopyType)}
                    className="mt-1 accent-[var(--accent-selected)]"
                    disabled={isBusy}
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">{option.label}</span>
                    <span className="block text-sm text-ink-secondary">{option.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label htmlFor={nameId} className="block text-sm font-medium text-ink mb-2">
              {isBranch ? 'Branch name' : 'Copy name'}
            </label>
            <input
              id={nameId}
              type="text"
              value={copyState.copyName}
              onChange={(e) => setCopyName(e.target.value)}
              placeholder={isBranch ? 'e.g. Clerks Prevail' : 'e.g. Engine Age (1840s only)'}
              required
              maxLength={255}
              className={fieldClass}
              disabled={isBusy}
            />
          </div>

          {/* Branch description */}
          {isBranch && (
            <div>
              <label htmlFor={descriptionId} className="block text-sm font-medium text-ink mb-2">
                Description <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <textarea
                id={descriptionId}
                value={branchDescription}
                onChange={(e) => setBranchDescription(e.target.value)}
                rows={2}
                placeholder="What changes in this branch?"
                className={fieldClass}
                disabled={isBusy}
              />
            </div>
          )}

          {isBranch && branchError && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-200"
            >
              Couldn't create the branch: {branchError} Nothing was changed; try again.
            </div>
          )}

          {/* Time range */}
          {selectedCopyType === 'time_range' && (
            <fieldset className="p-4 bg-subtle rounded-lg border border-line">
              <legend className="px-1 text-sm font-semibold text-ink">Time range</legend>
              <TimeRangeSelector
                value={copyState.selectedTimeRange}
                onChange={setSelectedTimeRange}
                disabled={isBusy}
                showPresets={true}
              />
            </fieldset>
          )}

          {/* Filters */}
          {selectedCopyType === 'filtered' && (
            <fieldset className="p-4 bg-subtle rounded-lg border border-line">
              <legend className="px-1 text-sm font-semibold text-ink">Filters</legend>
              <div className="flex justify-end mb-3">
                <button
                  type="button"
                  onClick={handleUseCurrentFilters}
                  className="text-sm text-baseline hover:underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-selected rounded"
                  disabled={isBusy}
                >
                  Use current filters
                </button>
              </div>

              <div className="space-y-4">
                {/* Actors Filter */}
                <div>
                  <label htmlFor="actors-select" className="block text-sm font-medium text-ink mb-2">
                    Actors
                  </label>
                  <select
                    id="actors-select"
                    multiple
                    value={filterConfig.actors || []}
                    onChange={(e) => {
                      const selected = Array.from(e.target.selectedOptions, option => option.value)
                      setFilterConfig(prev => ({ ...prev, actors: selected }))
                    }}
                    aria-describedby="actors-help"
                    className={`${fieldClass} h-24`}
                    disabled={isBusy}
                  >
                    {uniqueActors.map(actor => (
                      <option key={actor} value={actor}>
                        {actor}
                      </option>
                    ))}
                  </select>
                  <p id="actors-help" className="text-xs text-ink-muted mt-1">
                    Hold Ctrl/Cmd to select multiple actors
                  </p>
                </div>

                {/* Targets Filter */}
                <div>
                  <label htmlFor="targets-select" className="block text-sm font-medium text-ink mb-2">
                    Targets
                  </label>
                  <select
                    id="targets-select"
                    multiple
                    value={filterConfig.targets || []}
                    onChange={(e) => {
                      const selected = Array.from(e.target.selectedOptions, option => option.value)
                      setFilterConfig(prev => ({ ...prev, targets: selected }))
                    }}
                    aria-describedby="targets-help"
                    className={`${fieldClass} h-24`}
                    disabled={isBusy}
                  >
                    {uniqueTargets.map(target => (
                      <option key={target} value={target}>
                        {target}
                      </option>
                    ))}
                  </select>
                  <p id="targets-help" className="text-xs text-ink-muted mt-1">
                    Hold Ctrl/Cmd to select multiple targets
                  </p>
                </div>

                {/* Confidence Threshold */}
                <div>
                  <label htmlFor="confidence-threshold" className="block text-sm font-medium text-ink mb-2">
                    Confidence threshold: <span className="font-mono-code">{filterConfig.confidence_threshold}</span>
                  </label>
                  <input
                    id="confidence-threshold"
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={filterConfig.confidence_threshold || 0.5}
                    onChange={(e) => setFilterConfig(prev => ({
                      ...prev,
                      confidence_threshold: parseFloat(e.target.value)
                    }))}
                    aria-valuemin={0}
                    aria-valuemax={1}
                    aria-valuenow={filterConfig.confidence_threshold || 0.5}
                    className="w-full accent-[var(--accent-selected)]"
                    disabled={isBusy}
                  />
                  <div className="flex justify-between text-xs text-ink-muted mt-1">
                    <span className="font-mono-code">0.0 (low)</span>
                    <span className="font-mono-code">1.0 (high)</span>
                  </div>
                </div>
              </div>
            </fieldset>
          )}
        </div>
      )}
    </ModalBase>
  )
}
