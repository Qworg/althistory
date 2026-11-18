import { describe, it, expect, afterEach, vi } from 'vitest'
import { revealScrollDelta, revealSelectedMark } from './revealAboveSheet'

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

describe('revealSelectedMark', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  function mount(position: 'fixed' | 'static', markTop: number) {
    document.body.innerHTML = `
      <header></header>
      <svg><g data-timeline-mark="event" data-event-id="e1"></g></svg>
      <aside aria-label="Selection" style="position:${position}"></aside>`
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON() {} }) as DOMRect
    vi.spyOn(document.querySelector('header')!, 'getBoundingClientRect').mockReturnValue(rect(0, 100))
    vi.spyOn(document.querySelector('aside')!, 'getBoundingClientRect').mockReturnValue(rect(500, 800))
    vi.spyOn(document.querySelector('g')!, 'getBoundingClientRect').mockReturnValue(rect(markTop, markTop + 30))
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
})
