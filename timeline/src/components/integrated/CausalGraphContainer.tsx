import React, { useCallback, useState } from 'react';
import { CausalGraphVisualization } from '@/components/causal/CausalGraphVisualization';
import { useCausalGraphData, useVisualizationState, useRealTimeUpdates } from '@/hooks/useVisualizationData';
import { useCausalChain } from '@/hooks/useApiData';
import { IEvent } from '@/models/Event';
import { CausalGraphRelationship, CausalPath } from '@/components/causal/types';
import { TimeRange } from '@/hooks/useVisualizationData';

/**
 * Props for CausalGraphContainer
 */
export interface CausalGraphContainerProps {
  /** Initial filters */
  initialFilters?: {
    timeRange?: TimeRange;
    actor?: string;
    target?: string;
    minCausalWeight?: number;
  };
  
  /** Enable real-time updates */
  realTimeUpdates?: boolean;
  
  /** Refresh interval in milliseconds */
  refreshInterval?: number;
  
  /** CSS class name */
  className?: string;
  
  /** Event handlers */
  onEventSelect?: (event: IEvent | null) => void;
  onRelationshipSelect?: (relationship: CausalGraphRelationship | null) => void;
  onPathHighlight?: (path: CausalPath | null) => void;
}

/**
 * Loading component
 */
const LoadingSpinner: React.FC = () => (
  <div className="loading-spinner" style={{
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '400px',
    fontSize: '16px',
    color: '#666'
  }}>
    <div style={{ textAlign: 'center' }}>
      <div style={{
        border: '4px solid #f3f3f3',
        borderTop: '4px solid #3498db',
        borderRadius: '50%',
        width: '40px',
        height: '40px',
        animation: 'spin 1s linear infinite',
        margin: '0 auto 16px'
      }} />
      Loading causal graph data...
    </div>
  </div>
);

/**
 * Error component
 */
const ErrorDisplay: React.FC<{ error: Error; onRetry: () => void }> = ({ error, onRetry }) => (
  <div className="error-display" style={{
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: '400px',
    padding: '20px',
    backgroundColor: '#fee',
    border: '1px solid #fcc',
    borderRadius: '4px',
    color: '#c33'
  }}>
    <h3 style={{ margin: '0 0 16px', color: '#c33' }}>Error Loading Causal Graph</h3>
    <p style={{ margin: '0 0 16px', textAlign: 'center' }}>{error.message}</p>
    <button
      onClick={onRetry}
      style={{
        padding: '8px 16px',
        backgroundColor: '#3498db',
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer'
      }}
    >
      Retry
    </button>
  </div>
);

/**
 * Weight filter control
 */
const WeightFilter: React.FC<{
  value: number;
  onChange: (value: number) => void;
}> = ({ value, onChange }) => (
  <div className="weight-filter" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
    <label style={{ fontSize: '14px', color: '#495057' }}>Min Weight:</label>
    <input
      type="range"
      min="0"
      max="1"
      step="0.1"
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{ width: '100px' }}
    />
    <span style={{ fontSize: '14px', color: '#495057', minWidth: '40px' }}>
      {(value * 100).toFixed(0)}%
    </span>
  </div>
);

/**
 * Causal graph container with API integration
 */
export const CausalGraphContainer: React.FC<CausalGraphContainerProps> = ({
  initialFilters = {},
  realTimeUpdates = false,
  refreshInterval = 30000,
  className = '',
  onEventSelect,
  onRelationshipSelect,
  onPathHighlight
}) => {
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'error'>('connected');
  const [minWeight, setMinWeight] = useState(initialFilters.minCausalWeight || 0.1);
  const [selectedEventForChain, setSelectedEventForChain] = useState<string | null>(null);
  const [highlightedPath, setHighlightedPath] = useState<CausalPath | null>(null);
  
  // Visualization state management
  const {
    selectedEvent,
    setSelectedEvent,
    hoveredEvent,
    setHoveredEvent,
    filters,
    updateFilters
  } = useVisualizationState();

  // Initialize filters
  React.useEffect(() => {
    if (Object.keys(initialFilters).length > 0) {
      updateFilters({ ...initialFilters, minCausalWeight: minWeight });
    }
  }, [initialFilters, minWeight, updateFilters]);

  // Update filters when minWeight changes
  React.useEffect(() => {
    updateFilters({ minCausalWeight: minWeight });
  }, [minWeight, updateFilters]);

  // Fetch causal graph data
  const {
    data: causalGraphData,
    loading,
    error,
    refetch
  } = useCausalGraphData(filters, {
    refreshInterval: realTimeUpdates ? refreshInterval : undefined
  });

  // Fetch causal chain for selected event
  const {
    data: causalChainData,
    loading: chainLoading
  } = useCausalChain(selectedEventForChain, {
    maxDepth: 3,
    direction: 'both'
  });

  // Real-time updates
  const { isConnected, lastUpdate } = useRealTimeUpdates(
    realTimeUpdates ? (event: IEvent) => {
      refetch();
    } : undefined
  );

  // Update connection status
  React.useEffect(() => {
    if (error) {
      setConnectionStatus('error');
    } else if (realTimeUpdates && !isConnected) {
      setConnectionStatus('disconnected');
    } else {
      setConnectionStatus('connected');
    }
  }, [error, realTimeUpdates, isConnected]);

  // Update highlighted path when causal chain data changes
  React.useEffect(() => {
    if (causalChainData?.data) {
      const chainData = causalChainData.data as any;
      if (chainData.events && chainData.relationships) {
        const path: CausalPath = {
          events: chainData.events.map((e: any) => e.id),
          relationships: chainData.relationships.map((r: any) => r.id)
        };
        setHighlightedPath(path);
        onPathHighlight?.(path);
      }
    } else {
      setHighlightedPath(null);
      onPathHighlight?.(null);
    }
  }, [causalChainData, onPathHighlight]);

  // Graph interaction handlers
  const handleNodeClick = useCallback((event: IEvent) => {
    setSelectedEvent(event);
    setSelectedEventForChain(event.id);
    onEventSelect?.(event);
  }, [setSelectedEvent, onEventSelect]);

  const handleNodeHover = useCallback((event: IEvent | null) => {
    setHoveredEvent(event);
  }, [setHoveredEvent]);

  const handleEdgeClick = useCallback((relationship: CausalGraphRelationship) => {
    onRelationshipSelect?.(relationship);
  }, [onRelationshipSelect]);

  const handleEdgeHover = useCallback((relationship: CausalGraphRelationship | null) => {
    // Handle edge hover if needed
  }, []);

  const handleLayoutChange = useCallback(() => {
    // Handle layout changes if needed
  }, []);

  // Render loading state
  if (loading && !causalGraphData) {
    return <LoadingSpinner />;
  }

  // Render error state
  if (error && !causalGraphData) {
    return <ErrorDisplay error={error} onRetry={refetch} />;
  }

  // Render empty state
  if (!causalGraphData || causalGraphData.events.length === 0) {
    return (
      <div className="empty-causal-graph" style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '400px',
        color: '#666',
        fontSize: '16px'
      }}>
        No causal relationships found. Try adjusting your filters.
      </div>
    );
  }

  return (
    <div className={`causal-graph-container ${className}`}>
      {/* Status and controls bar */}
      <div className="causal-graph-controls" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 16px',
        backgroundColor: '#f8f9fa',
        borderBottom: '1px solid #dee2e6',
        fontSize: '14px'
      }}>
        <div className="data-info">
          {causalGraphData.events.length} events, {causalGraphData.relationships.length} relationships
          {loading && <span style={{ marginLeft: '8px', color: '#007bff' }}>Updating...</span>}
          {chainLoading && <span style={{ marginLeft: '8px', color: '#28a745' }}>Loading chain...</span>}
        </div>
        
        <div className="controls" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <WeightFilter value={minWeight} onChange={setMinWeight} />
          
          <div className="connection-status">
            <span style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: connectionStatus === 'connected' ? '#28a745' : 
                             connectionStatus === 'disconnected' ? '#ffc107' : '#dc3545',
              marginRight: '8px'
            }} />
            {connectionStatus === 'connected' ? 'Connected' :
             connectionStatus === 'disconnected' ? 'Disconnected' : 'Error'}
            {lastUpdate && (
              <span style={{ marginLeft: '8px', color: '#666' }}>
                Last update: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Causal graph visualization */}
      <CausalGraphVisualization
        data={causalGraphData}
        interactions={{
          onNodeClick: handleNodeClick,
          onNodeHover: handleNodeHover,
          onEdgeClick: handleEdgeClick,
          onEdgeHover: handleEdgeHover,
          onLayoutChange: handleLayoutChange
        }}
        highlightPath={highlightedPath || undefined}
        minWeight={minWeight}
        className="integrated-causal-graph"
      />

      {/* Selection info panel */}
      {selectedEvent && (
        <div className="selection-panel" style={{
          padding: '16px',
          backgroundColor: '#f8f9fa',
          borderTop: '1px solid #dee2e6'
        }}>
          <div className="selected-event">
            <h4 style={{ margin: '0 0 8px', color: '#495057' }}>Selected Event</h4>
            <p style={{ margin: '0 0 4px' }}><strong>Description:</strong> {selectedEvent.description}</p>
            <p style={{ margin: '0 0 4px' }}><strong>Actor:</strong> {selectedEvent.actor}</p>
            <p style={{ margin: '0 0 4px' }}><strong>Target:</strong> {selectedEvent.target}</p>
            <p style={{ margin: '0 0 12px' }}><strong>Time:</strong> {selectedEvent.timestamp.toLocaleString()}</p>
            
            {highlightedPath && (
              <div className="causal-chain-info">
                <h5 style={{ margin: '0 0 8px', color: '#495057' }}>Causal Chain</h5>
                <p style={{ margin: '0 0 4px', fontSize: '14px', color: '#666' }}>
                  {highlightedPath.events.length} events connected by {highlightedPath.relationships.length} relationships
                </p>
              </div>
            )}
          </div>
          
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button
              onClick={() => {
                setSelectedEvent(null);
                setSelectedEventForChain(null);
                onEventSelect?.(null);
              }}
              style={{
                padding: '6px 12px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Clear Selection
            </button>
            
            {selectedEventForChain && (
              <button
                onClick={() => {
                  setSelectedEventForChain(null);
                  setHighlightedPath(null);
                  onPathHighlight?.(null);
                }}
                style={{
                  padding: '6px 12px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                Clear Chain
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};