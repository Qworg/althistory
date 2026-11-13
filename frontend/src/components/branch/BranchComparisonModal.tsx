import React, { useState, useEffect, useMemo, useCallback, useId, useRef } from 'react'
import { Event, Arc, CausalRelationship } from '@/types'
import { useGraphs, useActiveGraphId, useSwitchGraph } from '@/hooks/useGraphs'
import { apiClient } from '@/services/api'
import {
  analyzeEventDivergence,
  analyzeRelationshipDivergence,
  comparisonCalendar,
  comparisonSide,
  type ComparisonCalendars,
  type EventComparisonItem,
} from '@/utils/divergenceAnalysis'
import { useViewOfCalendars, useWorldCalendar } from '@/stores/worldCalendarStore'
import { sameCalendarSet, storedCalendarSet } from '@althistory/calendar'
import { ModalBase } from '@/components/modals/ModalBase'
import { branchLabel } from '@/components/graphs/graphTree'
import { CounterfactualTimelineCanvas } from './CounterfactualTimelineCanvas'
import { BranchMergeModal } from './BranchMergeModal'
import {
  SECONDARY_BUTTON,
  FIELD,
  FOOTER_ROW,
  FOOTER_ACTIONS,
  countNoun,
  quoted,
} from './branchUi'
import { CausalGraphComponent } from '@/components/causal-graph/CausalGraphComponent'
import { formatHistoricalDate, formatEventDate } from '@/utils/historicalTime'

export interface BranchComparisonModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly initialBaselineGraphId?: string
  readonly initialCounterfactualGraphId?: string
  readonly originalGraphName?: string
  readonly copiedGraphName?: string
  readonly originalData?: {
    events: Event[]
    arcs: Arc[]
    relationships: CausalRelationship[]
  }
  readonly copiedData?: {
    events: Event[]
    arcs: Arc[]
    relationships: CausalRelationship[]
  }
}

// Read-only views. Simulating forward writes, so it lives in the Graph menu
// with the branch, not in a dialog opened to compare.
type ActiveTab = 'timeline' | 'causal' | 'diff' | 'summary'
type DiffFilter = 'changes' | 'all' | 'divergent' | 'shared' | 'baseline_only' | 'modified'
type DiffStatus = 'shared' | 'divergent_added' | 'baseline_only' | 'modified'

interface GraphDataState {
  events: Event[]
  arcs: Arc[]
  relationships: CausalRelationship[]
  isLoading: boolean
  error: string | null
}

const EMPTY_DATA: GraphDataState = {
  events: [],
  arcs: [],
  relationships: [],
  isLoading: false,
  error: null,
}

const ICON_PROPS = {
  className: 'w-4 h-4 shrink-0',
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  'aria-hidden': true,
} as const

const TABS: ReadonlyArray<{ id: ActiveTab; label: string; icon: React.ReactNode }> = [
  {
    id: 'timeline',
    label: 'Timeline',
    icon: (
      <svg {...ICON_PROPS}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 17h18M8 7v10m8-10v10" />
      </svg>
    ),
  },
  {
    id: 'causal',
    label: 'Causal graph',
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <circle cx="12" cy="18" r="2.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 6h7M7.5 8l3.5 7.5M16.5 8L13 15.5" />
      </svg>
    ),
  },
  {
    id: 'diff',
    label: 'Differences',
    icon: (
      <svg {...ICON_PROPS}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: 'summary',
    label: 'Summary',
    icon: (
      <svg {...ICON_PROPS}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
]

const STATUS_BADGES: Record<DiffStatus, { label: string; className: string }> = {
  shared: { label: 'Shared', className: 'border-baseline/40 bg-baseline/10 text-ink' },
  divergent_added: { label: 'Added in branch', className: 'border-divergence/60 bg-divergence/15 text-ink' },
  modified: { label: 'Changed', className: 'border-divergence/60 bg-card text-ink' },
  baseline_only: { label: 'Only in baseline', className: 'border-line bg-subtle text-ink-secondary' },
}

const FIELD_NAMES: Record<string, string> = {
  description: 'Reworded',
  actor: 'Actor',
  target: 'Target',
  timestamp: 'Date',
}

/**
 * What differs, without repeating the event (the Event column already names
 * it): "Date: Mar 2, 1838 → Jun 1, 1840", "Actor: Peel → Wellington".
 */
function describeDifference(item: EventComparisonItem, calendars: ComparisonCalendars): string {
  switch (item.status) {
    case 'divergent_added':
      return 'Happens only in the branch'
    case 'baseline_only':
      return 'Dropped by the branch'
    case 'shared':
      return 'Same in both'
    case 'modified':
      return (item.changes ?? [])
        .map((change) => {
          const name = FIELD_NAMES[change.field] ?? change.field
          if (change.field === 'description') return name
          // Each side's date in its own graph's calendar, at the precision that side gives it.
          const show = (value: unknown, side: 'baseline' | 'counterfactual') =>
            change.field === 'timestamp' && typeof value === 'string'
              ? formatEventDate(
                  { timestamp: value, metadata: (side === 'baseline' ? item.baselineEvent : item.counterfactualEvent)?.metadata },
                  undefined,
                  comparisonCalendar(side, calendars)
                )
              : String(value)
          return `${name}: ${show(change.baselineValue, 'baseline')} → ${show(change.counterfactualValue, 'counterfactual')}`
        })
        .join(' · ') || 'Changed'
    default:
      return item.diffSummary ?? ""
  }
}

/** One figure in the at-a-glance strip; rules between them from md. */
const STAT = 'min-w-0 md:px-4 md:first:pl-0 md:last:pr-0'

/** The point-of-divergence glyph: an amber diamond, drawn rather than typed. */
function DivergenceDiamond() {
  return (
    <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" aria-hidden="true">
      <polygon points="6,0.5 11.5,6 6,11.5 0.5,6" style={{ fill: 'var(--accent-divergence)' }} />
    </svg>
  )
}

/** Fetch one graph's events, arcs and relationships, unless they were handed in. */
function useGraphData(
  isOpen: boolean,
  graphId: string,
  provided: BranchComparisonModalProps['originalData'],
  reloadToken: number,
  fallbackError: string
): GraphDataState {
  const [data, setData] = useState<GraphDataState>(EMPTY_DATA)

  useEffect(() => {
    if (!isOpen) return

    if (provided) {
      setData({ ...provided, isLoading: false, error: null })
      return
    }

    if (!graphId) return

    let cancelled = false
    setData(prev => ({ ...prev, isLoading: true, error: null }))

    Promise.all([
      apiClient.events.getAll(undefined, { graphId }),
      apiClient.arcs.getAll(undefined, { graphId }),
      apiClient.causal.getRelationships(undefined, { graphId }),
    ])
      .then(([events, arcs, relationships]) => {
        if (!cancelled) {
          setData({
            events: events || [],
            arcs: arcs || [],
            relationships: relationships || [],
            isLoading: false,
            error: null,
          })
        }
      })
      .catch(err => {
        if (!cancelled) {
          setData(prev => ({
            ...prev,
            isLoading: false,
            error: err instanceof Error ? err.message : fallbackError,
          }))
        }
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, graphId, provided, reloadToken, fallbackError])

  return data
}

/**
 * "Compare branches": a baseline graph and a counterfactual branch side by
 * side, aligned at the point of divergence, with the merge and forward
 * simulation reachable from the same place.
 */
export const BranchComparisonModal: React.FC<BranchComparisonModalProps> = ({
  isOpen,
  onClose,
  initialBaselineGraphId,
  initialCounterfactualGraphId,
  originalGraphName,
  copiedGraphName,
  originalData,
  copiedData,
}) => {
  const activeGraphId = useActiveGraphId()
  const { data: graphsData } = useGraphs()
  const graphList = useMemo(() => graphsData?.graphs ?? [], [graphsData])
  const switchGraphMutation = useSwitchGraph()

  const baseId = useId()
  const tabRefs = useRef<Partial<Record<ActiveTab, HTMLButtonElement | null>>>({})

  const [activeTab, setActiveTab] = useState<ActiveTab>('timeline')
  const [showNextSteps, setShowNextSteps] = useState(false)
  // Opens on what differs: the shared history would bury the few changes.
  const [diffFilter, setDiffFilter] = useState<DiffFilter>('changes')

  const [baselineGraphId, setBaselineGraphId] = useState<string>('')
  const [counterfactualGraphId, setCounterfactualGraphId] = useState<string>('')

  // Bumped after a simulation run, a merge or a restore so both graphs are
  // fetched again: a simulation writes to the branch, a merge or restore to
  // the baseline.
  const [reloadToken, setReloadToken] = useState(0)
  const reload = useCallback(() => setReloadToken(token => token + 1), [])
  // Merging is a step of this dialog, not a second dialog stacked on it: the
  // comparison is what the merge is decided from, and "Back" returns to it.
  const [step, setStep] = useState<'compare' | 'merge'>('compare')
  // While the merge writes, Escape must not close the dialog under it.
  const [mergeWriting, setMergeWriting] = useState(false)
  useEffect(() => {
    if (!isOpen) {
      setStep('compare')
      setMergeWriting(false)
    }
  }, [isOpen])
  // Back from the merge step lands on the button that opened it.
  const mergeOpenerRef = useRef<HTMLButtonElement>(null)
  const returnFocusToOpener = useRef(false)
  const backToComparison = useCallback(() => {
    returnFocusToOpener.current = true
    setStep('compare')
  }, [])
  useEffect(() => {
    if (step === 'compare' && returnFocusToOpener.current) {
      returnFocusToOpener.current = false
      mergeOpenerRef.current?.focus()
    }
  }, [step])

  // Initialize selected graphs when modal opens
  useEffect(() => {
    if (!isOpen) return

    if (initialBaselineGraphId) {
      setBaselineGraphId(initialBaselineGraphId)
    } else if (activeGraphId) {
      setBaselineGraphId(activeGraphId)
    } else if (graphList.length > 0 && graphList[0]) {
      setBaselineGraphId(graphList[0].id)
    }

    if (initialCounterfactualGraphId) {
      setCounterfactualGraphId(initialCounterfactualGraphId)
    } else if (graphList.length > 1) {
      // Pick first non-baseline branch if possible
      const candidate = graphList.find(g => g.id !== (initialBaselineGraphId || activeGraphId))
      if (candidate) setCounterfactualGraphId(candidate.id)
    }
  }, [isOpen, initialBaselineGraphId, initialCounterfactualGraphId, activeGraphId, graphList])

  const baselineData = useGraphData(isOpen, baselineGraphId, originalData, reloadToken, 'Could not load the baseline')
  const counterfactualData = useGraphData(isOpen, counterfactualGraphId, copiedData, reloadToken, 'Could not load the branch')

  // Each graph's own world calendar, not the open graph's: comparing two other
  // graphs must not label their dates in a third one's years. A graph of the
  // open graph's world is shown in the calendar the viewer picked, and one
  // missing from the list falls back to the open graph's (subscribed, so it updates).
  const activeCalendar = useWorldCalendar()
  const viewOf = useViewOfCalendars()
  const calendars = useMemo<ComparisonCalendars>(() => {
    const of = (id: string) => {
      const graph = graphList.find(g => g.id === id)
      return graph ? viewOf(storedCalendarSet(graph.calendar)) : activeCalendar
    }
    return { baseline: of(baselineGraphId), counterfactual: of(counterfactualGraphId) }
  }, [graphList, baselineGraphId, counterfactualGraphId, activeCalendar, viewOf])
  const calendarsDiffer = !sameCalendarSet(calendars.baseline, calendars.counterfactual)
  /** The calendar for a date from one side, or one both share (see comparisonCalendar). */
  const calendarFor = useCallback(
    (status: Parameters<typeof comparisonSide>[0]) => comparisonCalendar(comparisonSide(status), calendars),
    [calendars]
  )

  // Compute divergence analysis between baseline and counterfactual datasets
  const divergenceAnalysis = useMemo(() => {
    return analyzeEventDivergence(baselineData.events, counterfactualData.events, calendars)
  }, [baselineData.events, counterfactualData.events, calendars])

  const relationshipDiff = useMemo(() => {
    return analyzeRelationshipDivergence(baselineData.relationships, counterfactualData.relationships)
  }, [baselineData.relationships, counterfactualData.relationships])

  const { items: eventDiffItems, metrics } = divergenceAnalysis

  // What only the branch has, for the causal tab's diff colouring.
  const branchAddedIds = useMemo(
    () => [
      ...eventDiffItems.filter(i => i.status === 'divergent_added').map(i => i.id),
      ...relationshipDiff.filter(r => r.status === 'added').map(r => r.id),
    ],
    [eventDiffItems, relationshipDiff]
  )

  // Names of selected graphs
  const resolvedBaselineName = useMemo(() => {
    if (originalGraphName) return originalGraphName
    const found = graphList?.find(g => g.id === baselineGraphId)
    return found ? (found.branchName || found.name) : 'Baseline'
  }, [originalGraphName, graphList, baselineGraphId])

  // A branch by its own name and what it branches from, as everywhere else:
  // "Clerks Prevail (branch of The Engine Age)".
  const optionLabel = useCallback(
    (g: { id: string; name: string; parentGraphId?: string }) => {
      const parent = g.parentGraphId ? graphList?.find(other => other.id === g.parentGraphId) ?? null : null
      return parent ? `${branchLabel(g as Parameters<typeof branchLabel>[0], parent)} (branch of ${parent.name})` : g.name
    },
    [graphList]
  )

  const resolvedCounterfactualName = useMemo(() => {
    if (copiedGraphName) return copiedGraphName
    const found = graphList?.find(g => g.id === counterfactualGraphId)
    if (!found) return 'Branch'
    // Its own name, as in the graph selector ("Clerks Prevail", not
    // "The Engine Age — Clerks Prevail"): the baseline is named beside it.
    const parent = found.parentGraphId ? graphList?.find(g => g.id === found.parentGraphId) ?? null : null
    return branchLabel(found, parent)
  }, [copiedGraphName, graphList, counterfactualGraphId])

  // Filtered event diff items
  const filteredEventDiff = useMemo(() => {
    switch (diffFilter) {
      case 'changes':
        return eventDiffItems.filter(i => i.status !== 'shared')
      case 'divergent':
        return eventDiffItems.filter(i => i.status === 'divergent_added')
      case 'shared':
        return eventDiffItems.filter(i => i.status === 'shared')
      case 'baseline_only':
        return eventDiffItems.filter(i => i.status === 'baseline_only')
      case 'modified':
        return eventDiffItems.filter(i => i.status === 'modified')
      default:
        return eventDiffItems
    }
  }, [eventDiffItems, diffFilter])

  // Point of Divergence event ID (if applicable) for CausalGraph highlighting
  const podEventIds = useMemo(() => {
    if (!metrics.pointOfDivergence?.event?.id) return []
    return [metrics.pointOfDivergence.event.id]
  }, [metrics.pointOfDivergence])

  const handleSwitchToBranch = useCallback(() => {
    if (!counterfactualGraphId) return
    switchGraphMutation.mutate(counterfactualGraphId, {
      onSuccess: () => {
        onClose()
      },
    })
  }, [counterfactualGraphId, switchGraphMutation, onClose])

  /** Arrow keys, Home and End move between tabs and select the one reached. */
  const handleTabKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex(tab => tab.id === activeTab)
    let next: number | null = null
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1
    if (next === null) return
    event.preventDefault()
    const nextTab = TABS[next]
    if (!nextTab) return
    setActiveTab(nextTab.id)
    tabRefs.current[nextTab.id]?.focus()
  }, [activeTab])

  if (!isOpen) return null

  const isLoading = baselineData.isLoading || counterfactualData.isLoading
  const loadError = baselineData.error
    ? `Could not load ${quoted(resolvedBaselineName)}: ${baselineData.error}`
    : counterfactualData.error
      ? `Could not load ${quoted(resolvedCounterfactualName)}: ${counterfactualData.error}`
      : null
  const canMerge = Boolean(baselineGraphId && counterfactualGraphId && baselineGraphId !== counterfactualGraphId)
  const canSwitch = Boolean(counterfactualGraphId && counterfactualGraphId !== activeGraphId)
  const panelId = `${baseId}-panel`
  const tabId = (id: ActiveTab) => `${baseId}-tab-${id}`
  const newCausalLinks = relationshipDiff.filter(r => r.status === 'added').length

  // Comparing is read-only; what you can do next is set apart on the left
  // as "Next step", and on a phone folds into one disclosure so the chart
  // keeps the screen.
  const nextSteps = (canSwitch || canMerge) && (
    <>
        {canSwitch && (
          <button
            type="button"
            onClick={handleSwitchToBranch}
            disabled={switchGraphMutation.isPending}
            className={SECONDARY_BUTTON}
          >
            {switchGraphMutation.isPending ? 'Opening…' : 'Open this branch'}
          </button>
        )}
        {/* Secondary, not primary: this dialog is opened to compare, and the
            filled button is where a curious click lands. The merge step that
            follows carries its own confirmation. */}
        {canMerge && (
          <button ref={mergeOpenerRef} type="button" onClick={() => setStep('merge')} className={SECONDARY_BUTTON}>
            Merge into baseline…
          </button>
        )}
    </>
  )

  const footer = (
    <div className={FOOTER_ROW}>
      {nextSteps && (
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => setShowNextSteps(open => !open)}
            aria-expanded={showNextSteps}
            aria-controls={`${baseId}-next-steps`}
            className="rounded-md px-1 py-2 text-sm font-medium text-ink-secondary hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected sm:hidden"
          >
            <span className="inline-flex items-center gap-1">
              Next step: switch or merge
              <svg className={`h-3.5 w-3.5 transition-transform ${showNextSteps ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </button>
          <div
            id={`${baseId}-next-steps`}
            className={`${showNextSteps ? 'flex' : 'hidden'} mt-2 flex-col gap-2 sm:mt-0 sm:flex sm:flex-row sm:items-center`}
          >
            <span className="hidden text-xs font-medium text-ink-muted sm:inline">Next step</span>
            {nextSteps}
          </div>
        </div>
      )}
      <div className={FOOTER_ACTIONS}>
        <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
          Close
        </button>
      </div>
    </div>
  )

  return (
    <>
      <ModalBase
        isOpen={isOpen}
        // In the merge step, Escape steps back to the comparison.
        onClose={step === 'merge' ? backToComparison : onClose}
        title="Compare branches"
        size="full"
        // ModalBase's widest fixed size is 4xl; the dual-lane canvas wants more.
        className="[&>div:last-child]:max-w-6xl"
        // The merge step brings its own action row.
        footer={step === 'merge' ? undefined : footer}
        closeOnEscape={!mergeWriting}
        showCloseButton={step !== 'merge'}
      >
        {step === 'merge' ? (
          <BranchMergeModal
            presentation="inline"
            isOpen
            onClose={backToComparison}
            cancelLabel="Back to comparison"
            onBusyChange={setMergeWriting}
            targetGraphId={baselineGraphId}
            targetGraphName={resolvedBaselineName}
            sourceGraphId={counterfactualGraphId}
            sourceGraphName={resolvedCounterfactualName}
            targetData={baselineData}
            sourceData={counterfactualData}
            onMerged={reload}
            onRestored={reload}
          />
        ) : (
        <div className="space-y-4 text-sm text-ink">
          {/* On a phone the intro and the figures fold away (one summary line
              instead) so the comparison itself starts on screen. */}
          <p className="text-ink-secondary max-sm:hidden">
            Baseline and counterfactual side by side, aligned at the point of divergence.
          </p>

          {/* Graph selection: side by side from sm, stacked on a phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:max-w-2xl">
            <div className="flex flex-col gap-1 min-w-0">
              <label htmlFor={`${baseId}-baseline`} className="text-xs font-semibold text-ink-secondary flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-baseline inline-block" aria-hidden="true" />
                Baseline
              </label>
              <select
                id={`${baseId}-baseline`}
                value={baselineGraphId}
                onChange={e => setBaselineGraphId(e.target.value)}
                disabled={Boolean(originalData)}
                className={`${FIELD} w-full`}
              >
                {graphList.map(g => (
                  <option key={`base-opt-${g.id}`} value={g.id}>
                    {optionLabel(g)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <label htmlFor={`${baseId}-branch`} className="text-xs font-semibold text-ink-secondary flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-divergence inline-block" aria-hidden="true" />
                Branch
              </label>
              <select
                id={`${baseId}-branch`}
                value={counterfactualGraphId}
                onChange={e => setCounterfactualGraphId(e.target.value)}
                disabled={Boolean(copiedData)}
                className={`${FIELD} w-full`}
              >
                {graphList.map(g => (
                  <option key={`cf-opt-${g.id}`} value={g.id}>
                    {optionLabel(g)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loadError && (
            <p role="alert" className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md p-3">
              {loadError}
            </p>
          )}

          {/* At-a-glance figures: one rule-separated strip, two columns on a
              phone, four in a row from md */}
          <p className="sm:hidden border-y border-line py-2 text-xs text-ink-secondary">
            {metrics.pointOfDivergence
              ? <>Splits <span className="font-mono-code text-ink">{formatHistoricalDate(metrics.pointOfDivergence.timestamp, undefined, calendarFor(metrics.pointOfDivergence.type))}</span> · {countNoun(metrics.divergentEventsCount, 'event')} added · {countNoun(newCausalLinks, 'new link')}</>
              : 'No point of divergence: the graphs have the same events.'}
          </p>
          {calendarsDiffer && (
            <p className="text-xs text-ink-muted">
              These graphs count years differently: each graph’s own events show its calendar’s years, and dates
              they share show stored years.
            </p>
          )}
          <dl className="max-sm:hidden grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 py-3 border-y border-line md:gap-x-0 md:divide-x md:divide-line">
            <div className={STAT}>
              <dt className="text-xs text-ink-muted flex items-center gap-1.5">
                <DivergenceDiamond />
                Point of divergence
              </dt>
              <dd className="mt-1 font-semibold font-mono-code truncate">
                {metrics.pointOfDivergence
                  ? formatHistoricalDate(metrics.pointOfDivergence.timestamp, undefined, calendarFor(metrics.pointOfDivergence.type))
                  : 'None'}
              </dd>
              <dd className="text-xs text-ink-secondary truncate mt-0.5">
                {metrics.pointOfDivergence
                  ? metrics.pointOfDivergence.description
                  : 'The two histories have the same events'}
              </dd>
            </div>
            <div className={STAT}>
              <dt className="text-xs text-ink-muted">Shared history</dt>
              <dd className="mt-1 font-semibold">
                <span className="font-mono-code">{metrics.sharedEventsCount}</span>{' '}
                {metrics.sharedEventsCount === 1 ? 'event' : 'events'}
              </dd>
              <dd className="text-xs text-ink-secondary mt-0.5">In both, before the split</dd>
            </div>
            <div className={STAT}>
              <dt className="text-xs text-ink-muted">Branch changes</dt>
              <dd className="mt-1 font-semibold">
                {/* A count, not a percentage: "2 added (9.5%)" dressed a small
                    number up as a rate. */}
                <span className="font-mono-code">{metrics.divergentEventsCount}</span>{' '}
                {metrics.divergentEventsCount === 1 ? 'event' : 'events'} added
              </dd>
              <dd className="text-xs text-ink-secondary mt-0.5">
                {metrics.modifiedEventsCount} changed · {metrics.baselineOnlyEventsCount} only in baseline
              </dd>
            </div>
            <div className={STAT}>
              <dt className="text-xs text-ink-muted">Causal links in branch</dt>
              <dd className="mt-1 font-semibold">
                <span className="font-mono-code">{counterfactualData.relationships.length}</span>
              </dd>
              <dd className="text-xs text-ink-secondary mt-0.5">{newCausalLinks} new</dd>
            </div>
          </dl>

          {/* View tabs */}
          <div
            role="tablist"
            aria-label="Comparison views"
            onKeyDown={handleTabKeyDown}
            // One row that scrolls sideways when the sheet is too narrow for
            // all five; the rule under it is an inset shadow so the selected
            // tab's underline can sit on it without overflowing the scroller.
            className="flex overflow-x-auto [scrollbar-width:thin] shadow-[inset_0_-1px_0_var(--border-subtle)]"
          >
            {TABS.map(tab => {
              const selected = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  ref={element => {
                    tabRefs.current[tab.id] = element
                  }}
                  type="button"
                  role="tab"
                  id={tabId(tab.id)}
                  aria-selected={selected}
                  aria-controls={panelId}
                  // The dialog opens on the comparison, not on the Baseline
                  // select (whose focus ring was the first thing on screen).
                  data-autofocus={selected ? '' : undefined}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  className={`shrink-0 whitespace-nowrap py-2.5 px-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                    selected
                      ? 'border-selected text-ink'
                      : 'border-transparent text-ink-secondary hover:text-ink'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              )
            })}
          </div>

          <div
            role="tabpanel"
            id={panelId}
            aria-labelledby={tabId(activeTab)}
            tabIndex={-1}
            // One height for every view, so switching tabs never resizes the
            // dialog: as tall as the viewport leaves room for (between 20 and
            // 32rem), scrolling inside. In the full-screen sheet below lg the
            // sheet itself scrolls, so the panel takes its natural height.
            className="focus:outline-none lg:h-[clamp(20rem,calc(100vh-31rem),32rem)] lg:overflow-y-auto"
          >
            {isLoading ? (
              <div role="status" className="flex items-center justify-center py-24 lg:h-full lg:py-0 text-ink-secondary gap-3">
                <svg className="animate-spin h-5 w-5 text-baseline" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Loading both histories…
              </div>
            ) : (
              <>
                {activeTab === 'timeline' && (
                  <CounterfactualTimelineCanvas
                    focusDivergence
                    baselineName={resolvedBaselineName}
                    counterfactualName={resolvedCounterfactualName}
                    baselineEvents={baselineData.events}
                    counterfactualEvents={counterfactualData.events}
                    baselineCalendar={calendars.baseline}
                    counterfactualCalendar={calendars.counterfactual}
                    width={1020}
                    height={320}
                  />
                )}

                {activeTab === 'causal' && (
                  // A fixed height in the sheet (the graph canvas needs one to
                  // lay out); the panel's height from lg.
                  <div className="h-[26rem] lg:h-full flex flex-col">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <p className="text-sm font-semibold">
                        What {quoted(resolvedCounterfactualName)} changes in the causal graph
                      </p>
                      {/* The point of divergence is in the graph's own legend
                          below; here only what this tab adds. */}
                      <span className="text-xs text-ink-secondary flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="flex items-center gap-1.5">
                          <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true">
                            <line x1="1" y1="4" x2="21" y2="4" stroke="var(--accent-divergence)" strokeWidth="2.5" />
                          </svg>
                          Only in the branch ({branchAddedIds.length})
                        </span>
                      </span>
                    </div>
                    <div className="flex-1 min-h-0 relative rounded-md bg-subtle">
                      {/* A read-only preview: the branch's links are edited in
                          the Causal Graph view, not from inside a comparison. */}
                      <CausalGraphComponent
                        readOnly
                        events={counterfactualData.events}
                        causalRelationships={counterfactualData.relationships}
                        divergenceEventIds={podEventIds}
                        branchAddedIds={branchAddedIds}
                        calendar={calendars.counterfactual}
                        canvasMinHeight={0}
                        className="h-full w-full"
                        showLayoutManager={true}
                        showOverview={false}
                        showPerformanceManager={false}
                        enablePathExploration={false}
                        enableSuggestions={false}
                        showSuggestionManager={false}
                      />
                    </div>
                  </div>
                )}

                {activeTab === 'diff' && (
                  <div className="flex flex-col gap-3 lg:h-full">
                    <div role="group" aria-label="Show events" className="flex flex-wrap items-center gap-2">
                      {/* A filter with nothing in it is not offered ("Changed (0)"),
                          unless it is the one showing. */}
                      {(['changes', 'all', 'divergent', 'shared', 'baseline_only', 'modified'] as DiffFilter[])
                        .filter(filter => {
                          const count =
                            filter === 'changes' ? eventDiffItems.filter(i => i.status !== 'shared').length
                            : filter === 'all' ? eventDiffItems.length
                            : filter === 'divergent' ? metrics.divergentEventsCount
                            : filter === 'shared' ? metrics.sharedEventsCount
                            : filter === 'baseline_only' ? metrics.baselineOnlyEventsCount
                            : metrics.modifiedEventsCount
                          return count > 0 || filter === diffFilter
                        })
                        .map(filter => {
                        const pressed = diffFilter === filter
                        return (
                          <button
                            key={filter}
                            type="button"
                            aria-pressed={pressed}
                            onClick={() => setDiffFilter(filter)}
                            className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${
                              pressed
                                ? 'bg-selected/10 border-selected text-ink'
                                : 'bg-card border-line text-ink-secondary hover:bg-subtle'
                            }`}
                          >
                            {filter === 'changes' && `Changes (${eventDiffItems.filter(i => i.status !== 'shared').length})`}
                            {filter === 'all' && `All (${eventDiffItems.length})`}
                            {filter === 'divergent' && `Added in branch (${metrics.divergentEventsCount})`}
                            {filter === 'shared' && `Shared (${metrics.sharedEventsCount})`}
                            {filter === 'baseline_only' && `Only in baseline (${metrics.baselineOnlyEventsCount})`}
                            {filter === 'modified' && `Changed (${metrics.modifiedEventsCount})`}
                          </button>
                        )
                      })}
                    </div>

                    {/* Scrolls both ways: five columns are wider than a phone. */}
                    <div className="max-h-96 lg:max-h-none lg:flex-1 lg:min-h-0 overflow-auto border-y border-line">
                      <table className="min-w-full divide-y divide-line text-xs">
                        <thead className="bg-subtle sticky top-0">
                          <tr>
                            <th scope="col" className="px-3 py-2 text-left font-semibold text-ink-secondary">Date</th>
                            <th scope="col" className="px-3 py-2 text-left font-semibold text-ink-secondary">Status</th>
                            <th scope="col" className="px-3 py-2 text-left font-semibold text-ink-secondary">Event</th>
                            <th scope="col" className="px-3 py-2 text-left font-semibold text-ink-secondary">Actor → target</th>
                            <th scope="col" className="px-3 py-2 text-left font-semibold text-ink-secondary">What changed</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {filteredEventDiff.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="text-center py-8 text-ink-secondary">
                                No events match this filter
                              </td>
                            </tr>
                          ) : (
                            filteredEventDiff.map(item => {
                              const event = item.counterfactualEvent || item.baselineEvent
                              const badge = STATUS_BADGES[item.status]
                              return (
                                <tr key={`diff-row-${item.id}`} className="hover:bg-subtle">
                                  <td className="px-3 py-2 text-ink-secondary whitespace-nowrap font-mono-code">
                                    {formatEventDate(event ?? item, undefined, calendarFor(item.status))}
                                  </td>
                                  <td className="px-3 py-2 whitespace-nowrap">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${badge.className}`}>
                                      {badge.label}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 font-medium text-ink min-w-48">
                                    {event?.description || item.id}
                                  </td>
                                  <td className="px-3 py-2 text-ink-secondary">
                                    {event ? `${event.actor} → ${event.target}` : '—'}
                                  </td>
                                  <td className="px-3 py-2 text-ink-secondary">
                                    {describeDifference(item, calendars)}
                                  </td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'summary' && (
                  // The story of the branch in words, not the header's figures
                  // again: where it splits, then what it adds, changes and drops.
                  <div className="space-y-5 text-sm">
                    <p className="text-base text-ink [text-wrap:pretty]">
                      {metrics.pointOfDivergence ? (
                        <>
                          {quoted(resolvedCounterfactualName)} follows {quoted(resolvedBaselineName)} until{' '}
                          <strong className="font-mono-code">
                            {formatHistoricalDate(metrics.pointOfDivergence.timestamp, undefined, calendarFor(metrics.pointOfDivergence.type))}
                          </strong>
                          {' '}({countNoun(metrics.sharedEventsCount, 'shared event')}), then goes its own way.
                        </>
                      ) : (
                        'These graphs have the same events, so there is no point of divergence.'
                      )}
                    </p>
                    {([
                      ['What the branch adds', 'divergent_added'],
                      ['What it changes', 'modified'],
                      ['What it drops', 'baseline_only'],
                    ] as const).map(([heading, status]) => {
                      const items = eventDiffItems.filter(i => i.status === status)
                      if (items.length === 0) return null
                      return (
                        <section key={status}>
                          <h3 className="text-base font-semibold text-ink">{heading}</h3>
                          <ol className="mt-2 space-y-1.5 border-l border-line pl-4">
                            {items.map(item => {
                              const event = item.counterfactualEvent || item.baselineEvent
                              return (
                                <li key={item.id} className="flex flex-wrap gap-x-3">
                                  <span className="w-24 shrink-0 font-mono-code text-ink-muted">{formatEventDate(event ?? item, undefined, calendarFor(item.status))}</span>
                                  <span className="min-w-0 flex-1 text-ink">
                                    {event?.description ?? item.id}
                                    {status === 'modified' && (
                                      <span className="block text-xs text-ink-secondary">{describeDifference(item, calendars)}</span>
                                    )}
                                  </span>
                                </li>
                              )
                            })}
                          </ol>
                        </section>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        )}
      </ModalBase>
    </>
  )
}
