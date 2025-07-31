import { IArc } from '../../models/Arc';
import { IEvent } from '../../models/Event';

/**
 * Timeline visualization configuration
 */
export interface TimelineConfig {
  /** Width of the timeline container */
  width: number;
  
  /** Height of the timeline container */
  height: number;
  
  /** Margin around the timeline */
  margin: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  
  /** Height of each arc bar */
  arcHeight: number;
  
  /** Spacing between arc levels */
  levelSpacing: number;
  
  /** Radius of event markers */
  eventRadius: number;
  
  /** Colors for different arc levels */
  arcColors: string[];
  
  /** Color for event markers */
  eventColor: string;
}

/**
 * Timeline data structure
 */
export interface TimelineData {
  /** Arcs to display on the timeline */
  arcs: IArc[];
  
  /** Events to display on the timeline */
  events: IEvent[];
  
  /** Time range for the timeline */
  timeRange: {
    start: Date;
    end: Date;
  };
}

/**
 * Timeline interaction events
 */
export interface TimelineInteractions {
  /** Called when an arc is clicked */
  onArcClick?: (arc: IArc) => void;
  
  /** Called when an event is clicked */
  onEventClick?: (event: IEvent) => void;
  
  /** Called when an arc is hovered */
  onArcHover?: (arc: IArc | null) => void;
  
  /** Called when an event is hovered */
  onEventHover?: (event: IEvent | null) => void;
  
  /** Called when the timeline is zoomed */
  onZoom?: (timeRange: { start: Date; end: Date }) => void;
  
  /** Called when the timeline is panned */
  onPan?: (timeRange: { start: Date; end: Date }) => void;
}

/**
 * Arc rendering data
 */
export interface ArcRenderData extends IArc {
  /** Y position for rendering */
  y: number;
  
  /** X position for start */
  x: number;
  
  /** Width of the arc bar */
  width: number;
  
  /** Color for this arc */
  color: string;
  
  /** Whether this arc is expanded to show children */
  expanded: boolean;
  
  /** Child arcs if expanded */
  children?: ArcRenderData[];
}

/**
 * Event rendering data
 */
export interface EventRenderData extends IEvent {
  /** X position for rendering */
  x: number;
  
  /** Y position for rendering */
  y: number;
  
  /** Color for this event */
  color: string;
  
  /** Whether this event is highlighted */
  highlighted: boolean;
}