/** Geometry checks for the labels the timeline draws, shared by its component tests. */
import { expect } from 'vitest'

export interface Box {
  left: number
  right: number
  top: number
  bottom: number
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
      return [mark.getAttribute('data-event-id')!, { left, right: left + width, top: baseline - 9.6, bottom: baseline + 3 }]
    })
  )
}

const area = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

/**
 * What the selection's plate must hold to, whether or not one was drawn:
 * every label is fully shown or fully hidden (none is left as a fragment);
 * a label the plate hides was covered by half or more; a label that stays is
 * not touched by the plate; no highlighted or traced label is hidden; the
 * plate is on a card, after every mark, inside the plot, and its leader
 * crosses no label that stays.
 */
export function expectPlateClean(container: HTMLElement, id: string, before: Map<string, Box>, protectedIds: readonly string[] = [], svgWidth = 1000) {
  const after = labelBoxes(container)
  const pinned = container.querySelector(`[data-pinned-label-for="${id}"]`)
  for (const key of before.keys()) {
    if (after.has(key)) expect(after.get(key), `${key} was moved`).toEqual(before.get(key))
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
  const innerWidth = svgWidth - 56 - 16
  expect(plate.left + 3, `${id} runs off the left`).toBeGreaterThanOrEqual(-0.001)
  expect(plate.right - 3, `${id} runs off the right`).toBeLessThanOrEqual(innerWidth + 0.001)
  for (const [key, box] of before) {
    const covered = area(plate, box) / ((box.right - box.left) * (box.bottom - box.top))
    if (after.has(key)) expect(covered, `${key} is covered by the plate but still drawn`).toBe(0)
    else {
      expect(covered, `${key} was hidden though the plate covers little of it`).toBeGreaterThanOrEqual(0.5)
      expect(protectedIds, `${key} is protected`).not.toContain(key)
    }
  }
  const line = pinned.querySelector('line')!
  const [y1, y2] = [Number(line.getAttribute('y1')), Number(line.getAttribute('y2'))].sort((p, q) => p - q) as [number, number]
  const lx = Number(line.getAttribute('x1'))
  for (const [key, box] of after) {
    expect(lx >= box.left - 1 && lx <= box.right + 1 && box.bottom > y1 && box.top < y2, `the leader crosses ${key}`).toBe(false)
  }
}

