import React, { useRef, useEffect, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { Event, Arc, TimeRange } from '@/types'
import { PressureWithContext } from '@/types/pressure'
import { 
  ArcWithUIState, 
  calculateArcHierarchy, 
  processArcsWithUIState, 
  formatDuration 
} from './arcHierarchyUtils'
import ArcCreationModal from './ArcCreationModal'
import EventArcAssignment from './EventArcAssignment'
import PressureIndicators from './PressureIndicators'

export interface TimelineProps {
  events: Event[]
  arcs: Arc[]
  pressures?: PressureWithContext[]
  width?: number
  height?: number
  margin?: { top: number; right: number; bottom: number; left: number }
  onEventSelect?: (event: Event) => void
  onArcSelect?: (arc: Arc) => void
  onPressureSelect?: (pressure: PressureWithContext) => void
  onPressureHover?: (pressure: PressureWithContext | null) => void
  onTimeRangeChange?: (range: TimeRange) => void
  onEventCreate?: (timestamp: Date) => void
  onEventDrag?: (event: Event, newTimestamp: Date) => void
  onArcExpand?: (arc: Arc) => void
  onArcCollapse?: (arc: Arc) => void
  onArcCreate?: (timeRange: TimeRange) => void
  onArcResize?: (arc: Arc, newBounds: { start: Date; end: Date }) => void
  onEventAssignToArc?: (event: Event, arc: Arc) => void
  showPressureIndicators?: boolean
  className?: string
}

export interface TimelineState {
  zoomLevel: number
  visibleTimeRange: TimeRange
  selectedElements: Set<string>
  expandedArcs: Set<string>
  dragState: {
    isDragging: boolean
    draggedEvent: Event | null
    draggedArc: Arc | null
    dragType: 'event' | 'arc-resize-start' | 'arc-resize-end' | null
    startPosition: { x: number; y: number } | null
  }
  selectionState: {
    isSelecting: boolean
    selectionStart: { x: number; y: number } | null
    selectionEnd: { x: number; y: number } | null
    selectionTimeRange: TimeRange | null
  }
  arcCreationModal: {
    isOpen: boolean
    timeRange: TimeRange | null
    containedEvents: Event[]
  }
  eventAssignmentModal: {
    isOpen: boolean
    event: Event | null
    position: { x: number; y: number } | null
  }
}

export const Timeline: React.FC<TimelineProps> = ({
  events = [],
  arcs = [],
  pressures = [],
  width = 800,
  height = 400,
  margin = { top: 20, right: 20, bottom: 40, left: 60 },
  onEventSelect,
  onArcSelect,
  onPressureSelect,
  onPressureHover,
  onTimeRangeChange,
  onEventCreate,
  onEventDrag,
  onArcExpand,
  onArcCollapse,
  onArcCreate,
  onArcResize,
  onEventAssignToArc,
  showPressureIndicators = true,
  className = ''
}) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<TimelineState>({
    zoomLevel: 1,
    visibleTimeRange: {
      start: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 1 year ago
      end: new Date()
    },
    selectedElements: new Set(),
    expandedArcs: new Set(),
    dragState: {
      isDragging: false,
      draggedEvent: null,
      draggedArc: null,
      dragType: null,
      startPosition: null
    },
    selectionState: {
      isSelecting: false,
      selectionStart: null,
      selectionEnd: null,
      selectionTimeRange: null
    },
    arcCreationModal: {
      isOpen: false,
      timeRange: null,
      containedEvents: []
    },
    eventAssignmentModal: {
      isOpen: false,
      event: null,
      position: null
    }
  })

  // Calculate dimensions
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom

  // Arc resize validation function
  const validateArcResize = useCallback((arc: Arc, newBounds: { start: Date; end: Date }): { isValid: boolean; error?: string } => {
    const { start: newStart, end: newEnd } = newBounds
    
    // Basic time validation
    if (newStart >= newEnd) {
      return { isValid: false, error: 'End time must be after start time' }
    }
    
    // Check contained events
    const containedEvents = events.filter(event => {
      // Find events that are currently in this arc (this would need arc-event relationship data)
      // For now, we'll check if events fall within the current arc bounds
      const eventTime = new Date(event.timestamp).getTime()
      const currentStart = new Date(arc.start_time).getTime()
      const currentEnd = new Date(arc.end_time).getTime()
      return eventTime >= currentStart && eventTime <= currentEnd
    })
    
    const eventsOutsideNewRange = containedEvents.filter(event => {
      const eventTime = new Date(event.timestamp).getTime()
      return eventTime < newStart.getTime() || eventTime > newEnd.getTime()
    })
    
    if (eventsOutsideNewRange.length > 0) {
      return { 
        isValid: false, 
        error: `${eventsOutsideNewRange.length} contained event${eventsOutsideNewRange.length !== 1 ? 's' : ''} would be outside the new time range` 
      }
    }
    
    // Check child arcs
    const childArcs = arcs.filter(childArc => childArc.parent_arc_id === arc.id)
    const childArcsOutsideRange = childArcs.filter(child => {
      const childStart = new Date(child.start_time).getTime()
      const childEnd = new Date(child.end_time).getTime()
      return childStart < newStart.getTime() || childEnd > newEnd.getTime()
    })
    
    if (childArcsOutsideRange.length > 0) {
      return { 
        isValid: false, 
        error: `${childArcsOutsideRange.length} child arc${childArcsOutsideRange.length !== 1 ? 's' : ''} would be outside the new time range` 
      }
    }
    
    // Check parent arc constraints
    if (arc.parent_arc_id) {
      const parentArc = arcs.find(parent => parent.id === arc.parent_arc_id)
      if (parentArc) {
        const parentStart = new Date(parentArc.start_time).getTime()
        const parentEnd = new Date(parentArc.end_time).getTime()
        
        if (newStart.getTime() < parentStart || newEnd.getTime() > parentEnd) {
          return { 
            isValid: false, 
            error: 'Arc must remain within parent arc time range' 
          }
        }
      }
    }
    
    return { isValid: true }
  }, [events, arcs])

  // Create scales
  const timeScale = useCallback(() => {
    return d3.scaleTime()
      .domain([state.visibleTimeRange.start, state.visibleTimeRange.end])
      .range([0, innerWidth])
  }, [state.visibleTimeRange, innerWidth])

  const yScale = useCallback(() => {
    return d3.scaleLinear()
      .domain([0, 10]) // Will be adjusted based on arc levels
      .range([innerHeight, 0])
  }, [innerHeight])

  // Initialize timeline
  useEffect(() => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove() // Clear previous render

    // Create main group with margins
    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    // Create time axis
    const xAxis = d3.axisBottom(timeScale())
      .tickFormat(d3.timeFormat('%Y-%m-%d') as (date: Date | { valueOf(): number }) => string)
      .ticks(d3.timeWeek.every(1))

    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .style('text-anchor', 'end')
      .attr('dx', '-.8em')
      .attr('dy', '.15em')
      .attr('transform', 'rotate(-45)')

    // Create y-axis (for arc levels)
    const yAxis = d3.axisLeft(yScale())
      .tickFormat(d => `Level ${d}`)

    g.append('g')
      .attr('class', 'y-axis')
      .call(yAxis)

    // Add grid lines
    g.append('g')
      .attr('class', 'grid')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(timeScale())
        .tickSize(-innerHeight)
        .tickFormat(() => '')
      )
      .style('stroke-dasharray', '3,3')
      .style('opacity', 0.3)

  }, [timeScale, yScale, innerWidth, innerHeight, margin])

  // Process arcs with hierarchy and UI state
  const processedArcs = useCallback((): ArcWithUIState[] => {
    return processArcsWithUIState(arcs, events, state.expandedArcs, state.selectedElements)
  }, [arcs, events, state.expandedArcs, state.selectedElements])

  // Render arcs with hierarchical structure
  useEffect(() => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)
    const g = svg.select('g')
    
    // Remove existing arcs
    g.selectAll('.arc-group').remove()

    const arcsWithState = processedArcs()
    
    // Calculate hierarchical levels and positions
    const { arcHierarchy, maxLevel } = calculateArcHierarchy(arcsWithState)
    
    // Update y-scale to accommodate all levels
    const yScaleUpdated = d3.scaleLinear()
      .domain([0, maxLevel + 2])
      .range([innerHeight - 60, 20]) // Leave space for events at bottom

    // Create arc groups
    const arcGroups = g.selectAll('.arc-group')
      .data(arcHierarchy)
      .enter()
      .append('g')
      .attr('class', 'arc-group')
      .attr('data-arc-id', d => d.id)

    // Draw arc backgrounds (for containment visualization)
    arcGroups.append('rect')
      .attr('class', 'arc-background')
      .attr('x', d => timeScale()(new Date(d.start_time)) - 2)
      .attr('y', d => yScaleUpdated(d.renderLevel) - 15)
      .attr('width', d => {
        const startX = timeScale()(new Date(d.start_time))
        const endX = timeScale()(new Date(d.end_time))
        return Math.max(0, endX - startX) + 4
      })
      .attr('height', 30)
      .attr('fill', d => d.renderLevel === 0 ? 'rgba(59, 130, 246, 0.1)' : 'rgba(156, 163, 175, 0.05)')
      .attr('stroke', 'none')
      .attr('rx', 6)

    // Draw main arc rectangles
    arcGroups.append('rect')
      .attr('class', 'arc-main')
      .attr('x', d => timeScale()(new Date(d.start_time)))
      .attr('y', d => yScaleUpdated(d.renderLevel) - 10)
      .attr('width', d => {
        const startX = timeScale()(new Date(d.start_time))
        const endX = timeScale()(new Date(d.end_time))
        return Math.max(0, endX - startX)
      })
      .attr('height', 20)
      .attr('fill', d => {
        if (d.isSelected) return '#3b82f6'
        if (d.renderLevel === 0) return '#e5e7eb'
        return `hsl(${220 + d.renderLevel * 20}, 50%, ${85 - d.renderLevel * 5}%)`
      })
      .attr('stroke', d => d.renderLevel === 0 ? '#6b7280' : '#9ca3af')
      .attr('stroke-width', d => d.renderLevel === 0 ? 2 : 1)
      .attr('rx', 4)
      .style('cursor', 'pointer')
      .on('click', (_, _) => {
        event.stopPropagation()
        
        // Toggle expansion if arc has children
        if (d.childArcs.length > 0) {
          setState(prev => {
            const newExpanded = new Set(prev.expandedArcs)
            if (newExpanded.has(d.id)) {
              newExpanded.delete(d.id)
              onArcCollapse?.(d)
            } else {
              newExpanded.add(d.id)
              onArcExpand?.(d)
            }
            return {
              ...prev,
              expandedArcs: newExpanded,
              selectedElements: new Set([d.id])
            }
          })
        } else {
          setState(prev => ({
            ...prev,
            selectedElements: new Set([d.id])
          }))
        }
        
        onArcSelect?.(d)
      })
      .on('mouseover', function(event, d) {
        // Highlight arc and show enhanced tooltip
        d3.select(this)
          .attr('fill', d.isSelected ? '#2563eb' : '#93c5fd')
          .attr('stroke-width', 3)
        
        // Highlight contained events if expanded
        if (d.isExpanded && d.containedEvents.length > 0) {
          g.selectAll('.event circle')
            .filter((eventData: any) => d.containedEvents.some(e => e.id === eventData.id))
            .attr('stroke', '#3b82f6')
            .attr('stroke-width', 3)
        }
        
        // Show enhanced tooltip with hierarchy info
        const tooltip = d3.select('body').append('div')
          .attr('class', 'timeline-tooltip')
          .style('position', 'absolute')
          .style('background', 'rgba(0, 0, 0, 0.9)')
          .style('color', 'white')
          .style('padding', '12px')
          .style('border-radius', '6px')
          .style('font-size', '12px')
          .style('pointer-events', 'none')
          .style('z-index', '1000')
          .style('max-width', '300px')
          .html(`
            <div style="font-weight: bold; margin-bottom: 4px;">${d.name}</div>
            <div style="margin-bottom: 8px;">${d.description}</div>
            <div style="font-size: 11px; color: #d1d5db;">
              <div>Duration: ${formatDuration(new Date(d.start_time), new Date(d.end_time))}</div>
              <div>Events: ${d.eventCount}</div>
              <div>Level: ${d.renderLevel}</div>
              ${d.childArcs.length > 0 ? `<div>Child arcs: ${d.childArcs.length}</div>` : ''}
              ${d.parentArc ? `<div>Parent: ${d.parentArc.name}</div>` : ''}
              ${d.childArcs.length > 0 ? `<div style="margin-top: 4px; font-style: italic;">Click to ${d.isExpanded ? 'collapse' : 'expand'}</div>` : ''}
            </div>
          `)
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY - 10) + 'px')
      })
      .on('mouseout', function(event, d) {
        // Remove highlight
        d3.select(this)
          .attr('fill', d => {
            if (d.isSelected) return '#3b82f6'
            if (d.renderLevel === 0) return '#e5e7eb'
            return `hsl(${220 + d.renderLevel * 20}, 50%, ${85 - d.renderLevel * 5}%)`
          })
          .attr('stroke-width', d => d.renderLevel === 0 ? 2 : 1)
        
        // Remove event highlights
        g.selectAll('.event circle')
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 2)
        
        d3.selectAll('.timeline-tooltip').remove()
      })

    // Add expansion indicators for arcs with children
    arcGroups.filter(d => d.childArcs.length > 0)
      .append('circle')
      .attr('class', 'expansion-indicator')
      .attr('cx', d => timeScale()(new Date(d.start_time)) - 8)
      .attr('cy', d => yScaleUpdated(d.renderLevel))
      .attr('r', 6)
      .attr('fill', '#ffffff')
      .attr('stroke', '#6b7280')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('click', (_, _) => {
        event.stopPropagation()
        setState(prev => {
          const newExpanded = new Set(prev.expandedArcs)
          if (newExpanded.has(d.id)) {
            newExpanded.delete(d.id)
            onArcCollapse?.(d)
          } else {
            newExpanded.add(d.id)
            onArcExpand?.(d)
          }
          return { ...prev, expandedArcs: newExpanded }
        })
      })

    // Add expansion indicator symbols
    arcGroups.filter(d => d.childArcs.length > 0)
      .append('text')
      .attr('class', 'expansion-symbol')
      .attr('x', d => timeScale()(new Date(d.start_time)) - 8)
      .attr('y', d => yScaleUpdated(d.renderLevel))
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .style('font-size', '10px')
      .style('font-weight', 'bold')
      .style('fill', '#6b7280')
      .style('pointer-events', 'none')
      .text(d => d.isExpanded ? '−' : '+')

    // Add arc labels with level-appropriate styling
    arcGroups.append('text')
      .attr('class', 'arc-label')
      .attr('x', d => {
        const startX = timeScale()(new Date(d.start_time))
        const endX = timeScale()(new Date(d.end_time))
        return startX + (endX - startX) / 2
      })
      .attr('y', d => yScaleUpdated(d.renderLevel))
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .style('font-size', d => `${Math.max(10, 14 - d.renderLevel)}px`)
      .style('font-weight', d => d.renderLevel === 0 ? 'bold' : 'normal')
      .style('fill', d => d.renderLevel === 0 ? '#374151' : '#6b7280')
      .style('pointer-events', 'none')
      .text(d => {
        const maxLength = Math.max(10, 25 - d.renderLevel * 3)
        return d.name.length > maxLength ? d.name.substring(0, maxLength - 3) + '...' : d.name
      })

    // Add containment lines for parent-child relationships
    arcGroups.filter(d => d.parentArc && state.expandedArcs.has(d.parentArc.id))
      .append('line')
      .attr('class', 'containment-line')
      .attr('x1', d => timeScale()(new Date(d.start_time)) - 15)
      .attr('y1', d => {
        const parentLevel = arcHierarchy.find(a => a.id === d.parentArc?.id)?.renderLevel || 0
        return yScaleUpdated(parentLevel)
      })
      .attr('x2', d => timeScale()(new Date(d.start_time)) - 15)
      .attr('y2', d => yScaleUpdated(d.renderLevel))
      .attr('stroke', '#9ca3af')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2,2')

    // Add resize handles for selected arcs
    arcGroups.filter(d => d.isSelected)
      .each(function(d) {
        const group = d3.select(this)
        const startX = timeScale()(new Date(d.start_time))
        const endX = timeScale()(new Date(d.end_time))
        const y = yScaleUpdated(d.renderLevel)

        // Start resize handle
        group.append('rect')
          .attr('class', 'resize-handle resize-handle-start')
          .attr('x', startX - 4)
          .attr('y', y - 12)
          .attr('width', 8)
          .attr('height', 24)
          .attr('fill', '#3b82f6')
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 1)
          .attr('rx', 2)
          .style('cursor', 'ew-resize')
          .call(d3.drag<SVGRectElement, ArcWithUIState>()
            .on('start', (event, arc) => {
              setState(prev => ({
                ...prev,
                dragState: {
                  isDragging: true,
                  draggedEvent: null,
                  draggedArc: arc,
                  dragType: 'arc-resize-start',
                  startPosition: { x: event.x, y: event.y }
                }
              }))
            })
            .on('drag', (event, arc) => {
              const newStartTime = timeScale().invert(event.x)
              // Update visual feedback
              group.select('.arc-main')
                .attr('x', event.x)
                .attr('width', Math.max(0, endX - event.x))
            })
            .on('end', (event, arc) => {
              const newStartTime = timeScale().invert(event.x)
              const newEndTime = new Date(arc.end_time)
              
              setState(prev => ({
                ...prev,
                dragState: {
                  isDragging: false,
                  draggedEvent: null,
                  draggedArc: null,
                  dragType: null,
                  startPosition: null
                }
              }))
              
              // Enhanced validation for arc resize
              const validationResult = validateArcResize(arc, { start: newStartTime, end: newEndTime })
              
              if (validationResult.isValid) {
                onArcResize?.(arc, { start: newStartTime, end: newEndTime })
              } else {
                // Show validation error
                const errorTooltip = d3.select('body').append('div')
                  .attr('class', 'timeline-error-tooltip')
                  .style('position', 'absolute')
                  .style('background', 'rgba(239, 68, 68, 0.9)')
                  .style('color', 'white')
                  .style('padding', '8px 12px')
                  .style('border-radius', '4px')
                  .style('font-size', '12px')
                  .style('pointer-events', 'none')
                  .style('z-index', '1001')
                  .html(`<strong>Invalid Resize:</strong><br/>${validationResult.error}`)
                  .style('left', (event.sourceEvent.pageX + 10) + 'px')
                  .style('top', (event.sourceEvent.pageY - 10) + 'px')
                
                setTimeout(() => {
                  errorTooltip.remove()
                }, 3000)
                
                // Reset visual state
                group.select('.arc-main')
                  .attr('x', timeScale()(new Date(arc.start_time)))
                  .attr('width', timeScale()(new Date(arc.end_time)) - timeScale()(new Date(arc.start_time)))
              }
            })
          )

        // End resize handle
        group.append('rect')
          .attr('class', 'resize-handle resize-handle-end')
          .attr('x', endX - 4)
          .attr('y', y - 12)
          .attr('width', 8)
          .attr('height', 24)
          .attr('fill', '#3b82f6')
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 1)
          .attr('rx', 2)
          .style('cursor', 'ew-resize')
          .call(d3.drag<SVGRectElement, ArcWithUIState>()
            .on('start', (event, arc) => {
              setState(prev => ({
                ...prev,
                dragState: {
                  isDragging: true,
                  draggedEvent: null,
                  draggedArc: arc,
                  dragType: 'arc-resize-end',
                  startPosition: { x: event.x, y: event.y }
                }
              }))
            })
            .on('drag', (event, arc) => {
              const newEndTime = timeScale().invert(event.x)
              // Update visual feedback
              group.select('.arc-main')
                .attr('width', Math.max(0, event.x - startX))
            })
            .on('end', (event, arc) => {
              const newStartTime = new Date(arc.start_time)
              const newEndTime = timeScale().invert(event.x)
              
              setState(prev => ({
                ...prev,
                dragState: {
                  isDragging: false,
                  draggedEvent: null,
                  draggedArc: null,
                  dragType: null,
                  startPosition: null
                }
              }))
              
              // Enhanced validation for arc resize
              const validationResult = validateArcResize(arc, { start: newStartTime, end: newEndTime })
              
              if (validationResult.isValid) {
                onArcResize?.(arc, { start: newStartTime, end: newEndTime })
              } else {
                // Show validation error
                const errorTooltip = d3.select('body').append('div')
                  .attr('class', 'timeline-error-tooltip')
                  .style('position', 'absolute')
                  .style('background', 'rgba(239, 68, 68, 0.9)')
                  .style('color', 'white')
                  .style('padding', '8px 12px')
                  .style('border-radius', '4px')
                  .style('font-size', '12px')
                  .style('pointer-events', 'none')
                  .style('z-index', '1001')
                  .html(`<strong>Invalid Resize:</strong><br/>${validationResult.error}`)
                  .style('left', (event.sourceEvent.pageX + 10) + 'px')
                  .style('top', (event.sourceEvent.pageY - 10) + 'px')
                
                setTimeout(() => {
                  errorTooltip.remove()
                }, 3000)
                
                // Reset visual state
                group.select('.arc-main')
                  .attr('width', timeScale()(new Date(arc.end_time)) - timeScale()(new Date(arc.start_time)))
              }
            })
          )
      })

  }, [arcs, events, timeScale, innerHeight, state.selectedElements, state.expandedArcs, processedArcs, onArcSelect, onArcExpand, onArcCollapse, onArcResize])

  // Add double-click handler for creating new events
  useEffect(() => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)
    const g = svg.select('g')
    
    // Add invisible overlay for double-click detection
    let clickTimeout: number | null = null
    
    g.selectAll('.timeline-background').remove()
    g.insert('rect', ':first-child')
      .attr('class', 'timeline-background')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('click', function(event) {
        // Handle single click vs double click
        if (clickTimeout) {
          clearTimeout(clickTimeout)
          clickTimeout = null
          
          // Double-click detected - create new event
          const [mouseX] = d3.pointer(event, this)
          const timestamp = timeScale().invert(mouseX)
          
          // Validate timestamp is within reasonable bounds
          const now = new Date()
          const minDate = new Date('1000-01-01')
          const maxDate = new Date(now.getFullYear() + 100, 11, 31)
          
          if (timestamp >= minDate && timestamp <= maxDate) {
            console.log('Creating new event at:', timestamp)
            onEventCreate?.(timestamp)
          } else {
            // Show error for invalid timestamp
            const errorTooltip = d3.select('body').append('div')
              .attr('class', 'timeline-error-tooltip')
              .style('position', 'absolute')
              .style('background', 'rgba(239, 68, 68, 0.9)')
              .style('color', 'white')
              .style('padding', '8px 12px')
              .style('border-radius', '4px')
              .style('font-size', '12px')
              .style('pointer-events', 'none')
              .style('z-index', '1001')
              .html(`<strong>Invalid Date:</strong><br/>Cannot create event at this time`)
              .style('left', (event.pageX + 10) + 'px')
              .style('top', (event.pageY - 10) + 'px')
            
            setTimeout(() => {
              errorTooltip.remove()
            }, 2000)
          }
        } else {
          // First click - set timeout for double-click detection
          clickTimeout = setTimeout(() => {
            clickTimeout = null
            // Single click - clear selection
            setState(prev => ({
              ...prev,
              selectedElements: new Set()
            }))
          }, 300)
        }
      })
      .on('contextmenu', function(event) {
        event.preventDefault()
        // Could show context menu for additional options
      })

  }, [timeScale, innerWidth, innerHeight, onEventCreate])

  // Render events with enhanced interaction handling
  useEffect(() => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)
    const g = svg.select('g')
    
    // Remove existing events
    g.selectAll('.event').remove()

    const eventSelection = g.selectAll('.event')
      .data(events)
      .enter()
      .append('g')
      .attr('class', 'event')
      .attr('data-event-id', d => d.id)
      .attr('transform', d => `translate(${timeScale()(new Date(d.timestamp))}, ${innerHeight - 30})`)
      .attr('tabindex', 0) // Make focusable for keyboard navigation
      .attr('role', 'button')
      .attr('aria-label', d => `Event: ${d.description} by ${d.actor} targeting ${d.target} at ${new Date(d.timestamp).toLocaleString()}`)

    // Draw event markers with enhanced styling
    eventSelection.append('circle')
      .attr('class', 'event-marker')
      .attr('r', d => state.selectedElements.has(d.id) ? 8 : 6)
      .attr('fill', d => {
        if (state.selectedElements.has(d.id)) return '#ef4444'
        if (state.dragState.isDragging && state.dragState.draggedEvent?.id === d.id) return '#3b82f6'
        return '#f59e0b'
      })
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .style('filter', d => state.selectedElements.has(d.id) ? 'drop-shadow(0 0 6px rgba(239, 68, 68, 0.5))' : 'none')
      .on('click', (_, _) => {
        event.stopPropagation()
        
        // Handle multi-selection with Ctrl/Cmd key
        setState(prev => {
          const newSelected = new Set(prev.selectedElements)
          if (event.ctrlKey || event.metaKey) {
            if (newSelected.has(d.id)) {
              newSelected.delete(d.id)
            } else {
              newSelected.add(d.id)
            }
          } else {
            newSelected.clear()
            newSelected.add(d.id)
          }
          return { ...prev, selectedElements: newSelected }
        })
        
        onEventSelect?.(d)
      })
      .on('dblclick', (_, _) => {
        event.stopPropagation()
        // Open detailed event panel on double-click
        console.log('Opening detailed event panel for:', d)
        // This would typically trigger a modal or detailed view
      })
      .on('contextmenu', (_, _) => {
        event.preventDefault()
        event.stopPropagation()
        
        // Show event arc assignment modal
        setState(prev => ({
          ...prev,
          eventAssignmentModal: {
            isOpen: true,
            event: d,
            position: { x: event.pageX, y: event.pageY }
          }
        }))
      })
      .on('mouseover', function(event, d) {
        // Enhanced hover effect
        d3.select(this)
          .transition()
          .duration(150)
          .attr('r', state.selectedElements.has(d.id) ? 10 : 8)
          .style('filter', 'drop-shadow(0 0 8px rgba(245, 158, 11, 0.6))')
        
        // Show enhanced tooltip with more details
        const tooltip = d3.select('body').append('div')
          .attr('class', 'timeline-tooltip event-tooltip')
          .style('position', 'absolute')
          .style('background', 'rgba(0, 0, 0, 0.9)')
          .style('color', 'white')
          .style('padding', '12px')
          .style('border-radius', '8px')
          .style('font-size', '12px')
          .style('pointer-events', 'none')
          .style('z-index', '1000')
          .style('max-width', '300px')
          .style('box-shadow', '0 4px 12px rgba(0, 0, 0, 0.3)')
          .html(`
            <div style="font-weight: bold; margin-bottom: 6px; color: #fbbf24;">${d.description}</div>
            <div style="margin-bottom: 4px;"><strong>Actor:</strong> ${d.actor}</div>
            <div style="margin-bottom: 4px;"><strong>Target:</strong> ${d.target}</div>
            <div style="margin-bottom: 8px;"><strong>Time:</strong> ${new Date(d.timestamp).toLocaleString()}</div>
            <div style="font-size: 10px; color: #d1d5db; border-top: 1px solid #374151; padding-top: 6px;">
              <div>Created: ${new Date(d.created_at).toLocaleString()}</div>
              <div>Updated: ${new Date(d.updated_at).toLocaleString()}</div>
              <div style="margin-top: 4px; font-style: italic;">
                Click to select • Double-click for details • Drag to move
              </div>
            </div>
          `)
          .style('left', (event.pageX + 15) + 'px')
          .style('top', (event.pageY - 10) + 'px')
          .style('opacity', 0)
          .transition()
          .duration(200)
          .style('opacity', 1)
      })
      .on('mouseout', function(event, d) {
        // Reset hover effect
        d3.select(this)
          .transition()
          .duration(150)
          .attr('r', state.selectedElements.has(d.id) ? 8 : 6)
          .style('filter', state.selectedElements.has(d.id) ? 'drop-shadow(0 0 6px rgba(239, 68, 68, 0.5))' : 'none')
        
        // Remove tooltip with fade out
        d3.selectAll('.timeline-tooltip.event-tooltip')
          .transition()
          .duration(200)
          .style('opacity', 0)
          .remove()
      })
      .on('keydown', (_, _) => {
        // Keyboard navigation support
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          setState(prev => ({
            ...prev,
            selectedElements: new Set([d.id])
          }))
          onEventSelect?.(d)
        }
      })
      .call(d3.drag<SVGCircleElement, Event>()
        .on('start', (_, _) => {
          // Prevent drag if event is not selected
          if (!state.selectedElements.has(d.id)) {
            setState(prev => ({
              ...prev,
              selectedElements: new Set([d.id])
            }))
          }
          
          setState(prev => ({
            ...prev,
            dragState: {
              isDragging: true,
              draggedEvent: d,
              draggedArc: null,
              dragType: 'event',
              startPosition: { x: event.x, y: event.y }
            }
          }))
          
          // Add visual feedback for drag start
          d3.select(event.sourceEvent.target)
            .style('filter', 'drop-shadow(0 0 12px rgba(59, 130, 246, 0.8))')
            .attr('r', 10)
        })
        .on('drag', (_, _) => {
          const newTimestamp = timeScale().invert(event.x)
          const eventGroup = d3.select(event.sourceEvent.target.parentNode)
          
          // Update event position with smooth movement
          eventGroup
            .attr('transform', `translate(${event.x}, ${innerHeight - 30})`)
          
          // Show timestamp preview
          let timestampPreview = g.select('.timestamp-preview')
          if (timestampPreview.empty()) {
            timestampPreview = g.append('text')
              .attr('class', 'timestamp-preview')
              .style('font-size', '11px')
              .style('fill', '#3b82f6')
              .style('font-weight', 'bold')
              .style('text-anchor', 'middle')
              .style('pointer-events', 'none')
          }
          
          timestampPreview
            .attr('x', event.x)
            .attr('y', innerHeight - 50)
            .text(newTimestamp.toLocaleString())
          
          // Enhanced arc highlighting with better visual feedback
          const mouseY = event.y + margin.top
          let validDropTarget = false
          
          g.selectAll('.arc-main')
            .each(function(arcData: any) {
              const arcElement = d3.select(this)
              const arcRect = this.getBoundingClientRect()
              const svgRect = svg.node()!.getBoundingClientRect()
              const relativeY = mouseY - (arcRect.top - svgRect.top)
              
              // Check if mouse is over this arc
              if (relativeY >= 0 && relativeY <= 20) {
                const arcStart = new Date(arcData.start_time).getTime()
                const arcEnd = new Date(arcData.end_time).getTime()
                const eventTime = newTimestamp.getTime()
                
                // Check if event would be contained in arc
                if (eventTime >= arcStart && eventTime <= arcEnd) {
                  validDropTarget = true
                  arcElement
                    .attr('stroke-width', 4)
                    .attr('stroke', '#10b981')
                    .style('filter', 'drop-shadow(0 0 8px rgba(16, 185, 129, 0.5))')
                } else {
                  arcElement
                    .attr('stroke-width', 3)
                    .attr('stroke', '#ef4444')
                    .style('filter', 'drop-shadow(0 0 6px rgba(239, 68, 68, 0.3))')
                }
              } else {
                // Reset to default styling
                arcElement
                  .attr('stroke-width', arcData.renderLevel === 0 ? 2 : 1)
                  .attr('stroke', arcData.renderLevel === 0 ? '#6b7280' : '#9ca3af')
                  .style('filter', 'none')
              }
            })
          
          // Update cursor based on drop validity
          eventGroup.style('cursor', validDropTarget ? 'copy' : 'move')
        })
        .on('end', (_, _) => {
          const newTimestamp = timeScale().invert(event.x)
          
          // Remove timestamp preview
          g.select('.timestamp-preview').remove()
          
          // Enhanced temporal constraint validation
          const validateTemporalConstraints = (eventTimestamp: Date, eventId: string): { isValid: boolean; error?: string } => {
            // Ensure timestamp is not in the future beyond reasonable bounds
            const maxFutureDate = new Date()
            maxFutureDate.setFullYear(maxFutureDate.getFullYear() + 100)
            
            if (eventTimestamp > maxFutureDate) {
              return { 
                isValid: false, 
                error: `Event timestamp cannot be more than 100 years in the future (max: ${maxFutureDate.getFullYear()})` 
              }
            }
            
            // Ensure timestamp is not too far in the past
            const minPastDate = new Date('1000-01-01')
            if (eventTimestamp < minPastDate) {
              return { 
                isValid: false, 
                error: 'Event timestamp cannot be before year 1000' 
              }
            }
            
            // Check for conflicts with other events (enhanced duplicate prevention)
            const conflictingEvent = events.find(e => {
              if (e.id === eventId) return false
              
              const timeDiff = Math.abs(new Date(e.timestamp).getTime() - eventTimestamp.getTime())
              const isSameActorTarget = e.actor === d.actor && e.target === d.target
              const isVeryClose = timeDiff < 60000 // Within 1 minute
              
              return isSameActorTarget && isVeryClose
            })
            
            if (conflictingEvent) {
              return { 
                isValid: false, 
                error: `Another event with the same actor and target exists within 1 minute of this time (${new Date(conflictingEvent.timestamp).toLocaleString()})` 
              }
            }
            
            // Check for causal relationship constraints
            // This would typically involve checking against backend constraints
            // For now, we'll implement basic temporal ordering validation
            
            return { isValid: true }
          }
          
          // Check if dropped on an arc with enhanced detection
          let droppedOnArc: Arc | null = null
          const mouseY = event.y + margin.top
          
          g.selectAll('.arc-main').each(function(arcData: any) {
            const arcRect = this.getBoundingClientRect()
            const svgRect = svg.node()!.getBoundingClientRect()
            const relativeY = mouseY - (arcRect.top - svgRect.top)
            
            if (relativeY >= 0 && relativeY <= 20) {
              const arcStart = new Date(arcData.start_time).getTime()
              const arcEnd = new Date(arcData.end_time).getTime()
              const eventTime = newTimestamp.getTime()
              
              if (eventTime >= arcStart && eventTime <= arcEnd) {
                droppedOnArc = arcData
              }
            }
          })
          
          // Reset all arc highlighting with smooth transition
          g.selectAll('.arc-main')
            .transition()
            .duration(200)
            .attr('stroke-width', (arcData: any) => arcData.renderLevel === 0 ? 2 : 1)
            .attr('stroke', (arcData: any) => arcData.renderLevel === 0 ? '#6b7280' : '#9ca3af')
            .style('filter', 'none')
          
          // Reset event styling
          d3.select(event.sourceEvent.target)
            .transition()
            .duration(200)
            .style('filter', state.selectedElements.has(d.id) ? 'drop-shadow(0 0 6px rgba(239, 68, 68, 0.5))' : 'none')
            .attr('r', state.selectedElements.has(d.id) ? 8 : 6)
          
          // Validate temporal constraints before applying changes
          const validation = validateTemporalConstraints(newTimestamp, d.id)
          
          setState(prev => ({
            ...prev,
            dragState: {
              isDragging: false,
              draggedEvent: null,
              draggedArc: null,
              dragType: null,
              startPosition: null
            }
          }))
          
          if (!validation.isValid) {
            // Show enhanced error message with better styling
            const errorTooltip = d3.select('body').append('div')
              .attr('class', 'timeline-error-tooltip')
              .style('position', 'absolute')
              .style('background', 'linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(220, 38, 38, 0.95))')
              .style('color', 'white')
              .style('padding', '12px 16px')
              .style('border-radius', '8px')
              .style('font-size', '12px')
              .style('pointer-events', 'none')
              .style('z-index', '1001')
              .style('max-width', '350px')
              .style('box-shadow', '0 8px 24px rgba(239, 68, 68, 0.3)')
              .style('border', '1px solid rgba(255, 255, 255, 0.2)')
              .html(`
                <div style="display: flex; align-items: center; margin-bottom: 6px;">
                  <span style="font-size: 16px; margin-right: 8px;">⚠️</span>
                  <strong>Invalid Operation</strong>
                </div>
                <div style="line-height: 1.4;">${validation.error}</div>
              `)
              .style('left', (event.sourceEvent.pageX + 15) + 'px')
              .style('top', (event.sourceEvent.pageY - 10) + 'px')
              .style('opacity', 0)
              .transition()
              .duration(200)
              .style('opacity', 1)
            
            // Remove error tooltip after 4 seconds with fade out
            setTimeout(() => {
              errorTooltip
                .transition()
                .duration(300)
                .style('opacity', 0)
                .remove()
            }, 4000)
            
            // Revert event position to original with elastic effect
            d3.select(event.sourceEvent.target.parentNode)
              .transition()
              .duration(400)
              .ease(d3.easeElastic)
              .attr('transform', `translate(${timeScale()(new Date(d.timestamp))}, ${innerHeight - 30})`)
            
            return
          }
          
          if (droppedOnArc && onEventAssignToArc) {
            // Enhanced validation for arc assignment
            const arcStart = new Date(droppedOnArc.start_time)
            const arcEnd = new Date(droppedOnArc.end_time)
            
            if (newTimestamp >= arcStart && newTimestamp <= arcEnd) {
              // Show success feedback
              const successTooltip = d3.select('body').append('div')
                .attr('class', 'timeline-success-tooltip')
                .style('position', 'absolute')
                .style('background', 'linear-gradient(135deg, rgba(16, 185, 129, 0.95), rgba(5, 150, 105, 0.95))')
                .style('color', 'white')
                .style('padding', '8px 12px')
                .style('border-radius', '6px')
                .style('font-size', '11px')
                .style('pointer-events', 'none')
                .style('z-index', '1001')
                .style('box-shadow', '0 4px 12px rgba(16, 185, 129, 0.3)')
                .html(`✓ Event assigned to "${droppedOnArc.name}"`)
                .style('left', (event.sourceEvent.pageX + 10) + 'px')
                .style('top', (event.sourceEvent.pageY - 40) + 'px')
                .style('opacity', 0)
                .transition()
                .duration(200)
                .style('opacity', 1)
              
              setTimeout(() => {
                successTooltip
                  .transition()
                  .duration(300)
                  .style('opacity', 0)
                  .remove()
              }, 2000)
              
              onEventAssignToArc(d, droppedOnArc)
            } else {
              // Show error for invalid arc assignment
              const errorTooltip = d3.select('body').append('div')
                .attr('class', 'timeline-error-tooltip')
                .style('position', 'absolute')
                .style('background', 'linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(220, 38, 38, 0.95))')
                .style('color', 'white')
                .style('padding', '12px 16px')
                .style('border-radius', '8px')
                .style('font-size', '12px')
                .style('pointer-events', 'none')
                .style('z-index', '1001')
                .style('box-shadow', '0 8px 24px rgba(239, 68, 68, 0.3)')
                .html(`
                  <div style="display: flex; align-items: center; margin-bottom: 6px;">
                    <span style="font-size: 16px; margin-right: 8px;">⚠️</span>
                    <strong>Invalid Arc Assignment</strong>
                  </div>
                  <div>Event timestamp must be within arc boundaries</div>
                  <div style="font-size: 10px; margin-top: 4px; opacity: 0.8;">
                    Arc: ${arcStart.toLocaleDateString()} - ${arcEnd.toLocaleDateString()}
                  </div>
                `)
                .style('left', (event.sourceEvent.pageX + 15) + 'px')
                .style('top', (event.sourceEvent.pageY - 10) + 'px')
                .style('opacity', 0)
                .transition()
                .duration(200)
                .style('opacity', 1)
              
              setTimeout(() => {
                errorTooltip
                  .transition()
                  .duration(300)
                  .style('opacity', 0)
                  .remove()
              }, 3000)
              
              // Revert position with elastic effect
              d3.select(event.sourceEvent.target.parentNode)
                .transition()
                .duration(400)
                .ease(d3.easeElastic)
                .attr('transform', `translate(${timeScale()(new Date(d.timestamp))}, ${innerHeight - 30})`)
            }
          } else {
            // Regular event drag - call the handler
            onEventDrag?.(d, newTimestamp)
          }
        })
      )

    // Add event lines connecting to timeline
    eventSelection.append('line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', 0)
      .attr('y2', 20)
      .attr('stroke', '#6b7280')
      .attr('stroke-width', 1)
      .style('pointer-events', 'none')

  }, [events, timeScale, innerHeight, state.selectedElements, state.dragState, onEventSelect, onEventDrag])

  // Render time range selection overlay
  useEffect(() => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)
    const g = svg.select('g')
    
    // Remove existing selection overlay
    g.selectAll('.selection-overlay').remove()

    if (state.selectionState.isSelecting && state.selectionState.selectionStart && state.selectionState.selectionEnd) {
      const startX = Math.min(state.selectionState.selectionStart.x, state.selectionState.selectionEnd.x)
      const endX = Math.max(state.selectionState.selectionStart.x, state.selectionState.selectionEnd.x)
      const width = endX - startX

      // Draw selection rectangle
      g.append('rect')
        .attr('class', 'selection-overlay')
        .attr('x', startX)
        .attr('y', 0)
        .attr('width', width)
        .attr('height', innerHeight)
        .attr('fill', 'rgba(59, 130, 246, 0.2)')
        .attr('stroke', '#3b82f6')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '5,5')
        .style('pointer-events', 'none')

      // Add time range labels
      const startTime = timeScale().invert(startX)
      const endTime = timeScale().invert(endX)

      g.append('text')
        .attr('class', 'selection-overlay selection-label')
        .attr('x', startX + 5)
        .attr('y', 15)
        .style('font-size', '12px')
        .style('fill', '#3b82f6')
        .style('font-weight', 'bold')
        .style('pointer-events', 'none')
        .text(startTime.toLocaleDateString())

      g.append('text')
        .attr('class', 'selection-overlay selection-label')
        .attr('x', endX - 5)
        .attr('y', 15)
        .attr('text-anchor', 'end')
        .style('font-size', '12px')
        .style('fill', '#3b82f6')
        .style('font-weight', 'bold')
        .style('pointer-events', 'none')
        .text(endTime.toLocaleDateString())
    }

  }, [state.selectionState, timeScale, innerHeight])

  // Setup zoom, pan, and selection interactions
  useEffect(() => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)
    const g = svg.select('g')
    
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .on('zoom', (event) => {
        const { transform } = event
        
        // Update time scale domain based on zoom
        const newTimeScale = transform.rescaleX(timeScale())
        const newDomain = newTimeScale.domain()
        
        setState(prev => ({
          ...prev,
          zoomLevel: transform.k,
          visibleTimeRange: {
            start: newDomain[0],
            end: newDomain[1]
          }
        }))

        onTimeRangeChange?.({
          start: newDomain[0],
          end: newDomain[1]
        })
      })

    svg.call(zoom)

    // Mouse interactions for time range selection and event creation
    let isMouseDown = false
    let mouseDownPosition: { x: number; y: number } | null = null

    svg.on('mousedown', (event) => {
      // Only handle if not clicking on an interactive element
      if (event.target === svg.node() || event.target === g.node()) {
        isMouseDown = true
        const [x, y] = d3.pointer(event, g.node())
        mouseDownPosition = { x, y }
        
        setState(prev => ({
          ...prev,
          selectionState: {
            isSelecting: true,
            selectionStart: { x, y },
            selectionEnd: { x, y },
            selectionTimeRange: null
          }
        }))
      }
    })

    svg.on('mousemove', (event) => {
      if (isMouseDown && mouseDownPosition) {
        const [x, y] = d3.pointer(event, g.node())
        
        setState(prev => ({
          ...prev,
          selectionState: {
            ...prev.selectionState,
            selectionEnd: { x, y }
          }
        }))
      }
    })

    svg.on('mouseup', (event) => {
      if (isMouseDown && mouseDownPosition) {
        const [x, y] = d3.pointer(event, g.node())
        const startX = Math.min(mouseDownPosition.x, x)
        const endX = Math.max(mouseDownPosition.x, x)
        
        // Check if this was a significant drag (more than 10 pixels)
        if (Math.abs(endX - startX) > 10) {
          // Time range selection
          const startTime = timeScale().invert(startX)
          const endTime = timeScale().invert(endX)
          
          setState(prev => ({
            ...prev,
            selectionState: {
              isSelecting: false,
              selectionStart: null,
              selectionEnd: null,
              selectionTimeRange: { start: startTime, end: endTime }
            }
          }))

          // Find events within the selected time range
          const containedEvents = events.filter(event => {
            const eventTime = new Date(event.timestamp).getTime()
            return eventTime >= startTime.getTime() && eventTime <= endTime.getTime()
          })

          // Show arc creation modal
          setState(prev => ({
            ...prev,
            selectionState: {
              isSelecting: false,
              selectionStart: null,
              selectionEnd: null,
              selectionTimeRange: null
            },
            arcCreationModal: {
              isOpen: true,
              timeRange: { start: startTime, end: endTime },
              containedEvents
            }
          }))
        } else {
          // Single click - clear selection
          setState(prev => ({
            ...prev,
            selectionState: {
              isSelecting: false,
              selectionStart: null,
              selectionEnd: null,
              selectionTimeRange: null
            }
          }))
        }
      }
      
      isMouseDown = false
      mouseDownPosition = null
    })

    // Double-click to create event
    svg.on('dblclick', (event) => {
      const [x] = d3.pointer(event, g.node())
      const timestamp = timeScale().invert(x)
      onEventCreate?.(timestamp)
    })

    return () => {
      svg.on('.zoom', null)
      svg.on('mousedown', null)
      svg.on('mousemove', null)
      svg.on('mouseup', null)
      svg.on('dblclick', null)
    }
  }, [timeScale, onTimeRangeChange, onEventCreate, onArcCreate])

  // Modal handlers
  const handleArcCreationSuccess = (newArc: Arc) => {
    setState(prev => ({
      ...prev,
      arcCreationModal: {
        isOpen: false,
        timeRange: null,
        containedEvents: []
      }
    }))
    // Optionally call the original onArcCreate callback
    if (onArcCreate && state.arcCreationModal.timeRange) {
      onArcCreate(state.arcCreationModal.timeRange)
    }
  }

  const handleArcCreationClose = () => {
    setState(prev => ({
      ...prev,
      arcCreationModal: {
        isOpen: false,
        timeRange: null,
        containedEvents: []
      }
    }))
  }

  const handleEventAssignment = async (eventId: string, arcId: string | null) => {
    const event = events.find(e => e.id === eventId)
    const arc = arcId ? arcs.find(a => a.id === arcId) : null
    
    if (event && onEventAssignToArc) {
      if (arc) {
        await onEventAssignToArc(event, arc)
      }
      // Handle removal from arc (arcId is null) - this would need additional API support
    }
    
    setState(prev => ({
      ...prev,
      eventAssignmentModal: {
        isOpen: false,
        event: null,
        position: null
      }
    }))
  }

  const handleEventAssignmentCancel = () => {
    setState(prev => ({
      ...prev,
      eventAssignmentModal: {
        isOpen: false,
        event: null,
        position: null
      }
    }))
  }

  // Find potential parent arcs for the creation modal
  const getPotentialParentArcs = (timeRange: TimeRange | null): Arc[] => {
    if (!timeRange) return []
    
    return arcs.filter(arc => {
      const arcStart = new Date(arc.start_time).getTime()
      const arcEnd = new Date(arc.end_time).getTime()
      const rangeStart = timeRange.start.getTime()
      const rangeEnd = timeRange.end.getTime()
      
      // Arc can be parent if it completely contains the time range
      return arcStart <= rangeStart && arcEnd >= rangeEnd
    })
  }

  return (
    <div 
      ref={containerRef} 
      className={`timeline-container ${className}`}
      role="application"
      aria-label="Interactive timeline visualization"
      tabIndex={0}
      onKeyDown={(e) => {
        // Keyboard navigation support
        if (e.key === 'Escape') {
          setState(prev => ({
            ...prev,
            selectedElements: new Set(),
            dragState: {
              isDragging: false,
              draggedEvent: null,
              draggedArc: null,
              dragType: null,
              startPosition: null
            },
            arcCreationModal: {
              isOpen: false,
              timeRange: null,
              containedEvents: []
            },
            eventAssignmentModal: {
              isOpen: false,
              event: null,
              position: null
            }
          }))
        }
      }}
    >
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="timeline-svg"
        role="img"
        aria-label={`Timeline with ${events.length} events and ${arcs.length} arcs`}
        style={{ border: '1px solid #e5e7eb', borderRadius: '4px' }}
      >
        {/* Pressure Indicators */}
        {showPressureIndicators && pressures.length > 0 && (
          <PressureIndicators
            pressures={pressures}
            arcs={arcs}
            timeScale={timeScale()}
            yScale={yScale()}
            arcLevelMap={new Map(processedArcs().map(arc => [arc.id, arc.renderLevel]))}
            svgRef={svgRef}
            onPressureClick={onPressureSelect}
            onPressureHover={onPressureHover}
            showTooltips={true}
          />
        )}
      </svg>
      
      {/* Screen reader announcements */}
      <div 
        className="sr-only" 
        aria-live="polite" 
        aria-atomic="true"
        id="timeline-announcements"
      >
        {state.selectedElements.size > 0 && (
          `${state.selectedElements.size} ${state.selectedElements.size === 1 ? 'item' : 'items'} selected`
        )}
        {state.dragState.isDragging && state.dragState.draggedEvent && (
          `Dragging event: ${state.dragState.draggedEvent.description}`
        )}
      </div>
      
      {/* Instructions for screen readers */}
      <div className="sr-only">
        <p>
          This is an interactive timeline. Use Tab to navigate between events and arcs. 
          Press Enter or Space to select items. Use arrow keys to navigate chronologically.
          Double-click on empty space to create new events. Drag events to change their timestamps.
          Right-click on events to assign them to arcs.
        </p>
      </div>

      {/* Arc Creation Modal */}
      <ArcCreationModal
        isOpen={state.arcCreationModal.isOpen}
        onClose={handleArcCreationClose}
        timeRange={state.arcCreationModal.timeRange}
        containedEvents={state.arcCreationModal.containedEvents}
        parentArcs={getPotentialParentArcs(state.arcCreationModal.timeRange)}
        onSuccess={handleArcCreationSuccess}
      />

      {/* Event Arc Assignment Modal */}
      {state.eventAssignmentModal.isOpen && state.eventAssignmentModal.event && (
        <div 
          className="fixed z-50"
          style={{
            left: state.eventAssignmentModal.position?.x || 0,
            top: state.eventAssignmentModal.position?.y || 0
          }}
        >
          <EventArcAssignment
            event={state.eventAssignmentModal.event}
            availableArcs={arcs}
            onAssign={handleEventAssignment}
            onCancel={handleEventAssignmentCancel}
          />
        </div>
      )}
    </div>
  )
}



export default Timeline