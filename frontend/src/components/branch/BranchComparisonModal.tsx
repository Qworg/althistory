import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Event, Arc, CausalRelationship } from '@/types'
import { useGraphs, useActiveGraphId, useSwitchGraph } from '@/hooks/useGraphs'
import { apiClient } from '@/services/api'
import { analyzeEventDivergence, analyzeRelationshipDivergence } from '@/utils/divergenceAnalysis'
import { CounterfactualTimelineCanvas } from './CounterfactualTimelineCanvas'
import { CausalGraphComponent } from '@/components/causal-graph/CausalGraphComponent'

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

type ActiveTab = 'timeline' | 'causal' | 'diff' | 'summary'
type DiffFilter = 'all' | 'divergent' | 'shared' | 'baseline_only' | 'modified'

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

  const [activeTab, setActiveTab] = useState<ActiveTab>('timeline')
  const [diffFilter, setDiffFilter] = useState<DiffFilter>('all')

  const [baselineGraphId, setBaselineGraphId] = useState<string>('')
  const [counterfactualGraphId, setCounterfactualGraphId] = useState<string>('')

  const [baselineData, setBaselineData] = useState<GraphDataState>(EMPTY_DATA)
  const [counterfactualData, setCounterfactualData] = useState<GraphDataState>(EMPTY_DATA)

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

  // Fetch baseline graph data
  useEffect(() => {
    if (!isOpen) return

    if (originalData) {
      setBaselineData({
        events: originalData.events,
        arcs: originalData.arcs,
        relationships: originalData.relationships,
        isLoading: false,
        error: null,
      })
      return
    }

    if (!baselineGraphId) return

    let cancelled = false
    setBaselineData(prev => ({ ...prev, isLoading: true, error: null }))

    Promise.all([
      apiClient.events.getAll(undefined, { graphId: baselineGraphId }),
      apiClient.arcs.getAll(undefined, { graphId: baselineGraphId }),
      apiClient.causal.getRelationships(undefined, { graphId: baselineGraphId }),
    ])
      .then(([events, arcs, relationships]) => {
        if (!cancelled) {
          setBaselineData({
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
          setBaselineData(prev => ({
            ...prev,
            isLoading: false,
            error: err instanceof Error ? err.message : 'Failed to load baseline data',
          }))
        }
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, baselineGraphId, originalData])

  // Fetch counterfactual graph data
  useEffect(() => {
    if (!isOpen) return

    if (copiedData) {
      setCounterfactualData({
        events: copiedData.events,
        arcs: copiedData.arcs,
        relationships: copiedData.relationships,
        isLoading: false,
        error: null,
      })
      return
    }

    if (!counterfactualGraphId) return

    let cancelled = false
    setCounterfactualData(prev => ({ ...prev, isLoading: true, error: null }))

    Promise.all([
      apiClient.events.getAll(undefined, { graphId: counterfactualGraphId }),
      apiClient.arcs.getAll(undefined, { graphId: counterfactualGraphId }),
      apiClient.causal.getRelationships(undefined, { graphId: counterfactualGraphId }),
    ])
      .then(([events, arcs, relationships]) => {
        if (!cancelled) {
          setCounterfactualData({
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
          setCounterfactualData(prev => ({
            ...prev,
            isLoading: false,
            error: err instanceof Error ? err.message : 'Failed to load counterfactual data',
          }))
        }
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, counterfactualGraphId, copiedData])

  // Compute divergence analysis between baseline and counterfactual datasets
  const divergenceAnalysis = useMemo(() => {
    return analyzeEventDivergence(baselineData.events, counterfactualData.events)
  }, [baselineData.events, counterfactualData.events])

  const relationshipDiff = useMemo(() => {
    return analyzeRelationshipDivergence(baselineData.relationships, counterfactualData.relationships)
  }, [baselineData.relationships, counterfactualData.relationships])

  const { items: eventDiffItems, metrics } = divergenceAnalysis

  // Names of selected graphs
  const resolvedBaselineName = useMemo(() => {
    if (originalGraphName) return originalGraphName
    const found = graphList?.find(g => g.id === baselineGraphId)
    return found ? (found.branchName || found.name) : 'Baseline'
  }, [originalGraphName, graphList, baselineGraphId])

  const resolvedCounterfactualName = useMemo(() => {
    if (copiedGraphName) return copiedGraphName
    const found = graphList?.find(g => g.id === counterfactualGraphId)
    return found ? (found.branchName || found.name) : 'Counterfactual Branch'
  }, [copiedGraphName, graphList, counterfactualGraphId])

  // Filtered event diff items
  const filteredEventDiff = useMemo(() => {
    if (diffFilter === 'all') return eventDiffItems
    if (diffFilter === 'divergent') {
      return eventDiffItems.filter(i => i.status === 'divergent_added')
    }
    if (diffFilter === 'shared') {
      return eventDiffItems.filter(i => i.status === 'shared')
    }
    if (diffFilter === 'baseline_only') {
      return eventDiffItems.filter(i => i.status === 'baseline_only')
    }
    if (diffFilter === 'modified') {
      return eventDiffItems.filter(i => i.status === 'modified')
    }
    return eventDiffItems
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

  if (!isOpen) return null

  const isLoading = baselineData.isLoading || counterfactualData.isLoading

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-gray-200">
        {/* Header */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">⑂</span>
              <h2 className="text-xl font-bold text-gray-900">
                Counterfactual Divergence Explorer
              </h2>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Compare baseline timeline continuity against counterfactual branch divergences
            </p>
          </div>

          {/* Graph Selection Dropdowns (when graphs are available) */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-blue-700">Baseline:</span>
              <select
                value={baselineGraphId}
                onChange={e => setBaselineGraphId(e.target.value)}
                disabled={Boolean(originalData)}
                className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
              >
                {graphList.map(g => (
                  <option key={`base-opt-${g.id}`} value={g.id}>
                    {g.name} {g.branchName ? `(${g.branchName})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-purple-700">Branch:</span>
              <select
                value={counterfactualGraphId}
                onChange={e => setCounterfactualGraphId(e.target.value)}
                disabled={Boolean(copiedData)}
                className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-purple-500 font-medium"
              >
                {graphList.map(g => (
                  <option key={`cf-opt-${g.id}`} value={g.id}>
                    {g.name} {g.branchName ? `(${g.branchName})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 p-1 rounded-md transition-colors ml-2"
              aria-label="Close dialog"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* KPI Metrics Ribbon */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-gray-50/70 border-b border-gray-200">
          {/* Point of Divergence Card */}
          <div className="bg-white p-3 rounded-lg border border-amber-200 shadow-xs">
            <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider flex items-center gap-1">
              <span>⑂</span> Point of Divergence
            </div>
            <div className="text-sm font-bold text-gray-900 mt-1 truncate">
              {metrics.pointOfDivergence
                ? new Date(metrics.pointOfDivergence.timestamp).toLocaleDateString()
                : 'Identical Continuity'}
            </div>
            <div className="text-[11px] text-gray-500 truncate mt-0.5">
              {metrics.pointOfDivergence ? metrics.pointOfDivergence.description : 'No divergence detected'}
            </div>
          </div>

          {/* Shared Continuity Card */}
          <div className="bg-white p-3 rounded-lg border border-blue-200 shadow-xs">
            <div className="text-[11px] font-semibold text-blue-700 uppercase tracking-wider">
              Shared History
            </div>
            <div className="text-sm font-bold text-gray-900 mt-1">
              {metrics.sharedEventsCount} events
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              Pre-divergence continuity
            </div>
          </div>

          {/* Divergent Events Card */}
          <div className="bg-white p-3 rounded-lg border border-purple-200 shadow-xs">
            <div className="text-[11px] font-semibold text-purple-700 uppercase tracking-wider">
              Counterfactual Drift
            </div>
            <div className="text-sm font-bold text-purple-900 mt-1">
              +{metrics.divergentEventsCount} divergent ({metrics.divergenceRate}%)
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              {metrics.modifiedEventsCount} modified | {metrics.baselineOnlyEventsCount} omitted
            </div>
          </div>

          {/* Causal Delta Card */}
          <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-xs">
            <div className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider">
              Causal Structure
            </div>
            <div className="text-sm font-bold text-gray-900 mt-1">
              {counterfactualData.relationships.length} connections
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              {relationshipDiff.filter(r => r.status === 'added').length} new causal paths
            </div>
          </div>
        </div>

        {/* View Navigation Tabs */}
        <div className="flex border-b border-gray-200 px-6 bg-white">
          <button
            type="button"
            onClick={() => setActiveTab('timeline')}
            className={`py-3 px-4 font-semibold text-xs border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'timeline'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>📈</span> Dual-Lane Timeline Visualizer
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('causal')}
            className={`py-3 px-4 font-semibold text-xs border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'causal'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>🕸️</span> Causal Graph View
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('diff')}
            className={`py-3 px-4 font-semibold text-xs border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'diff'
                ? 'border-amber-600 text-amber-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>📑</span> Event & Causal Diff
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('summary')}
            className={`py-3 px-4 font-semibold text-xs border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'summary'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>📊</span> Summary Overview
          </button>
        </div>

        {/* Main Tab Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
          {isLoading ? (
            <div className="flex items-center justify-center py-24 text-gray-500">
              <svg className="animate-spin h-6 w-6 mr-3 text-blue-600" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Loading branch telemetry...</span>
            </div>
          ) : (
            <>
              {/* Tab 1: Dual-Lane Timeline Canvas */}
              {activeTab === 'timeline' && (
                <div className="space-y-4">
                  <CounterfactualTimelineCanvas
                    baselineName={resolvedBaselineName}
                    counterfactualName={resolvedCounterfactualName}
                    baselineEvents={baselineData.events}
                    counterfactualEvents={counterfactualData.events}
                    width={1020}
                    height={380}
                  />
                  <div className="text-xs text-gray-500 italic text-center">
                    Shared events before the Point of Divergence are linked vertically. Divergent milestones are badged with glowing rings.
                  </div>
                </div>
              )}

              {/* Tab 2: Causal Graph with PoD Indicators */}
              {activeTab === 'causal' && (
                <div className="bg-white rounded-lg border border-gray-200 p-4 h-[440px] flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-700">
                      Causal Graph for Branch: {resolvedCounterfactualName}
                    </span>
                    <span className="text-xs text-amber-700 font-medium bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      ◆ Gold Diamond: Point of Divergence
                    </span>
                  </div>
                  <div className="flex-1 relative">
                    <CausalGraphComponent
                      events={counterfactualData.events}
                      causalRelationships={counterfactualData.relationships}
                      divergenceEventIds={podEventIds}
                      className="h-full w-full"
                      showLayoutManager={true}
                      showOverview={false}
                      showPerformanceManager={false}
                    />
                  </div>
                </div>
              )}

              {/* Tab 3: Detailed Event Diff Table */}
              {activeTab === 'diff' && (
                <div className="space-y-4">
                  {/* Filter Pills */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-gray-600 mr-1">Filter Events:</span>
                    {(['all', 'divergent', 'shared', 'baseline_only', 'modified'] as DiffFilter[]).map(filter => (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setDiffFilter(filter)}
                        className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                          diffFilter === filter
                            ? 'bg-blue-600 text-white'
                            : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {filter === 'all' && `All (${eventDiffItems.length})`}
                        {filter === 'divergent' && `Divergent Additions (${metrics.divergentEventsCount})`}
                        {filter === 'shared' && `Shared (${metrics.sharedEventsCount})`}
                        {filter === 'baseline_only' && `Baseline Only (${metrics.baselineOnlyEventsCount})`}
                        {filter === 'modified' && `Modified (${metrics.modifiedEventsCount})`}
                      </button>
                    ))}
                  </div>

                  {/* Table */}
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-xs">
                    <div className="max-h-96 overflow-y-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Timestamp</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Event Description</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Actor → Target</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Diff Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {filteredEventDiff.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="text-center py-8 text-gray-500">
                                No events match the selected filter
                              </td>
                            </tr>
                          ) : (
                            filteredEventDiff.map(item => {
                              const event = item.counterfactualEvent || item.baselineEvent
                              return (
                                <tr key={`diff-row-${item.id}`} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                                    {new Date(item.timestamp).toLocaleString()}
                                  </td>
                                  <td className="px-3 py-2 whitespace-nowrap">
                                    {item.status === 'shared' && (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                        Shared
                                      </span>
                                    )}
                                    {item.status === 'divergent_added' && (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                                        ★ Added
                                      </span>
                                    )}
                                    {item.status === 'modified' && (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                        ✎ Modified
                                      </span>
                                    )}
                                    {item.status === 'baseline_only' && (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-700 border border-gray-300">
                                        ∅ Omitted
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 font-medium text-gray-900">
                                    {event?.description || item.id}
                                  </td>
                                  <td className="px-3 py-2 text-gray-600">
                                    {event ? `${event.actor} → ${event.target}` : '—'}
                                  </td>
                                  <td className="px-3 py-2 text-gray-500">
                                    {item.diffSummary}
                                  </td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 4: Summary Overview */}
              {activeTab === 'summary' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Baseline Overview */}
                    <div className="bg-white p-4 rounded-lg border border-blue-100 shadow-xs">
                      <h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                        {resolvedBaselineName} (Baseline)
                      </h4>
                      <ul className="text-xs text-gray-600 space-y-1.5">
                        <li className="flex justify-between">
                          <span>Total Events:</span>
                          <span className="font-bold text-gray-900">{baselineData.events.length}</span>
                        </li>
                        <li className="flex justify-between">
                          <span>Total Arcs:</span>
                          <span className="font-bold text-gray-900">{baselineData.arcs.length}</span>
                        </li>
                        <li className="flex justify-between">
                          <span>Causal Relationships:</span>
                          <span className="font-bold text-gray-900">{baselineData.relationships.length}</span>
                        </li>
                      </ul>
                    </div>

                    {/* Counterfactual Overview */}
                    <div className="bg-white p-4 rounded-lg border border-purple-100 shadow-xs">
                      <h4 className="font-semibold text-purple-900 mb-2 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-purple-600 inline-block" />
                        {resolvedCounterfactualName} (Counterfactual Branch)
                      </h4>
                      <ul className="text-xs text-gray-600 space-y-1.5">
                        <li className="flex justify-between">
                          <span>Total Events:</span>
                          <span className="font-bold text-gray-900">{counterfactualData.events.length}</span>
                        </li>
                        <li className="flex justify-between">
                          <span>Total Arcs:</span>
                          <span className="font-bold text-gray-900">{counterfactualData.arcs.length}</span>
                        </li>
                        <li className="flex justify-between">
                          <span>Causal Relationships:</span>
                          <span className="font-bold text-gray-900">{counterfactualData.relationships.length}</span>
                        </li>
                      </ul>
                    </div>
                  </div>

                  {/* Point of Divergence Explanatory Box */}
                  <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-xs">
                    <div className="font-bold text-sm mb-1">
                      Historical Divergence Analysis
                    </div>
                    {metrics.pointOfDivergence ? (
                      <p>
                        The timeline splits on <strong>{new Date(metrics.pointOfDivergence.timestamp).toLocaleString()}</strong>.
                        Prior to this anchor, both universes share {metrics.sharedEventsCount} continuous events ({Math.round((metrics.sharedEventsCount / (metrics.totalBaselineEvents || 1)) * 100)}% of baseline history).
                        Following the split, {metrics.divergentEventsCount} counterfactual events emerge.
                      </p>
                    ) : (
                      <p>
                        No divergence point detected between these graphs. Both timelines share identical event history.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            {counterfactualGraphId ? `Viewing branch: ${resolvedCounterfactualName}` : ''}
          </div>
          <div className="flex items-center gap-2">
            {counterfactualGraphId && counterfactualGraphId !== activeGraphId && (
              <button
                type="button"
                onClick={handleSwitchToBranch}
                disabled={switchGraphMutation.isPending}
                className="px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors shadow-xs"
              >
                {switchGraphMutation.isPending ? 'Switching...' : 'Switch to this Branch'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
