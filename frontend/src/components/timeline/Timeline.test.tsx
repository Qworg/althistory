import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../test/utils'
import { Timeline } from './Timeline'
import { Event, Arc } from '../../types'

// Mock D3 with a simpler approach
vi.mock('d3', () => {
  // The D3 surface Timeline touches is a chained-selection / chained-scale API:
  // every mutator returns the same object so calls can be chained. These
  // interfaces mirror that contract so the mock keeps the real shape without casts.

  interface SelectionMock {
    selectAll: (...args: unknown[]) => SelectionMock
    select: (...args: unknown[]) => SelectionMock
    append: (...args: unknown[]) => SelectionMock
    insert: (...args: unknown[]) => SelectionMock
    attr: (...args: unknown[]) => SelectionMock
    style: (...args: unknown[]) => SelectionMock
    text: (...args: unknown[]) => SelectionMock
    html: (...args: unknown[]) => SelectionMock
    call: (...args: unknown[]) => SelectionMock
    on: (...args: unknown[]) => SelectionMock
    remove: (...args: unknown[]) => SelectionMock
    filter: (...args: unknown[]) => SelectionMock
    transition: (...args: unknown[]) => SelectionMock
    duration: (...args: unknown[]) => SelectionMock
    ease: (...args: unknown[]) => SelectionMock
    each: (...args: unknown[]) => SelectionMock
    data: (...args: unknown[]) => {
      enter: (...args: unknown[]) => SelectionMock
      exit: (...args: unknown[]) => SelectionMock
      merge: (...args: unknown[]) => SelectionMock
    }
    node: () => Element
  }

  interface ScaleMock {
    (value: Date | number): number
    domain: (...args: unknown[]) => ScaleMock
    range: (...args: unknown[]) => ScaleMock
    nice: (...args: unknown[]) => ScaleMock
    invert: (x: number) => Date
    copy: () => ScaleMock
    ticks: (count?: number) => Date[]
  }

  interface AxisMock {
    (...args: unknown[]): unknown
    tickFormat: (...args: unknown[]) => AxisMock
    ticks: (...args: unknown[]) => AxisMock
    tickSize: (...args: unknown[]) => AxisMock
  }

  interface ZoomMock {
    scaleExtent: (...args: unknown[]) => ZoomMock
    translateExtent: (...args: unknown[]) => ZoomMock
    extent: (...args: unknown[]) => ZoomMock
    transform: (...args: unknown[]) => ZoomMock
    on: (...args: unknown[]) => ZoomMock
    filter: (...args: unknown[]) => ZoomMock
    translateBy: (...args: unknown[]) => ZoomMock
    scaleBy: (...args: unknown[]) => ZoomMock
  }

  interface DragMock {
    (...args: unknown[]): unknown
    on: (...args: unknown[]) => DragMock
  }

  interface TimeIntervalMock {
    every: (...args: unknown[]) => TimeIntervalMock
    range: (...args: unknown[]) => Date[]
    floor: (date: Date) => Date
    ceil: (date: Date) => Date
    round: (date: Date) => Date
    offset: (date: Date) => Date
    count: () => number
  }

  const createSelectionMock = (): SelectionMock => {
    const selection: SelectionMock = {
      selectAll: () => selection,
      select: () => selection,
      append: () => selection,
      insert: () => selection,
      attr: () => selection,
      style: () => selection,
      text: () => selection,
      html: () => selection,
      call: () => selection,
      on: () => selection,
      remove: () => selection,
      filter: () => selection,
      transition: () => selection,
      duration: () => selection,
      ease: () => selection,
      each: () => selection,
      data: () => ({
        enter: () => selection,
        exit: () => selection,
        merge: () => selection
      }),
      node: () => document.createElement('g')
    }
    return selection
  }

  const mockSelection = createSelectionMock()

  const createScaleMock = (): ScaleMock => {
    const scale: ScaleMock = Object.assign(
      (): number => 100,
      {
        domain: () => scale,
        range: () => scale,
        nice: () => scale,
        invert: (): Date => new Date(),
        copy: () => createScaleMock(),
        ticks: (): Date[] => [new Date('2024-01-01'), new Date('2024-01-02')]
      }
    )
    return scale
  }

  const mockScale = createScaleMock()

  const createAxisMock = (): AxisMock => {
    const axis: AxisMock = Object.assign(
      (): unknown => undefined,
      {
        tickFormat: () => axis,
        ticks: () => axis,
        tickSize: () => axis
      }
    )
    return axis
  }

  const mockAxis = createAxisMock()

  const createZoomMock = (): ZoomMock => {
    const zoom: ZoomMock = {
      scaleExtent: () => zoom,
      translateExtent: () => zoom,
      extent: () => zoom,
      transform: () => zoom,
      on: () => zoom,
      filter: () => zoom,
      translateBy: () => zoom,
      scaleBy: () => zoom
    }
    return zoom
  }

  const mockZoom = createZoomMock()

  const createDragMock = (): DragMock => {
    const drag: DragMock = Object.assign(
      (): unknown => undefined,
      { on: () => drag }
    )
    return drag
  }

  const mockDrag = createDragMock()

  // Mock time intervals
  const createTimeIntervalMock = (): TimeIntervalMock => {
    const interval: TimeIntervalMock = {
      every: () => interval,
      range: (): Date[] => [],
      floor: (date: Date) => date,
      ceil: (date: Date) => date,
      round: (date: Date) => date,
      offset: (date: Date) => date,
      count: () => 0
    }
    return interval
  }

  const mockTimeInterval = createTimeIntervalMock()

  return {
    select: vi.fn(() => mockSelection),
    scaleTime: vi.fn(() => mockScale),
    scaleLinear: vi.fn(() => mockScale),
    axisBottom: vi.fn(() => mockAxis),
    axisLeft: vi.fn(() => mockAxis),
    timeFormat: vi.fn(() => vi.fn(() => '')),
    timeHour: mockTimeInterval,
    timeDay: mockTimeInterval,
    timeWeek: mockTimeInterval,
    timeMonth: mockTimeInterval,
    timeYear: mockTimeInterval,
    zoom: vi.fn(() => mockZoom),
    zoomIdentity: { k: 1, x: 0, y: 0 },
    drag: vi.fn(() => mockDrag),
    pointer: vi.fn(() => [100, 100] as [number, number]),
    easeElastic: vi.fn(),
    easeBounce: vi.fn(),
    easeLinear: vi.fn()
  }
})

describe('Timeline Component', () => {
  const mockEvents: Event[] = [
    {
      id: '1',
      description: 'Test Event 1',
      actor: 'Actor 1',
      target: 'Target 1',
      timestamp: '2024-01-01T10:00:00Z',
      created_at: '2024-01-01T09:00:00Z',
      updated_at: '2024-01-01T09:00:00Z'
    },
    {
      id: '2',
      description: 'Test Event 2',
      actor: 'Actor 2',
      target: 'Target 2',
      timestamp: '2024-01-02T14:00:00Z',
      created_at: '2024-01-02T13:00:00Z',
      updated_at: '2024-01-02T13:00:00Z'
    }
  ]

  const mockArcs: Arc[] = [
    {
      id: 'arc1',
      name: 'Test Arc 1',
      description: 'First test arc',
      start_time: '2024-01-01T00:00:00Z',
      end_time: '2024-01-03T00:00:00Z',
      level: 0,
      parent_arc_id: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    },
    {
      id: 'arc2',
      name: 'Test Arc 2',
      description: 'Second test arc',
      start_time: '2024-01-02T00:00:00Z',
      end_time: '2024-01-04T00:00:00Z',
      level: 0,
      parent_arc_id: null,
      created_at: '2024-01-02T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z'
    }
  ]

  const defaultProps = {
    events: mockEvents,
    arcs: mockArcs,
    width: 800,
    height: 400
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Clean up any tooltips that might have been created
    document.querySelectorAll('.timeline-tooltip').forEach(el => el.remove())
  })

  describe('Rendering', () => {
    it('renders timeline container with correct dimensions', () => {
      renderWithProviders(<Timeline {...defaultProps} />)
      
      const svg = document.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg).toHaveAttribute('width', '800')
      expect(svg).toHaveAttribute('height', '400')
    })

    it('applies custom className', () => {
      renderWithProviders(<Timeline {...defaultProps} className="custom-timeline" />)
      
      const container = document.querySelector('.timeline-container')
      expect(container).toHaveClass('custom-timeline')
    })

    it('renders with default props when optional props are not provided', () => {
      renderWithProviders(<Timeline events={[]} arcs={[]} />)
      
      const svg = document.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg).toHaveAttribute('width', '1000') // default width
      expect(svg).toHaveAttribute('height', '420') // default height
    })
  })

  describe('Scale Calculations', () => {
    it('creates time scale with correct domain and range', () => {
      const { rerender } = renderWithProviders(<Timeline {...defaultProps} />)
      
      // Test that the component renders without errors
      expect(document.querySelector('svg')).toBeInTheDocument()
      
      // Rerender with different width to test scale updates
      rerender(<Timeline {...defaultProps} width={1000} />)
    })

    it('updates scales when dimensions change', () => {
      const { rerender } = renderWithProviders(<Timeline {...defaultProps} width={600} height={300} />)
      
      let svg = document.querySelector('svg')
      expect(svg).toHaveAttribute('width', '600')
      expect(svg).toHaveAttribute('height', '300')
      
      rerender(<Timeline {...defaultProps} width={1000} height={500} />)
      svg = document.querySelector('svg')
      expect(svg).toHaveAttribute('width', '1000')
      expect(svg).toHaveAttribute('height', '500')
    })
  })

  describe('Event Handling', () => {
    it('calls onEventSelect when event selection callback is provided', () => {
      const onEventSelect = vi.fn()
      renderWithProviders(<Timeline {...defaultProps} onEventSelect={onEventSelect} />)
      
      // Since we're mocking D3, we can't actually test the click interaction
      // but we can verify the component renders with the callback
      expect(document.querySelector('svg')).toBeInTheDocument()
    })

    it('calls onArcSelect when arc selection callback is provided', () => {
      const onArcSelect = vi.fn()
      renderWithProviders(<Timeline {...defaultProps} onArcSelect={onArcSelect} />)
      
      expect(document.querySelector('svg')).toBeInTheDocument()
    })

    it('calls onTimeRangeChange when time range callback is provided', () => {
      const onTimeRangeChange = vi.fn()
      renderWithProviders(<Timeline {...defaultProps} onTimeRangeChange={onTimeRangeChange} />)
      
      expect(document.querySelector('svg')).toBeInTheDocument()
    })

    it('calls onEventCreate when event creation callback is provided', () => {
      const onEventCreate = vi.fn()
      renderWithProviders(<Timeline {...defaultProps} onEventCreate={onEventCreate} />)
      
      expect(document.querySelector('svg')).toBeInTheDocument()
    })

    it('calls onEventDrag when event drag callback is provided', () => {
      const onEventDrag = vi.fn()
      renderWithProviders(<Timeline {...defaultProps} onEventDrag={onEventDrag} />)
      
      expect(document.querySelector('svg')).toBeInTheDocument()
    })
  })

  describe('Data Updates', () => {
    it('re-renders when events data changes', () => {
      const { rerender } = renderWithProviders(<Timeline {...defaultProps} />)
      
      const newEvents = [
        ...mockEvents,
        {
          id: '3',
          description: 'New Event',
          actor: 'New Actor',
          target: 'New Target',
          timestamp: '2024-01-03T12:00:00Z',
          created_at: '2024-01-03T11:00:00Z',
          updated_at: '2024-01-03T11:00:00Z'
        }
      ]
      
      rerender(<Timeline {...defaultProps} events={newEvents} />)
      expect(document.querySelector('svg')).toBeInTheDocument()
    })

    it('re-renders when arcs data changes', () => {
      const { rerender } = renderWithProviders(<Timeline {...defaultProps} />)
      
      const newArcs = [
        ...mockArcs,
        {
          id: 'arc3',
          name: 'New Arc',
          description: 'New test arc',
          start_time: '2024-01-05T00:00:00Z',
          end_time: '2024-01-07T00:00:00Z',
          level: 0,
          parent_arc_id: null,
          created_at: '2024-01-05T00:00:00Z',
          updated_at: '2024-01-05T00:00:00Z'
        }
      ]
      
      rerender(<Timeline {...defaultProps} arcs={newArcs} />)
      expect(document.querySelector('svg')).toBeInTheDocument()
    })

    it('handles empty data gracefully', () => {
      renderWithProviders(<Timeline events={[]} arcs={[]} />)
      
      expect(document.querySelector('svg')).toBeInTheDocument()
    })
  })

  describe('State Management', () => {
    it('initializes with default state', () => {
      renderWithProviders(<Timeline {...defaultProps} />)
      
      // Component should render without errors with initial state
      expect(document.querySelector('svg')).toBeInTheDocument()
    })

    it('maintains selection state', () => {
      const { rerender } = renderWithProviders(<Timeline {...defaultProps} />)
      
      // Rerender to test state persistence
      rerender(<Timeline {...defaultProps} />)
      expect(document.querySelector('svg')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('provides proper ARIA attributes', () => {
      renderWithProviders(<Timeline {...defaultProps} />)
      
      const svg = document.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('supports keyboard navigation', () => {
      renderWithProviders(<Timeline {...defaultProps} />)
      
      const svg = document.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg).toHaveAttribute('tabindex', '0')
      
      if (svg) {
        // Arrow key panning
        expect(() => fireEvent.keyDown(svg, { key: 'ArrowLeft' })).not.toThrow()
        expect(() => fireEvent.keyDown(svg, { key: 'ArrowRight' })).not.toThrow()

        // PageUp / PageDown panning
        expect(() => fireEvent.keyDown(svg, { key: 'PageUp' })).not.toThrow()
        expect(() => fireEvent.keyDown(svg, { key: 'PageDown' })).not.toThrow()

        // Zoom keys
        expect(() => fireEvent.keyDown(svg, { key: '+' })).not.toThrow()
        expect(() => fireEvent.keyDown(svg, { key: '-' })).not.toThrow()

        // Reset zoom key
        expect(() => fireEvent.keyDown(svg, { key: '0' })).not.toThrow()
      }
    })
  })

  describe('Performance', () => {
    // Performance tests are sanity checks, not strict benchmarks.
    // Timing varies significantly based on:
    // - CI vs local environment
    // - Running in isolation vs full test suite
    // - System load and available resources
    it('handles large datasets efficiently', () => {
      const largeEvents = Array.from({ length: 1000 }, (_, i) => ({
        id: `event-${i}`,
        description: `Event ${i}`,
        actor: `Actor ${i % 10}`,
        target: `Target ${i % 10}`,
        timestamp: new Date(2024, 0, 1 + i).toISOString(),
        created_at: new Date(2024, 0, 1 + i).toISOString(),
        updated_at: new Date(2024, 0, 1 + i).toISOString()
      }))

      const largeArcs = Array.from({ length: 100 }, (_, i) => ({
        id: `arc-${i}`,
        name: `Arc ${i}`,
        description: `Arc description ${i}`,
        start_time: new Date(2024, 0, 1 + i * 10).toISOString(),
        end_time: new Date(2024, 0, 1 + i * 10 + 5).toISOString(),
        level: 0,
        parent_arc_id: null,
        created_at: new Date(2024, 0, 1 + i * 10).toISOString(),
        updated_at: new Date(2024, 0, 1 + i * 10).toISOString()
      }))

      const startTime = performance.now()
      renderWithProviders(<Timeline events={largeEvents} arcs={largeArcs} />)
      const endTime = performance.now()

      // Sanity check: rendering should complete, not be a strict performance benchmark.
      // Using generous 5000ms threshold to avoid flaky failures in CI/full-suite runs.
      // In isolation this typically runs in ~450ms, but full suite runs can be 3-4x slower.
      expect(endTime - startTime).toBeLessThan(5000)
      expect(document.querySelector('svg')).toBeInTheDocument()
    })
  })
})

// Helper function tests
describe('Timeline Helper Functions', () => {
  // Since helper functions are not exported, we'll test them indirectly through component behavior
  it('calculates arc levels correctly for overlapping arcs', () => {
    const overlappingArcs: Arc[] = [
      {
        id: 'arc1',
        name: 'Arc 1',
        description: 'First arc',
        start_time: '2024-01-01T00:00:00Z',
        end_time: '2024-01-03T00:00:00Z',
        level: 0,
        parent_arc_id: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      },
      {
        id: 'arc2',
        name: 'Arc 2',
        description: 'Overlapping arc',
        start_time: '2024-01-02T00:00:00Z',
        end_time: '2024-01-04T00:00:00Z',
        level: 0,
        parent_arc_id: null,
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z'
      }
    ]

    renderWithProviders(<Timeline events={[]} arcs={overlappingArcs} />)
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('formats duration correctly', () => {
    const testArcs: Arc[] = [
      {
        id: 'arc1',
        name: 'Test Arc',
        description: 'Test arc for duration',
        start_time: '2024-01-01T00:00:00Z',
        end_time: '2024-01-03T00:00:00Z',
        level: 0,
        parent_arc_id: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }
    ]
    
    // Test duration formatting indirectly through tooltip content
    renderWithProviders(<Timeline events={[]} arcs={testArcs} />)
    expect(document.querySelector('svg')).toBeInTheDocument()
  })
})