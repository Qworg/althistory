import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { IArc } from '../../models/Arc';
import { IEvent } from '../../models/Event';
import { 
  TimelineConfig, 
  TimelineData, 
  TimelineInteractions, 
  ArcRenderData, 
  EventRenderData 
} from './types';

/**
 * Default timeline configuration
 */
const DEFAULT_CONFIG: TimelineConfig = {
  width: 1200,
  height: 600,
  margin: { top: 20, right: 40, bottom: 60, left: 100 },
  arcHeight: 20,
  levelSpacing: 30,
  eventRadius: 4,
  arcColors: ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'],
  eventColor: '#e74c3c'
};

/**
 * Props for TimelineVisualization component
 */
export interface TimelineVisualizationProps {
  /** Data to display */
  data: TimelineData;
  
  /** Configuration options */
  config?: Partial<TimelineConfig>;
  
  /** Interaction handlers */
  interactions?: TimelineInteractions;
  
  /** CSS class name */
  className?: string;
}

/**
 * Timeline visualization component using D3.js
 */
export const TimelineVisualization: React.FC<TimelineVisualizationProps> = ({
  data,
  config: userConfig = {},
  interactions = {},
  className = ''
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [expandedArcs, setExpandedArcs] = useState<Set<string>>(new Set());
  const [currentZoom, setCurrentZoom] = useState<d3.ZoomTransform | null>(null);
  
  // Merge user config with defaults
  const config: TimelineConfig = { ...DEFAULT_CONFIG, ...userConfig };
  
  // Calculate dimensions
  const innerWidth = config.width - config.margin.left - config.margin.right;
  const innerHeight = config.height - config.margin.top - config.margin.bottom;

  /**
   * Create time scale for the timeline
   */
  const createTimeScale = useCallback(() => {
    // Ensure we have valid time range data
    if (!data.timeRange || !data.timeRange.start || !data.timeRange.end) {
      // Return a default scale if no valid time range
      const now = new Date();
      const oneDay = 24 * 60 * 60 * 1000;
      return d3.scaleTime()
        .domain([new Date(now.getTime() - oneDay), new Date(now.getTime() + oneDay)])
        .range([0, innerWidth]);
    }
    
    return d3.scaleTime()
      .domain([data.timeRange.start, data.timeRange.end])
      .range([0, innerWidth]);
  }, [data.timeRange, innerWidth]);

  /**
   * Process arcs for rendering with hierarchy
   */
  const processArcsForRendering = useCallback((): ArcRenderData[] => {
    // Return empty array if no arcs data
    if (!data.arcs || data.arcs.length === 0) {
      return [];
    }
    
    const timeScale = createTimeScale();
    const sortedArcs = [...data.arcs].sort((a, b) => a.level - b.level || a.start_time.getTime() - b.start_time.getTime());
    
    const renderData: ArcRenderData[] = [];
    const levelCounts: Record<number, number> = {};
    
    sortedArcs.forEach(arc => {
      // Ensure arc has valid dates
      if (!arc.start_time || !arc.end_time) return;
      
      const level = arc.level || 0;
      levelCounts[level] = (levelCounts[level] || 0) + 1;
      
      const y = config.margin.top + level * (config.arcHeight + config.levelSpacing);
      const x = timeScale(arc.start_time);
      const width = timeScale(arc.end_time) - x;
      const color = config.arcColors[level % config.arcColors.length];
      const expanded = expandedArcs.has(arc.id);
      
      renderData.push({
        ...arc,
        y,
        x,
        width,
        color,
        expanded
      });
    });
    
    return renderData;
  }, [data.arcs, createTimeScale, config, expandedArcs]);

  /**
   * Process events for rendering
   */
  const processEventsForRendering = useCallback((): EventRenderData[] => {
    // Return empty array if no events data
    if (!data.events || data.events.length === 0) {
      return [];
    }
    
    const timeScale = createTimeScale();
    const arcRenderData = processArcsForRendering();
    
    return data.events.map(event => {
      // Ensure event has valid timestamp
      if (!event.timestamp) return null;
      
      // Find the arc this event belongs to for Y positioning
      const containingArc = arcRenderData.find(arc => 
        event.timestamp >= arc.start_time && event.timestamp <= arc.end_time
      );
      
      const x = timeScale(event.timestamp);
      const y = containingArc ? containingArc.y + config.arcHeight / 2 : config.margin.top;
      
      return {
        ...event,
        x,
        y,
        color: config.eventColor,
        highlighted: false
      };
    }).filter(Boolean) as EventRenderData[];
  }, [data.events, createTimeScale, processArcsForRendering, config]);

  /**
   * Handle arc click to toggle expansion
   */
  const handleArcClick = useCallback((arc: IArc) => {
    setExpandedArcs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(arc.id)) {
        newSet.delete(arc.id);
      } else {
        newSet.add(arc.id);
      }
      return newSet;
    });
    
    interactions.onArcClick?.(arc);
  }, [interactions]);

  /**
   * Get child arcs for a given parent arc
   */
  const getChildArcs = useCallback((parentArc: IArc): IArc[] => {
    return data.arcs.filter(arc => 
      arc.level === parentArc.level + 1 &&
      arc.start_time >= parentArc.start_time &&
      arc.end_time <= parentArc.end_time
    );
  }, [data.arcs]);

  /**
   * Get events within an arc
   */
  const getEventsInArc = useCallback((arc: IArc): IEvent[] => {
    return data.events.filter(event =>
      event.timestamp >= arc.start_time && event.timestamp <= arc.end_time
    );
  }, [data.events]);

  /**
   * Show event tooltip
   */
  const showEventTooltip = useCallback((event: MouseEvent, eventData: IEvent) => {
    if (!tooltipRef.current) return;

    const tooltip = tooltipRef.current;
    tooltip.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 4px;">${eventData.description}</div>
      <div style="font-size: 12px; color: #666;">
        <div>Actor: ${eventData.actor}</div>
        <div>Target: ${eventData.target}</div>
        <div>Time: ${eventData.timestamp.toLocaleDateString()}</div>
      </div>
    `;
    
    tooltip.style.display = 'block';
    tooltip.style.left = `${event.pageX + 10}px`;
    tooltip.style.top = `${event.pageY - 10}px`;
  }, []);

  /**
   * Hide tooltip
   */
  const hideTooltip = useCallback(() => {
    if (!tooltipRef.current) return;
    tooltipRef.current.style.display = 'none';
  }, []);

  /**
   * Render the timeline
   */
  useEffect(() => {
    if (!svgRef.current || !data || (!data.arcs?.length && !data.events?.length)) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove(); // Clear previous render
    
    const timeScale = createTimeScale();
    const arcRenderData = processArcsForRendering();
    const eventRenderData = processEventsForRendering();

    // Create main group with margins
    const g = svg.append('g')
      .attr('transform', `translate(${config.margin.left},${config.margin.top})`);

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .extent([[0, 0], [config.width, config.height]])
      .on('zoom', (event) => {
        const transform = event.transform;
        setCurrentZoom(transform);
        
        // Update time scale with zoom
        const newTimeScale = transform.rescaleX(timeScale);
        
        // Update arc positions
        g.selectAll('.arc-rect')
          .attr('x', (d: any) => newTimeScale(d.start_time))
          .attr('width', (d: any) => newTimeScale(d.end_time) - newTimeScale(d.start_time));
        
        // Update event positions
        g.selectAll('.event-circle')
          .attr('cx', (d: any) => newTimeScale(d.timestamp));
        
        // Update time axis
        const xAxis = d3.axisBottom(newTimeScale);
        g.select('.x-axis').call(xAxis as any);
        
        // Notify zoom handler
        const domain = newTimeScale.domain();
        interactions.onZoom?.({ start: domain[0], end: domain[1] });
      });

    svg.call(zoom);

    // Create time axis
    const xAxis = d3.axisBottom(timeScale);
    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis);

    // Add axis label
    g.append('text')
      .attr('class', 'axis-label')
      .attr('transform', `translate(${innerWidth / 2},${innerHeight + 40})`)
      .style('text-anchor', 'middle')
      .text('Time');

    // Render arcs
    const arcGroups = g.selectAll('.arc-group')
      .data(arcRenderData)
      .enter()
      .append('g')
      .attr('class', 'arc-group');

    // Arc rectangles
    arcGroups.append('rect')
      .attr('class', 'arc-rect')
      .attr('x', d => d.x)
      .attr('y', d => d.y)
      .attr('width', d => d.width)
      .attr('height', config.arcHeight)
      .attr('fill', d => d.color)
      .attr('stroke', '#333')
      .attr('stroke-width', 1)
      .attr('opacity', 0.7)
      .style('cursor', 'pointer')
      .on('click', (event, d) => handleArcClick(d))
      .on('mouseover', (event, d) => {
        d3.select(event.currentTarget).attr('opacity', 1);
        interactions.onArcHover?.(d);
      })
      .on('mouseout', (event, d) => {
        d3.select(event.currentTarget).attr('opacity', 0.7);
        interactions.onArcHover?.(null);
      });

    // Arc labels
    arcGroups.append('text')
      .attr('class', 'arc-label')
      .attr('x', d => d.x + 5)
      .attr('y', d => d.y + config.arcHeight / 2)
      .attr('dy', '0.35em')
      .style('font-size', '12px')
      .style('fill', '#fff')
      .style('pointer-events', 'none')
      .text(d => d.name);

    // Render events
    const eventGroups = g.selectAll('.event-group')
      .data(eventRenderData)
      .enter()
      .append('g')
      .attr('class', 'event-group');

    // Event circles
    eventGroups.append('circle')
      .attr('class', 'event-circle')
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
      .attr('r', config.eventRadius)
      .attr('fill', d => d.color)
      .attr('stroke', '#333')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('click', (event, d) => interactions.onEventClick?.(d))
      .on('mouseover', (event, d) => {
        const circle = d3.select(event.currentTarget);
        circle.attr('r', config.eventRadius * 1.5);
        
        // Show tooltip
        showEventTooltip(event, d);
        interactions.onEventHover?.(d);
      })
      .on('mouseout', (event, d) => {
        const circle = d3.select(event.currentTarget);
        circle.attr('r', config.eventRadius);
        
        // Hide tooltip
        hideTooltip();
        interactions.onEventHover?.(null);
      });

    // Add expansion indicators for arcs with children
    arcGroups.each(function(d) {
      const childArcs = getChildArcs(d);
      const eventsInArc = getEventsInArc(d);
      
      if (childArcs.length > 0 || eventsInArc.length > 0) {
        const group = d3.select(this);
        
        // Add expansion indicator
        group.append('text')
          .attr('class', 'expansion-indicator')
          .attr('x', d.x + d.width - 15)
          .attr('y', d.y + config.arcHeight / 2)
          .attr('dy', '0.35em')
          .style('font-size', '12px')
          .style('fill', '#fff')
          .style('cursor', 'pointer')
          .style('user-select', 'none')
          .text(expandedArcs.has(d.id) ? '−' : '+')
          .on('click', (event) => {
            event.stopPropagation();
            handleArcClick(d);
          });
      }
    });

    // Show child arcs and events for expanded arcs
    expandedArcs.forEach(arcId => {
      const parentArc = arcRenderData.find(arc => arc.id === arcId);
      if (!parentArc) return;

      const childArcs = getChildArcs(parentArc);
      const eventsInArc = getEventsInArc(parentArc);

      // Render child arcs with slight offset
      childArcs.forEach((childArc, index) => {
        const childRenderData = arcRenderData.find(arc => arc.id === childArc.id);
        if (!childRenderData) return;

        const childGroup = g.append('g')
          .attr('class', 'child-arc-group')
          .style('opacity', 0.8);

        childGroup.append('rect')
          .attr('class', 'child-arc-rect')
          .attr('x', childRenderData.x)
          .attr('y', childRenderData.y + 2)
          .attr('width', childRenderData.width)
          .attr('height', config.arcHeight - 4)
          .attr('fill', childRenderData.color)
          .attr('stroke', '#666')
          .attr('stroke-width', 1)
          .style('cursor', 'pointer')
          .on('click', () => handleArcClick(childArc));

        childGroup.append('text')
          .attr('class', 'child-arc-label')
          .attr('x', childRenderData.x + 3)
          .attr('y', childRenderData.y + config.arcHeight / 2)
          .attr('dy', '0.35em')
          .style('font-size', '10px')
          .style('fill', '#fff')
          .style('pointer-events', 'none')
          .text(childArc.name);
      });

      // Show events in expanded arc
      eventsInArc.forEach(event => {
        const eventRender = eventRenderData.find(e => e.id === event.id);
        if (!eventRender) return;

        g.append('line')
          .attr('class', 'event-connection')
          .attr('x1', eventRender.x)
          .attr('y1', parentArc.y + config.arcHeight)
          .attr('x2', eventRender.x)
          .attr('y2', eventRender.y - config.eventRadius)
          .attr('stroke', '#999')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '2,2')
          .style('opacity', 0.6);
      });
    });

  }, [data, config, expandedArcs, createTimeScale, processArcsForRendering, processEventsForRendering, handleArcClick, interactions, innerHeight, innerWidth]);

  return (
    <div className={`timeline-visualization ${className}`} style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        width={config.width}
        height={config.height}
        style={{ border: '1px solid #ccc' }}
      />
      <div
        ref={tooltipRef}
        style={{
          position: 'absolute',
          background: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '8px',
          borderRadius: '4px',
          fontSize: '14px',
          pointerEvents: 'none',
          display: 'none',
          zIndex: 1000,
          maxWidth: '200px'
        }}
      />
    </div>
  );
};