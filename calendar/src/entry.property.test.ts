import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type DateBoundEdge,
  type DatePrecision,
  calendarIn,
  dateAt,
  datePrecisionMetadata,
  formatDateEntry,
  formatEventDate,
  MAX_AXIS_MS,
  formatHistoricalEnd,
  isoOfAxisTime,
  parseWorldText,
  readDateEntry,
  readWorldTimestamp,
  unreadDateReason,
  withDatePrecision,
} from './index'
import * as arb from './test/arbitraries'
import * as warb from './test/worldArbitraries'

const edge = fc.constantFrom<DateBoundEdge>('start', 'end')
const precision = fc.constantFrom<DatePrecision>('day', 'month', 'year')

/** What every typed date must do, with or without a world. */
function readsBackAsWritten(position: number, at: DatePrecision, side: DateBoundEdge, calendar: Parameters<typeof readDateEntry>[1]) {
  const text = formatDateEntry(new Date(position), at, calendar, side)
  const read = readDateEntry(text, calendar, side)
  expect(read.ok, text).toBe(true)
  if (!read.ok) return
  // At the precision it was written at, and canonical: the date it reads as is written the same way.
  expect(read.precision).toBe(at)
  expect(formatDateEntry(read.iso, read.precision, calendar, side)).toBe(text)
  const time = Date.parse(read.iso)
  if (side === 'start') {
    // A start covers the date from the first moment of what it names.
    expect(time).toBeLessThanOrEqual(position)
  } else if (at !== 'day') {
    // An end at a month or year covers it to the period's last moment.
    expect(time).toBeGreaterThanOrEqual(position)
  }
}

describe('a typed date without a world', () => {
  it('reads back as written, at its precision, on the right side of the instant', () => {
    fc.assert(
      fc.property(arb.instant, precision, edge, (date, at, side) => {
        // A month or year is written from its first day, which must be a date too.
        fc.pre(at === 'day' || Math.abs(date.getTime()) < arb.MAX_TIME - 4e10)
        readsBackAsWritten(date.getTime(), at, side, null)
      }),
      arb.runs(1500)
    )
  })

  it('reads an end at a day, month or year as its last moment', () => {
    expect(readDateEntry('1843', null, 'end')).toMatchObject({ ok: true, iso: '1843-12-31T23:59:59.999Z', precision: 'year' })
    expect(readDateEntry('1843-02', null, 'end')).toMatchObject({ ok: true, iso: '1843-02-28T23:59:59.999Z', precision: 'month' })
    expect(readDateEntry('1843-02-03 14:30', null, 'end')).toMatchObject({ ok: true, iso: '1843-02-03T14:30:00.000Z', precision: 'day' })
    expect(readDateEntry('44 BCE', null, 'start')).toMatchObject({ ok: true, iso: '-000043-01-01T00:00:00.000Z', precision: 'year' })
    expect(readDateEntry('1843-02-03 24:00', null).ok).toBe(false)
  })
})

describe('a typed date in a world', () => {
  it('reads back as written, at its precision, on the right side of the instant', () => {
    fc.assert(
      fc.property(warb.calendarSet, fc.integer({ min: -1e13, max: 1e13 }), precision, edge, (set, position, at, side) =>
        readsBackAsWritten(position, at, side, set)
      ),
      arb.runs(2000)
    )
  })

  it('reads an untimed date as the start of what it names, or as an end its last moment', () => {
    fc.assert(
      fc.property(warb.calendarSet, fc.integer({ min: -1e13, max: 1e13 }), precision, (set, position, at) => {
        const text = formatDateEntry(new Date(position), at, set, 'start')
        const start = readDateEntry(text, set, 'start')
        const end = readDateEntry(text, set, 'end')
        fc.pre(start.ok && end.ok)
        if (!start.ok || !end.ok) return
        const world = parseWorldText(set, text)
        if (world.ok && world.timed) expect(end.iso).toBe(start.iso)
        else {
          // The last moment: one more is a different day, month or year.
          const shown = calendarIn(set)
          const last = Date.parse(end.iso)
          expect(formatDateEntry(new Date(last), at, set, 'end')).toBe(text)
          expect(formatDateEntry(new Date(last + 1), at, set, 'start')).not.toBe(text)
          const next = dateAt(shown, last + 1)
          expect([next.hour, next.minute, next.second]).toEqual([0, 0, 0])
        }
      }),
      arb.runs(1000)
    )
  })

  it('reads an ISO 8601 timestamp as itself, and refuses what it cannot read, with the reason', () => {
    fc.assert(
      fc.property(warb.calendarSet, arb.instant, (set, date) => {
        const iso = date.toISOString()
        fc.pre(!parseWorldText(set, iso).ok)
        expect(readDateEntry(iso, set)).toMatchObject({ ok: true, iso, precision: 'day' })
        const refused = readDateEntry('not a date at all', set)
        expect(refused.ok).toBe(false)
        if (!refused.ok) expect(refused.error).toMatch(/^[A-Z"].*\.$/)
      }),
      arb.runs(300)
    )
  })
})

describe('an ISO date typed as an end', () => {
  it('is the last moment of its day, in a world as without one', () => {
    fc.assert(
      fc.property(warb.calendarSet, arb.fieldInstant, (set, date) => {
        const day = date.toISOString().slice(0, 10)
        fc.pre(!parseWorldText(set, day).ok)
        const end = `${day}T23:59:59.999Z`
        expect(readDateEntry(day, set, 'end')).toMatchObject({ ok: true, iso: end, precision: 'day' })
        expect(readDateEntry(day, null, 'end')).toMatchObject({ ok: true, iso: end, precision: 'day' })
        expect(readDateEntry(`${day}T06:00:00Z`, set, 'end')).toMatchObject({ ok: true, iso: `${day}T06:00:00.000Z`, precision: 'day' })
      }),
      arb.runs(300)
    )
    expect(readDateEntry('1843 14:30', null).ok).toBe(false)
  })
})

describe('one rule for ISO text, at every door', () => {
  const isoText = fc.tuple(arb.fieldInstant, fc.constantFrom('day', 'month', 'year', 'time') as fc.Arbitrary<'day' | 'month' | 'year' | 'time'>).map(([date, cut]) => {
    const iso = date.toISOString()
    return cut === 'time' ? iso : cut === 'day' ? iso.slice(0, 10) : cut === 'month' ? iso.slice(0, 7) : iso.slice(0, 4)
  })

  it('reads the same instant and precision in a form as the API, CLI and ingestion do', () => {
    fc.assert(
      fc.property(isoText, edge, (text, side) => {
        const door = readWorldTimestamp(null, text, side)
        const form = readDateEntry(text, null, side)
        expect(door, text).not.toBeNull()
        expect(form.ok, text).toBe(true)
        if (form.ok && door) expect({ iso: form.iso, precision: form.precision }).toEqual({ iso: door.iso, precision: door.precision })
      }),
      arb.runs(500)
    )
  })

  it('reads a year-first date with a time in UTC, the same in a form as at every other door', () => {
    const timed = fc.record({
      year: fc.integer({ min: 1, max: 9999 }),
      bce: fc.boolean(),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
    })
    fc.assert(
      fc.property(timed, edge, ({ year, bce, month, day, hour, minute }, side) => {
        const pad = (n: number) => String(n).padStart(2, '0')
        const text = `${year}-${pad(month)}-${pad(day)}${bce ? ' BCE' : ''} ${hour}:${pad(minute)}`
        const expected = new Date(Date.UTC(2000, month - 1, day, hour, minute))
        expected.setUTCFullYear(bce ? 1 - year : year)
        const door = readWorldTimestamp(null, text, side)
        expect(door, text).toMatchObject({ iso: expected.toISOString(), precision: 'day' })
        const form = readDateEntry(text, null, side)
        expect(form.ok && { iso: form.iso, time: form.time, precision: form.precision }, text).toEqual(door)
      }),
      arb.runs(300)
    )
    expect(readWorldTimestamp(null, '1843-11-20 24:00')).toBeNull()
    // The last day a date can hold, at a time past its last moment: refused, not thrown.
    // A Date's last day now reads: the axis reaches ±285 million years.
    expect(readWorldTimestamp(null, '275760-09-13 01:00')).toMatchObject({ iso: '+275760-09-13T01:00:00.000Z' })
    // The axis's own last day, at a time past its last moment: refused, not thrown.
    const lastDay = isoOfAxisTime(MAX_AXIS_MS).split('T')[0]!
    expect(readWorldTimestamp(null, `${lastDay} 23:59`)).toBeNull()
    expect(readDateEntry(`${lastDay} 23:59`, null)).toEqual({ ok: false, error: 'That date is beyond the range the timeline holds (about 285 million years).' })
    expect(unreadDateReason(null, `${lastDay}T23:59:59Z`)).toMatch(/beyond the range/)
    expect(unreadDateReason(null, '1843-11-20 24:00')).toMatch(/00:00 to 23:59/)
  })

  it('in a world, reads an ISO date or date and time as it does elsewhere, and refuses an ISO month or year, saying why', () => {
    fc.assert(
      fc.property(warb.calendarSet, isoText, edge, (set, text, side) => {
        fc.pre(!parseWorldText(set, text).ok)
        const plain = readWorldTimestamp(null, text, side)!
        const world = readWorldTimestamp(set, text, side)
        const form = readDateEntry(text, set, side)
        if (plain.precision === 'day') {
          expect(world).toMatchObject(plain)
          expect(form.ok && { iso: form.iso, time: form.time, precision: form.precision }).toEqual({ iso: plain.iso, time: plain.time, precision: plain.precision })
        } else {
          expect(world).toBeNull()
          expect(form.ok).toBe(false)
          if (!form.ok) expect(form.error).toMatch(/is a Gregorian (month|year), which is no (month|year) of this world/)
        }
      }),
      arb.runs(500)
    )
  })

  it('records the calendar a world date was written in, and shows a month in it', () => {
    const tide = readWorldTimestamp(VAEL_SET, 'Flooding 312 TC')!
    expect(tide).toMatchObject({ precision: 'month', calendar: 'tide' })
    const metadata = datePrecisionMetadata(tide)
    expect(metadata).toEqual({ datePrecision: 'month', dateCalendar: 'tide' })
    expect(formatEventDate({ timestamp: tide.iso, metadata }, undefined, VAEL_SET)).toBe('Flooding 312 TC')
    expect(formatDateEntry(tide.iso, 'month', VAEL_SET, 'start', 'tide')).toBe('Flooding 312 TC')
    // A new date replaces both.
    expect(withDatePrecision({ keep: 1, ...metadata }, { precision: 'day' })).toEqual({ keep: 1 })
  })
})

/** Two calendars on a world of 30-hour days: the Reckoning and the Tide-count. */
const VAEL_SET = {
  version: 2 as const,
  dayLength: 30 * 3600,
  primary: 'reckoning',
  calendars: [
    { id: 'reckoning', name: 'the Reckoning', parts: ['Lowtide', 'Greywater', 'Thaw', 'Seedtide'].map((name) => ({ name, days: 30 })), epoch: 0, eras: [{ label: 'AR', from: 1 }] },
    { id: 'tide', name: 'the Tide-count', parts: [{ name: 'Ebbing', days: 60 }, { name: 'Flooding', days: 60 }], epoch: -100, eras: [{ label: 'TC', from: 1 }] },
  ],
}

describe("an arc's end as it is shown", () => {
  it('is the day alone when it ends that day, in a world and without one', () => {
    expect(formatHistoricalEnd('1871-03-31T23:59:59.999Z', 'en-US', null)).toBe('Mar 31, 1871')
    expect(formatHistoricalEnd('1871-03-31T12:00:00.000Z', 'en-US', null)).toBe('Mar 31, 1871, 12:00 UTC')
    const end = readWorldTimestamp(VAEL_SET, 'Thaw 312 AR', 'end')!
    expect(formatHistoricalEnd(end.iso, undefined, VAEL_SET)).toBe('Thaw 30, 312 AR')
  })
})
