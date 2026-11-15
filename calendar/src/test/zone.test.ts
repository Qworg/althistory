import { describe, expect, it } from 'vitest'

/**
 * Each project in vitest.config.ts sets TZ. If the zone silently did not take,
 * every suite would run in the host's zone five times and prove nothing.
 */
describe('the time zone this project runs in', () => {
  it('is the one the project names', () => {
    // By offset, not name: ICU reports Asia/Kathmandu as its alias "Asia/Katmandu".
    const offsets: Record<string, number> = {
      UTC: 0,
      'America/Los_Angeles': 480, // January: PST, UTC-8
      'Pacific/Kiritimati': -840,
      'Pacific/Pago_Pago': 660,
      'Asia/Kathmandu': -345,
    }
    expect(new Date(Date.UTC(2021, 0, 15)).getTimezoneOffset()).toBe(offsets[process.env.TZ!])
  })
})
