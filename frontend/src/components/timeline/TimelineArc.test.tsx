/**
 * The arc mark: one focusable, selectable button per arc, with the edge
 * handles and the disclosure kept as pointer-only affordances.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimelineArc } from './TimelineArc'
import type { ArcWithUIState } from './arcHierarchyUtils'

const arc: ArcWithUIState = {
  id: 'arc-1',
  name: 'Building the Engine',
  description: 'Babbage completes the Analytical Engine',
  start_time: '1843-01-01T00:00:00Z',
  end_time: '1850-01-01T00:00:00Z',
  level: 0,
  parent_arc_id: null,
  created_at: '1843-01-01T00:00:00Z',
  updated_at: '1843-01-01T00:00:00Z',
  isExpanded: false,
  isSelected: false,
  renderLevel: 0,
  containedEvents: [],
  childArcs: [],
  parentArc: null,
  eventCount: 3,
  duration: 0,
}

const withChild: ArcWithUIState = { ...arc, childArcs: [{ ...arc, id: 'child', name: 'Child', parent_arc_id: 'arc-1' }] }

const renderArc = (props: Partial<React.ComponentProps<typeof TimelineArc>> = {}) =>
  render(
    <svg>
      <TimelineArc arc={arc} x={20} y={30} width={300} {...props} />
    </svg>
  )

describe('TimelineArc', () => {
  it('is one button named by the arc, its dates and its event count', () => {
    renderArc()
    const mark = screen.getByRole('button')
    expect(mark).toHaveAccessibleName('Arc: Building the Engine, Jan 1, 1843 – Jan 1, 1850, 3 events')
    expect(mark).toHaveAttribute('tabindex', '0')
    // The handles are pointer affordances, not separate controls.
    document.querySelectorAll('[data-resize-edge]').forEach(handle => {
      expect(handle).toHaveAttribute('aria-hidden', 'true')
      expect(handle).not.toHaveAttribute('tabindex')
    })
  })

  it('selects with a click, Enter or Space', () => {
    const onClick = vi.fn()
    renderArc({ onClick })
    const mark = screen.getByRole('button')
    fireEvent.click(mark.querySelector('.arc-main')!)
    fireEvent.keyDown(mark, { key: 'Enter' })
    const notPrevented = fireEvent.keyDown(mark, { key: ' ' })
    expect(onClick).toHaveBeenCalledTimes(3)
    expect(notPrevented).toBe(false)
  })

  it('expands with Shift+Enter, and the disclosure click does not also select', () => {
    const onClick = vi.fn()
    const onToggleExpand = vi.fn()
    renderArc({ arc: withChild, onClick, onToggleExpand })
    const mark = screen.getByRole('button', { name: /1 sub-arc, collapsed/ })
    expect(mark).toHaveAttribute('aria-keyshortcuts', 'Enter Shift+Enter')

    fireEvent.keyDown(mark, { key: 'Enter', shiftKey: true })
    fireEvent.click(document.querySelector('[data-arc-toggle="arc-1"]')!)
    expect(onToggleExpand).toHaveBeenCalledTimes(2)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('labels at 12px and cuts the name to the bar, dropping it when there is no room', () => {
    const { rerender } = renderArc()
    expect(document.querySelector('.arc-label')).toHaveAttribute('font-size', '12')
    expect(document.querySelector('.arc-label')).toHaveTextContent('Building the Engine')

    rerender(
      <svg>
        <TimelineArc arc={arc} x={20} y={30} width={60} />
      </svg>
    )
    expect(document.querySelector('.arc-label')?.textContent).toMatch(/…$/)

    rerender(
      <svg>
        <TimelineArc arc={arc} x={20} y={30} width={12} />
      </svg>
    )
    expect(document.querySelector('.arc-label')).toBeNull()
    // Still named for assistive tech.
    expect(screen.getByRole('button')).toHaveAccessibleName(/Building the Engine/)
  })

  it('keeps its label in view when the bar starts off the left edge', () => {
    renderArc({ x: -100, width: 400 })
    expect(document.querySelector('.arc-label')).toHaveAttribute('x', '4')
  })
})
