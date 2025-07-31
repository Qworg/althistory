import React, { useState, useCallback } from 'react';
import { TimelineContainer } from './TimelineContainer';
import { CausalGraphContainer } from './CausalGraphContainer';
import { useVisualizationState } from '@/hooks/useVisualizationData';
import { IEvent } from '@/models/Event';
import { IArc } from '@/models/Arc';
import { CausalGraphRelationship, CausalPath } from '@/components/causal/types';
import { TimeRange } from '@/hooks/useVisualizationData';

/**
 * View mode options
 */
type ViewMode = 'timeline' | 'causal' | 'split' | 'tabs';

/**
 * Props for VisualizationDashboard
 */
export interface VisualizationDashboardProps {
  /** Initial view mode */
  initialViewMode?: ViewMode;
  
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
}

/**
 * View mode selector component
 */
const ViewModeSelector: React.FC<{
  currentMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}> = ({ currentMode, onChange }) => (
  <div className="view-mode-selector" style={{
    display: 'flex',
    gap: '4px',
    backgroundColor: '#e9ecef',
    padding: '4px',
    borderRadius: '6px'
  }}>
    {[
      { mode: 'timeline' as ViewMode, label: 'Timeline', icon: '📊' },
      { mode: 'causal' as ViewMode, label: 'Causal Graph', icon: '🕸️' },
      { mode: 'split' as ViewMode, label: 'Split View', icon: '⚌' },
      { mode: 'tabs' as ViewMode, label: 'Tabs', icon: '📑' }
    ].map(({ mode, label, icon }) => (
      <button
        key={mode}
        onClick={() => onChange(mode)}
        style={{
          padding: '8px 12px',
          border: 'none',
          borderRadius: '4px',
          backgroundColor: currentMode === mode ? '#007bff' : 'transparent',
          color: currentMode === mode ? 'white' : '#495057',
          cursor: 'pointer',
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          transition: 'all 0.2s'
        }}
      >
        <span>{icon}</span>
        {label}
      </button>
    ))}
  </div>
);

/**
 * Filter panel component
 */
const FilterPanel: React.FC<{
  filters: any;
  onFiltersChange: (filters: any) => void;
  onClearFilters: () => void;
}> = ({ filters, onFiltersChange, onClearFilters }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="filter-panel" style={{
      backgroundColor: '#f8f9fa',
      border: '1px solid #dee2e6',
      borderRadius: '4px',
      marginBottom: '16px'
    }}>
      <div
        className="filter-header"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          padding: '12px 16px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: isExpanded ? '1px solid #dee2e6' : 'none'
        }}
      >
        <span style={{ fontWeight: '500', color: '#495057' }}>Filters</span>
        <span style={{ color: '#6c757d' }}>{isExpanded ? '▲' : '▼'}</span>
      </div>
      
      {isExpanded && (
        <div className="filter-content" style={{ padding: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#495057' }}>
                Actor
              </label>
              <input
                type="text"
                value={filters.actor || ''}
                onChange={(e) => onFiltersChange({ ...filters, actor: e.target.value || undefined })}
                placeholder="Filter by actor..."
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #ced4da',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#495057' }}>
                Target
              </label>
              <input
                type="text"
                value={filters.target || ''}
                onChange={(e) => onFiltersChange({ ...filters, target: e.target.value || undefined })}
                placeholder="Filter by target..."
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #ced4da',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#495057' }}>
                Start Date
              </label>
              <input
                type="datetime-local"
                value={filters.timeRange?.start ? filters.timeRange.start.toISOString().slice(0, 16) : ''}
                onChange={(e) => {
                  const startDate = e.target.value ? new Date(e.target.value) : undefined;
                  onFiltersChange({
                    ...filters,
                    timeRange: startDate ? {
                      start: startDate,
                      end: filters.timeRange?.end || new Date()
                    } : undefined
                  });
                }}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #ced4da',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#495057' }}>
                End Date
              </label>
              <input
                type="datetime-local"
                value={filters.timeRange?.end ? filters.timeRange.end.toISOString().slice(0, 16) : ''}
                onChange={(e) => {
                  const endDate = e.target.value ? new Date(e.target.value) : undefined;
                  onFiltersChange({
                    ...filters,
                    timeRange: endDate ? {
                      start: filters.timeRange?.start || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
                      end: endDate
                    } : undefined
                  });
                }}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #ced4da',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
            </div>
          </div>
          
          <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
            <button
              onClick={onClearFilters}
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
              Clear Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Visualization dashboard with integrated timeline and causal graph
 */
export const VisualizationDashboard: React.FC<VisualizationDashboardProps> = ({
  initialViewMode = 'timeline',
  initialFilters = {},
  realTimeUpdates = false,
  refreshInterval = 30000,
  className = ''
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [activeTab, setActiveTab] = useState<'timeline' | 'causal'>('timeline');
  const [filters, setFilters] = useState(initialFilters);
  const [selectedEvent, setSelectedEvent] = useState<IEvent | null>(null);
  const [selectedArc, setSelectedArc] = useState<IArc | null>(null);
  const [selectedRelationship, setSelectedRelationship] = useState<CausalGraphRelationship | null>(null);
  const [highlightedPath, setHighlightedPath] = useState<CausalPath | null>(null);

  // Handle filter changes
  const handleFiltersChange = useCallback((newFilters: any) => {
    setFilters(newFilters);
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({});
  }, []);

  // Handle cross-visualization interactions
  const handleEventSelect = useCallback((event: IEvent | null) => {
    setSelectedEvent(event);
    // If an event is selected in one view, we could highlight it in the other
  }, []);

  const handleArcSelect = useCallback((arc: IArc | null) => {
    setSelectedArc(arc);
  }, []);

  const handleRelationshipSelect = useCallback((relationship: CausalGraphRelationship | null) => {
    setSelectedRelationship(relationship);
  }, []);

  const handlePathHighlight = useCallback((path: CausalPath | null) => {
    setHighlightedPath(path);
  }, []);

  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    setFilters(prev => ({ ...prev, timeRange: range }));
  }, []);

  // Render timeline view
  const renderTimeline = () => (
    <TimelineContainer
      initialFilters={filters}
      realTimeUpdates={realTimeUpdates}
      refreshInterval={refreshInterval}
      onEventSelect={handleEventSelect}
      onArcSelect={handleArcSelect}
      onTimeRangeChange={handleTimeRangeChange}
      className="dashboard-timeline"
    />
  );

  // Render causal graph view
  const renderCausalGraph = () => (
    <CausalGraphContainer
      initialFilters={filters}
      realTimeUpdates={realTimeUpdates}
      refreshInterval={refreshInterval}
      onEventSelect={handleEventSelect}
      onRelationshipSelect={handleRelationshipSelect}
      onPathHighlight={handlePathHighlight}
      className="dashboard-causal-graph"
    />
  );

  return (
    <div className={`visualization-dashboard ${className}`} style={{ padding: '16px' }}>
      {/* Header */}
      <div className="dashboard-header" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px'
      }}>
        <h2 style={{ margin: 0, color: '#495057' }}>Historical Data Visualization</h2>
        <ViewModeSelector currentMode={viewMode} onChange={setViewMode} />
      </div>

      {/* Filters */}
      <FilterPanel
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onClearFilters={handleClearFilters}
      />

      {/* Main content */}
      <div className="dashboard-content">
        {viewMode === 'timeline' && renderTimeline()}
        
        {viewMode === 'causal' && renderCausalGraph()}
        
        {viewMode === 'split' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', height: '600px' }}>
            <div style={{ border: '1px solid #dee2e6', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{
                padding: '8px 16px',
                backgroundColor: '#f8f9fa',
                borderBottom: '1px solid #dee2e6',
                fontWeight: '500',
                color: '#495057'
              }}>
                Timeline View
              </div>
              {renderTimeline()}
            </div>
            <div style={{ border: '1px solid #dee2e6', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{
                padding: '8px 16px',
                backgroundColor: '#f8f9fa',
                borderBottom: '1px solid #dee2e6',
                fontWeight: '500',
                color: '#495057'
              }}>
                Causal Graph View
              </div>
              {renderCausalGraph()}
            </div>
          </div>
        )}
        
        {viewMode === 'tabs' && (
          <div>
            <div className="tab-headers" style={{
              display: 'flex',
              borderBottom: '1px solid #dee2e6',
              marginBottom: '16px'
            }}>
              <button
                onClick={() => setActiveTab('timeline')}
                style={{
                  padding: '12px 24px',
                  border: 'none',
                  borderBottom: activeTab === 'timeline' ? '2px solid #007bff' : '2px solid transparent',
                  backgroundColor: 'transparent',
                  color: activeTab === 'timeline' ? '#007bff' : '#495057',
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontWeight: activeTab === 'timeline' ? '500' : 'normal'
                }}
              >
                Timeline
              </button>
              <button
                onClick={() => setActiveTab('causal')}
                style={{
                  padding: '12px 24px',
                  border: 'none',
                  borderBottom: activeTab === 'causal' ? '2px solid #007bff' : '2px solid transparent',
                  backgroundColor: 'transparent',
                  color: activeTab === 'causal' ? '#007bff' : '#495057',
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontWeight: activeTab === 'causal' ? '500' : 'normal'
                }}
              >
                Causal Graph
              </button>
            </div>
            
            <div className="tab-content">
              {activeTab === 'timeline' && renderTimeline()}
              {activeTab === 'causal' && renderCausalGraph()}
            </div>
          </div>
        )}
      </div>

      {/* Global selection info */}
      {(selectedEvent || selectedArc || selectedRelationship || highlightedPath) && (
        <div className="global-selection-info" style={{
          position: 'fixed',
          bottom: '16px',
          right: '16px',
          width: '300px',
          backgroundColor: 'white',
          border: '1px solid #dee2e6',
          borderRadius: '4px',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          padding: '16px',
          zIndex: 1000
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px'
          }}>
            <h4 style={{ margin: 0, color: '#495057' }}>Selection Info</h4>
            <button
              onClick={() => {
                setSelectedEvent(null);
                setSelectedArc(null);
                setSelectedRelationship(null);
                setHighlightedPath(null);
              }}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '18px',
                cursor: 'pointer',
                color: '#6c757d'
              }}
            >
              ×
            </button>
          </div>
          
          {selectedEvent && (
            <div style={{ marginBottom: '8px', fontSize: '14px' }}>
              <strong>Event:</strong> {selectedEvent.description}
            </div>
          )}
          
          {selectedArc && (
            <div style={{ marginBottom: '8px', fontSize: '14px' }}>
              <strong>Arc:</strong> {selectedArc.name}
            </div>
          )}
          
          {selectedRelationship && (
            <div style={{ marginBottom: '8px', fontSize: '14px' }}>
              <strong>Relationship:</strong> Weight {(selectedRelationship.weight * 100).toFixed(0)}%
            </div>
          )}
          
          {highlightedPath && (
            <div style={{ fontSize: '14px' }}>
              <strong>Causal Path:</strong> {highlightedPath.events.length} events, {highlightedPath.relationships.length} relationships
            </div>
          )}
        </div>
      )}
    </div>
  );
};