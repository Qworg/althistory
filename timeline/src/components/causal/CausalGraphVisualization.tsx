import React, { useRef, useEffect, useState, useCallback } from 'react';
import cytoscape, { Core, NodeSingular, EdgeSingular } from 'cytoscape';
import { IEvent } from '../../models/Event';
import { 
  CausalGraphConfig, 
  CausalGraphData, 
  CausalGraphInteractions,
  CausalGraphRelationship,
  CytoscapeNodeData,
  CytoscapeEdgeData,
  CausalPath
} from './types';

/**
 * Default causal graph configuration
 */
const DEFAULT_CONFIG: CausalGraphConfig = {
  width: 800,
  height: 600,
  nodeStyle: {
    color: '#3498db',
    highlightColor: '#e74c3c',
    size: 30,
    fontSize: 12
  },
  edgeStyle: {
    color: '#95a5a6',
    highlightColor: '#e67e22',
    minWidth: 1,
    maxWidth: 8
  },
  layout: {
    name: 'cose',
    animationDuration: 1000,
    nodeSpacing: 100
  }
};

/**
 * Props for CausalGraphVisualization component
 */
export interface CausalGraphVisualizationProps {
  /** Data to display */
  data: CausalGraphData;
  
  /** Configuration options */
  config?: Partial<CausalGraphConfig>;
  
  /** Interaction handlers */
  interactions?: CausalGraphInteractions;
  
  /** CSS class name */
  className?: string;
  
  /** Causal path to highlight */
  highlightPath?: CausalPath;
  
  /** Minimum weight threshold for displaying relationships */
  minWeight?: number;
}

/**
 * Causal graph visualization component using Cytoscape.js
 */
export const CausalGraphVisualization: React.FC<CausalGraphVisualizationProps> = ({
  data,
  config: userConfig = {},
  interactions = {},
  className = '',
  highlightPath,
  minWeight = 0.1
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Merge user config with defaults
  const config: CausalGraphConfig = { ...DEFAULT_CONFIG, ...userConfig };

  /**
   * Filter relationships by weight threshold
   */
  const filterRelationshipsByWeight = useCallback((relationships: CausalGraphRelationship[]): CausalGraphRelationship[] => {
    return relationships.filter(rel => rel.weight >= minWeight);
  }, [minWeight]);

  /**
   * Convert data to Cytoscape format
   */
  const convertToCytoscapeData = useCallback(() => {
    const filteredRelationships = filterRelationshipsByWeight(data.relationships);
    
    // Create nodes from events
    const nodes = data.events.map(event => ({
      data: {
        id: event.id,
        label: event.description.length > 30 
          ? event.description.substring(0, 30) + '...' 
          : event.description,
        event,
        weight: filteredRelationships.filter(rel => 
          rel.source === event.id || rel.target === event.id
        ).length
      } as CytoscapeNodeData
    }));

    // Create edges from relationships
    const edges = filteredRelationships.map(relationship => ({
      data: {
        id: relationship.id,
        source: relationship.source,
        target: relationship.target,
        label: `${(relationship.weight * 100).toFixed(0)}%`,
        weight: relationship.weight,
        relationship
      } as CytoscapeEdgeData
    }));

    return { nodes, edges };
  }, [data, filterRelationshipsByWeight]);

  /**
   * Apply force-directed layout
   */
  const applyForceLayout = useCallback(() => {
    if (!cyRef.current) return;

    // Cytoscape's layout options are a discriminated union keyed on a literal
    // `name`, while `CausalGraphConfig.layout.name` is only typed as `string`.
    // Annotating the object (instead of inlining it) states the options once and
    // keeps the excess-property check from rejecting the cose-specific keys.
    const coseLayoutOptions: Omit<cytoscape.CoseLayoutOptions, 'name'> & { name: string } = {
      name: config.layout.name,
      animate: true,
      animationDuration: config.layout.animationDuration,
      nodeRepulsion: 400000,
      nodeOverlap: config.layout.nodeSpacing,
      idealEdgeLength: 100,
      edgeElasticity: 100,
      nestingFactor: 5,
      gravity: 80,
      numIter: 1000,
      initialTemp: 200,
      coolingFactor: 0.95,
      minTemp: 1.0
    };

    const layout = cyRef.current.layout(coseLayoutOptions);

    layout.run();
  }, [config.layout]);

  /**
   * Highlight causal path
   */
  const highlightCausalPath = useCallback((path: CausalPath) => {
    if (!cyRef.current) return;

    // Reset all styles
    cyRef.current.nodes().style({
      'background-color': config.nodeStyle.color,
      'border-width': 2,
      'border-color': '#34495e'
    });

    cyRef.current.edges().style({
      'line-color': config.edgeStyle.color,
      'target-arrow-color': config.edgeStyle.color,
      'width': (ele: EdgeSingular) => Math.max(
        config.edgeStyle.minWidth,
        Number(ele.data('weight')) * config.edgeStyle.maxWidth
      )
    });

    // Highlight path nodes
    path.events.forEach(eventId => {
      cyRef.current?.getElementById(eventId).style({
        'background-color': config.nodeStyle.highlightColor,
        'border-width': 4,
        'border-color': '#c0392b'
      });
    });

    // Highlight path edges
    path.relationships.forEach(relId => {
      cyRef.current?.getElementById(relId).style({
        'line-color': config.edgeStyle.highlightColor,
        'target-arrow-color': config.edgeStyle.highlightColor,
        'width': config.edgeStyle.maxWidth
      });
    });
  }, [config]);

  /**
   * Initialize Cytoscape instance
   */
  const initializeCytoscape = useCallback(() => {
    if (!containerRef.current || cyRef.current) return;

    const cytoscapeData = convertToCytoscapeData();

    cyRef.current = cytoscape({
      container: containerRef.current,
      elements: [...cytoscapeData.nodes, ...cytoscapeData.edges],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': config.nodeStyle.color,
            'label': 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': `${config.nodeStyle.fontSize}px`,
            'font-weight': 'bold',
            'color': '#2c3e50',
            'text-outline-width': 2,
            'text-outline-color': '#ffffff',
            'width': config.nodeStyle.size,
            'height': config.nodeStyle.size,
            'border-width': 2,
            'border-color': '#34495e'
          }
        },
        {
          selector: 'edge',
          style: {
            'width': (ele: EdgeSingular) => Math.max(
              config.edgeStyle.minWidth,
              Number(ele.data('weight')) * config.edgeStyle.maxWidth
            ),
            'line-color': config.edgeStyle.color,
            'target-arrow-color': config.edgeStyle.color,
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'label': 'data(label)',
            'font-size': '10px',
            'text-rotation': 'autorotate',
            'text-margin-y': -10
          }
        },
        {
          selector: 'node:selected',
          style: {
            'background-color': config.nodeStyle.highlightColor,
            'border-width': 4,
            'border-color': '#c0392b'
          }
        },
        {
          selector: 'edge:selected',
          style: {
            'line-color': config.edgeStyle.highlightColor,
            'target-arrow-color': config.edgeStyle.highlightColor,
            'width': config.edgeStyle.maxWidth
          }
        }
      ],
      layout: {
        name: 'grid',
        rows: 1
      }
    });

    // Add event listeners
    cyRef.current.on('tap', 'node', (event) => {
      const node = event.target as NodeSingular;
      const eventData = node.data('event') as IEvent;
      interactions.onNodeClick?.(eventData);
    });

    cyRef.current.on('tap', 'edge', (event) => {
      const edge = event.target as EdgeSingular;
      const relationship = edge.data('relationship') as CausalGraphRelationship;
      interactions.onEdgeClick?.(relationship);
    });

    cyRef.current.on('mouseover', 'node', (event) => {
      const node = event.target as NodeSingular;
      const eventData = node.data('event') as IEvent;
      interactions.onNodeHover?.(eventData);
    });

    cyRef.current.on('mouseout', 'node', () => {
      interactions.onNodeHover?.(null);
    });

    cyRef.current.on('mouseover', 'edge', (event) => {
      const edge = event.target as EdgeSingular;
      const relationship = edge.data('relationship') as CausalGraphRelationship;
      interactions.onEdgeHover?.(relationship);
    });

    cyRef.current.on('mouseout', 'edge', () => {
      interactions.onEdgeHover?.(null);
    });

    cyRef.current.on('layoutstop', () => {
      interactions.onLayoutChange?.();
    });

    setIsInitialized(true);
  }, [convertToCytoscapeData, config, interactions]);

  /**
   * Update graph data
   */
  const updateGraphData = useCallback(() => {
    if (!cyRef.current) return;

    const cytoscapeData = convertToCytoscapeData();
    
    // Remove all elements and add new ones
    cyRef.current.elements().remove();
    cyRef.current.add([...cytoscapeData.nodes, ...cytoscapeData.edges]);
    
    // Apply layout
    applyForceLayout();
  }, [convertToCytoscapeData, applyForceLayout]);

  /**
   * Filter by weight threshold
   */
  const filterByWeight = useCallback((threshold: number) => {
    if (!cyRef.current) return;

    cyRef.current.edges().forEach(edge => {
      const weight = edge.data('weight') as number;
      if (weight < threshold) {
        edge.style('display', 'none');
      } else {
        edge.style('display', 'element');
      }
    });
  }, []);

  // Initialize Cytoscape on mount
  useEffect(() => {
    initializeCytoscape();
    
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
        setIsInitialized(false);
      }
    };
  }, [initializeCytoscape]);

  // Update data when it changes
  useEffect(() => {
    if (isInitialized) {
      updateGraphData();
    }
  }, [data, isInitialized, updateGraphData]);

  // Apply force layout when initialized
  useEffect(() => {
    if (isInitialized) {
      applyForceLayout();
    }
  }, [isInitialized, applyForceLayout]);

  // Highlight path when it changes
  useEffect(() => {
    if (isInitialized && highlightPath) {
      highlightCausalPath(highlightPath);
    }
  }, [highlightPath, isInitialized, highlightCausalPath]);

  // Filter by weight when threshold changes
  useEffect(() => {
    if (isInitialized) {
      filterByWeight(minWeight);
    }
  }, [minWeight, isInitialized, filterByWeight]);

  return (
    <div className={`causal-graph-visualization ${className}`}>
      <div
        ref={containerRef}
        style={{
          width: config.width,
          height: config.height,
          border: '1px solid #bdc3c7',
          borderRadius: '4px'
        }}
      />
    </div>
  );
};