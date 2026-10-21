/**
 * Tests for the frontend's copy of the causal-order rule.
 *
 * The backend keeps the same rule in `timeline/src/utils/causalOrder.ts`.
 * The two packages cannot import each other, so the rule is written down
 * twice -- and a test in each package checks that no other file in it
 * compares a cause with an effect on its own.
 */

import { describe, it, expect } from 'vitest'
import { isTemporalInversion, isCausalOrderValid } from './causalOrder'

describe('isTemporalInversion', () => {
  it('should be true when the cause is after the effect', () => {
    expect(
      isTemporalInversion(new Date('2023-01-02T00:00:00Z'), new Date('2023-01-01T00:00:00Z'))
    ).toBe(true)
  })

  it('should be false when the cause is before the effect', () => {
    expect(
      isTemporalInversion(new Date('2023-01-01T00:00:00Z'), new Date('2023-01-02T00:00:00Z'))
    ).toBe(false)
  })

  it('should be false when the cause and the effect are at the same moment', () => {
    const moment = new Date('2023-01-01T00:00:00Z')
    expect(isTemporalInversion(moment, moment)).toBe(false)
  })
})

describe('isCausalOrderValid', () => {
  it('should accept a pair the project allows', () => {
    const moment = new Date('2023-01-01T00:00:00Z')
    expect(isCausalOrderValid(moment, new Date(moment.getTime() + 1000))).toBe(true)
    expect(isCausalOrderValid(moment, moment)).toBe(true)
  })

  it('should refuse a cause that follows its effect', () => {
    const moment = new Date('2023-01-01T00:00:00Z')
    expect(isCausalOrderValid(new Date(moment.getTime() + 1000), moment)).toBe(false)
  })
})
