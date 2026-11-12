# @althistory/calendar

Historical dates and invented-world calendars. This is the single implementation
used by the API, the CLI, the MCP tools and the web app. Before it existed, the
backend and the frontend each had a hand-kept copy, and only a comment ("the two
must agree") kept them in step. They had already drifted apart.

It has no runtime dependencies and reads no ambient state:

- Every function that can show a world's dates takes the calendar as an
  argument (`null` for none).
- Nothing reads the host's time zone. Historical dates are UTC instants on the
  proleptic Gregorian calendar.

## What is in it

### World calendars (`src/world/`)

An invented world keeps its own calendars, of any shape, on the graph's one
timeline (positions in milliseconds, the timestamps every route already
stores). [docs/specs/world-calendars.md](../docs/specs/world-calendars.md)
states the requirements; the `Req N` numbers in the code point there.

| Module | What it does |
| --- | --- |
| `definition.ts` | The `WorldCalendarSet` shape: a day of any length, and calendars of months and festival days, leap rules, eras, a week, a division of the day and a notation, with the rules for that shape (`calendarSetShapeIssues`). |
| `check.ts` | `calendarSetIssues`, the one set of rules the API, the CLI, the tools and the editor apply: the shape, and that every date the set writes reads back as itself and as no other calendar's (a sample of each calendar's dates is written and read back). `normalizeCalendarSet` stores a set that passes. A set stored before a rule was added is still read for display (`storedCalendarSet`). |
| `engine.ts` | Positions to dates and back (`dateAt`, `positionOf`), a whole leap cycle at a time rather than year by year, so a date millions of years from the epoch costs no more than one near it. |
| `notation.ts` | Writing a date in a calendar's notation and reading it back (`formatWorldPosition`, `parseWorldText`, `readWorldInput` for structured fields), and the period a month or a year names (`worldPeriod`). Text two of a world's calendars read as different dates is refused. |
| `axis.ts` | Timeline ticks on a calendar's round years, months, days and hours (`worldTicks`), and filter bounds in its notation (`worldBound`, `formatWorldBound`). |
| `describe.ts` | `formatInWorld`, `readWorldTimestamp` (the world's notation, then ISO 8601, where a date first enters), and the calendars in words for exports and what a model is told. |
| `legacy.ts` | A calendar of the earlier form (a relabelled Gregorian year count) read as a set, `storedCalendarSet` (reading a stored calendar without losing what still checks out), and `sameCalendarSet`. |
| `draft.ts` | The app's calendar editor: a whole set as a form holds it, its problems filed under its fields by the same `calendarSetIssues`, so the editor accepts exactly what the API accepts. |

### Historical dates

| Module | What it does |
| --- | --- |
| `instant.ts` | `parseIsoInstant` / `toInstant`: every timestamp given as text is read here (by the app, the API's ingestion, the CLI and the MCP tools), as ISO 8601 in UTC, with its fields checked by arithmetic. It takes the forms people and models write: a year or a month alone, a space for the `T`, lower case, `+0545`. `toInstant` is the one reader the whole app uses: ISO 8601 and the near spellings other programs write exactly, UTC when no zone is given; text that starts like an ISO date and is not one (`2019-2-31`, `T24:00`) as no date, never the day V8 rolls it into; and text of another shape as JavaScript always read it. Where text first enters from a person or a model, `readTimestamp` (or, in a world, `readWorldTimestamp`) stores `toISOString`'s spelling plus the precision the text stated. |
| `entry.ts` | A date typed into a form (`readDateEntry` / `formatDateEntry`): year first without a world (`1843`, `1843-11`, `1843-11-20 14:30`, `44 BCE`), in its notation within one, a month or a year naming its period. |
| `bounds.ts` | Filter bounds (`readDateBound` / `formatDateBound`; `1843-11` or, in a world, `Thaw 312 AR`) and native date-field values (`readDateField`), read as UTC. A date that does not exist is refused. |
| `locale.ts` | Formatting for the app (`formatHistoricalDate` and family): in the viewer's locale on the Gregorian calendar the dates are stored on, a year before 1 CE showing its era; in a world, its notation. |
| `describe.ts` | Plain text: the ISO date part of an instant, and a date in a calendar of the earlier form (the oracle the world calendars are checked against). |
| `gregorian.ts` | Leap years, month lengths and day counts by arithmetic, so a typed date can be checked, and an instant built, without a `Date`. |

### The earlier form of calendar

`calendar.ts`, `years.ts` and `parse.ts` hold the rules of the calendar graphs
stored before calendar sets (an epoch year, an era label and twelve month
names), which `legacy.ts` reads as a set. `parse.ts` also reads the CLI's and
the MCP tools' simple calendar flags.

## How the apps use it

There is nothing to publish or install. Both apps read the package by path:

- **Frontend:** compiles `src/` with the app. The Vite, Vitest and `tsconfig`
  aliases all point `@althistory/calendar` at `../calendar/src/index.ts`.
  `frontend/src/utils/historicalTime.ts` wraps the formatters so that a missing
  calendar argument means the open graph's calendar.
- **Backend:** type-check, tests, `ts-node` and `ts-node-dev` read `src/` the
  same way (`timeline/tsconfig.json`). `npm run build` in `timeline/` first
  compiles this package to CommonJS in `dist/`, then builds the backend against
  `dist/index.d.ts` (`tsconfig.build.json`). At runtime,
  `tsconfig.runtime.json` maps the import to `dist/index.js`. The API image
  copies `calendar/dist` for that reason.

The package is not an npm workspace, so the root lockfile does not cover it.
Like `timeline/` and `frontend/`, it has its own `package-lock.json` for its
dev tools.

## Tests

```bash
npm install
npm test                # every suite, once in each of five time zones
FC_SCALE=20 npm test    # the property tests at twenty times the runs (a soak)
FC_SEED=1234 npm test   # replay the seed a failure printed
npm run type-check
npm run lint
```

`vitest.config.ts` runs every suite as five projects, one per `TZ`:

- UTC;
- America/Los_Angeles (west of Greenwich, with local mean time before 1883);
- Pacific/Kiritimati (+14) and Pacific/Pago_Pago (−11), the two extremes;
- Asia/Kathmandu (+5:45).

A stray `getFullYear()` or a zone-less `new Date('…T00:00')` passes in UTC
and fails in at least one of the others. `src/test/zone.test.ts` checks that
each project really runs in its zone.

The `*.property.test.ts` files use [fast-check](https://fast-check.dev). Each
one states something that must hold for every input. Examples:

- every world date converts to a position and back unchanged, later dates
  give later positions, and no position lacks a date; on a Gregorian-shaped
  calendar the dates are exactly `Date`'s, and a calendar of the earlier form
  reads exactly as it did;
- a date written in a calendar's notation reads back as itself, at its
  precision, and the period a month or a year names starts and ends where the
  next one does;
- in any set the rules accept, every date of every calendar reads back from
  its text alone, as that calendar's (the sampled check holds on random dates);
- the generated worlds have one, two or three calendars of any shape, with
  days from 7 seconds to 30 hours;
- axis ticks lie inside the domain, in order, on round units, each labelled
  differently, and as many as the room allows;
- a typed date, a filter bound and a date field each read back as they are
  written, on the right side of the instant, with or without a world;
- the calendar editor holds any set the API accepts and sends it back
  unchanged, and files every problem under a field it has;
- every calendar of the earlier form the API accepts is stored unchanged, and
  reads the same in the app as in the API;
- a typed bound or an ISO timestamp names exactly the instant an arithmetic
  oracle (Hinnant's `days_from_civil`, no `Date`) says it does, or is refused
  for the right reason.

Generators live in `src/test/arbitraries.ts` (and, for world calendars, `src/test/worldArbitraries.ts`). They lean towards edge cases:

- years 0, 1 and 99, the ends of what a `Date` holds, and 29 February in 1900
  and 2000;
- characters that are easy to get wrong: NBSP, zero-width space, `İ`, emoji,
  and right-to-left scripts;
- about a hundred locales, including ones whose default calendar is not
  Gregorian.

When you add a function, add the property it must keep. When a property finds
a bug, keep the counterexample as an example test too, and check that the
property fails with the bug put back: a property drawn too widely can pass
for ever without meeting the case it is about. (The "two days never format the
same" property once drew its dates thousands of years apart and missed a
planted bug in 150,000 runs; it now compares dates one field apart.)
