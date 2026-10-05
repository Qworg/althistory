import { describe, it, expect } from 'vitest'
import { Event, Arc } from '@/types'
import { 
  calculateArcHierarchy, 
  processArcsWithUIState, 
  formatDuration,
  ArcWithUIState 
} from './arcHierarchyUtils'

describe('Arc Hierarchy Utilities', () => {
  const mockEvents: Event[] = [
    {
      id: '1',
      description: 'Event 1',
      actor: 'Actor A',
      target: 'Target A',
      timestamp: '2024-01-15T10:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    },
    {
      id: '2',
      description: 'Event 2',
      actor: 'Actor B',
      target: 'Target B',
      timestamp: '2024-01-20T10:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    },
    {
      id: '3',
      description: 'Event 3',
      actor: 'Actor C',
      target: 'Target C',
      timestamp: '2024-02-10T10:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    }
  ]

  const mockArcs: Arc[] = [
    {
      id: 'arc1',
      name: 'Root Arc 1',
      description: 'Top level arc',
      start_time: '2024-01-01T00:00:00Z',
      end_time: '2024-01-31T23:59:59Z',
      level: 0,
      parent_arc_id: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    },
    {
      id: 'arc2',
      name: 'Child Arc 1',
      description: 'Child of Root Arc 1',
      start_time: '2024-01-10T00:00:00Z',
      end_time: '2024-01-25T23:59:59Z',
      level: 1,
      parent_arc_id: 'arc1',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    },
    {
      id: 'arc3',
      name: 'Root Arc 2',
      description: 'Another top level arc',
      start_time: '2024-02-01T00:00:00Z',
      end_time: '2024-02-28T23:59:59Z',
      level: 0,
      parent_arc_id: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    },
    {
      id: 'arc4',
      name: 'Grandchild Arc',
      description: 'Child of Child Arc 1',
      start_time: '2024-01-15T00:00:00Z',
      end_time: '2024-01-20T23:59:59Z',
      level: 2,
      parent_arc_id: 'arc2',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    }
  ]

  describe('processArcsWithUIState', () => {
    it('should correctly process arcs with UI state', () => {
      const expandedArcs = new Set(['arc1'])
      const selectedElements = new Set(['arc2'])
      
      const processedArcs = processArcsWithUIState(mockArcs, mockEvents, expandedArcs, selectedElements)
      
      expect(processedArcs).toHaveLength(4)
      
      // Check arc1 (expanded)
      const arc1 = processedArcs.find(a => a.id === 'arc1')!
      expect(arc1.isExpanded).toBe(true)
      expect(arc1.isSelected).toBe(false)
      expect(arc1.eventCount).toBe(2) // Events 1 and 2 are within this arc
      expect(arc1.childArcs).toHaveLength(1) // arc2 is a child
      expect(arc1.parentArc).toBeNull()
      
      // Check arc2 (selected)
      const arc2 = processedArcs.find(a => a.id === 'arc2')!
      expect(arc2.isExpanded).toBe(false)
      expect(arc2.isSelected).toBe(true)
      expect(arc2.eventCount).toBe(2) // Events 1 and 2 are within this arc
      expect(arc2.childArcs).toHaveLength(1) // arc4 is a child
      expect(arc2.parentArc?.id).toBe('arc1')
      
      // Check arc3 (separate root)
      const arc3 = processedArcs.find(a => a.id === 'arc3')!
      expect(arc3.isExpanded).toBe(false)
      expect(arc3.isSelected).toBe(false)
      expect(arc3.eventCount).toBe(1) // Event 3 is within this arc
      expect(arc3.childArcs).toHaveLength(0)
      expect(arc3.parentArc).toBeNull()
      
      // Check arc4 (grandchild)
      const arc4 = processedArcs.find(a => a.id === 'arc4')!
      expect(arc4.isExpanded).toBe(false)
      expect(arc4.isSelected).toBe(false)
      expect(arc4.eventCount).toBe(2) // Events 1 and 2 are within this arc
      expect(arc4.childArcs).toHaveLength(0)
      expect(arc4.parentArc?.id).toBe('arc2')
    })

    it('should calculate correct event containment', () => {
      const processedArcs = processArcsWithUIState(mockArcs, mockEvents, new Set(), new Set())
      
      const arc1 = processedArcs.find(a => a.id === 'arc1')!
      expect(arc1.containedEvents.map(e => e.id)).toEqual(['1', '2'])
      
      const arc3 = processedArcs.find(a => a.id === 'arc3')!
      expect(arc3.containedEvents.map(e => e.id)).toEqual(['3'])
    })

    it('should calculate duration correctly', () => {
      const processedArcs = processArcsWithUIState(mockArcs, mockEvents, new Set(), new Set())
      
      const arc1 = processedArcs.find(a => a.id === 'arc1')!
      const expectedDuration = new Date('2024-01-31T23:59:59Z').getTime() - new Date('2024-01-01T00:00:00Z').getTime()
      expect(arc1.duration).toBe(expectedDuration)
    })
  })

  describe('calculateArcHierarchy', () => {
    it('should calculate correct hierarchy levels for root arcs', () => {
      const processedArcs = processArcsWithUIState(mockArcs, mockEvents, new Set(), new Set())
      const { arcHierarchy, maxLevel } = calculateArcHierarchy(processedArcs)
      
      // Should have all arcs at root level since none are expanded
      expect(arcHierarchy).toHaveLength(2) // Only root arcs (arc1, arc3)
      expect(maxLevel).toBe(0) // Both arcs are at level 0 since they don't overlap temporally
      
      const rootArcs = arcHierarchy.filter(a => a.parent_arc_id === null)
      expect(rootArcs).toHaveLength(2)
      
      // Both root arcs should be at level 0
      rootArcs.forEach(arc => {
        expect(arc.renderLevel).toBe(0)
      })
    })

    it('should handle expanded arcs and show children', () => {
      const expandedArcs = new Set(['arc1', 'arc2'])
      const processedArcs = processArcsWithUIState(mockArcs, mockEvents, expandedArcs, new Set())
      const { arcHierarchy, maxLevel } = calculateArcHierarchy(processedArcs)
      
      // Should include children of expanded arcs
      expect(arcHierarchy.length).toBeGreaterThan(2)
      
      // Check that child arcs have higher render levels than parents
      const arc1 = arcHierarchy.find(a => a.id === 'arc1')!
      const arc2 = arcHierarchy.find(a => a.id === 'arc2')!
      const arc4 = arcHierarchy.find(a => a.id === 'arc4')!
      
      expect(arc2.renderLevel).toBeGreaterThan(arc1.renderLevel)
      expect(arc4.renderLevel).toBeGreaterThan(arc2.renderLevel)
    })

    it('should avoid overlaps between arcs at the same level', () => {
      const overlappingArcs: Arc[] = [
        {
          id: 'overlap1',
          name: 'Overlapping Arc 1',
          description: 'First overlapping arc',
          start_time: '2024-01-01T00:00:00Z',
          end_time: '2024-01-15T23:59:59Z',
          level: 0,
          parent_arc_id: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 'overlap2',
          name: 'Overlapping Arc 2',
          description: 'Second overlapping arc',
          start_time: '2024-01-10T00:00:00Z',
          end_time: '2024-01-25T23:59:59Z',
          level: 0,
          parent_arc_id: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        }
      ]

      const processedArcs = processArcsWithUIState(overlappingArcs, [], new Set(), new Set())
      const { arcHierarchy } = calculateArcHierarchy(processedArcs)
      
      const overlap1 = arcHierarchy.find(a => a.id === 'overlap1')!
      const overlap2 = arcHierarchy.find(a => a.id === 'overlap2')!
      
      // Overlapping arcs should be at different levels
      expect(overlap1.renderLevel).not.toBe(overlap2.renderLevel)
    })

    it('should handle deep hierarchy levels', () => {
      const deepArcs: Arc[] = Array.from({ length: 5 }, (_, i) => ({
        id: `deep${i}`,
        name: `Deep Arc ${i}`,
        description: `Level ${i} arc`,
        start_time: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
        end_time: `2024-01-${String(i + 10).padStart(2, '0')}T23:59:59Z`,
        level: i,
        parent_arc_id: i > 0 ? `deep${i - 1}` : null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }))

      const expandedArcs = new Set(deepArcs.map(a => a.id))
      const processedArcs = processArcsWithUIState(deepArcs, [], expandedArcs, new Set())
      const { arcHierarchy, maxLevel } = calculateArcHierarchy(processedArcs)
      
      expect(arcHierarchy).toHaveLength(5)
      expect(maxLevel).toBe(4) // 0-indexed, so 5 levels total
      
      // Check that each level is correctly assigned
      for (let i = 0; i < 5; i++) {
        const arc = arcHierarchy.find(a => a.id === `deep${i}`)!
        expect(arc.renderLevel).toBe(i)
      }
    })
  })

  describe('formatDuration', () => {
    it('should format hours correctly', () => {
      const start = new Date('2024-01-01T10:00:00Z')
      const end = new Date('2024-01-01T15:00:00Z')
      expect(formatDuration(start, end)).toBe('5 hours')
    })

    it('should format days correctly', () => {
      const start = new Date('2024-01-01T00:00:00Z')
      const end = new Date('2024-01-05T00:00:00Z')
      expect(formatDuration(start, end)).toBe('4 days')
    })

    it('should format months correctly', () => {
      const start = new Date('2024-01-01T00:00:00Z')
      const end = new Date('2024-03-01T00:00:00Z')
      expect(formatDuration(start, end)).toBe('2 months')
    })

    it('should format years correctly', () => {
      const start = new Date('2022-01-01T00:00:00Z')
      const end = new Date('2024-01-01T00:00:00Z')
      expect(formatDuration(start, end)).toBe('2 years')
    })
  })

  describe('Event Containment Edge Cases', () => {
    it('should handle events at arc boundaries correctly', () => {
      const boundaryEvents: Event[] = [
        {
          id: 'boundary1',
          description: 'Event at arc start',
          actor: 'Actor',
          target: 'Target',
          timestamp: '2024-01-01T00:00:00Z', // Exactly at arc start
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 'boundary2',
          description: 'Event at arc end',
          actor: 'Actor',
          target: 'Target',
          timestamp: '2024-01-31T23:59:59Z', // Exactly at arc end
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        }
      ]

      const processedArcs = processArcsWithUIState(mockArcs, boundaryEvents, new Set(), new Set())
      const arc1 = processedArcs.find(a => a.id === 'arc1')!
      
      // Both boundary events should be contained in arc1
      expect(arc1.containedEvents).toHaveLength(2)
      expect(arc1.containedEvents.map(e => e.id)).toEqual(['boundary1', 'boundary2'])
    })

    it('should handle events outside all arcs', () => {
      const outsideEvents: Event[] = [
        {
          id: 'outside1',
          description: 'Event before all arcs',
          actor: 'Actor',
          target: 'Target',
          timestamp: '2023-12-01T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 'outside2',
          description: 'Event after all arcs',
          actor: 'Actor',
          target: 'Target',
          timestamp: '2024-12-01T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        }
      ]

      const processedArcs = processArcsWithUIState(mockArcs, outsideEvents, new Set(), new Set())
      
      // No arc should contain these events
      processedArcs.forEach(arc => {
        expect(arc.containedEvents).toHaveLength(0)
      })
    })
  })

  describe('Performance', () => {
    it('should handle large numbers of arcs efficiently', () => {
      const manyArcs: Arc[] = Array.from({ length: 100 }, (_, i) => ({
        id: `arc${i}`,
        name: `Arc ${i}`,
        description: `Description ${i}`,
        start_time: `2024-01-${String(i % 28 + 1).padStart(2, '0')}T00:00:00Z`,
        end_time: `2024-01-${String((i % 28 + 1) + 1).padStart(2, '0')}T23:59:59Z`,
        level: i > 50 ? 1 : 0,
        parent_arc_id: i > 50 ? `arc${i - 50}` : null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }))

      const startTime = performance.now()
      const processedArcs = processArcsWithUIState(manyArcs, [], new Set(), new Set())
      const { arcHierarchy } = calculateArcHierarchy(processedArcs)
      const endTime = performance.now()

      // Sanity check: should process in reasonable time (generous 500ms threshold)
      // In isolation runs ~10ms, but can be slower in full test suite
      expect(endTime - startTime).toBeLessThan(500)
      expect(arcHierarchy.length).toBeGreaterThan(0)
    })

    // Performance test - sanity check only, not a strict benchmark.
    it('should handle complex hierarchy calculations efficiently', () => {
      const complexArcs: Arc[] = []
      
      // Create a complex hierarchy with multiple branches
      for (let i = 0; i < 50; i++) {
        complexArcs.push({
          id: `root${i}`,
          name: `Root ${i}`,
          description: `Root arc ${i}`,
          start_time: `2024-${String(i % 12 + 1).padStart(2, '0')}-01T00:00:00Z`,
          end_time: `2024-${String(i % 12 + 1).padStart(2, '0')}-28T23:59:59Z`,
          level: 0,
          parent_arc_id: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        })

        // Add children
        for (let j = 0; j < 3; j++) {
          complexArcs.push({
            id: `child${i}_${j}`,
            name: `Child ${i}_${j}`,
            description: `Child arc ${i}_${j}`,
            start_time: `2024-${String(i % 12 + 1).padStart(2, '0')}-${String(j * 7 + 1).padStart(2, '0')}T00:00:00Z`,
            end_time: `2024-${String(i % 12 + 1).padStart(2, '0')}-${String(j * 7 + 7).padStart(2, '0')}T23:59:59Z`,
            level: 1,
            parent_arc_id: `root${i}`,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z'
          })
        }
      }

      const expandedArcs = new Set(complexArcs.filter(a => a.parent_arc_id === null).map(a => a.id))
      
      const startTime = performance.now()
      const processedArcs = processArcsWithUIState(complexArcs, [], expandedArcs, new Set())
      const { arcHierarchy } = calculateArcHierarchy(processedArcs)
      const endTime = performance.now()

      // Sanity check: should handle complex hierarchy in reasonable time (generous 1000ms threshold)
      // In isolation runs ~30ms, but can be slower in full test suite
      expect(endTime - startTime).toBeLessThan(1000)
      expect(arcHierarchy.length).toBeGreaterThan(50)
    })
  })
})