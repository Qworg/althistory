import { useEffect } from 'react'
import { useGlobalStore } from '@/stores/globalStore'

/**
 * Below 1024 px the selection inspector is a bottom sheet over the page. It can
 * cover the very mark that was just selected, so a new selection scrolls the
 * page until the mark (and as much of its trace as fits) sits above the sheet.
 */

/** A vertical span in viewport coordinates (`getBoundingClientRect` top/bottom). */
export interface Span {
  top: number
  bottom: number
}

/** Space kept between a revealed mark and the header or sheet edge. */
export const REVEAL_MARGIN_PX = 12

/**
 * How far to scroll the page (positive = down, content moves up) so that the
 * selected mark is clear of the sheet.
 *
 * The visible band is the strip between the sticky header's bottom and the
 * sheet's top, less a margin. 0 when the mark is already inside it. Otherwise
 * the smallest scroll that brings the whole trace (the selected mark plus every
 * traced mark) into the band; when the trace is taller than the band, the
 * trace's top is aligned to the band's top, but never at the cost of the
 * selected mark leaving the band.
 */
export function revealScrollDelta(
  selected: Span,
  trace: Span | null,
  headerBottom: number,
  sheetTop: number,
  margin: number = REVEAL_MARGIN_PX,
): number {
  const lo = headerBottom + margin
  const hi = sheetTop - margin
  if (hi <= lo) return 0
  if (selected.top >= lo && selected.bottom <= hi) return 0

  const want: Span = trace
    ? { top: Math.min(selected.top, trace.top), bottom: Math.max(selected.bottom, trace.bottom) }
    : selected

  if (want.bottom - want.top <= hi - lo) {
    if (want.top < lo) return want.top - lo
    if (want.bottom > hi) return want.bottom - hi
    return 0
  }
  // Too tall: align the trace's top, then keep the selected mark above the sheet.
  let delta = want.top - lo
  if (selected.bottom - delta > hi) delta = selected.bottom - hi
  return delta
}

/** The view pads its bottom by this, so there is room to scroll past the sheet. */
function clearSheetSpace(): void {
  document.documentElement.style.removeProperty('--inspector-sheet-h')
}

function isScrollable(el: Element): boolean {
  const overflowY = getComputedStyle(el).overflowY
  return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight
}

function scrollParent(el: Element): HTMLElement | null {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    if (isScrollable(node)) return node
  }
  return null
}

function reduceMotion(): boolean {
  if (useGlobalStore.getState().userPreferences.accessibility?.reducedMotion) return true
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Scroll so the selected event's mark clears the docked sheet. Does nothing on
 * a layout where the inspector is a side panel or sits under the canvas (the
 * sheet is then not `position: fixed`), and nothing when the mark is already
 * visible above the sheet. Returns whether it scrolled.
 */
export function revealSelectedMark(eventId: string): boolean {
  const sheet = document.querySelector<HTMLElement>('aside[aria-label="Selection"]')
  if (!sheet || getComputedStyle(sheet).position !== 'fixed') {
    clearSheetSpace()
    return false
  }
  // The sheet is over the page, so the page needs room to scroll the mark up
  // past it, even when its content is shorter than the viewport.
  document.documentElement.style.setProperty('--inspector-sheet-h', `${Math.ceil(sheet.getBoundingClientRect().height)}px`)

  const mark = Array.from(document.querySelectorAll<SVGGElement>('g[data-timeline-mark="event"]')).find(
    (node) => node.getAttribute('data-event-id') === eventId,
  )
  if (!mark) return false

  const rect = mark.getBoundingClientRect()
  const selected: Span = { top: rect.top, bottom: rect.bottom }

  let trace: Span | null = null
  const canvas = mark.closest('svg')
  const traced = canvas?.querySelectorAll<SVGGElement>('g[data-timeline-mark="event"][data-traced="true"]') ?? []
  for (const node of Array.from(traced)) {
    const r = node.getBoundingClientRect()
    trace = {
      top: trace ? Math.min(trace.top, r.top) : r.top,
      bottom: trace ? Math.max(trace.bottom, r.bottom) : r.bottom,
    }
  }

  const header = document.querySelector('header')
  const headerBottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0
  const delta = revealScrollDelta(selected, trace, headerBottom, sheet.getBoundingClientRect().top)
  if (Math.abs(delta) < 1) return false

  const behavior: ScrollBehavior = reduceMotion() ? 'auto' : 'smooth'
  const parent = scrollParent(mark)
  if (parent) parent.scrollBy({ top: delta, behavior })
  else window.scrollBy({ top: delta, behavior })
  return true
}

/**
 * Reveal the selected event whenever the selection changes. The sheet's height
 * settles after the selection renders (its content loads), so the check runs
 * again while the sheet resizes during a short window; it scrolls only if the
 * mark is still covered, so it never fights the person who has started to
 * scroll on their own.
 */
export function useRevealSelectionAboveSheet(selectedEventId: string | null): void {
  // The room kept for the sheet goes when the view does.
  useEffect(() => clearSheetSpace, [])

  useEffect(() => {
    if (!selectedEventId) {
      clearSheetSpace()
      return
    }
    let userMoved = false
    const stop = () => {
      userMoved = true
    }
    const run = () => {
      if (!userMoved) revealSelectedMark(selectedEventId)
    }

    const frame = requestAnimationFrame(run)
    window.addEventListener('wheel', stop, { passive: true })
    window.addEventListener('touchstart', stop, { passive: true })

    let observer: ResizeObserver | undefined
    const sheet = document.querySelector('aside[aria-label="Selection"]')
    if (sheet && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(run)
      observer.observe(sheet)
    }
    const settle = window.setTimeout(() => observer?.disconnect(), 1000)

    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(settle)
      observer?.disconnect()
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchstart', stop)
    }
  }, [selectedEventId])
}
