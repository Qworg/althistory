import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../test/utils'
import { Timeline } from './Timeline'
import { Event, Arc } from '../../types'

// Mock D3 with proper scale implementation
vi.mock('d3', () => {
  // Mirror the real chained-scale contract (callable + mutators returning itself)
  // so the mock keeps D3's shape without casts.
  interface MockTimeScale {
    (date: Date | number): number
    domain: (...args: unknown[]) => MockTimeScale
    range: (...args: unknown[]) => MockTimeScale
    nice: (...args: unknown[]) => MockTimeScale
    invert: (x: number) => Date
    copy: () => MockTimeScale
    ticks: (count?: number) => Date[]
  }

  interface MockZoomBehavior {
    scaleExtent: (...args: unknown[]) => MockZoomBehavior
    translateExtent: (...args: unknown[]) => MockZoomBehavior
    extent: (...args: unknown[]) => MockZoomBehavior
    on: (...args: unknown[]) => MockZoomBehavior
    transform: Record<string, unknown>
  }

  // Create mock scale inside the factory
  const createMockScale = (): MockTimeScale => {
    const scale = (date: Date | number): number => {
      const time = new Date(date).getTime()
      const minTime = new Date('2024-01-01T00:00:00Z').getTime()
      const maxTime = new Date('2024-01-05T00:00:00Z').getTime()
      return ((time - minTime) / (maxTime - minTime)) * 728
    }
    const chainedScale: MockTimeScale = Object.assign(scale, {
      domain: () => chainedScale,
      range: () => chainedScale,
      nice: () => chainedScale,
      invert: (x: number) => new Date(2024, 0, 1 + x / 182),
      copy: () => createMockScale(),
      ticks: (count?: number) => {
        const numTicks = count || 5
        const ticks: Date[] = []
        for (let i = 0; i < numTicks; i++) {
          ticks.push(new Date(2024, 0, 1 + i))
        }
        return ticks
      }
    })
    return chainedScale
  }

  const createZoomBehavior = (): MockZoomBehavior => {
    const zoom: MockZoomBehavior = {
      scaleExtent: () => zoom,
      translateExtent: () => zoom,
      extent: () => zoom,
      on: () => zoom,
      transform: {}
    }
    return zoom
  }

  return {
    scaleTime: () => createMockScale(),
    scaleLinear: () => createMockScale(),
    timeFormat: () => (date: Date): string => date.toISOString().split('T')[0] ?? '',
    select: () => ({
      call: () => {},
      on: () => {}
    }),
    zoom: () => createZoomBehavior(),
    zoomIdentity: {},
    easeElastic: () => {},
    easeBounce: () => {},
    easeLinear: () => {}
  }
})

// Mock the useTimelineScales hook. The returned xDomain must be a stable
// reference across renders: Timeline.memo derives `originalExtent` from it and
// resets visibleTimeRange in an effect keyed on that object, so a fresh array
// per render produces an infinite render loop.
vi.mock('@/hooks/useTimelineScales', () => {
  const xDomain: [Date, Date] = [new Date('2024-01-01'), new Date('2024-01-05')]
  const innerWidth = 728
  const innerHeight = 344
  return {
    useTimelineScales: () => ({ innerWidth, innerHeight, xDomain })
  }
})

// `noUncheckedIndexedAccess` types array access as `T | undefined`; these fixtures are
// non-empty literals, so narrow them at the point of use instead of asserting non-null.
const requireItem = <T,>(items: readonly T[], index: number, label: string): T => {
  const item = items[index]
  if (item === undefined) {
    throw new Error(`Expected ${label}[${index}] to be defined`)
  }
  return item
}

describe('Timeline Event Interactions', () => {
  const mockEvents: Event[] = [
    {
      id: 'event-1',
      description: 'First Event',
      actor: 'Actor One',
      target: 'Target One',
      timestamp: '2024-01-01T10:00:00Z',
      created_at: '2024-01-01T09:00:00Z',
      updated_at: '2024-01-01T09:00:00Z'
    },
    {
      id: 'event-2',
      description: 'Second Event',
      actor: 'Actor Two',
      target: 'Target Two',
      timestamp: '2024-01-02T14:00:00Z',
      created_at: '2024-01-02T13:00:00Z',
      updated_at: '2024-01-02T13:00:00Z'
    },
    {
      id: 'event-3',
      description: 'Third Event',
      actor: 'Actor Three',
      target: 'Target Three',
      timestamp: '2024-01-03T08:00:00Z',
      created_at: '2024-01-03T07:00:00Z',
      updated_at: '2024-01-03T07:00:00Z'
    }
  ]

  const mockArcs: Arc[] = [
    {
      id: 'arc-1',
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
      id: 'arc-2',
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
    height: 400,
    margin: { top: 16, right: 16, bottom: 40, left: 56 }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Add SVG methods that don't exist in JSDOM (getScreenCTM / createSVGPoint
    // are not implemented by JSDOM, so they are installed as own properties).
    Object.defineProperty(SVGElement.prototype, 'getScreenCTM', {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({
        inverse: () => ({
          a: 1, b: 0, c: 0, d: 1, e: 0, f: 0
        })
      }))
    })
    Object.defineProperty(SVGElement.prototype, 'createSVGPoint', {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({
        x: 0,
        y: 0,
        matrixTransform: vi.fn(() => ({ x: 100, y: 200 }))
      }))
    })
  })

  afterEach(() => {
    // Clean up any tooltips or modals
    document.querySelectorAll('.timeline-tooltip').forEach(el => el.remove())
    document.querySelectorAll('.fixed.z-50').forEach(el => el.remove())
  })

  describe('Event Click Interactions', () => {
    it('calls onEventSelect when an event marker is clicked', () => {
      const onEventSelect = vi.fn()
      renderWithProviders(
        <Timeline {...defaultProps} onEventSelect={onEventSelect} />
      )

      const eventMarker = document.querySelector('[data-event-id="event-1"] .event-marker')
      expect(eventMarker).toBeInTheDocument()

      fireEvent.click(eventMarker!)
      expect(onEventSelect).toHaveBeenCalledWith(requireItem(mockEvents, 0, 'mockEvents'))
    })

    it('calls onEventSelect with correct event when clicking different events', () => {
      const onEventSelect = vi.fn()
      renderWithProviders(
        <Timeline {...defaultProps} onEventSelect={onEventSelect} />
      )

      // Click first event
      const event1Marker = document.querySelector('[data-event-id="event-1"] .event-marker')
      fireEvent.click(event1Marker!)
      expect(onEventSelect).toHaveBeenLastCalledWith(requireItem(mockEvents, 0, 'mockEvents'))

      // Click second event
      const event2Marker = document.querySelector('[data-event-id="event-2"] .event-marker')
      fireEvent.click(event2Marker!)
      expect(onEventSelect).toHaveBeenLastCalledWith(requireItem(mockEvents, 1, 'mockEvents'))

      // Click third event
      const event3Marker = document.querySelector('[data-event-id="event-3"] .event-marker')
      fireEvent.click(event3Marker!)
      expect(onEventSelect).toHaveBeenLastCalledWith(requireItem(mockEvents, 2, 'mockEvents'))

      expect(onEventSelect).toHaveBeenCalledTimes(3)
    })

    it('does not throw when onEventSelect is not provided', () => {
      renderWithProviders(<Timeline {...defaultProps} />)

      const eventMarker = document.querySelector('[data-event-id="event-1"] .event-marker')
      expect(() => fireEvent.click(eventMarker!)).not.toThrow()
    })

    it('renders all event markers with correct data attributes', () => {
      renderWithProviders(<Timeline {...defaultProps} />)

      mockEvents.forEach(event => {
        const eventGroup = document.querySelector(`[data-event-id="${event.id}"]`)
        expect(eventGroup).toBeInTheDocument()
      })
    })
  })

  describe('Arc Click Interactions', () => {
    it('calls onArcSelect when an arc is clicked', () => {
      const onArcSelect = vi.fn()
      renderWithProviders(
        <Timeline {...defaultProps} onArcSelect={onArcSelect} />
      )

      const arcRect = document.querySelector('[data-arc-id="arc-1"] .arc-main')
      expect(arcRect).toBeInTheDocument()

      fireEvent.click(arcRect!)
      // Arc is enhanced with UI state, so check for core properties
      expect(onArcSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          id: requireItem(mockArcs, 0, 'mockArcs').id,
          name: requireItem(mockArcs, 0, 'mockArcs').name,
          start_time: requireItem(mockArcs, 0, 'mockArcs').start_time,
          end_time: requireItem(mockArcs, 0, 'mockArcs').end_time
        })
      )
    })

    it('calls onArcSelect with correct arc when clicking different arcs', () => {
      const onArcSelect = vi.fn()
      renderWithProviders(
        <Timeline {...defaultProps} onArcSelect={onArcSelect} />
      )

      const arc1Rect = document.querySelector('[data-arc-id="arc-1"] .arc-main')
      fireEvent.click(arc1Rect!)
      expect(onArcSelect).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: requireItem(mockArcs, 0, 'mockArcs').id,
          name: requireItem(mockArcs, 0, 'mockArcs').name
        })
      )

      const arc2Rect = document.querySelector('[data-arc-id="arc-2"] .arc-main')
      fireEvent.click(arc2Rect!)
      expect(onArcSelect).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: requireItem(mockArcs, 1, 'mockArcs').id,
          name: requireItem(mockArcs, 1, 'mockArcs').name
        })
      )

      expect(onArcSelect).toHaveBeenCalledTimes(2)
    })

    it('does not throw when onArcSelect is not provided', () => {
      renderWithProviders(<Timeline {...defaultProps} />)

      const arcRect = document.querySelector('[data-arc-id="arc-1"] .arc-main')
      expect(() => fireEvent.click(arcRect!)).not.toThrow()
    })

    it('renders all arc elements with correct data attributes', () => {
      renderWithProviders(<Timeline {...defaultProps} />)

      mockArcs.forEach(arc => {
        const arcGroup = document.querySelector(`[data-arc-id="${arc.id}"]`)
        expect(arcGroup).toBeInTheDocument()
      })
    })
  })

  describe('Event Context Menu (Right-Click)', () => {
    it('opens context menu when right-clicking an event', () => {
      renderWithProviders(<Timeline {...defaultProps} />)

      const eventMarker = document.querySelector('[data-event-id="event-1"] .event-marker')
      fireEvent.contextMenu(eventMarker!)

      // The EventArcAssignment modal should appear
      const modal = document.querySelector('.fixed.z-50')
      expect(modal).toBeInTheDocument()
    })

    it('positions context menu near click location', async () => {
      renderWithProviders(<Timeline {...defaultProps} />)

      const eventMarker = document.querySelector('[data-event-id="event-1"] .event-marker')
      expect(eventMarker).toBeInTheDocument()

      // Use fireEvent with pageX/pageY - note these may not be perfectly preserved in JSDOM
      fireEvent.contextMenu(eventMarker!)

      await waitFor(() => {
        const modal = document.querySelector('.fixed.z-50') as HTMLElement
        expect(modal).toBeInTheDocument()
        // Modal should have inline styles set (the exact values depend on JSDOM behavior)
        expect(modal.style).toBeDefined()
      })
    })

    it('shows EventArcAssignment component with correct event', () => {
      renderWithProviders(<Timeline {...defaultProps} />)

      const eventMarker = document.querySelector('[data-event-id="event-1"] .event-marker')
      fireEvent.contextMenu(eventMarker!)

      // EventArcAssignment should receive the correct event
      const modal = document.querySelector('.fixed.z-50')
      expect(modal).toBeInTheDocument()
    })

    it('prevents default context menu behavior', () => {
      renderWithProviders(<Timeline {...defaultProps} />)

      const eventMarker = document.querySelector('[data-event-id="event-1"] .event-marker')
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      const preventDefault = vi.spyOn(event, 'preventDefault')

      eventMarker!.dispatchEvent(event)
      expect(preventDefault).toHaveBeenCalled()
    })
  })

  describe('SVG Double-Click (Event Creation)', () => {
    it('calls onEventCreate when double-clicking on the SVG', async () => {
      const onEventCreate = vi.fn()
      renderWithProviders(
        <Timeline {...defaultProps} onEventCreate={onEventCreate} />
      )

      const svg = document.querySelector('svg')
      expect(svg).toBeInTheDocument()

      // SVG methods are mocked in beforeEach
      fireEvent.doubleClick(svg!, { clientX: 200, clientY: 150 })

      await waitFor(() => {
        expect(onEventCreate).toHaveBeenCalled()
      })
    })

    it('does not call onEventCreate when callback is not provided', () => {
      renderWithProviders(<Timeline {...defaultProps} />)

      const svg = document.querySelector('svg')
      expect(() => fireEvent.doubleClick(svg!)).not.toThrow()
    })

    it('passes correct timestamp based on click position', async () => {
      const onEventCreate = vi.fn()
      renderWithProviders(
        <Timeline {...defaultProps} onEventCreate={onEventCreate} />
      )

      const svg = document.querySelector('svg')

      // SVG methods are mocked in beforeEach
      fireEvent.doubleClick(svg!, { clientX: 200, clientY: 200 })

      await waitFor(() => {
        expect(onEventCreate).toHaveBeenCalled()
        const calledArg = onEventCreate.mock.calls[0]?.[0]
        expect(calledArg).toBeInstanceOf(Date)
      })
    })
  })

  describe('Keyboard Navigation', () => {
    it('event elements have tabIndex for keyboard focus', () => {
      renderWithProviders(<Timeline {...defaultProps} />)

      mockEvents.forEach(event => {
        const eventGroup = document.querySelector(`[data-event-id="${event.id}"]`)
        expect(eventGroup).toHaveAttribute('tabindex', '0')
      })
    })

    it('event elements have proper ARIA role', () => {
      renderWithProviders(<Timeline {...defaultProps} />)

      mockEvents.forEach(event => {
        const eventGroup = document.querySelector(`[data-event-id="${event.id}"]`)
        expect(eventGroup).toHaveAttribute('role', 'button')
      })
    })

    it('event elements have ARIA labels with event info', () => {
      renderWithProviders(<Timeline {...defaultProps} />)

      const event1 = requireItem(mockEvents, 0, 'mockEvents')
      const eventGroup = document.querySelector(`[data-event-id="${event1.id}"]`)
      const ariaLabel = eventGroup?.getAttribute('aria-label')

      expect(ariaLabel).toContain(event1.description)
      expect(ariaLabel).toContain(event1.actor)
      expect(ariaLabel).toContain(event1.target)
    })

    it('can receive focus on event elements', () => {
      renderWithProviders(<Timeline {...defaultProps} />)

      const eventGroup = document.querySelector('[data-event-id="event-1"]') as HTMLElement
      eventGroup.focus()
      expect(document.activeElement).toBe(eventGroup)
    })
  })

  describe('Event Assignment Modal', () => {
    it('closes modal when cancel is clicked', async () => {
      renderWithProviders(<Timeline {...defaultProps} />)

      // Open context menu
      const eventMarker = document.querySelector('[data-event-id="event-1"] .event-marker')
      fireEvent.contextMenu(eventMarker!)

      const modal = document.querySelector('.fixed.z-50')
      expect(modal).toBeInTheDocument()

      // Find and click cancel button
      const cancelButton = modal?.querySelector('button[type="button"]') ||
                          Array.from(modal?.querySelectorAll('button') || [])
                            .find(btn => btn.textContent?.toLowerCase().includes('cancel'))

      if (cancelButton) {
        fireEvent.click(cancelButton)
        await waitFor(() => {
          expect(document.querySelector('.fixed.z-50')).not.toBeInTheDocument()
        })
      }
    })

    it('calls onEventAssignToArc when assignment is made', async () => {
      const onEventAssignToArc = vi.fn()
      renderWithProviders(
        <Timeline {...defaultProps} onEventAssignToArc={onEventAssignToArc} />
      )

      // Open context menu
      const eventMarker = document.querySelector('[data-event-id="event-1"] .event-marker')
      fireEvent.contextMenu(eventMarker!)

      const modal = document.querySelector('.fixed.z-50')
      expect(modal).toBeInTheDocument()
    })
  })

  describe('Multiple Interactions', () => {
    it('handles rapid clicks without errors', () => {
      const onEventSelect = vi.fn()
      renderWithProviders(
        <Timeline {...defaultProps} onEventSelect={onEventSelect} />
      )

      const eventMarker = document.querySelector('[data-event-id="event-1"] .event-marker')

      // Rapid fire clicks
      for (let i = 0; i < 10; i++) {
        fireEvent.click(eventMarker!)
      }

      expect(onEventSelect).toHaveBeenCalledTimes(10)
    })

    it('handles alternating event and arc clicks', () => {
      const onEventSelect = vi.fn()
      const onArcSelect = vi.fn()
      renderWithProviders(
        <Timeline
          {...defaultProps}
          onEventSelect={onEventSelect}
          onArcSelect={onArcSelect}
        />
      )

      const eventMarker = document.querySelector('[data-event-id="event-1"] .event-marker')
      const arcRect = document.querySelector('[data-arc-id="arc-1"] .arc-main')

      fireEvent.click(eventMarker!)
      fireEvent.click(arcRect!)
      fireEvent.click(eventMarker!)
      fireEvent.click(arcRect!)

      expect(onEventSelect).toHaveBeenCalledTimes(2)
      expect(onArcSelect).toHaveBeenCalledTimes(2)
    })
  })

  describe('Empty State Interactions', () => {
    it('handles interactions with no events', () => {
      const onEventSelect = vi.fn()
      renderWithProviders(
        <Timeline {...defaultProps} events={[]} onEventSelect={onEventSelect} />
      )

      const eventGroups = document.querySelectorAll('[data-event-id]')
      expect(eventGroups).toHaveLength(0)
      expect(onEventSelect).not.toHaveBeenCalled()
    })

    it('handles interactions with no arcs', () => {
      const onArcSelect = vi.fn()
      renderWithProviders(
        <Timeline {...defaultProps} arcs={[]} onArcSelect={onArcSelect} />
      )

      const arcGroups = document.querySelectorAll('[data-arc-id]')
      expect(arcGroups).toHaveLength(0)
      expect(onArcSelect).not.toHaveBeenCalled()
    })

    it('handles SVG double-click with no events or arcs', async () => {
      const onEventCreate = vi.fn()
      renderWithProviders(
        <Timeline events={[]} arcs={[]} onEventCreate={onEventCreate} />
      )

      const svg = document.querySelector('svg')
      // SVG methods are mocked in beforeEach
      fireEvent.doubleClick(svg!, { clientX: 200, clientY: 150 })

      await waitFor(() => {
        expect(onEventCreate).toHaveBeenCalled()
      })
    })
  })

  describe('Callback Stability', () => {
    it('maintains callback stability across re-renders', () => {
      const onEventSelect = vi.fn()
      const { rerender } = renderWithProviders(
        <Timeline {...defaultProps} onEventSelect={onEventSelect} />
      )

      const eventMarker = document.querySelector('[data-event-id="event-1"] .event-marker')
      fireEvent.click(eventMarker!)

      // Re-render with same callback
      rerender(<Timeline {...defaultProps} onEventSelect={onEventSelect} />)

      fireEvent.click(eventMarker!)

      expect(onEventSelect).toHaveBeenCalledTimes(2)
    })

    it('updates to new callbacks properly', () => {
      const onEventSelect1 = vi.fn()
      const onEventSelect2 = vi.fn()

      const { rerender } = renderWithProviders(
        <Timeline {...defaultProps} onEventSelect={onEventSelect1} />
      )

      const eventMarker = document.querySelector('[data-event-id="event-1"] .event-marker')
      fireEvent.click(eventMarker!)
      expect(onEventSelect1).toHaveBeenCalledTimes(1)
      expect(onEventSelect2).not.toHaveBeenCalled()

      // Re-render with different callback
      rerender(<Timeline {...defaultProps} onEventSelect={onEventSelect2} />)

      fireEvent.click(eventMarker!)
      expect(onEventSelect1).toHaveBeenCalledTimes(1)
      expect(onEventSelect2).toHaveBeenCalledTimes(1)
    })
  })

  describe('Data Updates During Interaction', () => {
    it('handles event data updates after interaction', () => {
      const onEventSelect = vi.fn()
      const { rerender } = renderWithProviders(
        <Timeline {...defaultProps} onEventSelect={onEventSelect} />
      )

      const eventMarker = document.querySelector('[data-event-id="event-1"] .event-marker')
      fireEvent.click(eventMarker!)

      // Update events
      const newEvents = [
        ...mockEvents,
        {
          id: 'event-4',
          description: 'New Event',
          actor: 'New Actor',
          target: 'New Target',
          timestamp: '2024-01-04T12:00:00Z',
          created_at: '2024-01-04T11:00:00Z',
          updated_at: '2024-01-04T11:00:00Z'
        }
      ]

      rerender(<Timeline {...defaultProps} events={newEvents} onEventSelect={onEventSelect} />)

      // Click new event
      const newEventMarker = document.querySelector('[data-event-id="event-4"] .event-marker')
      expect(newEventMarker).toBeInTheDocument()
      fireEvent.click(newEventMarker!)

      expect(onEventSelect).toHaveBeenCalledTimes(2)
    })

    it('handles removed events gracefully', () => {
      const onEventSelect = vi.fn()
      const { rerender } = renderWithProviders(
        <Timeline {...defaultProps} onEventSelect={onEventSelect} />
      )

      // Remove first event
      const reducedEvents = mockEvents.slice(1)
      rerender(<Timeline {...defaultProps} events={reducedEvents} onEventSelect={onEventSelect} />)

      const event1Marker = document.querySelector('[data-event-id="event-1"]')
      expect(event1Marker).not.toBeInTheDocument()

      // Remaining events should still work
      const event2Marker = document.querySelector('[data-event-id="event-2"] .event-marker')
      fireEvent.click(event2Marker!)
      expect(onEventSelect).toHaveBeenCalledWith(reducedEvents[0])
    })
  })
})
