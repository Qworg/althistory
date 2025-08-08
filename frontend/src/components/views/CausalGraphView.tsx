import { useState, useCallback } from 'react'
import { CausalGraphComponent } from '@/components/causal-graph'
import { Event, CausalRelationship } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'

export function CausalGraphView() {
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [selectedRelationship, setSelectedRelationship] = useState<CausalRelationship | null>(null)
  const [hoveredEvent, setHoveredEvent] = useState<Event | null>(null)
  const [hoveredRelationship, setHoveredRelationship] = useState<CausalRelationship | null>(null)
  
  const { 
    events, 
    causalRelationships,
    sessionData,
    updateSessionData
  } = useGlobalStore()

  const handleNodeClick = useCallback((event: Event) => {
    setSelectedEvent(event)
    setSelectedRelationship(null)
  }, [])

  const handleNodeHover = useCallback((event: Event | null) => {
    setHoveredEvent(event)
  }, [])

  const handleEdgeClick = useCallback((relationship: CausalRelationship) => {
    setSelectedRelationship(relationship)
    setSelectedEvent(null)
  }, [])

  const handleEdgeHover = useCallback((relationship: CausalRelationship | null) => {
    setHoveredRelationship(relationship)
  }, [])

  const handleLayoutChange = useCallback((layout: string) => {
    updateSessionData({
      viewportState: {
        ...sessionData.viewportState,
        causalGraph: {
          ...sessionData.viewportState.causalGraph,
          layout
        }
      }
    })
  }, [sessionData, updateSessionData])

  const currentLayout = sessionData.viewportState.causalGraph.layout || 'cose'

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Header with controls */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Causal Graph View</h2>
            <p className="text-sm text-gray-600 mt-1">
              Explore causal relationships between events
            </p>
          </div>
          
          {/* Layout controls */}
          <div className="flex items-center space-x-4">
            <label className="text-sm font-medium text-gray-700">Layout:</label>
            <select
              value={currentLayout}
              onChange={(e) => handleLayoutChange(e.target.value)}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="cose">Force-directed</option>
              <option value="breadthfirst">Hierarchical</option>
              <option value="circle">Circular</option>
              <option value="grid">Grid</option>
              <option value="concentric">Concentric</option>
            </select>
          </div>
        </div>
        
        {/* Statistics */}
        <div className="mt-4 flex items-center space-x-6 text-sm text-gray-600">
          <span>{events.length} events</span>
          <span>{causalRelationships.length} relationships</span>
          {selectedEvent && (
            <span className="text-blue-600 font-medium">
              Selected: {selectedEvent.actor} → {selectedEvent.target}
            </span>
          )}
          {selectedRelationship && (
            <span className="text-green-600 font-medium">
              Relationship weight: {selectedRelationship.weight.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* Main graph container */}
      <div className="flex-1 bg-white rounded-lg shadow p-4">
        <CausalGraphComponent
          className="h-full"
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onEdgeClick={handleEdgeClick}
          onEdgeHover={handleEdgeHover}
        />
      </div>

      {/* Info panels */}
      {(hoveredEvent || hoveredRelationship) && (
        <div className="bg-white rounded-lg shadow p-4">
          {hoveredEvent && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Event Details</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium text-gray-700">Actor:</span>
                  <span className="ml-2 text-gray-900">{hoveredEvent.actor}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Target:</span>
                  <span className="ml-2 text-gray-900">{hoveredEvent.target}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-medium text-gray-700">Description:</span>
                  <span className="ml-2 text-gray-900">{hoveredEvent.description}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Timestamp:</span>
                  <span className="ml-2 text-gray-900">
                    {new Date(hoveredEvent.timestamp).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}
          
          {hoveredRelationship && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Causal Relationship</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium text-gray-700">Weight:</span>
                  <span className="ml-2 text-gray-900">{hoveredRelationship.weight.toFixed(2)}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Confidence:</span>
                  <span className="ml-2 text-gray-900">{hoveredRelationship.confidence.toFixed(2)}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Type:</span>
                  <span className="ml-2 text-gray-900 capitalize">{hoveredRelationship.relationship_type}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-medium text-gray-700">Evidence:</span>
                  <span className="ml-2 text-gray-900">{hoveredRelationship.evidence}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}