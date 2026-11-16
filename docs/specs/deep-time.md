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
a 19xx year, in every reader of ISO 8601 text (`parseIsoInstant`, and so
`toInstant`, `toAxisTime` and `readTimestamp` for ISO text) and in every door
where text first enters (`readTimestamp` and `readDateField` take ISO text:
"0050-03-01" is March of the year 50; `readWorldTimestamp` also reads the
year-first notation, where "50" is the year 50).
The one exception is `toInstant`'s fallback for non-ISO text stored before
ISO was the only spelling ("50-03-01", "1/1/50"): it reads that as JavaScript
always did, in the host's zone, and so as a 19xx year; the doors refuse such
text before it is stored. An epoch year of any size is allowed
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
history's axis is drawn where it always was.

Year labels and ticks are written in the syntax a person types, so they read
back where they are typed (`readDateBound`) in any locale: ASCII digits, `BCE`
after a year before 1 CE, nothing after a year from 1 CE on, and at a month or
day the bound syntax (`250000000 BCE`, `300000`, `44-03 BCE`, `1843-11-20`). Every
`gregorianTicks` tick is written so. A d3 tick set (a real history's) keeps
d3's labels unless any of its ticks falls before 1 CE: then the whole set is
written in the typed syntax at the format's precision ("81 BCE … 1 BCE 20 40"),
never d3's "-0043", "0001" or "20s" beside an era.

At a time of day, a tick is written `HH:MM`, or `HH:MM:SS` when a tick in the
set has seconds, or `HH:MM:SS.mmm` when one has milliseconds (a single event's
default view is 20 seconds, and zoom reaches 1); a day's first moment
(00:00:00.000) is written as its date. The axis names the day of its times in a
caption under it ("44-03-15 BCE", or "44-03-14 BCE – 44-03-15 BCE" across
midnight), taken from the visible span, so the day stays named however the
ticks are thinned, even where there is no tick. If two labels would still read
the same (a day-long view whose ends share a time), every tick is its date and
time instead, and no caption is drawn. The reader takes a time to the
minute, second or millisecond after a date, so every label and the caption read
back. Before 1 CE, in deep time and beyond 9999 (never for a world calendar), an
end label that would run past the SVG is anchored inward, and ticks whose
labels would overprint are thinned to an even stride, keeping a label that
names a day among times; the actor view fits such an axis the same way rather
than turning its labels. An axis from 1 CE to 9999 draws as it always did.

Full dates in prose (event labels, the inspector, arc spans, tooltips) are the
locale's (Req 11), "Mar 15, 44 BC" in en-US: nobody types those back. The en-US "BC" of a full date beside
the "BCE" of a year label is deliberate.

## Storage and exchange

**Req 13. Storage.** The local store keeps ISO text, which is exact at any
magnitude. Neo4j keeps its `datetime` properties (range ±999,999,999 years),
written from and read as `epochMillis` (a 64-bit integer) so no value passes
through a double: an old node reads back as the same milliseconds. No schema
migration is needed.

**Req 14. The wire.** Every date in an API, CLI or MCP response is its ISO
text, plus, additively, a decimal string of the `AxisTime`. The entity
responses of the API (events and arcs, and the events the inference routes
return) carry `timestamp_ms`, `start_time_ms`, `end_time_ms`; the CLI and MCP
carry the same strings under camelCase names, `timestampMs`, `startTimeMs`,
`endTimeMs`. A date inside a response built by hand (a validation result's
`timestamp`, an arc's time range in a check) is its ISO text alone, which is
exact: the milliseconds are a convenience for a client that wants a number
without parsing the text. A request gives a date as text only (the ISO
spelling, or the text a person writes); the milliseconds are for reading a
response, and a request field named `*_ms` is ignored. A string, because
JSON has no `bigint`, and a test checks that no response ever holds one.

**Req 15. Export.** An export whose dates are all inside a `Date`'s range is
written as version "1.0", byte for byte as before, with the same checksum.
One with a date beyond it is written as "1.1": the same shape, expanded ISO
years allowed. Import reads both.

**Req 16. Real history is unchanged.** A graph whose every date is inside a
`Date`'s range reads, sorts, filters, exports and displays exactly as before.
Some behaviours were changed on purpose, and stay:

- The API's refusal of prose dates.
- Every date or date-time field in a graph without a world has a small
  "Type a year before 1 CE or after 9999" button under the native input, since
  a native picker cannot hold such a year.
- The actor timeline draws its decade ticks only while they fit the width (more
  than about three times what the width holds, which is a span of about 240
  years on a 600 px chart, it draws count-based ticks, as the main timeline
  does), because a span of hundreds of thousands of years is thousands of
  decades.
- A timeline that starts before year -9999 (or comes within its own span of a
  `Date`'s bounds) takes the calendar package's year ticks ("200000 BCE")
  rather than d3's, which tick nothing there, or label years astronomically
  ("-200000s" for 200,001 BCE). A history inside years -9999 to 9999 keeps
  d3's tick positions; a tick set with any tick before 1 CE is labelled whole
  in the typed syntax of Req 12 ("44 BCE", "20"), not d3's "-0043" or "20s".
- A year without a world's calendar (graph cards, the graph selector, the
  actor view, the causal graph's node labels, ingestion span labels and the
  counterfactual axis) is written in the typed syntax of Req 12 at every
  magnitude and in every locale: "1843", "44 BCE", "500000 BCE", never the
  astronomical "-43" (which every door refuses as typed text, since it could be
  43 BCE or 44 BCE). Year labels and ticks use the typed syntax so they read
  back in any locale; full dates use the locale. This changes how real BCE
  years were shown, on purpose.
