import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGlobalStore } from '@/stores/globalStore'
import { revealScrollDelta, revealSelectedMark, useRevealSelectionAboveSheet } from './revealAboveSheet'

// Visible band with these: header bottom 100, sheet top 500, margin 12 -> 112..488.
const H = 100
const S = 500

describe('revealScrollDelta', () => {
  it('does not scroll when the mark is already above the sheet', () => {
    expect(revealScrollDelta({ top: 200, bottom: 230 }, null, H, S)).toBe(0)
  })

  it('scrolls a covered mark up to just above the sheet', () => {
    expect(revealScrollDelta({ top: 600, bottom: 630 }, null, H, S)).toBe(630 - 488)
  })

  it('scrolls a mark hidden under the header back down', () => {
    expect(revealScrollDelta({ top: 20, bottom: 50 }, null, H, S)).toBe(20 - 112)
  })

  it('brings as much of the trace as fits into view with the mark', () => {
    // Mark covered at 600; its trace runs from 380 to 640: 260px fits in 376px.
    const delta = revealScrollDelta({ top: 600, bottom: 630 }, { top: 380, bottom: 640 }, H, S)
    expect(delta).toBe(640 - 488)
    expect(380 - delta).toBeGreaterThanOrEqual(112)
  })

  it('keeps the mark visible when the trace is taller than the band', () => {
    const delta = revealScrollDelta({ top: 900, bottom: 930 }, { top: 150, bottom: 1400 }, H, S)
    expect(900 - delta).toBeGreaterThanOrEqual(112)
    expect(930 - delta).toBeLessThanOrEqual(488)
  })

  it('does not scroll for an already-visible mark even if its trace runs under the sheet', () => {
    expect(revealScrollDelta({ top: 200, bottom: 230 }, { top: 200, bottom: 900 }, H, S)).toBe(0)
  })
})

describe('revealScrollDelta with a visible mark and a cut trace', () => {
  it('nudges the page when the whole trace would fit', () => {
    // Mark 345..425 is visible (band 112..488), its curves run to 520: 520 - 488.
    expect(revealScrollDelta({ top: 345, bottom: 425 }, { top: 331, bottom: 520 }, H, S)).toBe(520 - 488)
  })
})

describe('revealScrollDelta with a header that is not yet stuck', () => {
  it('computes a downward scroll from where the header will rest, not where it is', () => {
    // A 127px banner above a 100px header: header bottom is 227 now, 100 once stuck.
    // Mark at 600..630 under a sheet at 500: band is 112..488 once stuck.
    const delta = revealScrollDelta({ top: 600, bottom: 630 }, null, 227, 500, 12, 100)
    expect(delta).toBe(630 - 488)
  })

  it('still scrolls on a short phone where the unstuck band is empty', () => {
    // 667px tall, sheet top 214: header at 237 leaves no band; at rest (110) it is 122..202.
    expect(revealScrollDelta({ top: 300, bottom: 330 }, null, 237, 214, 12, 110)).toBeGreaterThan(0)
    expect(revealScrollDelta({ top: 300, bottom: 330 }, null, 237, 214)).toBe(0)
  })
})

const originalMatchMedia = window.matchMedia

describe('revealSelectedMark', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    window.matchMedia = originalMatchMedia
    document.documentElement.style.removeProperty('--inspector-sheet-h')
  })

  function mount(position: 'fixed' | 'static', markTop: number, curve?: { top: number; bottom: number }) {
    document.body.innerHTML = `
      <header></header>
      <svg><g data-timeline-mark="event" data-event-id="e1"></g>${curve ? '<path class="timeline-link" data-ripple="effect"></path>' : ''}</svg>
      <aside aria-label="Selection" style="position:${position}"></aside>`
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON() {} }) as DOMRect
    vi.spyOn(document.querySelector('header')!, 'getBoundingClientRect').mockReturnValue(rect(0, 100))
    Object.defineProperty(document.querySelector('header')!, 'offsetHeight', { value: 100, configurable: true })
    vi.spyOn(document.querySelector('aside')!, 'getBoundingClientRect').mockReturnValue(rect(500, 800))
    vi.spyOn(document.querySelector('g')!, 'getBoundingClientRect').mockReturnValue(rect(markTop, markTop + 30))
    if (curve) vi.spyOn(document.querySelector('path')!, 'getBoundingClientRect').mockReturnValue(rect(curve.top, curve.bottom))
    const scrollBy = vi.fn()
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy
    return scrollBy
  }

  it('scrolls the page when the docked sheet covers the mark', () => {
    const scrollBy = mount('fixed', 600)
    expect(revealSelectedMark('e1')).toBe(true)
    expect(scrollBy).toHaveBeenCalledWith({ top: 142, behavior: 'smooth' })
  })

  it('does not smooth-scroll under prefers-reduced-motion', () => {
    const scrollBy = mount('fixed', 600)
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q }) as MediaQueryList) as typeof window.matchMedia
    revealSelectedMark('e1')
    expect(scrollBy).toHaveBeenCalledWith({ top: 142, behavior: 'auto' })
  })

  it('does not scroll when the mark is already above the sheet', () => {
    const scrollBy = mount('fixed', 200)
    expect(revealSelectedMark('e1')).toBe(false)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('does not scroll where the inspector is a side panel, not a docked sheet', () => {
    const scrollBy = mount('static', 600)
    expect(revealSelectedMark('e1')).toBe(false)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('brings the ripple curves, which hang below the mark, above the sheet too', () => {
    // Mark 600..630; its curve runs down to 700. Both fit the 112..488 band: 630..700 -> 700-488.
    const scrollBy = mount('fixed', 600, { top: 630, bottom: 700 })
    revealSelectedMark('e1')
    expect(scrollBy).toHaveBeenCalledWith({ top: 212, behavior: 'smooth' })
  })

  it('reserves the sheet height as room to scroll, and clears it when it is not docked', () => {
    mount('fixed', 600)
    revealSelectedMark('e1')
    expect(document.documentElement.style.getPropertyValue('--inspector-sheet-h')).toBe('300px')
    document.querySelector('aside')!.style.position = 'static'
    revealSelectedMark('e1')
    expect(document.documentElement.style.getPropertyValue('--inspector-sheet-h')).toBe('')
  })

  it('honours the app\'s own reduced-motion preference', () => {
    const scrollBy = mount('fixed', 600)
    const before = useGlobalStore.getState().userPreferences
    useGlobalStore.setState({ userPreferences: { ...before, accessibility: { ...before.accessibility, reducedMotion: true } } })
    try {
      revealSelectedMark('e1')
      expect(scrollBy).toHaveBeenCalledWith({ top: 142, behavior: 'auto' })
    } finally {
      useGlobalStore.setState({ userPreferences: before })
    }
  })
})

describe('useRevealSelectionAboveSheet', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    document.documentElement.style.removeProperty('--inspector-sheet-h')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function dock(markTop: number) {
    document.body.innerHTML = `
      <header></header>
      <svg data-timeline-canvas><g data-timeline-mark="event" data-event-id="e1"></g></svg>
      <aside aria-label="Selection" style="position:fixed"></aside>`
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON() {} }) as DOMRect
    vi.spyOn(document.querySelector('header')!, 'getBoundingClientRect').mockReturnValue(rect(0, 100))
    Object.defineProperty(document.querySelector('header')!, 'offsetHeight', { value: 100, configurable: true })
    vi.spyOn(document.querySelector('aside')!, 'getBoundingClientRect').mockReturnValue(rect(500, 800))
    vi.spyOn(document.querySelector('g')!, 'getBoundingClientRect').mockReturnValue(rect(markTop, markTop + 30))
    const scrollBy = vi.fn()
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy
    return scrollBy
  }

  it('does not scroll once the person has started scrolling themselves', async () => {
    const scrollBy = dock(600)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 20))
    renderHook(() => useRevealSelectionAboveSheet('e1'))
    window.dispatchEvent(new Event('wheel'))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('scrolls on the next frame when the person has not', async () => {
    const scrollBy = dock(600)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 20))
    renderHook(() => useRevealSelectionAboveSheet('e1'))
    await vi.waitFor(() => expect(scrollBy).toHaveBeenCalled())
  })

  it('checks again when the sheet resizes (its content loaded), and stops watching after a second', async () => {
    const scrollBy = dock(450) // visible at first: sheet top is 500
    let notify: () => void = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          notify = cb
        }
        observe() {}
        disconnect = disconnect
      },
    )
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 5))
    renderHook(() => useRevealSelectionAboveSheet('e1'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(scrollBy).not.toHaveBeenCalled()
    // The sheet grew taller and now covers the mark.
    const rect = { top: 400, bottom: 800, left: 0, right: 0, width: 0, height: 400, x: 0, y: 400, toJSON() {} } as DOMRect
    vi.spyOn(document.querySelector('aside')!, 'getBoundingClientRect').mockReturnValue(rect)
    notify()
    expect(scrollBy).toHaveBeenCalled()
  })

  it('checks again when the trace is drawn after the selection (the link curves arrive late)', async () => {
    const scrollBy = dock(300) // visible above the sheet at 500
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 5))
    renderHook(() => useRevealSelectionAboveSheet('e1'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(scrollBy).not.toHaveBeenCalled()

    const curve = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    curve.setAttribute('class', 'timeline-link')
    curve.setAttribute('data-ripple', 'effect')
    const rect = { top: 330, bottom: 520, left: 0, right: 0, width: 0, height: 190, x: 0, y: 330, toJSON() {} } as DOMRect
    vi.spyOn(curve, 'getBoundingClientRect').mockReturnValue(rect)
    document.querySelector('svg')!.appendChild(curve)
    await vi.waitFor(() => expect(scrollBy).toHaveBeenCalled())
  })

  it('clears the reserved room when the selection ends', () => {
    dock(600)
    document.documentElement.style.setProperty('--inspector-sheet-h', '300px')
    const { rerender } = renderHook(({ id }: { id: string | null }) => useRevealSelectionAboveSheet(id), {
      initialProps: { id: 'e1' as string | null },
    })
    rerender({ id: null })
    expect(document.documentElement.style.getPropertyValue('--inspector-sheet-h')).toBe('')
  })
})
