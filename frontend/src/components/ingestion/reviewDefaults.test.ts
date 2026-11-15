import { describe, it, expect } from 'vitest'
import { applyReviewDefaults, datePhrase, formatSpan, historySpan, isOutsideSpan } from './reviewDefaults'
import type { ExtractionResult } from '@/types'

const span = historySpan([{ timestamp: '1834-01-01T00:00:00Z' }, { timestamp: '1868-01-09T00:00:00Z' }])

describe('review defaults', () => {
  it('flags a date well outside the history, not one near its ends', () => {
    expect(isOutsideSpan('2010-10-01T00:00:00Z', span)).toBe(true)
    expect(isOutsideSpan('1871-03-01T00:00:00Z', span)).toBe(false)
    expect(isOutsideSpan('2010-10-01T00:00:00Z', null)).toBe(false)
  })

  it('ticks only rows that reach the threshold and fit the history', () => {
    const row = (tempId: string, confidence: number, timestamp: string) => ({
      tempId, description: tempId, actor: 'A', target: 'B', timestamp, confidence,
      source: { type: 'wikipedia' as const, extractedAt: '' }, selected: true, edited: false,
    })
    const extraction = {
      events: [row('good', 0.8, '1850-01-01T00:00:00Z'), row('weak', 0.45, '1850-01-01T00:00:00Z'), row('modern', 0.8, '2016-05-01T00:00:00Z')],
      arcs: [], relationships: [],
    } as unknown as ExtractionResult
    const selected = applyReviewDefaults(extraction, span).events.map((e) => [e.tempId, e.selected])
    expect(selected).toEqual([['good', true], ['weak', false], ['modern', false]])
  })
})

describe('formatSpan', () => {
  it('writes a real history\'s span as it always was', () => {
    expect(formatSpan(span!)).toBe('1834–1868')
  })

  it('writes a deep history\'s span, never "?–?"', () => {
    const deep = historySpan([{ timestamp: '-499999-03-15T00:00:00.000Z' }, { timestamp: '+300000-01-01T00:00:00.000Z' }])
    expect(deep).not.toBeNull()
    expect(formatSpan(deep!)).toBe('500000 BC–300000')
  })

  it('flags a date outside a deep span', () => {
    const deep = historySpan([{ timestamp: '-499999-03-15T00:00:00.000Z' }, { timestamp: '-399999-01-01T00:00:00.000Z' }])
    expect(isOutsideSpan('+000100-01-01T00:00:00.000Z', deep)).toBe(true)
    expect(isOutsideSpan('-449999-01-01T00:00:00.000Z', deep)).toBe(false)
  })
})

describe('datePhrase', () => {
  it('writes a typed date the way the date reader recognises it', () => {
    expect(datePhrase('1862')).toBe('In 1862, ')
    expect(datePhrase('1862-05')).toBe('In May 1862, ')
    expect(datePhrase('1862-05-03')).toBe('On 3 May 1862, ')
    expect(datePhrase('May 1862')).toBeNull()
    expect(datePhrase('1862-13')).toBeNull()
  })
})

describe('the out-of-span flag on text a reviewer typed', () => {
  it('reads it as the importer does, never as new Date would guess', async () => {
    const { VAEL, vael } = await import('@/test/fixtures/worldCalendars')
    const span = { start: vael(300, 0, 1).getTime(), end: vael(320, 0, 1).getTime() }
    expect(isOutsideSpan('Thaw 4, 312 AR', span, VAEL)).toBe(false)
    expect(isOutsideSpan('Thaw 4, 900 AR', span, VAEL)).toBe(true)
    // Prose, and a day the month does not have, name nothing to flag.
    expect(isOutsideSpan('Year 312', span, VAEL)).toBe(false)
    expect(isOutsideSpan('2019-02-31', { start: Date.parse('1800-01-01'), end: Date.parse('1850-01-01') }, null)).toBe(false)
  })
})
