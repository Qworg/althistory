/**
 * GraphManagerModal Component
 * 
 * Full-featured modal for managing graphs: create, edit, delete, branch, merge.
 */

import { useState, useCallback, memo } from 'react'
import { 
  useGraphManagement, 
  useGraphVersions,
  useGraphBranches 
} from '@/hooks/useGraphs'
import { Graph, GraphStatus, GraphVersion } from '@/types'
import { ModalBase } from '@/components/modals/ModalBase'
import { BranchComparisonModal } from '@/components/branch/BranchComparisonModal'

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
  const [showBranchDialog, setShowBranchDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [branchName, setBranchName] = useState('')
  const [comparingBranchId, setComparingBranchId] = useState<string | null>(null)

  const {
    activeGraphId,
    activeGraph,
    graphs,
    updateGraph,
    deleteGraph,
    branchGraph,
    switchGraph,
    rollbackGraph,
    isDeleting,
    isBranching,
    isRollingBack,
  } = useGraphManagement()

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

  const handleBranchGraph = useCallback(async () => {
    if (!activeGraphId || !branchName.trim()) return
    try {
      await branchGraph(activeGraphId, branchName.trim())
      setBranchName('')
      setShowBranchDialog(false)
    } catch (error) {
      console.error('Failed to create branch:', error)
    }
  }, [activeGraphId, branchName, branchGraph])

  const handleRollback = useCallback(async (version: number) => {
    if (!activeGraphId) return
    if (window.confirm(`Are you sure you want to rollback to version ${version}? This cannot be undone.`)) {
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
        <div className="w-48 border-r bg-gray-50 flex flex-col">
          <nav className="flex-1 p-2">
            {(['graphs', 'branches', 'versions'] as Tab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`
                  w-full px-3 py-2 rounded text-left text-sm font-medium capitalize
                  ${activeTab === tab 
                    ? 'bg-blue-100 text-blue-700' 
                    : 'text-gray-600 hover:bg-gray-100'}
                  transition-colors
                `}
              >
                {tab}
              </button>
            ))}
          </nav>

          {/* Current Graph Info */}
          {activeGraph && (
            <div className="p-3 border-t bg-white">
              <div className="text-xs text-gray-500 mb-1">Active Graph</div>
              <div className="font-medium text-sm text-gray-900 truncate">
                {activeGraph.name}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                v{activeGraph.version} - {activeGraph.metadata.eventCount} events
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
                onBranch={() => setShowBranchDialog(true)}
              />
            )}

            {activeTab === 'branches' && (
              <BranchesTab
                branches={branches || []}
                activeGraphId={activeGraphId}
                isLoading={isLoadingBranches}
                onSwitch={handleSwitchAndClose}
                onCompare={setComparingBranchId}
                onCreateBranch={() => setShowBranchDialog(true)}
              />
            )}

            {activeTab === 'versions' && (
              <VersionsTab
                versions={versions || []}
                isLoading={isLoadingVersions}
                currentVersion={activeGraph?.version}
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
          <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
            <h3 className="text-lg font-semibold mb-4">Create Branch</h3>
            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="Branch name..."
              className="w-full px-3 py-2 border rounded mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowBranchDialog(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleBranchGraph}
                disabled={!branchName.trim() || isBranching}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {isBranching ? 'Creating...' : 'Create Branch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && selectedGraph && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
            <h3 className="text-lg font-semibold mb-2 text-red-600">Delete Graph</h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to delete "{selectedGraph.name}"? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
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
}: GraphsTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">All Graphs</h3>
        <button
          onClick={onBranch}
          disabled={!activeGraphId}
          className="px-3 py-1.5 text-sm bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50"
        >
          Branch Current
        </button>
      </div>

      <div className="grid gap-3">
        {graphs.map(graph => (
          <div
            key={graph.id}
            onClick={() => onSelect(graph)}
            className={`
              p-4 border rounded-lg cursor-pointer transition-all
              ${graph.id === activeGraphId ? 'border-blue-500 bg-blue-50' : 'hover:border-gray-300'}
              ${selectedGraph?.id === graph.id ? 'ring-2 ring-blue-500' : ''}
            `}
          >
            {editingGraph?.id === graph.id ? (
              // Edit Mode
              <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  value={editingGraph.name}
                  onChange={(e) => onEditChange({ ...editingGraph, name: e.target.value })}
                  className="w-full px-2 py-1 border rounded text-lg font-semibold"
                />
                <textarea
                  value={editingGraph.description || ''}
                  onChange={(e) => onEditChange({ ...editingGraph, description: e.target.value })}
                  placeholder="Description..."
                  className="w-full px-2 py-1 border rounded text-sm"
                  rows={2}
                />
                <select
                  value={editingGraph.status}
                  onChange={(e) => onEditChange({ ...editingGraph, status: e.target.value as GraphStatus })}
                  className="px-2 py-1 border rounded text-sm"
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={onSaveEdit}
                    className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                  >
                    Save
                  </button>
                  <button
                    onClick={onCancelEdit}
                    className="px-3 py-1 border rounded text-sm hover:bg-gray-50"
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
                    <h4 className="font-semibold text-gray-900">
                      {graph.name}
                      {graph.branchName && (
                        <span className="ml-2 text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                          {graph.branchName}
                        </span>
                      )}
                    </h4>
                    {graph.description && (
                      <p className="text-sm text-gray-500 mt-1">{graph.description}</p>
                    )}
                  </div>
                  <span className={`
                    text-xs px-2 py-0.5 rounded capitalize
                    ${graph.status === 'active' ? 'bg-green-100 text-green-700' : 
                      graph.status === 'archived' ? 'bg-yellow-100 text-yellow-700' : 
                      'bg-red-100 text-red-700'}
                  `}>
                    {graph.status}
                  </span>
                </div>
                
                <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                  <span>{graph.metadata.eventCount} events</span>
                  <span>{graph.metadata.arcCount} arcs</span>
                  <span>v{graph.version}</span>
                </div>

                {selectedGraph?.id === graph.id && (
                  <div className="flex gap-2 mt-4 pt-3 border-t" onClick={(e) => e.stopPropagation()}>
                    {graph.id !== activeGraphId && (
                      <button
                        onClick={() => onSwitch(graph.id)}
                        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                      >
                        Switch to Graph
                      </button>
                    )}
                    <button
                      onClick={() => onEdit(graph)}
                      className="px-3 py-1 border rounded text-sm hover:bg-gray-50"
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
    return <div className="text-center py-8 text-gray-500">Loading branches...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Branches</h3>
        <button
          onClick={onCreateBranch}
          className="px-3 py-1.5 text-sm bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
        >
          Create Branch
        </button>
      </div>

      {branches.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No branches yet. Create a branch to explore alternative timelines.
        </div>
      ) : (
        <div className="grid gap-3">
          {branches.map(branch => (
            <div
              key={branch.id}
              className={`
                p-4 border rounded-lg
                ${branch.id === activeGraphId ? 'border-blue-500 bg-blue-50' : ''}
              `}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-gray-900">
                    {branch.branchName || branch.name}
                  </h4>
                  <div className="text-sm text-gray-500 mt-1">
                    {branch.metadata.eventCount} events - v{branch.version}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onCompare?.(branch.id)}
                    className="px-3 py-1 bg-purple-50 text-purple-700 border border-purple-200 rounded text-sm hover:bg-purple-100 font-medium"
                    title="Compare branch against baseline"
                  >
                    Compare
                  </button>
                  {branch.id !== activeGraphId && (
                    <button
                      onClick={() => onSwitch(branch.id)}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
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
    return <div className="text-center py-8 text-gray-500">Loading version history...</div>
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Version History</h3>

      {versions.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No version history available.
        </div>
      ) : (
        <div className="space-y-3">
          {versions.map((version) => (
            <div
              key={version.commitHash}
              className={`
                p-4 border rounded-lg
                ${version.version === currentVersion ? 'border-blue-500 bg-blue-50' : ''}
              `}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">v{version.version}</span>
                    {version.version === currentVersion && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">{version.message}</div>
                  <div className="text-xs text-gray-400 mt-2">
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
