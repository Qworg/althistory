# Deep time

A timeline can run for a million years, or before 275,000 BCE and after
275,000 CE. A Gregorian history from 500,000 BCE to 300,000 CE, and a
chronicle of 1,000,000 years in a world whose day is 30 hours long, both
store, sort, validate, export and display correctly. No JavaScript `Date`
limit and no four-digit year is left in the way.

The code is `calendar/src/time.ts` and the world modules that take its value.
The property tests cite these requirements by number. This spec replaces the
Date limit that [world-calendars.md](world-calendars.md) Req 1 and Req 3
stated.

## The value

**Req 1. One value.** A moment in history is an `AxisTime`: a `bigint` count
of milliseconds on the axis. The axis is the one the system already used: zero
is 1970-01-01T00:00:00Z, and a world's axis day *n* starts at *n* × `dayLength`
× 1000 ms (world-calendars Req 2). Time of day is kept: a world's hours,
minutes and seconds name positions inside a day, as before.

**Req 2. Nothing stored changes.** Every instant a `Date` can hold is
`BigInt(date.getTime())`, so every stored timestamp means the same
millisecond as before and nothing is rewritten. Its ISO 8601 text is
`toISOString`'s, byte for byte. Beyond year 0000-9999 the text is expanded: a
sign and at least six digits ("+275761-01-01T00:00:00.000Z",
"-271822-04-19T23:59:59.999Z", "+120000000-06-01T00:00:00.000Z"), written and
read by arithmetic and never through a `Date`. `isoOfAxisTime` and
`axisTimeOfIso` are inverse over the whole range.

**Req 3. Order.** Two moments order as their `AxisTime` does. Nothing orders
moments by `getTime()` where they can be farther apart than a double holds
exactly (±2^53 ms, about ±285,000 years): the repositories, the services, the
exports and the scales compare `AxisTime`.

**Req 4. One reader.** `toAxisTime` is the one reader of stored or sent
timestamps. For every value a `Date` holds it answers
`BigInt(toInstant(x).getTime())`, so real history reads as it always did;
beyond that it reads ISO text with an expanded year, a `bigint` and an
`AxisDate`. Text that is not ISO 8601 is read as before (stored legacy text),
and a person's or a model's first-time text is read by `readTimestamp` and
`readWorldTimestamp`, which refuse prose.

**Req 5. The bound.** The axis holds ±9 × 10¹⁸ ms (`MAX_AXIS_MS`), about ±285
million years: a thousand times 300,000 years, and still inside a signed
64-bit integer and a Neo4j `datetime`. It also keeps a world's axis days
below 2^53 even with a one-second day, so the calendar engine counts days,
years and parts in ordinary numbers after one bigint split. A moment beyond
the bound is refused, with a message that says so. Going farther needs a
`{ day, msOfDay }` pair; the bound is that one constant.

**Req 6. Years 0-99.** A year before 100 reads as the year it names, never as
a 19xx year, in every reader, and an epoch year of any size is allowed
(`MIN_EPOCH_YEAR`..`MAX_EPOCH_YEAR`, computed from the bound).

## Carrying it

**Req 7. AxisDate.** A `Date` cannot hold a moment beyond ±8.64 × 10¹⁵ ms. The
packages carry such a moment as an `AxisDate`: a `Date` that also holds the
exact `AxisTime`, answers `getTime`, `valueOf`, `toISOString`, `toJSON` and the
UTC fields from it, and is a plain `Date` everywhere a moment is inside the
range. `getTime()` is the nearest double: it orders loosely and never the wrong
way, and code that must be exact reads `axisOf(date)`. An unmigrated site that
calls `getTime()` therefore degrades to a second's precision at the farthest
reach and never to `NaN`.

**Req 8. A world over the whole axis.** `dateAt(calendar, t)` and
`positionOf(calendar, fields)` take and give `AxisTime`, so every position
the bound allows names a date and every date names a position. For every
position the first position of its second reads back the same date
(world-calendars Req 13), and a later position never names an earlier date,
with a day of 1 second, 30 hours or 1,000,000 seconds.

**Req 9. A chronicle of a million years.** A calendar's epoch is any axis day
the bound allows, except that the days from it to the axis's edge must stay
exact (under 2^53), which only a day of a few seconds can break: it is refused
there, with a message, rather than naming a wrong date. A world whose year is 40 or 3 days long reaches a million
years from its epoch and further, and its dates read back from the text they
were written in (Req 10).

**Req 10. One rule for text.** `readWorldTimestamp`, `readDateEntry`,
`readDateBound` and `readHistoricalText` refuse only what is beyond the bound.
Each returns the moment as `time` beside its `iso`.

**Req 11. Gregorian stays one calendar.** A graph without a world calendar is
proleptic Gregorian throughout the axis, and keeps the viewer's locale for
every date a `Date` holds. Beyond that, the day, month and time come from
`Intl` applied to a stand-in date in a leap year of the same era (2000 CE or
401 BCE), and the year from arithmetic, in the locale's digits and with its
era.

**Req 12. Axes.** A scale over a deep timeline is linear over the number of
milliseconds from the domain's start (`axisToNumber`). Its ticks come from the
calendar: `worldTicks` in a world, `gregorianTicks` without one beyond what
d3's ticks reach. In range a Gregorian axis keeps d3's ticks, so a real
history's axis is unchanged.

## Storage and exchange

**Req 13. Storage.** The local store keeps ISO text, which is exact at any
magnitude. Neo4j keeps its `datetime` properties (range ±999,999,999 years),
written from and read as `epochMillis` (a 64-bit integer) so no value passes
through a double: an old node reads back as the same milliseconds. No schema
migration is needed.

**Req 14. The wire.** Every date in an API, CLI or MCP response is its ISO
text, plus, additively, a decimal string of the `AxisTime`: `timestamp_ms`,
`start_time_ms`, `end_time_ms`. A request gives a date as text only (the ISO
spelling, or the text a person writes); the milliseconds are for reading a
response, and a request field named `*_ms` is ignored. A string, because
JSON has no `bigint`, and a test checks that no response ever holds one.

**Req 15. Export.** An export whose dates are all inside a `Date`'s range is
written as version "1.0", byte for byte as before, with the same checksum.
One with a date beyond it is written as "1.1": the same shape, expanded ISO
years allowed. Import reads both.

**Req 16. Real history is unchanged.** A graph whose every date is inside a
`Date`'s range reads, sorts, filters, exports and displays exactly as before.
One behaviour was already changed on purpose by the API's refusal of prose
dates, and stays.
