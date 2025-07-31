import { IEvent } from '../../models/Event';
import { CausalRelationship } from '../../models/relationships';

/**
 * Causal graph visualization configuration
 */
export interface CausalGraphConfig {
  /** Width of the graph container */
  width: number;
  
  /** Height of the graph container */
  height: number;
  
  /** Node styling options */
  nodeStyle: {
    /** Default node color */
    color: string;
    
    /** Highlighted node color */
    highlightColor: string;
    
    /** Node size */
    size: number;
    
    /** Font size for labels */
    fontSize: number;
  };
  
  /** Edge styling options */
  edgeStyle: {
    /** Default edge color */
    color: string;
    
    /** Highlighted edge color */
    highlightColor: string;
    
    /** Minimum edge width */
    minWidth: number;
    
    /** Maximum edge width */
    maxWidth: number;
  };
  
  /** Layout options */
  layout: {
    /** Layout algorithm name */
    name: string;
    
    /** Animation duration */
    animationDuration: number;
    
    /** Node spacing */
    nodeSpacing: number;
  };
}

/**
 * Causal graph data structure
 */
export interface CausalGraphData {
  /** Events to display as nodes */
  events: IEvent[];
  
  /** Causal relationships to display as edges */
  relationships: CausalGraphRelationship[];
}

/**
 * Extended causal relationship with source and target event IDs
 */
export interface CausalGraphRelationship extends CausalRelationship {
  /** Source event ID */
  source: string;
  
  /** Target event ID */
  target: string;
  
  /** Unique relationship ID */
  id: string;
}

/**
 * Causal graph interaction events
 */
export interface CausalGraphInteractions {
  /** Called when a node (event) is clicked */
  onNodeClick?: (event: IEvent) => void;
  
  /** Called when an edge (relationship) is clicked */
  onEdgeClick?: (relationship: CausalGraphRelationship) => void;
  
  /** Called when a node is hovered */
  onNodeHover?: (event: IEvent | null) => void;
  
  /** Called when an edge is hovered */
  onEdgeHover?: (relationship: CausalGraphRelationship | null) => void;
  
  /** Called when the layout changes */
  onLayoutChange?: () => void;
}

/**
 * Cytoscape node data
 */
export interface CytoscapeNodeData {
  id: string;
  label: string;
  event: IEvent;
  weight?: number;
}

/**
 * Cytoscape edge data
 */
export interface CytoscapeEdgeData {
  id: string;
  source: string;
  target: string;
  label: string;
  weight: number;
  relationship: CausalGraphRelationship;
}

/**
 * Causal path for highlighting
 */
export interface CausalPath {
  /** Event IDs in the path */
  events: string[];
  
  /** Relationship IDs in the path */
  relationships: string[];
  
  /** Total path strength */
  strength: number;
}