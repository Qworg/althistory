import React, { useCallback, useState } from 'react';
import { TimelineVisualization } from '@/components/timeline/TimelineVisualization';
import { useTimelineData, useVisualizationState, useRealTimeUpdates } from '@/hooks/useVisualizationData';
import { IEvent } from '@/models/Event';
import { IArc } from '@/models/Arc';
import { TimeRange } from '@/hooks/useVisualizationData';

/**
 * Props for TimelineContainer
 */
export interface TimelineContainerProps {
  /** Initial filters */
  initialFilters?: {
    timeRange?: TimeRange;
    actor?: string;
    target?: string;
  };
  
  /** Enable real-time updates */
  realTimeUpdates?: boolean;
  
  /** Refresh interval in milliseconds */
  refreshInterval?: number;
  
  /** CSS class name */
  className?: string;
  
  /** Event handlers */
  onEventSelect?: (event: IEvent | null) => void;
  onArcSelect?: (arc: IArc | null) => void;
  onTimeRangeChange?: (range: TimeRange) => void;
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
      Loading timeline data...
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
    <h3 style={{ margin: '0 0 16px', color: '#c33' }}>Error Loading Timeline</h3>
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
 * Timeline container with API integration
 */
export const TimelineContainer: React.FC<TimelineContainerProps> = ({
  initialFilters = {},
  realTimeUpdates = false,
  refreshInterval = 30000,
  className = '',
  onEventSelect,
  onArcSelect,
  onTimeRangeChange
}) => {
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'error'>('connected');
  
  // Visualization state management
  const {
    selectedEvent,
    setSelectedEvent,
    selectedArc,
    setSelectedArc,
    hoveredEvent,
    setHoveredEvent,
    hoveredArc,
    setHoveredArc,
    filters,
    updateFilters
  } = useVisualizationState();

  // Initialize filters
  React.useEffect(() => {
    if (Object.keys(initialFilters).length > 0) {
      updateFilters(initialFilters);
    }
  }, [initialFilters, updateFilters]);

  // Fetch timeline data
  const {
    data: timelineData,
    loading,
    error,
    refetch,
    setTimeRange
  } = useTimelineData(filters, {
    refreshInterval: realTimeUpdates ? refreshInterval : undefined
  });

  // Real-time updates
  const { isConnected, lastUpdate } = useRealTimeUpdates(
    realTimeUpdates ? (event: IEvent) => {
      // Handle real-time event updates
      refetch();
    } : undefined,
    realTimeUpdates ? (arc: IArc) => {
      // Handle real-time arc updates
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

  // Timeline interaction handlers
  const handleEventClick = useCallback((event: IEvent) => {
    setSelectedEvent(event);
    onEventSelect?.(event);
  }, [setSelectedEvent, onEventSelect]);

  const handleEventHover = useCallback((event: IEvent | null) => {
    setHoveredEvent(event);
  }, [setHoveredEvent]);

  const handleArcClick = useCallback((arc: IArc) => {
    setSelectedArc(arc);
    onArcSelect?.(arc);
  }, [setSelectedArc, onArcSelect]);

  const handleArcHover = useCallback((arc: IArc | null) => {
    setHoveredArc(arc);
  }, [setHoveredArc]);

  const handleZoom = useCallback((range: TimeRange) => {
    setTimeRange(range);
    onTimeRangeChange?.(range);
  }, [setTimeRange, onTimeRangeChange]);

  // Render loading state
  if (loading && !timelineData) {
    return <LoadingSpinner />;
  }

  // Render error state
  if (error && !timelineData) {
    return <ErrorDisplay error={error} onRetry={refetch} />;
  }

  // Render empty state
  if (!timelineData || (timelineData.events.length === 0 && timelineData.arcs.length === 0)) {
    return (
      <div className="empty-timeline" style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '400px',
        color: '#666',
        fontSize: '16px'
      }}>
        No timeline data available. Try adjusting your filters.
      </div>
    );
  }

  return (
    <div className={`timeline-container ${className}`}>
      {/* Status bar */}
      <div className="timeline-status" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 16px',
        backgroundColor: '#f8f9fa',
        borderBottom: '1px solid #dee2e6',
        fontSize: '14px'
      }}>
        <div className="data-info">
          {timelineData.events.length} events, {timelineData.arcs.length} arcs
          {loading && <span style={{ marginLeft: '8px', color: '#007bff' }}>Updating...</span>}
        </div>
        
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

      {/* Timeline visualization */}
      <TimelineVisualization
        data={timelineData}
        interactions={{
          onEventClick: handleEventClick,
          onEventHover: handleEventHover,
          onArcClick: handleArcClick,
          onArcHover: handleArcHover,
          onZoom: handleZoom
        }}
        className="integrated-timeline"
      />

      {/* Selection info panel */}
      {(selectedEvent || selectedArc) && (
        <div className="selection-panel" style={{
          padding: '16px',
          backgroundColor: '#f8f9fa',
          borderTop: '1px solid #dee2e6'
        }}>
          {selectedEvent && (
            <div className="selected-event">
              <h4 style={{ margin: '0 0 8px', color: '#495057' }}>Selected Event</h4>
              <p style={{ margin: '0 0 4px' }}><strong>Description:</strong> {selectedEvent.description}</p>
              <p style={{ margin: '0 0 4px' }}><strong>Actor:</strong> {selectedEvent.actor}</p>
              <p style={{ margin: '0 0 4px' }}><strong>Target:</strong> {selectedEvent.target}</p>
              <p style={{ margin: '0' }}><strong>Time:</strong> {selectedEvent.timestamp.toLocaleString()}</p>
            </div>
          )}
          
          {selectedArc && (
            <div className="selected-arc" style={{ marginTop: selectedEvent ? '16px' : '0' }}>
              <h4 style={{ margin: '0 0 8px', color: '#495057' }}>Selected Arc</h4>
              <p style={{ margin: '0 0 4px' }}><strong>Name:</strong> {selectedArc.name}</p>
              <p style={{ margin: '0 0 4px' }}><strong>Level:</strong> {selectedArc.level}</p>
              <p style={{ margin: '0 0 4px' }}><strong>Start:</strong> {selectedArc.start_time.toLocaleString()}</p>
              <p style={{ margin: '0' }}><strong>End:</strong> {selectedArc.end_time.toLocaleString()}</p>
            </div>
          )}
          
          <button
            onClick={() => {
              setSelectedEvent(null);
              setSelectedArc(null);
              onEventSelect?.(null);
              onArcSelect?.(null);
            }}
            style={{
              marginTop: '12px',
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
        </div>
      )}
    </div>
  );
};