/**
 * GraphSelector Component
 * 
 * Dropdown component for switching between graphs, creating new graphs,
 * and accessing graph management features.
 */

import React, { useState, useCallback, memo, useRef, useEffect } from 'react'
import { 
  useGraphManagement, 
} from '@/hooks/useGraphs'
import { GraphStatus } from '@/types'

interface GraphSelectorProps {
  onOpenManager?: () => void
  className?: string
}

export const GraphSelector = memo(function GraphSelector({ 
  onOpenManager,
  className = '' 
}: GraphSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newGraphName, setNewGraphName] = useState('')
  const [filter, setFilter] = useState<GraphStatus | 'all'>('active')
  
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const {
    activeGraphId,
    activeGraph,
    graphs,
    switchGraph,
    createGraph,
    isLoading,
    isCreating: isCreatingGraph,
    isSwitching,
  } = useGraphManagement()

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setIsCreating(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Focus input when creating
  useEffect(() => {
    if (isCreating && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isCreating])

  const handleToggle = useCallback(() => {
    setIsOpen(prev => !prev)
    setIsCreating(false)
  }, [])

  const handleSelectGraph = useCallback((graphId: string) => {
    if (graphId !== activeGraphId) {
      switchGraph(graphId)
    }
    setIsOpen(false)
  }, [activeGraphId, switchGraph])

  const handleStartCreate = useCallback(() => {
    setIsCreating(true)
    setNewGraphName('')
  }, [])

  const handleCancelCreate = useCallback(() => {
    setIsCreating(false)
    setNewGraphName('')
  }, [])

  const handleCreate = useCallback(async () => {
    if (!newGraphName.trim()) return

    try {
      const newGraph = await createGraph({ name: newGraphName.trim() })
      switchGraph(newGraph.id)
      setIsCreating(false)
      setNewGraphName('')
      setIsOpen(false)
    } catch (error) {
      console.error('Failed to create graph:', error)
    }
  }, [newGraphName, createGraph, switchGraph])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreate()
    } else if (e.key === 'Escape') {
      handleCancelCreate()
    }
  }, [handleCreate, handleCancelCreate])

  const filteredGraphs = filter === 'all' 
    ? graphs 
    : graphs.filter(g => g.status === filter)

  const displayName = activeGraph?.name || 'Select Graph'
  const isDisabled = isLoading || isSwitching

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      {/* Main Button */}
      <button
        onClick={handleToggle}
        disabled={isDisabled}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-lg border
          ${isDisabled 
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
            : 'bg-white hover:bg-gray-50 text-gray-700 cursor-pointer'}
          transition-colors min-w-[200px]
        `}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {/* Graph Icon */}
        <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" 
          />
        </svg>

        {/* Graph Name */}
        <span className="flex-1 text-left truncate font-medium">
          {isSwitching ? 'Switching...' : displayName}
        </span>

        {/* Version Badge */}
        {activeGraph && (
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            v{activeGraph.version}
          </span>
        )}

        {/* Chevron */}
        <svg 
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-white border rounded-lg shadow-lg z-50">
          {/* Filter Tabs */}
          <div className="flex border-b">
            {(['active', 'archived', 'all'] as const).map(status => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`
                  flex-1 px-3 py-2 text-sm font-medium capitalize
                  ${filter === status 
                    ? 'text-blue-600 border-b-2 border-blue-600' 
                    : 'text-gray-500 hover:text-gray-700'}
                `}
              >
                {status}
              </button>
            ))}
          </div>

          {/* Graph List */}
          <div className="max-h-64 overflow-y-auto">
            {filteredGraphs.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-500 text-center">
                No {filter !== 'all' ? filter : ''} graphs found
              </div>
            ) : (
              filteredGraphs.map(graph => (
                <button
                  key={graph.id}
                  onClick={() => handleSelectGraph(graph.id)}
                  className={`
                    w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors
                    ${graph.id === activeGraphId ? 'bg-blue-50' : ''}
                    flex items-start gap-3
                  `}
                >
                  {/* Selection Indicator */}
                  <span className={`
                    mt-1 w-2 h-2 rounded-full flex-shrink-0
                    ${graph.id === activeGraphId ? 'bg-blue-600' : 'bg-transparent'}
                  `} />
                  
                  <div className="flex-1 min-w-0">
                    {/* Graph Name */}
                    <div className="font-medium text-gray-900 truncate">
                      {graph.name}
                      {graph.branchName && (
                        <span className="ml-1.5 text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                          {graph.branchName}
                        </span>
                      )}
                    </div>
                    
                    {/* Description */}
                    {graph.description && (
                      <div className="text-sm text-gray-500 truncate mt-0.5">
                        {graph.description}
                      </div>
                    )}
                    
                    {/* Metadata */}
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                      <span>{graph.metadata.eventCount} events</span>
                      <span>{graph.metadata.arcCount} arcs</span>
                      <span>v{graph.version}</span>
                      {graph.metadata.timeRange && (
                        <span>
                          {new Date(graph.metadata.timeRange.start).getFullYear()}–{new Date(graph.metadata.timeRange.end).getFullYear()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status Badge */}
                  {graph.status !== 'active' && (
                    <span className={`
                      text-xs px-1.5 py-0.5 rounded capitalize
                      ${graph.status === 'archived' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}
                    `}>
                      {graph.status}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Create New Graph */}
          <div className="border-t p-2">
            {isCreating ? (
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={newGraphName}
                  onChange={(e) => setNewGraphName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Graph name..."
                  className="flex-1 px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleCreate}
                  disabled={!newGraphName.trim() || isCreatingGraph}
                  className="px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreatingGraph ? '...' : 'Create'}
                </button>
                <button
                  onClick={handleCancelCreate}
                  className="px-2 py-2 text-gray-500 hover:text-gray-700"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleStartCreate}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Graph
                </button>
                
                {onOpenManager && (
                  <button
                    onClick={() => {
                      setIsOpen(false)
                      onOpenManager()
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" 
                      />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Manage
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

export default GraphSelector
