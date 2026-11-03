import { describe, it, expect } from 'vitest'
import {
  ARC_BAR_HEIGHT,
  DEFAULT_TIMELINE_MARGIN,
  arcRowY,
  computeTimelineLayout,
  timelineContentHeight,
} from './timelineLayout'
import { TIMELINE_LABEL_CONFIG } from './eventLabelLayout'
import type { Arc } from '@/types'

const arc = (id: string, start: string, end: string, parent: string | null = null): Arc => ({
  id,
  name: id,
  description: id,
  start_time: start,
  end_time: end,
  level: parent ? 1 : 0,
  parent_arc_id: parent,
  created_at: start,
  updated_at: start,
})

describe('computeTimelineLayout', () => {
  it('stacks top-down: arcs, then the event labels, then the track, then the axis', () => {
    const layout = computeTimelineLayout({ maxArcLevel: 1 })
    const lowestBar = arcRowY(1, layout.arcTop) + ARC_BAR_HEIGHT
    const highestLabelTop = layout.eventY + Math.min(...TIMELINE_LABEL_CONFIG.rowOffsets) - TIMELINE_LABEL_CONFIG.fontSize
    // The highest label row clears the lowest arc bar, by a small gap rather than an empty band.
    expect(highestLabelTop).toBeGreaterThan(lowestBar)
    expect(highestLabelTop - lowestBar).toBeLessThanOrEqual(12)
    expect(layout.axisY).toBeGreaterThan(layout.eventY + 20)
    expect(layout.height).toBe(DEFAULT_TIMELINE_MARGIN.top + layout.axisY + DEFAULT_TIMELINE_MARGIN.bottom)
  })

  it('grows by one row pitch per arc level', () => {
    const one = computeTimelineLayout({ maxArcLevel: 0 })
    const two = computeTimelineLayout({ maxArcLevel: 1 })
    expect(two.eventY - one.eventY).toBe(arcRowY(1, 0) - arcRowY(0, 0))
    expect(two.height - one.height).toBe(two.eventY - one.eventY)
  })

  it('reserves a band for the divergence landmark and a lane for the baseline', () => {
    const plain = computeTimelineLayout({ maxArcLevel: 0 })
    const branch = computeTimelineLayout({ maxArcLevel: 0, hasGhostLane: true, hasDivergence: true })
    expect(branch.arcTop).toBeGreaterThan(plain.arcTop)
    expect(plain.ghostY).toBeNull()
    expect(branch.ghostY).toBeGreaterThan(branch.eventY + 20)
    expect(branch.axisY).toBeGreaterThan(branch.ghostY!)
  })

  it('keeps a usable minimum with no arcs', () => {
    const empty = computeTimelineLayout({ maxArcLevel: -1 })
    expect(empty.eventY).toBeGreaterThan(0)
    expect(empty.axisY).toBeGreaterThan(empty.eventY)
  })
})

describe('timelineContentHeight', () => {
  it('counts the overlap rows of top-level arcs, but not collapsed children', () => {
    const single = timelineContentHeight([arc('a', '2024-01-01', '2024-03-01')])
    const overlapping = timelineContentHeight([
      arc('a', '2024-01-01', '2024-03-01'),
      arc('b', '2024-02-01', '2024-04-01'),
    ])
    const withChild = timelineContentHeight([
      arc('a', '2024-01-01', '2024-03-01'),
      arc('child', '2024-01-10', '2024-01-20', 'a'),
    ])
    expect(overlapping).toBeGreaterThan(single)
    expect(withChild).toBe(single)
    expect(single).toBe(computeTimelineLayout({ maxArcLevel: 0 }).height)
  })

  it('adds the ghost lane and divergence band for a branch', () => {
    const arcs = [arc('a', '2024-01-01', '2024-03-01')]
    expect(timelineContentHeight(arcs, { ghost: true, divergence: true })).toBeGreaterThan(timelineContentHeight(arcs))
    expect(timelineContentHeight([])).toBe(computeTimelineLayout({ maxArcLevel: -1 }).height)
  })
})
