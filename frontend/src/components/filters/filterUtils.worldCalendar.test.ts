import { describe, expect, it } from 'vitest'
import { worldBoundLabel } from './filterUtils'

const AR = { epochYear: 1000, eraLabel: 'AR' }

describe('worldBoundLabel', () => {
  it('reads a typed (stored) bound in the world calendar, at the precision typed', () => {
    expect(worldBoundLabel('1311', 'start', AR)).toBe('312 AR')
    expect(worldBoundLabel('1311', 'end', AR)).toBe('312 AR')
    expect(worldBoundLabel('1311-03', 'end', AR)).toBe('Mar 312 AR')
    expect(worldBoundLabel('1311-03-04', 'end', AR)).toBe('Mar 4, 312 AR')
    expect(worldBoundLabel('999', 'start', AR)).toBe('1 before AR')
  })

  it('is null without a calendar or a readable bound', () => {
    expect(worldBoundLabel('1311', 'start', null)).toBeNull()
    expect(worldBoundLabel('', 'start', AR)).toBeNull()
    expect(worldBoundLabel('13x1', 'start', AR)).toBeNull()
  })
})
