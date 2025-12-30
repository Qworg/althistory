import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import * as d3 from 'd3'
import { Event, Arc, TimeRange } from '@/types'
import { formatTimeAxisTick, getTimeAxisInterval } from '@/utils/d3Calculations'

export interface ActorEventData extends Event {
  role: 'actor' | 'target'
  isHighlighted: boolean
}

export interface ActorTimelineProps {
  events: ActorEventData[]
  arcs: Arc[]
  actor: string
  layoutMode: 'chronological' | 'thematic'
  width?: number
  height?: number
  margin?: { top: number; right: number; bottom: number; left: number }
  onEventSelect?: (event: Event) => void
  onTimeRangeChange?: (range: TimeRange) => void
  className?: string
}

export interface ActorTimelineState {
  zoomLevel: number
  visibleTimeRange: TimeRange
  selectedEventId: string | null
  hoveredEventId: string | null
}

export const ActorTimeline: React.FC<ActorTimelineProps> = ({
  events = [],
  arcs = [],
  actor,
  layoutMode = 'chronological',
  width = 800,
  height = 400,
  margin = { top: 20, right: 20, bottom: 60, left: 80 },
  onEventSelect,
  onTimeRangeChange,
  className = ''
}) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const zoomTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity)

  // Calculate original time extent from events (memoized, doesn't change with zoom)
  const originalTimeExtent = useMemo(() => {
    if (events.length === 0) {
      return {
        start: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        end: new Date()
      }
    }
    return {
      start: new Date(Math.min(...events.map(e => new Date(e.timestamp).getTime())) - 86400000),
      end: new Date(Math.max(...events.map(e => new Date(e.timestamp).getTime())) + 86400000)
    }
  }, [events])

  const [state, setState] = useState<ActorTimelineState>({
    zoomLevel: 1,
    visibleTimeRange: {
      start: events.length > 0
        ? new Date(Math.min(...events.map(e => new Date(e.timestamp).getTime())) - 86400000) // 1 day before first event
        : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      end: events.length > 0
        ? new Date(Math.max(...events.map(e => new Date(e.timestamp).getTime())) + 86400000) // 1 day after last event
        : new Date()
    },
    selectedEventId: null,
    hoveredEventId: null
  })

  // Calculate dimensions
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom

  // Reset visible range when original extent changes (e.g., new events loaded)
  useEffect(() => {
    setState(prev => ({
      ...prev,
      visibleTimeRange: originalTimeExtent,
      zoomLevel: 1
    }))
    zoomTransformRef.current = d3.zoomIdentity

    // Reset zoom transform on the SVG if it exists
    if (svgRef.current) {
      const svg = d3.select(svgRef.current)
      svg.call(d3.zoom<SVGSVGElement, unknown>().transform, d3.zoomIdentity)
    }
  }, [originalTimeExtent])

  // Create time scale
  const timeScale = useCallback(() => {
    return d3.scaleTime()
      .domain([state.visibleTimeRange.start, state.visibleTimeRange.end])
      .range([0, innerWidth])
  }, [state.visibleTimeRange, innerWidth])

  // Create y-scale based on layout mode
  const yScale = useCallback(() => {
    if (layoutMode === 'chronological') {
      // Simple two-track layout: actor events on top, target events on bottom
      return d3.scaleOrdinal<string, number>()
        .domain(['actor', 'target'])
        .range([innerHeight * 0.3, innerHeight * 0.7])
    } else {
      // Thematic layout: group by target/actor relationships
      const uniquePartners = new Set<string>()
      events.forEach(event => {
        if (event.role === 'actor') {
          uniquePartners.add(event.target)
        } else {
          uniquePartners.add(event.actor)
        }
      })
      
      const partners = Array.from(uniquePartners).sort()
      return d3.scaleOrdinal<string, number>()
        .domain(partners)
        .range(partners.map((_, i) => (i + 1) * (innerHeight / (partners.length + 1))))
    }
  }, [layoutMode, events, innerHeight])

  // Group events for thematic layout
  const groupedEvents = useCallback(() => {
    if (layoutMode === 'chronological') {
      return {
        actor: events.filter(e => e.role === 'actor'),
        target: events.filter(e => e.role === 'target')
      }
    } else {
      const groups: Record<string, ActorEventData[]> = {}
      events.forEach(event => {
        const partner = event.role === 'actor' ? event.target : event.actor
        if (!groups[partner]) {
          groups[partner] = []
        }
        groups[partner].push(event)
      })
      return groups
    }
  }, [events, layoutMode])

  // Initialize timeline
  useEffect(() => {
    if (!svgRef.current || events.length === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove() // Clear previous render

    // Create main group with margins
    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    // Create time axis with dynamic formatting based on visible time span
    const timeSpanMs = state.visibleTimeRange.end.getTime() - state.visibleTimeRange.start.getTime()
    const timeInterval = getTimeAxisInterval(timeSpanMs)
    const maxTicks = Math.min(10, Math.floor(innerWidth / 100))

    const xAxis = d3.axisBottom(timeScale())
      .tickFormat((domainValue) => {
        const date = domainValue as Date
        return formatTimeAxisTick(date, timeSpanMs)
      })
      .ticks(timeInterval, maxTicks > 0 ? maxTicks : 1)

    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .style('text-anchor', 'end')
      .attr('dx', '-.8em')
      .attr('dy', '.15em')
      .attr('transform', 'rotate(-45)')
      .style('font-size', '11px')

    // Create y-axis based on layout mode
    if (layoutMode === 'chronological') {
      const yAxis = d3.axisLeft(yScale() as d3.ScaleOrdinal<string, number>)
        .tickFormat(d => d === 'actor' ? `${actor} as Actor` : `${actor} as Target`)

      g.append('g')
        .attr('class', 'y-axis')
        .call(yAxis)
        .selectAll('text')
        .style('font-size', '12px')
        .style('font-weight', 'medium')
    } else {
      const partners = Object.keys(groupedEvents())
      const yAxisScale = yScale() as d3.ScaleOrdinal<string, number>
      
      g.append('g')
        .attr('class', 'y-axis')
        .selectAll('.y-tick')
        .data(partners)
        .enter()
        .append('g')
        .attr('class', 'y-tick')
        .attr('transform', d => `translate(0, ${yAxisScale(d)})`)
        .each(function(d) {
          const tick = d3.select(this)
          
          // Add tick line
          tick.append('line')
            .attr('x1', -6)
            .attr('x2', 0)
            .attr('y1', 0)
            .attr('y2', 0)
            .attr('stroke', '#6b7280')
          
          // Add label
          tick.append('text')
            .attr('x', -9)
            .attr('y', 0)
            .attr('dy', '0.32em')
            .style('text-anchor', 'end')
            .style('font-size', '11px')
            .style('fill', '#374151')
            .text(d)
        })
    }

    // Add grid lines
    g.append('g')
      .attr('class', 'grid')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(timeScale())
        .tickSize(-innerHeight)
        .tickFormat(() => '')
      )
      .style('stroke-dasharray', '2,2')
      .style('opacity', 0.2)

  }, [timeScale, yScale, innerWidth, innerHeight, margin, events, layoutMode, actor, groupedEvents])

  // Render arcs as background context
  useEffect(() => {
    if (!svgRef.current || arcs.length === 0) return

    const svg = d3.select(svgRef.current)
    const g = svg.select('g')
    
    // Remove existing arcs
    g.selectAll('.actor-arc').remove()

    // Add arcs as background rectangles
    const arcSelection = g.selectAll('.actor-arc')
      .data(arcs)
      .enter()
      .append('g')
      .attr('class', 'actor-arc')

    arcSelection.append('rect')
      .attr('x', d => timeScale()(new Date(d.start_time)))
      .attr('y', 0)
      .attr('width', d => {
        const startX = timeScale()(new Date(d.start_time))
        const endX = timeScale()(new Date(d.end_time))
        return Math.max(0, endX - startX)
      })
      .attr('height', innerHeight)
      .attr('fill', 'rgba(59, 130, 246, 0.05)')
      .attr('stroke', 'rgba(59, 130, 246, 0.2)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')

    // Add arc labels
    arcSelection.append('text')
      .attr('x', d => {
        const startX = timeScale()(new Date(d.start_time))
        const endX = timeScale()(new Date(d.end_time))
        return startX + (endX - startX) / 2
      })
      .attr('y', 15)
      .attr('text-anchor', 'middle')
      .style('font-size', '10px')
      .style('fill', '#6b7280')
      .style('font-weight', '500')
      .text(d => d.name.length > 20 ? d.name.substring(0, 17) + '...' : d.name)

  }, [arcs, timeScale, innerHeight])

  // Render events with role-based styling
  useEffect(() => {
    if (!svgRef.current || events.length === 0) return

    const svg = d3.select(svgRef.current)
    const g = svg.select('g')
    
    // Remove existing events
    g.selectAll('.actor-event').remove()

    const groups = groupedEvents()
    const yScaleFunc = yScale()

    // Render events for each group
    Object.entries(groups).forEach(([groupKey, groupEvents]) => {
      const eventSelection = g.selectAll(`.actor-event-${groupKey}`)
        .data(groupEvents)
        .enter()
        .append('g')
        .attr('class', `actor-event actor-event-${groupKey}`)
        .attr('data-event-id', d => d.id)
        .attr('transform', d => {
          const x = timeScale()(new Date(d.timestamp))
          let y: number
          
          if (layoutMode === 'chronological') {
            y = (yScaleFunc as d3.ScaleOrdinal<string, number>)(d.role)
          } else {
            const partner = d.role === 'actor' ? d.target : d.actor
            y = (yScaleFunc as d3.ScaleOrdinal<string, number>)(partner)
          }
          
          return `translate(${x}, ${y})`
        })

      // Draw event markers with role-based styling
      eventSelection.append('circle')
        .attr('class', 'event-marker')
        .attr('r', d => state.selectedEventId === d.id ? 8 : 6)
        .attr('fill', d => {
          if (state.selectedEventId === d.id) return '#ef4444'
          return d.role === 'actor' ? '#3b82f6' : '#10b981'
        })
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 2)
        .style('cursor', 'pointer')
        .style('filter', d => state.selectedEventId === d.id ? 'drop-shadow(0 0 6px rgba(239, 68, 68, 0.5))' : 'none')
        .on('click', (event, d) => {
          event.stopPropagation()
          setState(prev => ({
            ...prev,
            selectedEventId: prev.selectedEventId === d.id ? null : d.id
          }))
          onEventSelect?.(d)
        })
        .on('mouseenter', function(event, d) {
          setState(prev => ({ ...prev, hoveredEventId: d.id }))

          // Enhance hover effect
          d3.select(this)
            .transition()
            .duration(150)
            .attr('r', state.selectedEventId === d.id ? 10 : 8)
            .style('filter', 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.6))')

          // Remove any existing tooltip before showing new one
          d3.selectAll('.actor-timeline-tooltip').remove()

          // Show tooltip
          d3.select('body').append('div')
            .attr('class', 'actor-timeline-tooltip')
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
              <div style="font-weight: bold; margin-bottom: 4px;">${d.description}</div>
              <div style="margin-bottom: 8px;">
                <span style="color: ${d.role === 'actor' ? '#60a5fa' : '#34d399'};">
                  ${actor} as ${d.role === 'actor' ? 'Actor' : 'Target'}
                </span>
              </div>
              <div style="font-size: 11px; color: #d1d5db;">
                <div><strong>Actor:</strong> ${d.actor}</div>
                <div><strong>Target:</strong> ${d.target}</div>
                <div><strong>Time:</strong> ${new Date(d.timestamp).toLocaleString()}</div>
              </div>
            `)
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 10) + 'px')
        })
        .on('mouseleave', function(_, d) {
          setState(prev => ({ ...prev, hoveredEventId: null }))

          // Remove hover effect
          d3.select(this)
            .transition()
            .duration(150)
            .attr('r', state.selectedEventId === d.id ? 8 : 6)
            .style('filter', state.selectedEventId === d.id ? 'drop-shadow(0 0 6px rgba(239, 68, 68, 0.5))' : 'none')

          d3.selectAll('.actor-timeline-tooltip').remove()
        })

      // Add role indicators
      eventSelection.append('text')
        .attr('x', 0)
        .attr('y', -12)
        .attr('text-anchor', 'middle')
        .style('font-size', '8px')
        .style('font-weight', 'bold')
        .style('fill', d => d.role === 'actor' ? '#3b82f6' : '#10b981')
        .style('pointer-events', 'none')
        .text(d => d.role === 'actor' ? 'A' : 'T')

      // Add connection lines for thematic layout
      if (layoutMode === 'thematic' && groupEvents.length > 1) {
        const sortedEvents = [...groupEvents].sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
        
        for (let i = 0; i < sortedEvents.length - 1; i++) {
          const current = sortedEvents[i]
          const next = sortedEvents[i + 1]
          
          if (current && next) {
            g.append('line')
              .attr('class', 'connection-line')
              .attr('x1', timeScale()(new Date(current.timestamp)))
              .attr('y1', (yScaleFunc as d3.ScaleOrdinal<string, number>)(groupKey))
              .attr('x2', timeScale()(new Date(next.timestamp)))
              .attr('y2', (yScaleFunc as d3.ScaleOrdinal<string, number>)(groupKey))
              .attr('stroke', '#d1d5db')
              .attr('stroke-width', 1)
              .attr('stroke-dasharray', '2,2')
              .style('opacity', 0.5)
          }
        }
      }
    })

    // Cleanup tooltips on unmount or dependency change
    return () => {
      d3.selectAll('.actor-timeline-tooltip').remove()
    }
  }, [events, timeScale, yScale, layoutMode, state.selectedEventId, state.hoveredEventId, groupedEvents, onEventSelect, actor])

  // Add zoom and pan functionality
  useEffect(() => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)

    // Create a base scale from the ORIGINAL extent (not the current visible range)
    // This prevents the compounding zoom issue
    const baseTimeScale = d3.scaleTime()
      .domain([originalTimeExtent.start, originalTimeExtent.end])
      .range([0, innerWidth])

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .on('zoom', (event) => {
        const { transform } = event

        // Store the current transform
        zoomTransformRef.current = transform

        // Calculate new domain from the ORIGINAL scale, not the current visible range
        const newTimeScale = transform.rescaleX(baseTimeScale)
        const newDomain = newTimeScale.domain()

        setState(prev => ({
          ...prev,
          visibleTimeRange: {
            start: newDomain[0],
            end: newDomain[1]
          },
          zoomLevel: transform.k
        }))

        onTimeRangeChange?.({
          start: newDomain[0],
          end: newDomain[1]
        })
      })

    svg.call(zoom)

    // Fit to View button
    const fitButton = d3.select(containerRef.current)
      .select('.fit-to-view-button')

    if (fitButton.empty()) {
      d3.select(containerRef.current)
        .append('button')
        .attr('class', 'fit-to-view-button')
        .attr('title', 'Fit all events in view (F)')
        .style('position', 'absolute')
        .style('top', '10px')
        .style('right', '10px')
        .style('padding', '4px 8px')
        .style('background', '#ffffff')
        .style('border', '1px solid #d1d5db')
        .style('border-radius', '4px')
        .style('font-size', '12px')
        .style('cursor', 'pointer')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('gap', '4px')
        .style('box-shadow', '0 1px 2px rgba(0,0,0,0.05)')
        .html(`
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
          Fit to View
        `)
        .on('click', () => {
          svg.transition()
            .duration(300)
            .call(zoom.transform, d3.zoomIdentity)
        })
    }

    return () => {
      svg.on('.zoom', null)
    }
  }, [originalTimeExtent, innerWidth, onTimeRangeChange])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="border border-gray-200 rounded-lg bg-white"
        style={{ overflow: 'visible' }}
      >
        {/* SVG content is rendered by D3 */}
      </svg>
      
      {/* Legend */}
      <div className="absolute bottom-2 left-2 bg-white bg-opacity-90 rounded-lg p-2 text-xs border border-gray-200">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
            <span>As Actor</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            <span>As Target</span>
          </div>
          {layoutMode === 'thematic' && (
            <div className="flex items-center space-x-1">
              <div className="w-4 h-0 border-t border-gray-400 border-dashed"></div>
              <span>Connections</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Layout mode indicator */}
      <div className="absolute top-2 left-2 bg-white bg-opacity-90 rounded-lg px-2 py-1 text-xs border border-gray-200">
        {layoutMode === 'chronological' ? 'Chronological Layout' : 'Thematic Layout'}
      </div>
    </div>
  )
}