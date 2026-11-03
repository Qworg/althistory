/**
 * GraphManagerModal Component
 * 
 * Full-featured modal for managing graphs: create, edit, delete, branch, merge.
 */

import { useState, useCallback, memo } from 'react'
import { 
  useGraphManagement, 
  useGraphVersions,
  useGraphBranches,
  useGraphHeadVersion,
} from '@/hooks/useGraphs'
import { Graph, GraphStatus, GraphVersion, CreateGraphRequest } from '@/types'
import { ModalBase } from '@/components/modals/ModalBase'
import { BranchComparisonModal } from '@/components/branch/BranchComparisonModal'
import { CreateGraphModal } from './CreateGraphModal'

interface GraphManagerModalProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: 'graphs' | 'branches' | 'versions'
}

type Tab = 'graphs' | 'branches' | 'versions'

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

  const {
    activeGraphId,
    activeGraph,
    graphs,
    createGraph,
    updateGraph,
    deleteGraph,
    branchGraph,
    switchGraph,
    rollbackGraph,
    isCreating,
    isDeleting,
    isBranching,
    isRollingBack,
  } = useGraphManagement()
  // Version-history numbers (Graph.version is an internal change counter)
  const headVersion = useGraphHeadVersion(activeGraph?.id, activeGraph?.version)

  const { data: versions, isLoading: isLoadingVersions } = useGraphVersions(
    activeTab === 'versions' ? activeGraphId : null
  )

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
  }, [])

  const handleCreateGraph = useCallback(async (request: CreateGraphRequest) => {
    await createGraph(request)
    setShowCreateModal(false)
  }, [createGraph])

  const handleSaveEdit = useCallback(() => {
    if (!editingGraph) return
    updateGraph({ id: editingGraph.id, data: {
      name: editingGraph.name,
      description: editingGraph.description,
      status: editingGraph.status,
    }})
    setEditingGraph(null)
  }, [editingGraph, updateGraph])

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

  const handleRollback = useCallback(async (version: number) => {
    if (!activeGraphId) return
    // A restore commits a NEW version with the old content, so it is itself
    // undoable from Version history: the confirmation says so, not the reverse.
    if (window.confirm(`Restore version ${version}? The graph returns to how it was then, saved as a new version; the current state stays in Version history.`)) {
      await rollbackGraph(activeGraphId, version)
    }
  }, [activeGraphId, rollbackGraph])

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
      <div className="flex h-[600px]">
        {/* Sidebar Navigation */}
        <div className="w-48 border-r border-line bg-subtle flex flex-col">
          <nav className="flex-1 p-2">
            {(['graphs', 'branches', 'versions'] as Tab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`
                  w-full px-3 py-2 rounded text-left text-sm font-medium capitalize
                  ${activeTab === tab 
                    ? 'bg-selected/10 text-ink' 
                    : 'text-ink-secondary hover:bg-card hover:text-ink'}
                  transition-colors
                `}
              >
                {tab}
              </button>
            ))}
          </nav>

          {/* Current Graph Info */}
          {activeGraph && (
            <div className="p-3 border-t border-line bg-card">
              <div className="text-xs text-ink-muted mb-1">Active Graph</div>
              <div className="font-medium text-sm text-ink truncate">
                {activeGraph.name}
              </div>
              <div className="text-xs text-ink-muted mt-1 font-mono-code">
                {headVersion !== null ? `v${headVersion} · ` : ''}{activeGraph.metadata.eventCount} events
              </div>
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-4">
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
                onSwitch={handleSwitchAndClose}
                onDelete={() => setShowDeleteDialog(true)}
                onBranch={openBranchDialog}
                onCreate={() => setShowCreateModal(true)}
              />
            )}

            {activeTab === 'branches' && (
              <BranchesTab
                branches={branches || []}
                activeGraphId={activeGraphId}
                isLoading={isLoadingBranches}
                onSwitch={handleSwitchAndClose}
                onCompare={setComparingBranchId}
                onCreateBranch={openBranchDialog}
              />
            )}

            {activeTab === 'versions' && (
              <VersionsTab
                versions={versions || []}
                isLoading={isLoadingVersions}
                currentVersion={headVersion ?? undefined}
                onRollback={handleRollback}
                isRollingBack={isRollingBack}
              />
            )}
          </div>
        </div>
      </div>

      {/* Branch Dialog */}
      {showBranchDialog && (
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
                className="px-4 py-2 text-sm bg-baseline text-white rounded hover:bg-baseline/90 disabled:opacity-50"
              >
                {isBranching ? 'Creating branch…' : 'Create branch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && selectedGraph && (
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
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
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
            className="px-3 py-1.5 text-sm bg-baseline text-white rounded hover:bg-baseline/90"
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

      <div className="grid gap-3">
        {graphs.map(graph => (
          <div
            key={graph.id}
            onClick={() => onSelect(graph)}
            className={`
              p-4 border rounded-lg cursor-pointer transition-all
              ${graph.id === activeGraphId ? 'border-selected bg-selected/10' : 'border-line hover:border-ink-muted'}
              ${selectedGraph?.id === graph.id ? 'ring-2 ring-selected' : ''}
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
                <div className="flex gap-2">
                  <button
                    onClick={onSaveEdit}
                    className="px-3 py-1 bg-baseline text-white rounded text-sm hover:bg-baseline/90"
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
                    <h4 className="text-base font-semibold text-ink">
                      {graph.name}
                      {graph.branchName && (
                        <span className="ml-2 text-xs text-ink-secondary border border-divergence/50 px-1.5 py-0.5 rounded">
                          {graph.branchName}
                        </span>
                      )}
                    </h4>
                    {graph.description && (
                      <p className="text-sm text-ink-muted mt-1">{graph.description}</p>
                    )}
                  </div>
                  {/* "Active" is the default status of every graph, so it says
                      nothing; the badge marks the exceptions and the open one. */}
                  {graph.id === activeGraphId ? (
                    <span className="shrink-0 rounded border border-selected/30 px-2 py-0.5 text-xs font-medium text-selected">
                      Open
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
                        className="px-3 py-1 bg-baseline text-white rounded text-sm hover:bg-baseline/90"
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
  branches: Graph[]
  activeGraphId: string | null
  isLoading: boolean
  onSwitch: (graphId: string) => void
  onCompare?: (graphId: string) => void
  onCreateBranch: () => void
}

const BranchesTab = memo(function BranchesTab({
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
        <div className="grid gap-3">
          {branches.map(branch => (
            <div
              key={branch.id}
              className={`
                p-4 border rounded-lg
                ${branch.id === activeGraphId ? 'border-selected bg-selected/10' : 'border-line'}
              `}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-base font-semibold text-ink">
                    {branch.name}
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
                      className="px-3 py-1 bg-baseline text-white rounded text-sm hover:bg-baseline/90"
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

interface VersionsTabProps {
  versions: GraphVersion[]
  isLoading: boolean
  currentVersion?: number
  onRollback: (version: number) => void
  isRollingBack: boolean
}

const VersionsTab = memo(function VersionsTab({
  versions,
  isLoading,
  currentVersion,
  onRollback,
  isRollingBack,
}: VersionsTabProps) {
  if (isLoading) {
    return <div className="text-center py-8 text-ink-muted">Loading version history...</div>
  }

  return (
    <div className="space-y-4">
      <h3 className="font-display text-xl font-semibold text-ink">Version history</h3>

      {versions.length === 0 ? (
        <div className="text-center py-8 text-ink-muted">
          No version history available.
        </div>
      ) : (
        <div className="space-y-3">
          {versions.map((version) => (
            <div
              key={version.commitHash}
              className={`
                p-4 border rounded-lg
                ${version.version === currentVersion ? 'border-selected bg-selected/10' : 'border-line'}
              `}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">v{version.version}</span>
                    {version.version === currentVersion && (
                      <span className="text-xs bg-selected/10 text-ink px-1.5 py-0.5 rounded">
                        Current
                      </span>
                    )}
                    {version.operation && (
                      <span className="text-xs bg-subtle text-ink-secondary px-1.5 py-0.5 rounded capitalize">
                        {version.operation}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-ink-secondary mt-1">{version.message}</div>
                  <div className="text-xs text-ink-muted mt-2">
                    {new Date(version.timestamp).toLocaleString()}
                    {version.author && ` by ${version.author}`}
                  </div>
                </div>
                
                {version.version !== currentVersion && (
                  <button
                    onClick={() => onRollback(version.version)}
                    disabled={isRollingBack}
                    className="px-3 py-1 text-sm border border-orange-200 text-orange-600 rounded hover:bg-orange-50 disabled:opacity-50"
                  >
                    {isRollingBack ? 'Rolling back...' : 'Rollback'}
                  </button>
                )}
              </div>

              {/* Change summary */}
              <div className="flex flex-wrap gap-2 mt-3 text-xs">
                {version.changes.eventsAdded > 0 && (
                  <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                    +{version.changes.eventsAdded} events
                  </span>
                )}
                {version.changes.eventsModified > 0 && (
                  <span className="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">
                    ~{version.changes.eventsModified} events
                  </span>
                )}
                {version.changes.eventsDeleted > 0 && (
                  <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                    -{version.changes.eventsDeleted} events
                  </span>
                )}
                {version.changes.arcsAdded > 0 && (
                  <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                    +{version.changes.arcsAdded} arcs
                  </span>
                )}
                {version.changes.relationshipsAdded > 0 && (
                  <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                    +{version.changes.relationshipsAdded} relationships
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

export default GraphManagerModal

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
