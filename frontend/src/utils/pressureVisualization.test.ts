import { describe, it, expect } from 'vitest'
import {
  processPressuresWithContext,
  calculatePressureOpacity,
  generatePressureIndicators,
  formatPressureTooltip,
  getConfidenceLevel,
  formatPressureType,
  getPressureTypeIcon,
  calculatePressurePositions,
  filterPressuresByConfidence,
  groupPressuresByType
} from './pressureVisualization'
import { InferredPressure, Arc, Event } from '@/types'
import { PressureWithContext, PressureIndicatorData } from '@/types/pressure'

describe('pressureVisualization utils', () => {
  const mockPressures: InferredPressure[] = [
    {
      id: 'pressure-1',
      description: 'Economic pressure from trade sanctions',
      confidence_score: 0.8,
      pressure_type: 'economic',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    },
    {
      id: 'pressure-2',
      description: 'Social unrest due to policy changes',
      confidence_score: 0.3,
      pressure_type: 'social',
      created_at: '2023-01-02T00:00:00Z',
      updated_at: '2023-01-02T00:00:00Z'
    },
    {
      id: 'pressure-3',
      description: 'Environmental concerns',
      confidence_score: 0.05,
      pressure_type: 'environmental',
      created_at: '2023-01-03T00:00:00Z',
      updated_at: '2023-01-03T00:00:00Z'
    }
  ]

  const mockArcs: Arc[] = [
    {
      id: 'arc-1',
      name: 'Test Arc 1',
      description: 'First test arc',
      start_time: '2023-01-01T00:00:00Z',
      end_time: '2023-01-31T00:00:00Z',
      parent_arc_id: null,
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    }
  ]

  const mockEvents: Event[] = [
    {
      id: 'event-1',
      description: 'Test event',
      actor: 'Actor 1',
      target: 'Target 1',
      timestamp: '2023-01-15T00:00:00Z',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    }
  ]

  describe('processPressuresWithContext', () => {
    it('processes pressures with context correctly', () => {
      const result = processPressuresWithContext(mockPressures, mockArcs, mockEvents)
      
      expect(result).toHaveLength(3)
      expect(result[0]).toHaveProperty('affectedArcs')
      expect(result[0]).toHaveProperty('evidenceEvents')
      expect(result[0]).toHaveProperty('influenceStrength')
      expect(result[0]).toHaveProperty('isVisible')
      expect(result[0]).toHaveProperty('renderColor')
      expect(result[0]).toHaveProperty('renderOpacity')
    })

    it('filters out low confidence pressures', () => {
      const result = processPressuresWithContext(mockPressures, mockArcs, mockEvents)
      
      // Pressure with confidence 0.05 should not be visible
      const lowConfidencePressure = result.find(p => p.id === 'pressure-3')
      expect(lowConfidencePressure?.isVisible).toBe(false)
    })

    it('handles empty inputs', () => {
      const result = processPressuresWithContext([], [], [])
      expect(result).toHaveLength(0)
    })
  })

  describe('calculatePressureOpacity', () => {
    it('calculates opacity correctly for different confidence scores', () => {
      expect(calculatePressureOpacity(0)).toBe(0.2)
      expect(calculatePressureOpacity(1)).toBe(0.8)
      expect(calculatePressureOpacity(0.5)).toBe(0.5)
    })

    it('handles edge cases', () => {
      expect(calculatePressureOpacity(-0.1)).toBeLessThan(0.2)
      expect(calculatePressureOpacity(1.1)).toBeGreaterThan(0.8)
    })
  })

  describe('generatePressureIndicators', () => {
    const mockTimeScale = (date: Date) => date.getTime() / 1000000
    const mockYScale = (level: number) => level * 50
    const mockArcLevelMap = new Map([['arc-1', 0]])

    it('generates indicators for visible pressures', () => {
      const pressuresWithContext = processPressuresWithContext(mockPressures, mockArcs, mockEvents)
      const visiblePressures = pressuresWithContext.filter(p => p.isVisible)
      
      const result = generatePressureIndicators(
        visiblePressures,
        mockArcs,
        mockTimeScale,
        mockYScale,
        mockArcLevelMap
      )
      
      expect(result.length).toBeGreaterThan(0)
      result.forEach(indicator => {
        expect(indicator).toHaveProperty('id')
        expect(indicator).toHaveProperty('pressure')
        expect(indicator).toHaveProperty('arc')
        expect(indicator).toHaveProperty('x')
        expect(indicator).toHaveProperty('y')
        expect(indicator).toHaveProperty('width')
        expect(indicator).toHaveProperty('height')
        expect(indicator).toHaveProperty('color')
        expect(indicator).toHaveProperty('opacity')
      })
    })

    it('handles empty pressure list', () => {
      const result = generatePressureIndicators(
        [],
        mockArcs,
        mockTimeScale,
        mockYScale,
        mockArcLevelMap
      )
      
      expect(result).toHaveLength(0)
    })
  })

  describe('formatPressureTooltip', () => {
    it('formats tooltip data correctly', () => {
      const pressureWithContext: PressureWithContext = {
        ...mockPressures[0],
        affectedArcs: mockArcs,
        evidenceEvents: mockEvents,
        influenceStrength: 0.75,
        isVisible: true,
        isHighlighted: false,
        renderColor: '#10b981',
        renderOpacity: 0.6
      }

      const result = formatPressureTooltip(pressureWithContext, { x: 100, y: 200 })
      
      expect(result.pressure).toBe(pressureWithContext)
      expect(result.position).toEqual({ x: 100, y: 200 })
      expect(result.evidenceCount).toBe(1)
      expect(result.confidenceLevel).toBe('high')
      expect(result.formattedConfidence).toBe('80%')
    })
  })

  describe('getConfidenceLevel', () => {
    it('categorizes confidence levels correctly', () => {
      expect(getConfidenceLevel(0.1)).toBe('low')
      expect(getConfidenceLevel(0.5)).toBe('medium')
      expect(getConfidenceLevel(0.8)).toBe('high')
      expect(getConfidenceLevel(0.29)).toBe('low')
      expect(getConfidenceLevel(0.3)).toBe('medium')
      expect(getConfidenceLevel(0.69)).toBe('medium')
      expect(getConfidenceLevel(0.7)).toBe('high')
    })
  })

  describe('formatPressureType', () => {
    it('formats pressure types correctly', () => {
      expect(formatPressureType('economic')).toBe('Economic')
      expect(formatPressureType('social')).toBe('Social')
      expect(formatPressureType('environmental')).toBe('Environmental')
      expect(formatPressureType('political')).toBe('Political')
    })
  })

  describe('getPressureTypeIcon', () => {
    it('returns correct icons for pressure types', () => {
      expect(getPressureTypeIcon('economic')).toBe('💰')
      expect(getPressureTypeIcon('social')).toBe('👥')
      expect(getPressureTypeIcon('environmental')).toBe('🌍')
      expect(getPressureTypeIcon('political')).toBe('🏛️')
      expect(getPressureTypeIcon('unknown')).toBe('❓')
    })
  })

  describe('calculatePressurePositions', () => {
    it('adjusts positions to avoid overlaps', () => {
      const indicators: PressureIndicatorData[] = [
        {
          id: 'indicator-1',
          pressure: {} as PressureWithContext,
          arc: mockArcs[0],
          x: 100,
          y: 50,
          width: 50,
          height: 4,
          color: '#10b981',
          opacity: 0.6,
          strokeColor: 'none',
          strokeWidth: 0
        },
        {
          id: 'indicator-2',
          pressure: {} as PressureWithContext,
          arc: mockArcs[0],
          x: 120,
          y: 50,
          width: 50,
          height: 4,
          color: '#f59e0b',
          opacity: 0.4,
          strokeColor: 'none',
          strokeWidth: 0
        }
      ]

      const result = calculatePressurePositions(indicators)
      
      expect(result).toHaveLength(2)
      // Second indicator should be moved to avoid overlap
      expect(result[1].y).not.toBe(result[0].y)
    })
  })

  describe('filterPressuresByConfidence', () => {
    it('filters pressures by confidence threshold', () => {
      const pressuresWithContext = processPressuresWithContext(mockPressures, mockArcs, mockEvents)
      
      const filtered = filterPressuresByConfidence(pressuresWithContext, 0.5)
      
      expect(filtered.length).toBe(1) // Only the 0.8 confidence pressure should remain
      expect(filtered[0].confidence_score).toBe(0.8)
    })

    it('returns all pressures when threshold is 0', () => {
      const pressuresWithContext = processPressuresWithContext(mockPressures, mockArcs, mockEvents)
      
      const filtered = filterPressuresByConfidence(pressuresWithContext, 0)
      
      expect(filtered.length).toBe(pressuresWithContext.length)
    })
  })

  describe('groupPressuresByType', () => {
    it('groups pressures by type correctly', () => {
      const pressuresWithContext = processPressuresWithContext(mockPressures, mockArcs, mockEvents)
      
      const grouped = groupPressuresByType(pressuresWithContext)
      
      expect(grouped).toHaveProperty('economic')
      expect(grouped).toHaveProperty('social')
      expect(grouped).toHaveProperty('environmental')
      expect(grouped.economic).toHaveLength(1)
      expect(grouped.social).toHaveLength(1)
      expect(grouped.environmental).toHaveLength(1)
    })

    it('handles empty pressure list', () => {
      const grouped = groupPressuresByType([])
      expect(Object.keys(grouped)).toHaveLength(0)
    })
  })
})