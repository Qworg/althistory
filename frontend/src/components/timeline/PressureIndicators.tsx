import React, { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { Arc } from '@/types'
import { 
  PressureWithContext, 
  PressureIndicatorData
} from '@/types/pressure'
import { 
  generatePressureIndicators,
  formatPressureTooltip,
  calculatePressurePositions,
  formatPressureType,
  getPressureTypeIcon 
} from '@/utils/pressureVisualization'

export interface PressureIndicatorsProps {
  pressures: PressureWithContext[]
  arcs: Arc[]
  timeScale: (date: Date) => number
  yScale: (level: number) => number
  arcLevelMap: Map<string, number>
  svgRef: React.RefObject<SVGSVGElement | null>
  onPressureClick?: (pressure: PressureWithContext) => void
  onPressureHover?: (pressure: PressureWithContext | null) => void
  showTooltips?: boolean
  className?: string
}

export const PressureIndicators: React.FC<PressureIndicatorsProps> = ({
  pressures,
  arcs,
  timeScale,
  yScale,
  arcLevelMap,
  svgRef,
  onPressureClick,
  onPressureHover,
  showTooltips = true,
  className = ''
}) => {
  const indicatorsRef = useRef<SVGGElement>(null)

  // Generate pressure indicator data
  const indicatorData = React.useMemo(() => {
    const rawIndicators = generatePressureIndicators(
      pressures,
      arcs,
      timeScale,
      yScale,
      arcLevelMap
    )
    return calculatePressurePositions(rawIndicators)
  }, [pressures, arcs, timeScale, yScale, arcLevelMap])

  // Render pressure indicators
  useEffect(() => {
    if (!svgRef.current || !indicatorsRef.current) return

    const svg = d3.select<SVGSVGElement, unknown>(svgRef.current)
    // Bind the datum type to the selection so the key function below and every
    // downstream `.attr(..., d => ...)` see PressureIndicatorData instead of unknown.
    const indicatorsGroup = d3.select<SVGGElement, PressureIndicatorData>(indicatorsRef.current)

    // Clear existing indicators
    indicatorsGroup.selectAll('.pressure-indicator').remove()

    // Create indicator groups
    const indicators = indicatorsGroup
      .selectAll<SVGGElement, PressureIndicatorData>('.pressure-indicator')
      .data(indicatorData, (d: PressureIndicatorData) => d.id)
      .enter()
      .append('g')
      .attr('class', 'pressure-indicator')
      .attr('data-pressure-id', d => d.pressure.id)
      .attr('data-arc-id', d => d.arc.id)

    // Add main pressure bars
    indicators
      .append('rect')
      .attr('class', 'pressure-bar')
      .attr('x', d => d.x)
      .attr('y', d => d.y)
      .attr('width', d => d.width)
      .attr('height', d => d.height)
      .attr('fill', d => d.color)
      .attr('opacity', d => d.opacity)
      .attr('stroke', d => d.strokeColor)
      .attr('stroke-width', d => d.strokeWidth)
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .style('transition', 'all 0.2s ease')

    // Add pressure type indicators (small circles)
    indicators
      .append('circle')
      .attr('class', 'pressure-type-indicator')
      .attr('cx', d => d.x + 6)
      .attr('cy', d => d.y + d.height / 2)
      .attr('r', 3)
      .attr('fill', d => d.color)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')

    // Add confidence indicators (gradient overlay)
    indicators
      .append('rect')
      .attr('class', 'confidence-indicator')
      .attr('x', d => d.x)
      .attr('y', d => d.y)
      .attr('width', d => d.width * d.pressure.confidence_score)
      .attr('height', d => d.height)
      .attr('fill', 'url(#confidenceGradient)')
      .attr('opacity', 0.3)
      .attr('rx', 2)
      .style('pointer-events', 'none')

    // Add interaction handlers
    indicators
      .on('click', (event, d) => {
        event.stopPropagation()
        onPressureClick?.(d.pressure)
      })
      .on('mouseenter', function(event, d) {
        // Highlight effect
        d3.select(this)
          .select('.pressure-bar')
          .transition()
          .duration(150)
          .attr('opacity', Math.min(d.opacity + 0.2, 1))
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 2)

        // Show tooltip if enabled
        if (showTooltips) {
          showPressureTooltip(event, d)
        }

        onPressureHover?.(d.pressure)
      })
      .on('mouseleave', function(_event, d) {
        // Remove highlight
        d3.select(this)
          .select('.pressure-bar')
          .transition()
          .duration(150)
          .attr('opacity', d.opacity)
          .attr('stroke', d.strokeColor)
          .attr('stroke-width', d.strokeWidth)

        // Hide tooltip
        d3.selectAll('.pressure-tooltip').remove()

        onPressureHover?.(null)
      })

    // Add gradient definitions for confidence indicators
    // Hoist the select so both ternary branches share one concrete Selection type
    // (a union of two different Selection types would collapse the selectAll overloads).
    const existingDefs = svg.select<SVGDefsElement>('defs')
    const defs = existingDefs.empty() ? svg.append<SVGDefsElement>('defs') : existingDefs
    
    defs.selectAll('#confidenceGradient').remove()
    const gradient = defs.append('linearGradient')
      .attr('id', 'confidenceGradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '100%')
      .attr('y2', '0%')

    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#ffffff')
      .attr('stop-opacity', 0.8)

    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#ffffff')
      .attr('stop-opacity', 0.2)

  }, [indicatorData, onPressureClick, onPressureHover, showTooltips, svgRef])

  // Show pressure tooltip
  const showPressureTooltip = (event: MouseEvent, indicatorData: PressureIndicatorData) => {
    const tooltipData = formatPressureTooltip(
      indicatorData.pressure,
      { x: event.pageX, y: event.pageY }
    )

    const tooltip = d3.select('body')
      .append('div')
      .attr('class', 'pressure-tooltip')
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
      .style('border', `2px solid ${indicatorData.color}`)

    // Tooltip content
    const content = `
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <span style="font-size: 16px; margin-right: 8px;">${getPressureTypeIcon(tooltipData.pressure.pressure_type)}</span>
        <div>
          <div style="font-weight: bold; color: ${indicatorData.color};">
            ${formatPressureType(tooltipData.pressure.pressure_type)} Pressure
          </div>
          <div style="font-size: 10px; color: #d1d5db;">
            Confidence: ${tooltipData.formattedConfidence} (${tooltipData.confidenceLevel})
          </div>
        </div>
      </div>
      
      <div style="margin-bottom: 8px; line-height: 1.4;">
        ${tooltipData.pressure.description}
      </div>
      
      <div style="font-size: 11px; color: #d1d5db; border-top: 1px solid #374151; padding-top: 8px;">
        <div style="margin-bottom: 4px;">
          <strong>Evidence Events:</strong> ${tooltipData.evidenceCount}
        </div>
        <div style="margin-bottom: 4px;">
          <strong>Influence Strength:</strong> ${Math.round(tooltipData.pressure.influenceStrength * 100)}%
        </div>
        <div style="margin-bottom: 4px;">
          <strong>Affected Arcs:</strong> ${tooltipData.pressure.affectedArcs.length}
        </div>
        <div style="font-style: italic; margin-top: 8px; color: #9ca3af;">
          Click to explore evidence and relationships
        </div>
      </div>
    `

    tooltip.html(content)
      .style('left', (tooltipData.position.x + 10) + 'px')
      .style('top', (tooltipData.position.y - 10) + 'px')

    // Adjust position if tooltip goes off screen
    const tooltipNode = tooltip.node() as HTMLElement
    if (tooltipNode) {
      const rect = tooltipNode.getBoundingClientRect()
      const windowWidth = window.innerWidth
      const windowHeight = window.innerHeight

      if (rect.right > windowWidth) {
        tooltip.style('left', (tooltipData.position.x - rect.width - 10) + 'px')
      }
      if (rect.bottom > windowHeight) {
        tooltip.style('top', (tooltipData.position.y - rect.height - 10) + 'px')
      }
    }
  }

  return (
    <g 
      ref={indicatorsRef} 
      className={`pressure-indicators ${className}`}
      data-testid="pressure-indicators"
    />
  )
}

export default PressureIndicators