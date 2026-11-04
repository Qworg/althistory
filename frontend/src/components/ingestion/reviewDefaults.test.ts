import { describe, it, expect } from 'vitest'
import { applyReviewDefaults, datePhrase, historySpan, isOutsideSpan } from './reviewDefaults'
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

describe('datePhrase', () => {
  it('writes a typed date the way the date reader recognises it', () => {
    expect(datePhrase('1862')).toBe('In 1862, ')
    expect(datePhrase('1862-05')).toBe('In May 1862, ')
    expect(datePhrase('1862-05-03')).toBe('On 3 May 1862, ')
    expect(datePhrase('May 1862')).toBeNull()
    expect(datePhrase('1862-13')).toBeNull()
  })
})
