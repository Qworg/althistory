import { describe, expect, it } from 'vitest'
import { worldDateOf } from './worldDateHint'

const AR = { epochYear: 1000, eraLabel: 'AR' }

describe('worldDateOf', () => {
  it('reads date, datetime-local and ISO values as UTC', () => {
    expect(worldDateOf('1140-03-04', AR)).toBe('Mar 4, 141 AR')
    expect(worldDateOf('1140-03-04T14:30', AR)).toBe('Mar 4, 141 AR, 14:30 UTC')
    expect(worldDateOf('1140-03-04T00:00:00.000Z', AR)).toBe('Mar 4, 141 AR')
  })

  it('shows nothing for text that is not an ISO date, rather than a lenient guess', () => {
    // The browser reads "1" as 2001 and "12/03/1066" in US order.
    for (const value of ['1', '10', '106', '1066', '12/03/1066', 'March 1066', '1066-3-4']) {
      expect(worldDateOf(value, AR)).toBeNull()
    }
  })

  it('shows nothing without a calendar', () => {
    expect(worldDateOf('1140-03-04', null)).toBeNull()
  })
})
