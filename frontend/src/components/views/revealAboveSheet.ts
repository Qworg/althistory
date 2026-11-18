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
 * sheet's top, less a margin. 0 when the mark is already inside it (unless its trace would fit the band and is partly cut: then that is brought in). Otherwise
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
  headerRestBottom: number = headerBottom,
): number {
  // Scrolling down, the header ends up stuck at `headerRestBottom`, which can be
  // well above where it is now (a banner above it scrolls away first). Scrolling
  // up, it is where it is.
  const down = bandDelta(selected, trace, Math.min(headerBottom, headerRestBottom), sheetTop, margin)
  if (down > 0) return down
  return bandDelta(selected, trace, headerBottom, sheetTop, margin)
}

function bandDelta(selected: Span, trace: Span | null, headerBottom: number, sheetTop: number, margin: number): number {
  const lo = headerBottom + margin
  const hi = sheetTop - margin
  if (hi <= lo) return 0
  const want: Span = trace
    ? { top: Math.min(selected.top, trace.top), bottom: Math.max(selected.bottom, trace.bottom) }
    : selected
  const wantFits = want.bottom - want.top <= hi - lo
  const markVisible = selected.top >= lo && selected.bottom <= hi
  // A visible mark is left alone unless its whole trace would fit once scrolled
  // and is now partly under the sheet (or the header): then nudge it into view.
  if (markVisible && (!wantFits || (want.top >= lo && want.bottom <= hi))) return 0

  if (wantFits) {
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

  // The dot, not the whole group: its stem and label can run well past it.
  const rect = (mark.querySelector('.event-hit-area') ?? mark).getBoundingClientRect()
  const selected: Span = { top: rect.top, bottom: rect.bottom }

  let trace: Span | null = null
  const canvas = mark.closest('svg')
  // The traced marks and the ripple's link curves, which hang below them.
  const traced = canvas?.querySelectorAll<SVGGraphicsElement>(
    'g[data-timeline-mark="event"][data-traced="true"], path.timeline-link[data-ripple]',
  ) ?? []
  for (const node of Array.from(traced)) {
    // A traced mark counts by its dot, as the selected one does; labels can be
    // moved aside, and measuring them hid curves that would have fitted.
    const r = (node.querySelector('.event-hit-area') ?? node).getBoundingClientRect()
    trace = {
      top: trace ? Math.min(trace.top, r.top) : r.top,
      bottom: trace ? Math.max(trace.bottom, r.bottom) : r.bottom,
    }
  }

  const header = document.querySelector('header')
  const headerBottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0
  const stickyTop = header ? parseFloat(getComputedStyle(header).top) || 0 : 0
  const headerRest = header ? stickyTop + header.offsetHeight : 0
  const delta = revealScrollDelta(selected, trace, headerBottom, sheet.getBoundingClientRect().top, REVEAL_MARGIN_PX, headerRest)
  if (Math.abs(delta) < 1) return false

  const behavior: ScrollBehavior = reduceMotion() ? 'auto' : 'smooth'
  const parent = scrollParent(mark)
  // The absolute place this scroll ends. While a smooth scroll is under way the
  // rects (and so `delta`) move with it, but this stays put; a re-check that
  // lands on the same place must not restart the animation (a burst of canvas
  // mutations while the curves animate used to hold the page still).
  const target = (parent ? parent.scrollTop : window.scrollY) + delta
  const now = Date.now()
  if (inFlight && inFlight.scroller === (parent ?? window) && now - inFlight.at < IN_FLIGHT_MS && Math.abs(inFlight.target - target) < SAME_TARGET_PX) {
    return false
  }
  inFlight = { scroller: parent ?? window, target, at: now }
  if (parent) parent.scrollBy({ top: delta, behavior })
  else window.scrollBy({ top: delta, behavior })
  return true
}

/** A scroll started a moment ago, and where it is headed. */
let inFlight: { scroller: Window | HTMLElement; target: number; at: number } | null = null
const IN_FLIGHT_MS = 1000
const SAME_TARGET_PX = 1

/** Forget a scroll in flight (tests, and when a selection ends). */
export function resetRevealInFlight(): void {
  inFlight = null
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
    inFlight = null
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

    // The sheet's height and the trace (its link curves are drawn once the
    // relationships arrive) settle after the selection renders: check again as
    // either changes, for a short window.
    let observer: ResizeObserver | undefined
    let mutations: MutationObserver | undefined
    let pending: number | null = null
    let trailing: number | null = null
    const runSoon = () => {
      // Once the changes stop and the scroll has come to rest, one last check
      // corrects whatever the animated curves left a pixel or two short.
      if (trailing !== null) window.clearTimeout(trailing)
      trailing = window.setTimeout(run, 150)
      if (pending !== null) return
      pending = requestAnimationFrame(() => {
        pending = null
        run()
      })
    }
    const sheet = document.querySelector('aside[aria-label="Selection"]')
    if (sheet && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(run)
      observer.observe(sheet)
    }
    const canvas = document.querySelector('svg[data-timeline-canvas]')
    if (canvas && typeof MutationObserver !== 'undefined') {
      mutations = new MutationObserver(runSoon)
      mutations.observe(canvas, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-ripple', 'data-traced', 'd'] })
    }
    const settle = window.setTimeout(() => {
      observer?.disconnect()
      mutations?.disconnect()
    }, 1500)

    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(settle)
      if (pending !== null) cancelAnimationFrame(pending)
      if (trailing !== null) window.clearTimeout(trailing)
      observer?.disconnect()
      mutations?.disconnect()
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchstart', stop)
    }
  }, [selectedEventId])
}
