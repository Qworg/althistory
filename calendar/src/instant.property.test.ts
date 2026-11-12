import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseIsoInstant, toInstant } from './index'
import * as arb from './test/arbitraries'

// An oracle that does not use Date: Hinnant's days_from_civil, written out
// again here rather than imported, so a mistake in the package's copy shows.
const DAY = 86_400_000
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * ((month + 9) % 12) + 2) / 5) + day - 1
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468
}
function daysIn(year: number, month: number): number {
  return Math.round((daysFromCivil(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) - daysFromCivil(year, month, 1)))
}
const pad = (n: number, width = 2) => String(n).padStart(width, '0')

describe('an ISO 8601 timestamp, in every time zone', () => {
  it('reads back every instant a Date holds, as toISOString writes it', () => {
    fc.assert(
      fc.property(arb.instant, (date) => {
        expect(parseIsoInstant(date.toISOString())).toEqual({ date, dateOnly: false })
        expect(toInstant(date.toISOString())).toEqual(date)
      }),
      arb.runs(3000)
    )
  })

  it('is the instant its fields name, or nothing when one of them does not exist', () => {
    const fields = fc.record({
      year: fc.oneof(fc.integer({ min: -280000, max: 280000 }), fc.integer({ min: -5, max: 2100 })),
      month: fc.integer({ min: 0, max: 13 }),
      day: fc.integer({ min: 0, max: 32 }),
      time: fc.option(
        fc.record({
          hour: fc.integer({ min: 0, max: 25 }),
          minute: fc.integer({ min: 0, max: 61 }),
          second: fc.option(fc.integer({ min: 0, max: 61 }), { nil: undefined }),
          ms: fc.option(fc.integer({ min: 0, max: 999 }), { nil: undefined }),
          zone: fc.option(fc.oneof(fc.constant(0), fc.integer({ min: -24 * 60 - 1, max: 24 * 60 + 1 })), { nil: undefined }),
        }),
        { nil: undefined }
      ),
      expanded: fc.boolean(),
    })
    fc.assert(
      fc.property(fields, ({ year, month, day, time, expanded }) => {
        const yearText =
          expanded || year < 0 || year > 999999 ? `${year < 0 ? '-' : '+'}${pad(Math.abs(year), 6)}` : pad(year, 4)
        let text = `${yearText}-${pad(month)}-${pad(day)}`
        let offset = 0
        if (time) {
          text += `T${pad(time.hour)}:${pad(time.minute)}`
          if (time.second !== undefined) text += `:${pad(time.second)}${time.ms !== undefined ? `.${pad(time.ms, 3)}` : ''}`
          if (time.zone !== undefined) {
            offset = time.zone
            text += time.zone === 0 ? 'Z' : `${time.zone < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(time.zone) / 60))}:${pad(Math.abs(time.zone) % 60)}`
          }
        }
        const exists =
          !(year === 0 && yearText === '-000000') &&
          month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month) &&
          (!time || (time.hour <= 23 && time.minute <= 59 && (time.second ?? 0) <= 59 && Math.abs(offset) <= 23 * 60 + 59))
        const ms = time
          ? daysFromCivil(year, month, day) * DAY + ((time.hour * 60 + time.minute - offset) * 60 + (time.second ?? 0)) * 1000 + (time.second !== undefined ? time.ms ?? 0 : 0)
          : daysFromCivil(year, month, day) * DAY
        const parsed = parseIsoInstant(text)
        if (!exists || Math.abs(ms) > arb.MAX_TIME) {
          expect(parsed, text).toBeNull()
          expect(Number.isNaN(toInstant(text).getTime()), text).toBe(true)
        } else {
          expect(parsed, text).toEqual({ date: new Date(ms), dateOnly: !time })
        }
      }),
      arb.runs(5000)
    )
  })

  it('reads text that is not ISO 8601 as no date, never as a guess in the host zone', () => {
    fc.assert(
      fc.property(arb.fieldInstant, (date) => {
        for (const text of [date.toString(), date.toUTCString(), date.toDateString(), date.toLocaleDateString('en-US')]) {
          expect(parseIsoInstant(text), text).toBeNull()
        }
      })
    )
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (text) => {
        const parsed = parseIsoInstant(text)
        if (parsed) expect(Number.isNaN(parsed.date.getTime())).toBe(false)
      }),
      arb.runs(2000)
    )
  })
})
