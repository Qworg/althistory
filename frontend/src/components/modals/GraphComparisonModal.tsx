import React, { useState, useMemo } from 'react'
import { Event, Arc, CausalRelationship } from '@/types'

interface GraphComparisonModalProps {
  isOpen: boolean
  onClose: () => void
  originalGraphName: string
  copiedGraphName: string
  originalData?: {
    events: Event[]
    arcs: Arc[]
    relationships: CausalRelationship[]
  }
  copiedData?: {
    events: Event[]
    arcs: Arc[]
    relationships: CausalRelationship[]
  }
}

type ComparisonView = 'summary' | 'events' | 'arcs' | 'relationships'

interface ComparisonStats {
  originalCount: number
  copiedCount: number
  difference: number
  percentageChange: number
}

export const GraphComparisonModal: React.FC<GraphComparisonModalProps> = ({
  isOpen,
  onClose,
  originalGraphName,
  copiedGraphName,
  originalData,
  copiedData
}) => {
  const [activeView, setActiveView] = useState<ComparisonView>('summary')
  const [showOnlyDifferences, setShowOnlyDifferences] = useState(false)

  // Calculate comparison statistics
  const comparisonStats = useMemo(() => {
    if (!originalData || !copiedData) {
      return {
        events: { originalCount: 0, copiedCount: 0, difference: 0, percentageChange: 0 },
        arcs: { originalCount: 0, copiedCount: 0, difference: 0, percentageChange: 0 },
        relationships: { originalCount: 0, copiedCount: 0, difference: 0, percentageChange: 0 }
      }
    }

    const calculateStats = (originalCount: number, copiedCount: number): ComparisonStats => {
      const difference = copiedCount - originalCount
      const percentageChange = originalCount > 0 ? (difference / originalCount) * 100 : 0
      return { originalCount, copiedCount, difference, percentageChange }
    }

    return {
      events: calculateStats(originalData.events.length, copiedData.events.length),
      arcs: calculateStats(originalData.arcs.length, copiedData.arcs.length),
      relationships: calculateStats(originalData.relationships.length, copiedData.relationships.length)
    }
  }, [originalData, copiedData])

  // Find differences between datasets
  const differences = useMemo(() => {
    if (!originalData || !copiedData) return { added: [], removed: [], modified: [] }

    const originalEventIds = new Set(originalData.events.map(e => e.id))
    const copiedEventIds = new Set(copiedData.events.map(e => e.id))

    const addedEvents = copiedData.events.filter(e => !originalEventIds.has(e.id))
    const removedEvents = originalData.events.filter(e => !copiedEventIds.has(e.id))

    // For simplicity, we'll focus on added/removed for now
    // Modified detection would require deep comparison
    return {
      added: addedEvents,
      removed: removedEvents,
      modified: [] // TODO: Implement modified detection
    }
  }, [originalData, copiedData])

  const formatPercentage = (value: number) => {
    const sign = value > 0 ? '+' : ''
    return `${sign}${value.toFixed(1)}%`
  }

  const getChangeColor = (value: number) => {
    if (value > 0) return 'text-green-600'
    if (value < 0) return 'text-red-600'
    return 'text-gray-600'
  }

  const renderSummaryView = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {/* Events Summary */}
        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="font-medium text-gray-900 mb-2">Events</h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Original:</span>
              <span className="font-medium">{comparisonStats.events.originalCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Copied:</span>
              <span className="font-medium">{comparisonStats.events.copiedCount}</span>
            </div>
            <div className="flex justify-between border-t pt-1">
              <span>Change:</span>
              <span className={`font-medium ${getChangeColor(comparisonStats.events.difference)}`}>
                {comparisonStats.events.difference} ({formatPercentage(comparisonStats.events.percentageChange)})
              </span>
            </div>
          </div>
        </div>

        {/* Arcs Summary */}
        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="font-medium text-gray-900 mb-2">Arcs</h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Original:</span>
              <span className="font-medium">{comparisonStats.arcs.originalCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Copied:</span>
              <span className="font-medium">{comparisonStats.arcs.copiedCount}</span>
            </div>
            <div className="flex justify-between border-t pt-1">
              <span>Change:</span>
              <span className={`font-medium ${getChangeColor(comparisonStats.arcs.difference)}`}>
                {comparisonStats.arcs.difference} ({formatPercentage(comparisonStats.arcs.percentageChange)})
              </span>
            </div>
          </div>
        </div>

        {/* Relationships Summary */}
        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="font-medium text-gray-900 mb-2">Relationships</h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Original:</span>
              <span className="font-medium">{comparisonStats.relationships.originalCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Copied:</span>
              <span className="font-medium">{comparisonStats.relationships.copiedCount}</span>
            </div>
            <div className="flex justify-between border-t pt-1">
              <span>Change:</span>
              <span className={`font-medium ${getChangeColor(comparisonStats.relationships.difference)}`}>
                {comparisonStats.relationships.difference} ({formatPercentage(comparisonStats.relationships.percentageChange)})
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Differences Summary */}
      {differences.added.length > 0 || differences.removed.length > 0 ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-medium text-yellow-800 mb-2">Key Differences</h3>
          <div className="space-y-2 text-sm">
            {differences.added.length > 0 && (
              <div className="flex items-center text-green-700">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                {differences.added.length} events added
              </div>
            )}
            {differences.removed.length > 0 && (
              <div className="flex items-center text-red-700">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
                {differences.removed.length} events removed
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center text-green-700">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            No significant differences detected
          </div>
        </div>
      )}
    </div>
  )

  const renderEventsView = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900">Events Comparison</h3>
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={showOnlyDifferences}
            onChange={(e) => setShowOnlyDifferences(e.target.checked)}
            className="mr-2"
          />
          Show only differences
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="font-medium text-gray-700 mb-2">{originalGraphName}</h4>
          <div className="bg-gray-50 rounded-lg p-3 max-h-96 overflow-y-auto">
            {originalData?.events.map(event => (
              <div key={event.id} className="mb-2 p-2 bg-white rounded text-sm">
                <div className="font-medium">{event.description}</div>
                <div className="text-gray-600">{event.actor} → {event.target}</div>
                <div className="text-xs text-gray-500">{new Date(event.timestamp).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">{copiedGraphName}</h4>
          <div className="bg-gray-50 rounded-lg p-3 max-h-96 overflow-y-auto">
            {copiedData?.events.map(event => (
              <div key={event.id} className="mb-2 p-2 bg-white rounded text-sm">
                <div className="font-medium">{event.description}</div>
                <div className="text-gray-600">{event.actor} → {event.target}</div>
                <div className="text-xs text-gray-500">{new Date(event.timestamp).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )

  const renderViewContent = () => {
    switch (activeView) {
      case 'summary':
        return renderSummaryView()
      case 'events':
        return renderEventsView()
      case 'arcs':
        return <div className="text-center py-8 text-gray-500">Arc comparison view coming soon</div>
      case 'relationships':
        return <div className="text-center py-8 text-gray-500">Relationship comparison view coming soon</div>
      default:
        return renderSummaryView()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Graph Comparison</h2>
              <p className="text-gray-600 mt-1">
                Comparing "{originalGraphName}" with "{copiedGraphName}"
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* View Tabs */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="-mb-px flex space-x-8">
              {[
                { id: 'summary', label: 'Summary', icon: '📊' },
                { id: 'events', label: 'Events', icon: '📅' },
                { id: 'arcs', label: 'Arcs', icon: '🏛️' },
                { id: 'relationships', label: 'Relationships', icon: '🔗' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveView(tab.id as ComparisonView)}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeView === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <span className="mr-2">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* View Content */}
          <div className="min-h-96">
            {renderViewContent()}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 mt-6 pt-6 border-t">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}