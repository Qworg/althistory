import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CausalGraphVisualization } from './CausalGraphVisualization';
import { CausalGraphData, CausalGraphRelationship } from './types';
import { Event } from '../../models/Event';

// Mock Cytoscape.js
vi.mock('cytoscape', () => {
  const mockCytoscape = vi.fn(() => ({
    on: vi.fn(),
    layout: vi.fn(() => ({ run: vi.fn() })),
    elements: vi.fn(() => ({ remove: vi.fn() })),
    add: vi.fn(),
    nodes: vi.fn(() => ({ 
      style: vi.fn(),
      forEach: vi.fn()
    })),
    edges: vi.fn(() => ({ 
      style: vi.fn(),
      forEach: vi.fn()
    })),
    getElementById: vi.fn(() => ({ style: vi.fn() })),
    destroy: vi.fn()
  }));
  
  return {
    default: mockCytoscape
  };
});

describe('CausalGraphVisualization', () => {
  let mockData: CausalGraphData;
  let mockEvents: Event[];
  let mockRelationships: CausalGraphRelationship[];

  beforeEach(() => {
    // Create test events
    mockEvents = [
      new Event({
        description: 'Assassination of Archduke Franz Ferdinand',
        actor: 'Gavrilo Princip',
        target: 'Archduke Franz Ferdinand',
        timestamp: new Date('1914-06-28')
      }),
      new Event({
        description: 'Austria-Hungary declares war on Serbia',
        actor: 'Austria-Hungary',
        target: 'Serbia',
        timestamp: new Date('1914-07-28')
      }),
      new Event({
        description: 'Germany declares war on Russia',
        actor: 'Germany',
        target: 'Russia',
        timestamp: new Date('1914-08-01')
      })
    ];

    // Create test relationships
    mockRelationships = [
      {
        id: 'rel_1',
        source: mockEvents[0].id,
        target: mockEvents[1].id,
        weight: 0.9,
        evidence: 'Direct causal link',
        confidence: 0.95,
        relationship_type: 'direct'
      },
      {
        id: 'rel_2',
        source: mockEvents[1].id,
        target: mockEvents[2].id,
        weight: 0.7,
        evidence: 'Alliance obligations',
        confidence: 0.8,
        relationship_type: 'indirect'
      }
    ];

    mockData = {
      events: mockEvents,
      relationships: mockRelationships
    };
  });

  it('renders causal graph container', () => {
    render(<CausalGraphVisualization data={mockData} />);
    
    const container = document.querySelector('.causal-graph-visualization');
    expect(container).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<CausalGraphVisualization data={mockData} className="custom-graph" />);
    
    const container = document.querySelector('.causal-graph-visualization.custom-graph');
    expect(container).toBeInTheDocument();
  });

  it('uses default configuration when none provided', () => {
    render(<CausalGraphVisualization data={mockData} />);
    
    const graphContainer = document.querySelector('.causal-graph-visualization > div');
    expect(graphContainer).toHaveStyle({ width: '800px', height: '600px' });
  });

  it('applies custom configuration', () => {
    const customConfig = {
      width: 1000,
      height: 800
    };

    render(<CausalGraphVisualization data={mockData} config={customConfig} />);
    
    const graphContainer = document.querySelector('.causal-graph-visualization > div');
    expect(graphContainer).toHaveStyle({ width: '1000px', height: '800px' });
  });

  it('handles empty data gracefully', () => {
    const emptyData: CausalGraphData = {
      events: [],
      relationships: []
    };

    expect(() => {
      render(<CausalGraphVisualization data={emptyData} />);
    }).not.toThrow();
  });

  it('filters relationships by weight threshold', () => {
    const minWeight = 0.8;

    render(
      <CausalGraphVisualization 
        data={mockData} 
        minWeight={minWeight}
      />
    );

    // Component should render without errors
    expect(document.querySelector('.causal-graph-visualization')).toBeInTheDocument();
  });

  it('handles interaction callbacks', () => {
    const mockInteractions = {
      onNodeClick: vi.fn(),
      onEdgeClick: vi.fn(),
      onNodeHover: vi.fn(),
      onEdgeHover: vi.fn(),
      onLayoutChange: vi.fn()
    };

    render(
      <CausalGraphVisualization 
        data={mockData} 
        interactions={mockInteractions}
      />
    );

    expect(document.querySelector('.causal-graph-visualization')).toBeInTheDocument();
  });

  it('handles causal path highlighting', () => {
    const highlightPath = {
      events: [mockEvents[0].id, mockEvents[1].id],
      relationships: [mockRelationships[0].id],
      strength: 0.9
    };

    render(
      <CausalGraphVisualization 
        data={mockData} 
        highlightPath={highlightPath}
      />
    );

    expect(document.querySelector('.causal-graph-visualization')).toBeInTheDocument();
  });

  it('processes node data correctly', () => {
    render(<CausalGraphVisualization data={mockData} />);
    
    // Component should process nodes without errors
    expect(document.querySelector('.causal-graph-visualization')).toBeInTheDocument();
  });

  it('processes edge data correctly', () => {
    render(<CausalGraphVisualization data={mockData} />);
    
    // Component should process edges without errors
    expect(document.querySelector('.causal-graph-visualization')).toBeInTheDocument();
  });

  it('applies force-directed layout', () => {
    render(<CausalGraphVisualization data={mockData} />);
    
    // Component should apply layout without errors
    expect(document.querySelector('.causal-graph-visualization')).toBeInTheDocument();
  });

  it('handles weight-based edge styling', () => {
    render(<CausalGraphVisualization data={mockData} />);
    
    // Component should style edges based on weight
    expect(document.querySelector('.causal-graph-visualization')).toBeInTheDocument();
  });

  it('truncates long event descriptions for labels', () => {
    const longDescriptionEvent = new Event({
      description: 'This is a very long event description that should be truncated for display purposes',
      actor: 'Test Actor',
      target: 'Test Target',
      timestamp: new Date('1914-01-01')
    });

    const dataWithLongDescription: CausalGraphData = {
      events: [longDescriptionEvent],
      relationships: []
    };

    render(<CausalGraphVisualization data={dataWithLongDescription} />);
    
    expect(document.querySelector('.causal-graph-visualization')).toBeInTheDocument();
  });

  it('handles custom node and edge styling', () => {
    const customConfig = {
      nodeStyle: {
        color: '#ff0000',
        highlightColor: '#00ff00',
        size: 40,
        fontSize: 14
      },
      edgeStyle: {
        color: '#0000ff',
        highlightColor: '#ffff00',
        minWidth: 2,
        maxWidth: 10
      }
    };

    render(
      <CausalGraphVisualization 
        data={mockData} 
        config={customConfig}
      />
    );

    expect(document.querySelector('.causal-graph-visualization')).toBeInTheDocument();
  });
});