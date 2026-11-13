import { describe, expect, it } from 'vitest'
import { fromPanelFilters, readDateBound, toPanelFilters } from './filterUtils'
import type { FilterState } from '@/types'
import { VAEL, vael } from '@/test/fixtures/worldCalendars'

const SHOWN_TIDE = { ...VAEL, primary: 'tide' }

const NO_FILTERS: FilterState = {
  dateRange: null,
  actors: [],
  targets: [],
  eventTypes: [],
  arcLevels: [],
  causalWeightRange: [0, 1],
  confidenceThreshold: 0,
  searchQuery: '',
}

describe('date bounds in a world calendar', () => {
  it("reads a year, a month or a day in the world's notation, as the whole period", () => {
    const year = readDateBound('312 AR', 'start', VAEL)
    expect(year.ok && year.date.getTime()).toBe(vael(312, 0, 1).getTime())
    const month = readDateBound('Thaw 312 AR', 'end', VAEL)
    expect(month.ok && month.date.getTime()).toBe(vael(312, 3, 1).getTime() - 1)
    const festival = readDateBound("Midyear's Day, 312 AR", 'start', VAEL)
    expect(festival.ok && festival.text).toBe("Midyear's Day, 312 AR")
  })

  it('refuses a day the world does not have, and a time of day, with the reason', () => {
    const missing = readDateBound('Thaw 31, 312 AR', 'start', VAEL)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toMatch(/Thaw has 30 days/)
    expect(readDateBound('Thaw 4, 312 AR, 06:00', 'start', VAEL).ok).toBe(false)
  })

  it('writes the store’s bounds in the calendar shown, and reads them back as the same instants', () => {
    const filters = { ...NO_FILTERS, dateRange: { start: vael(312, 0, 1), end: new Date(vael(313, 0, 1).getTime() - 1) } }
    const panel = toPanelFilters(filters, VAEL)
    expect(panel.dateRange).toEqual({ start: '312 AR', end: '312 AR' })
    expect(fromPanelFilters(panel, VAEL).dateRange).toEqual(filters.dateRange)
    // In the Tide-count the same instants are days of its own.
    const tide = toPanelFilters(filters, SHOWN_TIDE)
    expect(tide.dateRange?.start).toMatch(/ TC$/)
    expect(fromPanelFilters(tide, SHOWN_TIDE).dateRange?.start.getTime()).toBeLessThanOrEqual(vael(312, 0, 1).getTime())
  })

  it("reads a link's instant as itself, and refuses year-first text, which names no date of the world's", () => {
    const bound = readDateBound('2358-11-15T12:00:00.000Z', 'start', VAEL)
    expect(bound.ok && bound.date.toISOString()).toBe('2358-11-15T12:00:00.000Z')
    expect(readDateBound('1843-11', 'start', VAEL).ok).toBe(false)
    expect(readDateBound('312', 'start', VAEL).ok).toBe(false)
  })
})

describe('date bounds in a link', () => {
  it('in a world, are the instants they name, whatever calendar the viewer picked', async () => {
    const { boundFromUrl, boundToUrl } = await import('./filterUtils')
    const start = boundToUrl('Thaw 312 AR', 'start', VAEL)
    expect(start).toBe(vael(312, 2, 1).toISOString())
    expect(boundToUrl(boundFromUrl(start, 'start', SHOWN_TIDE), 'start', SHOWN_TIDE)).toBe(start)
    expect(boundFromUrl(start, 'start', VAEL)).toBe('Thaw 312 AR')
    // Without a world, as typed (links made before keep working).
    expect(boundToUrl('1843-11', 'start', null)).toBe('1843-11')
    expect(boundFromUrl('1843-11', 'start', null)).toBe('1843-11')
  })
})
