import React, { useState, useCallback, useEffect } from 'react'
import { useGraphCopy } from '@/hooks/useGraphCopy'
import { useGlobalStore } from '@/stores/globalStore'
import { TimeRangeSelector } from '@/components/filters/TimeRangeSelector'
import { EntityFilter } from '@/types'

interface GraphCopyModalProps {
  isOpen: boolean
  onClose: () => void
}

type CopyType = 'full' | 'time_range' | 'filtered'

export const GraphCopyModal: React.FC<GraphCopyModalProps> = ({
  isOpen,
  onClose
}) => {
  const { events, arcs, activeFilters } = useGlobalStore()
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

  const [selectedCopyType, setSelectedCopyType] = useState<CopyType>('full')
  const [filterConfig, setFilterConfig] = useState<EntityFilter>({
    actors: [],
    targets: [],
    event_types: [],
    confidence_threshold: 0.5
  })

  // Reset form state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedCopyType('full')
      setFilterConfig({
        actors: [],
        targets: [],
        event_types: [],
        confidence_threshold: 0.5
      })
    }
  }, [isOpen])

  // Get unique actors and targets for filter options
  const uniqueActors = Array.from(new Set(events.map(e => e.actor))).sort()
  const uniqueTargets = Array.from(new Set(events.map(e => e.target))).sort()



  const handleFilterChange = useCallback(() => {
    setSelectedFilter(filterConfig)
  }, [filterConfig, setSelectedFilter])

  const handleCreateCopy = useCallback(async () => {
    try {
      switch (selectedCopyType) {
        case 'full':
          await createFullCopy()
          break
        case 'time_range':
          await createTimeRangeCopy()
          break
        case 'filtered':
          handleFilterChange()
          await createFilteredCopy()
          break
      }
      // Close modal on successful completion
      onClose()
    } catch (error) {
      // Don't close on error - let the hook handle error state
      console.error('Failed to create copy:', error)
    }
  }, [
    selectedCopyType,
    createFullCopy,
    createTimeRangeCopy,
    createFilteredCopy,
    handleFilterChange,
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

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="graph-copy-modal-title"
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 id="graph-copy-modal-title" className="text-2xl font-bold text-gray-900">Create Graph Copy</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              disabled={isCreatingCopy}
              aria-label="Close modal"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Copy Name Input */}
          <div className="mb-6">
            <label htmlFor="copyName" className="block text-sm font-medium text-gray-700 mb-2">
              Copy Name <span className="text-red-500">*</span>
            </label>
            <input
              id="copyName"
              type="text"
              value={copyState.copyName}
              onChange={(e) => setCopyName(e.target.value)}
              placeholder="Enter a name for the new graph copy"
              aria-required="true"
              aria-invalid={!copyState.copyName.trim()}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isCreatingCopy}
            />
          </div>

          {/* Copy Type Selection */}
          <div className="mb-6">
            <label id="copy-type-label" className="block text-sm font-medium text-gray-700 mb-3">
              Copy Type
            </label>
            <div role="radiogroup" aria-labelledby="copy-type-label" className="space-y-3">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="copyType"
                  value="full"
                  checked={selectedCopyType === 'full'}
                  onChange={(e) => setSelectedCopyType(e.target.value as CopyType)}
                  className="mr-3"
                  disabled={isCreatingCopy}
                />
                <div>
                  <div className="font-medium">Full Graph Copy</div>
                  <div className="text-sm text-gray-600">
                    Copy all events, arcs, and relationships ({events.length} events, {arcs.length} arcs)
                  </div>
                </div>
              </label>

              <label className="flex items-center">
                <input
                  type="radio"
                  name="copyType"
                  value="time_range"
                  checked={selectedCopyType === 'time_range'}
                  onChange={(e) => setSelectedCopyType(e.target.value as CopyType)}
                  className="mr-3"
                  disabled={isCreatingCopy}
                />
                <div>
                  <div className="font-medium">Time Range Copy</div>
                  <div className="text-sm text-gray-600">
                    Copy only events and arcs within a specific time period
                  </div>
                </div>
              </label>

              <label className="flex items-center">
                <input
                  type="radio"
                  name="copyType"
                  value="filtered"
                  checked={selectedCopyType === 'filtered'}
                  onChange={(e) => setSelectedCopyType(e.target.value as CopyType)}
                  className="mr-3"
                  disabled={isCreatingCopy}
                />
                <div>
                  <div className="font-medium">Filtered Copy</div>
                  <div className="text-sm text-gray-600">
                    Copy events and arcs matching specific criteria
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Time Range Configuration */}
          {selectedCopyType === 'time_range' && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="font-medium text-gray-900 mb-3">Time Range Selection</h3>
              <TimeRangeSelector
                value={copyState.selectedTimeRange}
                onChange={setSelectedTimeRange}
                disabled={isCreatingCopy}
                showPresets={true}
              />
            </div>
          )}

          {/* Filter Configuration */}
          {selectedCopyType === 'filtered' && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-medium text-gray-900">Filter Configuration</h3>
                <button
                  onClick={handleUseCurrentFilters}
                  className="text-sm text-blue-600 hover:text-blue-800 underline"
                  disabled={isCreatingCopy}
                >
                  Use Current Filters
                </button>
              </div>

              <div className="space-y-4">
                {/* Actors Filter */}
                <div>
                  <label htmlFor="actors-select" className="block text-sm font-medium text-gray-700 mb-2">
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-24"
                    disabled={isCreatingCopy}
                  >
                    {uniqueActors.map(actor => (
                      <option key={actor} value={actor}>
                        {actor}
                      </option>
                    ))}
                  </select>
                  <p id="actors-help" className="text-xs text-gray-500 mt-1">
                    Hold Ctrl/Cmd to select multiple actors
                  </p>
                </div>

                {/* Targets Filter */}
                <div>
                  <label htmlFor="targets-select" className="block text-sm font-medium text-gray-700 mb-2">
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-24"
                    disabled={isCreatingCopy}
                  >
                    {uniqueTargets.map(target => (
                      <option key={target} value={target}>
                        {target}
                      </option>
                    ))}
                  </select>
                  <p id="targets-help" className="text-xs text-gray-500 mt-1">
                    Hold Ctrl/Cmd to select multiple targets
                  </p>
                </div>

                {/* Confidence Threshold */}
                <div>
                  <label htmlFor="confidence-threshold" className="block text-sm font-medium text-gray-700 mb-2">
                    Confidence Threshold: {filterConfig.confidence_threshold}
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
                    className="w-full"
                    disabled={isCreatingCopy}
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>0.0 (Low)</span>
                    <span>1.0 (High)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
              disabled={isCreatingCopy}
            >
              Cancel
            </button>
            <button
              onClick={handleCreateCopy}
              disabled={!copyState.copyName.trim() || isCreatingCopy}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center"
            >
              {isCreatingCopy && (
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {isCreatingCopy ? 'Creating Copy...' : 'Create Copy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}