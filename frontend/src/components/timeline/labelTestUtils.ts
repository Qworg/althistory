/** Geometry checks for the labels the timeline draws, shared by its component tests. */
import { expect } from 'vitest'

export interface Box {
  left: number
  right: number
  top: number
  bottom: number
  /** The vertical hairline that joins the label to its mark, when it has one. */
  leader?: { x: number; top: number; bottom: number }
}

/** Every drawn event label's box, as the layout measures it (0.56 em a character), by event id. */
export function labelBoxes(container: HTMLElement): Map<string, Box> {
  const first = container.querySelector('[data-event-id]')!
  const eventY = Number(/translate\(\s*[-\d.e]+\s*,\s*([-\d.e]+)\)/.exec(first.getAttribute('transform')!)![1])
  return new Map(
    Array.from(container.querySelectorAll<SVGTextElement>('[data-event-id] text.event-label')).map((text) => {
      const mark = text.closest('[data-event-id]')!
      const x = Number(/translate\(\s*([-\d.e]+)/.exec(mark.getAttribute('transform')!)![1]) + Number(text.getAttribute('x') ?? 0)
      const width = text.textContent!.length * 12 * 0.56
      const anchor = text.getAttribute('text-anchor')
      const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2
      const baseline = eventY + Number(text.getAttribute('y'))
      const id = mark.getAttribute('data-event-id')!
      const line = container.querySelector(`line.event-label-leader[data-leader-for="${id}"]`)
      const [ly1, ly2] = [Number(line?.getAttribute('y1')), Number(line?.getAttribute('y2'))]
      const leader = line && ly1 !== ly2 ? { x: Number(line.getAttribute('x1')), top: Math.min(ly1, ly2), bottom: Math.max(ly1, ly2) } : undefined
      return [id, { left, right: left + width, top: baseline - 9.6, bottom: baseline + 3, ...(leader ? { leader } : {}) }]
    })
  )
}

const area = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

/**
 * What the selection's plate must hold to, whether or not one was drawn:
 * every label is fully shown or fully hidden (none is left as a fragment);
 * a label the plate hides was touched by it or had its leader through it; a
 * label that stays is not touched by the plate; no highlighted or traced label is hidden; the
 * plate is on a card, after every mark, inside the plot, and hangs from its
 * mark by a leader drawn beneath the marks and labels.
 */
export function expectPlateClean(container: HTMLElement, id: string, before: Map<string, Box>, protectedIds: readonly string[] = [], svgWidth = 1000) {
  const after = labelBoxes(container)
  const pinned = container.querySelector(`[data-pinned-label-for="${id}"]`)
  for (const key of before.keys()) {
    // Position and size (a leader's reach follows its mark's radius, which a selection changes).
    if (after.has(key)) expect({ ...after.get(key)!, leader: undefined }, `${key} was moved`).toEqual({ ...before.get(key)!, leader: undefined })
  }
  if (!pinned) {
    // No plate: nothing is hidden for it.
    for (const key of before.keys()) expect(after.has(key), `${key} vanished with no plate`).toBe(true)
    return
  }
  const rect = pinned.querySelector('rect.event-label-plate')!
  const plate: Box = {
    left: Number(rect.getAttribute('x')),
    right: Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')),
    top: Number(rect.getAttribute('y')),
    bottom: Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')),
  }
  expect(rect.getAttribute('style')).toContain('var(--surface-card)')
  const text = pinned.querySelector('text')!
  expect(text.getAttribute('style')).toContain('var(--accent-selected)')
  expect(text.getAttribute('font-weight')).toBe('600')
  const marks = Array.from(container.querySelectorAll('[data-event-id]'))
  expect(pinned.parentElement!.compareDocumentPosition(marks[marks.length - 1]!) & Node.DOCUMENT_POSITION_PRECEDING, 'drawn after every mark').toBeTruthy()
  // Every plate keeps its leader, in the accent, drawn beneath every mark and label.
  const hang = container.querySelector(`line[data-pinned-leader-for="${id}"]`)
  expect(hang, `${id}'s plate has a leader`).not.toBeNull()
  expect(hang!.getAttribute('stroke')).toBe('var(--accent-selected)')
  expect(hang!.compareDocumentPosition(marks[0]!) & Node.DOCUMENT_POSITION_FOLLOWING, 'its leader is drawn beneath the marks and labels').toBeTruthy()
  expect(Number(hang!.getAttribute('x1'))).toBeGreaterThanOrEqual(plate.left)
  expect(Number(hang!.getAttribute('x1'))).toBeLessThanOrEqual(plate.right)
  const innerWidth = svgWidth - 56 - 16
  expect(plate.left + 3, `${id} runs off the left`).toBeGreaterThanOrEqual(-0.001)
  expect(plate.right - 3, `${id} runs off the right`).toBeLessThanOrEqual(innerWidth + 0.001)
  for (const [key, box] of before) {
    const covered = area(plate, box) / ((box.right - box.left) * (box.bottom - box.top))
    if (after.has(key)) expect(covered, `${key} is covered by the plate but still drawn`).toBe(0)
    else {
      // The plate covers it (half or more, or the little it touches when nothing else fit), or its own leader runs
      // through the plate: then it is hidden whole, text and leader. Nothing else is hidden.
      const lead = box.leader
      const leaderThrough = lead !== undefined && lead.x >= plate.left && lead.x <= plate.right && lead.bottom > plate.top && lead.top < plate.bottom
      expect(covered > 0 || leaderThrough, `${key} was hidden though the plate neither covers it nor has its leader through it`).toBe(true)
      expect(protectedIds, `${key} is protected`).not.toContain(key)
    }
  }
  // No kept label's leader runs through the plate: it would look joined to another mark.
  for (const leader of Array.from(container.querySelectorAll('line.event-label-leader'))) {
    const [ly1, ly2] = [Number(leader.getAttribute('y1')), Number(leader.getAttribute('y2'))]
    if (ly1 === ly2) continue
    const lx = Number(leader.getAttribute('x1'))
    const through = lx >= plate.left && lx <= plate.right && Math.max(ly1, ly2) > plate.top && Math.min(ly1, ly2) < plate.bottom
    expect(through, `the leader of ${leader.getAttribute('data-leader-for')} runs through the plate of ${id}`).toBe(false)
  }
}
