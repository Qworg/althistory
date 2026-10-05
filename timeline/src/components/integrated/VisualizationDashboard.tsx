import React, { useState } from 'react';
import { TimelineContainer } from './TimelineContainer';
import { CausalGraphContainer } from './CausalGraphContainer';

type ViewMode = 'timeline' | 'causal' | 'split' | 'tabs';

interface VisualizationDashboardProps {
  initialViewMode?: ViewMode;
  realTimeUpdates?: boolean;
  /** Reserved for polling; not wired up yet. */
  refreshInterval?: number;
}

export const VisualizationDashboard: React.FC<VisualizationDashboardProps> = ({
  initialViewMode = 'timeline',
  realTimeUpdates = false
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    actor: '',
    target: ''
  });
  const [activeTab, setActiveTab] = useState<'timeline' | 'causal'>('timeline');

  const clearFilters = () => {
    setFilters({ actor: '', target: '' });
  };

  const renderContent = () => {
    switch (viewMode) {
      case 'timeline':
        return <TimelineContainer initialFilters={filters} />;
      case 'causal':
        return <CausalGraphContainer />;
      case 'split':
        return (
          <div style={{ display: 'flex' }}>
            <div style={{ flex: 1 }}>
              <h3>Timeline View</h3>
              <TimelineContainer initialFilters={filters} />
            </div>
            <div style={{ flex: 1 }}>
              <h3>Causal Graph View</h3>
              <CausalGraphContainer />
            </div>
          </div>
        );
      case 'tabs':
        return (
          <div>
            <div>
              <button 
                onClick={() => setActiveTab('timeline')}
                style={{ fontWeight: activeTab === 'timeline' ? 'bold' : 'normal' }}
              >
                Timeline
              </button>
              <button 
                onClick={() => setActiveTab('causal')}
                style={{ fontWeight: activeTab === 'causal' ? 'bold' : 'normal' }}
              >
                Causal Graph
              </button>
            </div>
            {activeTab === 'timeline' ? (
              <TimelineContainer initialFilters={filters} />
            ) : (
              <CausalGraphContainer />
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div>
      <h1>Historical Data Visualization</h1>
      
      <div>
        <button onClick={() => setViewMode('timeline')}>Timeline</button>
        <button onClick={() => setViewMode('causal')}>Causal Graph</button>
        <button onClick={() => setViewMode('split')}>Split View</button>
        <button onClick={() => setViewMode('tabs')}>Tabs</button>
      </div>

      <div>
        <button onClick={() => setShowFilters(!showFilters)}>Filters</button>
        {showFilters && (
          <div>
            <input
              type="text"
              placeholder="Filter by actor..."
              value={filters.actor}
              onChange={(e) => setFilters({ ...filters, actor: e.target.value })}
            />
            <input
              type="text"
              placeholder="Filter by target..."
              value={filters.target}
              onChange={(e) => setFilters({ ...filters, target: e.target.value })}
            />
            <button onClick={clearFilters}>Clear Filters</button>
          </div>
        )}
      </div>

      {realTimeUpdates && (
        <div>
          <span>Connected</span>
        </div>
      )}

      {renderContent()}
    </div>
  );
};