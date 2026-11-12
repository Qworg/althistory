# World calendars

An invented world keeps time its own way. A graph can carry one or more
calendars of any shape. The months, the year, the day and the week are the
world's own, not the Gregorian calendar renamed. Real-history graphs, which
have no calendar, keep the proleptic Gregorian calendar and the viewer's
locale.

The code is `calendar/src/world/`. Its property tests cite these requirements
by number.

## The timeline

**Req 1. One linear timeline.** Every graph stores its times as positions on
one linear axis: a count of milliseconds, held in the existing timestamp
fields. Sorting, durations, causal order, time ranges and the timeline's scales
read positions and never need a calendar. A calendar is only a way to name a
position.

**Req 2. Days.** A world's day is the same length for all its calendars:
`dayLength` seconds of the axis (86,400 by default). Axis day *n* starts at
*n* × `dayLength` × 1000 ms. All the world's calendars begin their days at the
same moment.

**Req 3. Range.** A position is a JavaScript `Date`, about ±8.64 × 10¹⁵ ms. A
calendar's dates exist only within that range, and the package refuses one it
cannot reach.

## A calendar

**Req 4. Year parts.** A year is an ordered list of parts. A part is either a
month, with a name and a length in days, or a run of festival days that belong
to no month (`intercalary`). A calendar has 1 to 100 parts, and each part has
1 to 1,000 days. Every name is distinct, ignoring case and invisible characters.

**Req 5. Leap rules.** A leap rule adds days to a part in some years, or takes
them away: `{ every, offset, part, days }` applies in year *Y* when
(*Y* − `offset`) is a multiple of `every`. Rules add up, so the Gregorian
calendar is three rules: +1 every 4, −1 every 100 and +1 every 400, all applied
to February. A part may never fall below 1 day in any year. The rules repeat
over a cycle (the least common multiple of their `every` values), which may
not exceed 100,000 years.

**Req 6. Epoch.** `epoch` is the axis day on which year 1 begins. Years are
numbered on one line: year 1 begins at the epoch, year 0 is the year before,
and earlier years are negative.

**Req 7. Eras.** Years are shown in eras. Each era has a `label` and the year
`from` which it counts, starting at 1. Years before the first era count back
from it ("40 before AR"). A calendar with no era label shows "Year 312" and
"40 before Year 1". No year is ever shown as 0 or with a minus sign.

**Req 8. Time of day.** A calendar divides the world's day into its own hours,
minutes and seconds: `{ hoursPerDay, minutesPerHour, secondsPerMinute }`,
24/60/60 by default. A time of day is the fraction of the day elapsed, so two
calendars that divide the day differently still agree on every moment.

**Req 9. Weeks.** A calendar may have a week: a cycle of named days, and the
weekday of the epoch. Festival days can be left out of the week (as the Shire
leaves out Midyear's Day), so the week resumes after them.

**Req 10. Notation.** A calendar has templates for a date at day, month and
year precision, for a festival of a single day, and for a time. The defaults
are "{month} {day}, {year}", "{month} {year}", "{year}", "{month}, {year}"
("Midyear's Day, 312 AR") and "{hour}:{minute}". Placeholders are separated
by text, so a written date reads back unambiguously. The weekday is a field
of a date, not part of its notation: a festival day the week leaves out has
none.

## Several calendars

**Req 11. A world's calendar set.** A graph's calendar is a set:
`{ version: 2, dayLength, calendars, primary }`. Every calendar names the same
positions. `primary` is the one shown unless the viewer picks another, and
the one assumed for text that names no calendar.

**Req 12. Calendars stored before.** A calendar stored in the earlier form
(`{ epochYear, eraLabel, name, monthNames }`, a relabelled Gregorian calendar)
is read as a set holding one Gregorian-shaped calendar. Every date it shows
reads exactly as it did.

## Dates in and out

**Req 13. Conversion.** For every position *t* and every calendar,
`fields(t)` gives the era, year, part, day, weekday and time of day. The start
of those fields is ≤ *t*, and *t* is before the start of the next second.
Every valid set of fields converts to a position and back unchanged. Later
fields give later positions, and no position lacks a date.

**Req 14. Text.** A date written in a calendar's notation, at any precision,
reads back as the date it names: `parse(format(d)) = d`. Text that names a
day, month or year that does not exist is refused, with the reason.
Structured input (`{ calendar, era, year, month, day, hour, minute, second }`)
is accepted wherever text is.

**Req 15. Periods.** A date at month or year precision names a period. Its
start is the first position in it, and its end the last millisecond before the
next one. Filters and time ranges written in a calendar's notation use these
periods.

**Req 16. Precision.** A date given as a month or a year is stored at its
period's start, with `datePrecision` recorded, and shown at that precision.

**Req 17. Axis.** A timeline in a world calendar puts its ticks on that
calendar's round units: years in steps of 1, 2 or 5 × 10ⁿ, months, days and
hours. The ticks lie inside the domain, in order, and are labelled in the
calendar's notation, with every label distinct.

**Req 18. Everywhere.** Every surface that shows or accepts a date in a world
graph uses the graph's calendar set: the app, the API, the CLI and MCP tools,
exports and imports, and what a language model is told.
