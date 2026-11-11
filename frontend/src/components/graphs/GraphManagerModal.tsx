/**
 * GraphManagerModal Component
 * 
 * Full-featured modal for managing graphs: create, edit, delete, branch, merge.
 */

import { useState, useCallback, memo } from 'react'
import { 
  useGraphManagement, 
  useGraphBranches,
  useGraphHeadVersion,
} from '@/hooks/useGraphs'
import { Graph, GraphStatus, CreateGraphRequest } from '@/types'
import { ModalBase } from '@/components/modals/ModalBase'
import { BranchComparisonModal } from '@/components/branch/BranchComparisonModal'
import { CreateGraphModal } from './CreateGraphModal'
import { Portal } from '@/components/ui/Portal'
import { branchLabel } from './graphTree'
import { WorldCalendarFields } from './WorldCalendarFields'
import { useCalendarDraft, type CalendarDraftState } from './useCalendarDraft'

interface GraphManagerModalProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: 'graphs' | 'branches'
}

/**
 * Graphs and branches. Version history is not a tab here: it is Graph ›
 * Versions, one panel with the restore confirmation and its outcome. A second,
 * simpler copy here restored on a browser confirm() and drifted from it.
 */
type Tab = 'graphs' | 'branches'

export const GraphManagerModal = memo(function GraphManagerModal({ 
  isOpen, 
  onClose,
  initialTab = 'graphs'
}: GraphManagerModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [selectedGraph, setSelectedGraph] = useState<Graph | null>(null)
  const [editingGraph, setEditingGraph] = useState<Graph | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showBranchDialog, setShowBranchDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [branchName, setBranchName] = useState('')
  const [branchDescription, setBranchDescription] = useState('')
  const [branchError, setBranchError] = useState<string | null>(null)
  const [comparingBranchId, setComparingBranchId] = useState<string | null>(null)
  // The edit form's "World calendar" section, reset to the graph being edited.
  const calendarDraft = useCalendarDraft()
  const resetCalendar = calendarDraft.reset

  const {
    activeGraphId,
    activeGraph,
    graphs,
    createGraph,
    updateGraph,
    deleteGraph,
    branchGraph,
    switchGraph,
    isCreating,
    isDeleting,
    isBranching,
  } = useGraphManagement()
  // Version-history numbers (Graph.version is an internal change counter)
  const headVersion = useGraphHeadVersion(activeGraph?.id, activeGraph?.version)

  const { data: branches, isLoading: isLoadingBranches } = useGraphBranches(
    activeTab === 'branches' ? activeGraphId : null
  )

  // Handlers
  const handleSelectGraph = useCallback((graph: Graph) => {
    setSelectedGraph(graph)
    setEditingGraph(null)
  }, [])

  const handleEditGraph = useCallback((graph: Graph) => {
    setEditingGraph(graph)
    setSelectedGraph(null)
    resetCalendar(graph.calendar ?? null)
  }, [resetCalendar])

  const handleCreateGraph = useCallback(async (request: CreateGraphRequest) => {
    await createGraph(request)
    setShowCreateModal(false)
  }, [createGraph])

  const handleSaveEdit = useCallback(() => {
    if (!editingGraph) return
    // An invalid calendar keeps the form open with its errors showing.
    const calendar = calendarDraft.resolve()
    if (!calendar.ok) return
    updateGraph({ id: editingGraph.id, data: {
      name: editingGraph.name,
      description: editingGraph.description,
      status: editingGraph.status,
      // A calendar to set, null to remove it; left out when unchanged.
      ...(calendar.calendar !== undefined ? { calendar: calendar.calendar } : {}),
    }})
    setEditingGraph(null)
  }, [editingGraph, updateGraph, calendarDraft])

  const handleDeleteGraph = useCallback(() => {
    if (!selectedGraph) return
    deleteGraph(selectedGraph.id)
    setSelectedGraph(null)
    setShowDeleteDialog(false)
  }, [selectedGraph, deleteGraph])

  const openBranchDialog = useCallback(() => {
    setBranchError(null)
    setShowBranchDialog(true)
  }, [])

  const handleBranchGraph = useCallback(async () => {
    if (!activeGraphId || !branchName.trim()) return
    setBranchError(null)
    try {
      const description = branchDescription.trim()
      await (description
        ? branchGraph(activeGraphId, branchName.trim(), { description })
        : branchGraph(activeGraphId, branchName.trim()))
      setBranchName('')
      setBranchDescription('')
      setShowBranchDialog(false)
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'The server did not say why.'
      setBranchError(message)
    }
  }, [activeGraphId, branchName, branchDescription, branchGraph])

  const handleSwitchAndClose = useCallback((graphId: string) => {
    switchGraph(graphId)
    onClose()
  }, [switchGraph, onClose])

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title="Graph Manager"
      size="4xl"
    >
      {/* Two tabs across the top. As a 12rem column of their own (with a
          repeat of the open graph under them) they left that column mostly
          empty and took the width the lists needed. */}
      <div className="flex max-h-[70vh] min-h-[24rem] flex-col">
        <div role="tablist" aria-label="Graph Manager sections" className="flex gap-1 border-b border-line">
          {(['graphs', 'branches'] as Tab[]).map(tab => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors ${
                activeTab === tab ? 'border-selected text-ink' : 'border-transparent text-ink-secondary hover:text-ink'
              }`}
            >
              {tab}
            </button>
          ))}
          {activeGraph && (
            <span className="ml-auto self-center truncate pl-4 text-xs text-ink-muted">
              Open: <span className="font-medium text-ink-secondary">{activeGraph.name}</span>
              {headVersion !== null && <span className="font-mono-code"> · v{headVersion}</span>}
            </span>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto pt-4">
            {activeTab === 'graphs' && (
              <GraphsTab
                graphs={graphs}
                activeGraphId={activeGraphId}
                selectedGraph={selectedGraph}
                editingGraph={editingGraph}
                onSelect={handleSelectGraph}
                onEdit={handleEditGraph}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={() => setEditingGraph(null)}
                onEditChange={setEditingGraph}
                calendarDraft={calendarDraft}
                onSwitch={handleSwitchAndClose}
                onDelete={() => setShowDeleteDialog(true)}
                onBranch={openBranchDialog}
                onCreate={() => setShowCreateModal(true)}
              />
            )}

            {activeTab === 'branches' && (
              <BranchesTab
                parent={activeGraph ?? null}
                branches={branches || []}
                activeGraphId={activeGraphId}
                isLoading={isLoadingBranches}
                onSwitch={handleSwitchAndClose}
                onCompare={setComparingBranchId}
                onCreateBranch={openBranchDialog}
              />
            )}

          </div>
        </div>
      </div>

      {/* Branch Dialog */}
      {showBranchDialog && (
        <Portal>
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div role="dialog" aria-modal="true" aria-labelledby="graph-manager-branch-title" className="bg-card text-ink border border-line rounded-lg p-6 w-[28rem] max-w-[calc(100vw-2rem)] shadow-xl">
              <h2 id="graph-manager-branch-title" className="font-display text-xl font-semibold text-ink mb-2">Create branch</h2>
              <p className="text-sm text-ink-secondary mb-4">
                The branch starts as a full copy of {activeGraph?.name ?? 'the active graph'}, which stays as it is.
                Switch to the branch to explore the what-if.
              </p>
              <label htmlFor="graph-manager-branch-name" className="block text-sm font-medium text-ink mb-1">
                Branch name
              </label>
              <input
                id="graph-manager-branch-name"
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="e.g. Clerks Prevail"
                maxLength={255}
                className="w-full px-3 py-2 border border-line bg-card text-ink rounded mb-3 text-sm focus:outline-none focus:ring-2 focus:ring-selected"
                autoFocus
              />
              <label htmlFor="graph-manager-branch-description" className="block text-sm font-medium text-ink mb-1">
                Description <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <textarea
                id="graph-manager-branch-description"
                value={branchDescription}
                onChange={(e) => setBranchDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-line bg-card text-ink rounded mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-selected"
              />
              {branchError && (
                <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-200">
                  Couldn't create the branch: {branchError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowBranchDialog(false)}
                  className="px-4 py-2 text-sm text-ink-secondary hover:bg-subtle hover:text-ink rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBranchGraph}
                  disabled={!branchName.trim() || isBranching}
                  className="px-4 py-2 text-sm bg-baseline text-on-accent rounded hover:bg-baseline/90 disabled:opacity-50"
                >
                  {isBranching ? 'Creating branch…' : 'Create branch'}
                </button>
              </div>
            </div>
          </div>
      </Portal>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && selectedGraph && (
        <Portal>
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div role="dialog" aria-modal="true" aria-labelledby="graph-manager-delete-title" className="bg-card text-ink border border-line rounded-lg p-6 w-96 max-w-[calc(100vw-2rem)] shadow-xl">
              <h2 id="graph-manager-delete-title" className="font-display text-xl font-semibold mb-2 text-red-700 dark:text-red-300">Delete graph</h2>
              <p className="text-sm text-ink-secondary mb-4">
                Are you sure you want to delete "{selectedGraph.name}"? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowDeleteDialog(false)}
                  className="px-4 py-2 text-sm text-ink-secondary hover:bg-subtle hover:text-ink rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteGraph}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-danger text-on-accent rounded hover:bg-danger/90 disabled:opacity-50"
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* Branch Divergence / Comparison Explorer */}
      {comparingBranchId && (
        <BranchComparisonModal
          isOpen={Boolean(comparingBranchId)}
          onClose={() => setComparingBranchId(null)}
          initialBaselineGraphId={activeGraphId ?? undefined}
          initialCounterfactualGraphId={comparingBranchId}
        />
      )}

      {/* Create Graph Modal */}
      {showCreateModal && (
        <CreateGraphModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateGraph}
          isCreating={isCreating}
        />
      )}
    </ModalBase>
  )
})

// Sub-components

interface GraphsTabProps {
  graphs: Graph[]
  activeGraphId: string | null
  selectedGraph: Graph | null
  editingGraph: Graph | null
  onSelect: (graph: Graph) => void
  onEdit: (graph: Graph) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onEditChange: (graph: Graph) => void
  /** The edit form's world calendar section. */
  calendarDraft: CalendarDraftState
  onSwitch: (graphId: string) => void
  onDelete: () => void
  onBranch: () => void
  onCreate: () => void
}

const GraphsTab = memo(function GraphsTab({
  graphs,
  activeGraphId,
  selectedGraph,
  editingGraph,
  onSelect,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onEditChange,
  calendarDraft,
  onSwitch,
  onDelete,
  onBranch,
  onCreate,
}: GraphsTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-display text-xl font-semibold text-ink">All graphs</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onCreate}
            className="px-3 py-1.5 text-sm bg-baseline text-on-accent rounded hover:bg-baseline/90"
          >
            New Graph
          </button>
          <button
            onClick={onBranch}
            disabled={!activeGraphId}
            className="px-3 py-1.5 text-sm border border-divergence/60 text-ink rounded hover:bg-divergence/10 disabled:opacity-50"
          >
            Branch this graph
          </button>
        </div>
      </div>

      {/* Rows divided by rules, not a card per graph: inside the dialog's
          own panel that was a card in a card (in a card, for the Open pill). */}
      <div className="divide-y divide-line border-y border-line">
        {graphs.map(graph => (
          <div
            key={graph.id}
            data-graph-row
            aria-current={graph.id === activeGraphId ? 'true' : undefined}
            onClick={() => onSelect(graph)}
            className={`
              px-3 py-4 cursor-pointer transition-colors
              ${graph.id === activeGraphId ? 'bg-selected/10' : 'hover:bg-subtle'}
              ${selectedGraph?.id === graph.id ? 'ring-2 ring-inset ring-selected' : ''}
            `}
          >
            {editingGraph?.id === graph.id ? (
              // Edit Mode
              <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  value={editingGraph.name}
                  onChange={(e) => onEditChange({ ...editingGraph, name: e.target.value })}
                  className="w-full px-2 py-1 border border-line rounded text-lg font-semibold"
                />
                <textarea
                  value={editingGraph.description || ''}
                  onChange={(e) => onEditChange({ ...editingGraph, description: e.target.value })}
                  placeholder="Description..."
                  className="w-full px-2 py-1 border border-line rounded text-sm"
                  rows={2}
                />
                <select
                  value={editingGraph.status}
                  onChange={(e) => onEditChange({ ...editingGraph, status: e.target.value as GraphStatus })}
                  className="px-2 py-1 border border-line rounded text-sm"
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
                <WorldCalendarFields
                  state={calendarDraft}
                  idPrefix={`edit-graph-${graph.id}`}
                  sampleYear={firstStoredYear(graph)}
                />
                <div className="flex gap-2">
                  <button
                    onClick={onSaveEdit}
                    className="px-3 py-1 bg-baseline text-on-accent rounded text-sm hover:bg-baseline/90"
                  >
                    Save
                  </button>
                  <button
                    onClick={onCancelEdit}
                    className="px-3 py-1 border border-line rounded text-sm hover:bg-subtle"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              // Display Mode
              <>
                <div className="flex items-start justify-between">
                  <div>
                    {/* A branch by its own name, as in the graph selector, with
                        the history it branches from under it: the same branch
                        was "Clerks Prevail" in one place and "The Engine Age —
                        Clerks Prevail" in another. */}
                    <h4 className="text-base font-semibold text-ink">
                      {(() => {
                        const parent = graph.parentGraphId ? graphs.find(g => g.id === graph.parentGraphId) ?? null : null
                        return branchLabel(graph, parent)
                      })()}
                      {graph.branchName && graph.branchName !== branchLabel(graph, graphs.find(g => g.id === graph.parentGraphId) ?? null) && (
                        <span className="ml-2 text-xs text-ink-secondary border border-divergence/50 px-1.5 py-0.5 rounded">
                          {graph.branchName}
                        </span>
                      )}
                    </h4>
                    {graph.parentGraphId && (
                      <p className="mt-0.5 text-xs text-ink-secondary">
                        Branch of {graphs.find(g => g.id === graph.parentGraphId)?.name ?? 'another graph'}
                      </p>
                    )}
                    {graph.description && (
                      <p className="text-sm text-ink-muted mt-1">{graph.description}</p>
                    )}
                  </div>
                  {/* "Active" is the default status of every graph, so it says
                      nothing; the badge marks the exceptions and the open one. */}
                  {graph.id === activeGraphId ? (
                    // A status, not an action: a dot and "Open now", so it does
                    // not read as a button beside the real ones.
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink-secondary">
                      <span className="h-2 w-2 rounded-full bg-selected" aria-hidden="true" />
                      Open now
                    </span>
                  ) : graph.status !== 'active' ? (
                    <span className="shrink-0 rounded bg-subtle px-2 py-0.5 text-xs capitalize text-ink-secondary">
                      {graph.status}
                    </span>
                  ) : null}
                </div>
                
                <div className="flex items-center gap-4 mt-3 text-sm text-ink-muted">
                  <span>{graph.metadata.eventCount} events</span>
                  <span>{graph.metadata.arcCount} arcs</span>
                  <GraphHeadVersion graph={graph} />
                </div>

                {selectedGraph?.id === graph.id && (
                  <div className="flex gap-2 mt-4 pt-3 border-t border-line" onClick={(e) => e.stopPropagation()}>
                    {graph.id !== activeGraphId && (
                      <button
                        onClick={() => onSwitch(graph.id)}
                        className="px-3 py-1 bg-baseline text-on-accent rounded text-sm hover:bg-baseline/90"
                      >
                        Switch to Graph
                      </button>
                    )}
                    <button
                      onClick={() => onEdit(graph)}
                      className="px-3 py-1 border border-line rounded text-sm hover:bg-subtle"
                    >
                      Edit
                    </button>
                    <button
                      onClick={onDelete}
                      className="px-3 py-1 text-red-600 border border-red-200 rounded text-sm hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})

interface BranchesTabProps {
  /** The graph these branch from, for their short names. */
  parent: Graph | null
  branches: Graph[]
  activeGraphId: string | null
  isLoading: boolean
  onSwitch: (graphId: string) => void
  onCompare?: (graphId: string) => void
  onCreateBranch: () => void
}

const BranchesTab = memo(function BranchesTab({
  parent,
  branches,
  activeGraphId,
  isLoading,
  onSwitch,
  onCompare,
  onCreateBranch,
}: BranchesTabProps) {
  if (isLoading) {
    return <div className="text-center py-8 text-ink-muted">Loading branches...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-display text-xl font-semibold text-ink">Branches</h3>
        <button
          onClick={onCreateBranch}
          className="px-3 py-1.5 text-sm border border-divergence/60 text-ink rounded hover:bg-divergence/10"
        >
          Create branch
        </button>
      </div>

      {branches.length === 0 ? (
        <div className="text-center py-8 text-ink-muted">
          No branches yet. Create a branch to explore alternative timelines.
        </div>
      ) : (
        <div className="divide-y divide-line border-y border-line">
          {branches.map(branch => (
            <div
              key={branch.id}
              data-graph-row
              aria-current={branch.id === activeGraphId ? 'true' : undefined}
              className={`
                px-3 py-4
                ${branch.id === activeGraphId ? 'bg-selected/10' : ''}
              `}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-base font-semibold text-ink">
                    {branchLabel(branch, parent)}
                  </h4>
                  <div className="text-sm text-ink-muted mt-1">
                    {branch.metadata.eventCount} events <GraphHeadVersion graph={branch} prefix=" · " />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onCompare?.(branch.id)}
                    className="px-3 py-1 border border-divergence/60 text-ink rounded text-sm hover:bg-divergence/10 font-medium"
                    title="Compare branch against baseline"
                  >
                    Compare
                  </button>
                  {branch.id !== activeGraphId && (
                    <button
                      onClick={() => onSwitch(branch.id)}
                      className="px-3 py-1 bg-baseline text-on-accent rounded text-sm hover:bg-baseline/90"
                    >
                      Switch
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

export default GraphManagerModal

/** The UTC year of a graph's first event, for the calendar preview; undefined when it has none. */
function firstStoredYear(graph: Graph): number | undefined {
  const start = graph.metadata.temporalRange?.start
  if (!start) return undefined
  const year = new Date(start).getUTCFullYear()
  return Number.isNaN(year) ? undefined : year
}

/**
 * A graph's number in Version history (its head commit): the same number the
 * header badge, merge and restore use. `Graph.version` is an internal change
 * counter that runs ahead of it, so showing that here contradicted the header.
 */
function GraphHeadVersion({ graph, prefix = '' }: { graph: Graph; prefix?: string }) {
  const head = useGraphHeadVersion(graph.id, graph.version)
  if (head === null) return null
  return (
    <span className="font-mono-code">
      {prefix}v{head}
    </span>
  )
}
