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

| Module | What it does |
| --- | --- |
| `calendar.ts` | The `GraphCalendar` type and its limits. The rules are written once, as `calendarIssues`; `calendarProblems` turns them into the API's messages. Text must have something visible in it, any text-direction control it opens must be closed as Unicode's bidi algorithm closes it (so right-to-left text can be isolated in a label, but nothing leaks into the date around it), and two month names that differ only by case, composition or characters drawn as nothing are the same name (a subdivision flag's tags excepted). Also `normalizeCalendar`, `storedCalendar` (reading a calendar back without losing its epoch), `usableCalendar` and `sameCalendar`. |
| `years.ts` | Stored years ↔ world years, `formatWorldYear` ("312 AR", "1 before AR"), and month names. |
| `parse.ts` | One reader each for what people type: `parseEpochYear` and `parseMonthNames` (a JSON list, one per line, or comma-separated). The CLI, MCP and the app's form all use them. |
| `draft.ts` | The app's calendar form. A draft is checked by the same `calendarIssues`, so the form accepts exactly what the API accepts. |
| `describe.ts` | Plain English for the exports, the CLI and model prompts: `formatWorldDate`, `describeCalendar`, `calendarExtractionInstructions`. |
| `instant.ts` | `parseIsoInstant` / `toInstant`: every timestamp given as text is read here (by the app, the API's ingestion, the CLI and the MCP tools), as ISO 8601 in UTC, with its fields checked by arithmetic. It takes the forms people and models write: a year or a month alone, a space for the `T`, lower case, `+0545`. `toInstant` is the one reader the whole app uses: ISO 8601 and the near spellings other programs write (`2023-1-5`, `12:00:00 UTC`, Go's `+0000 UTC`) exactly, UTC when no zone is given; text that starts like an ISO date and is not one (`2019-2-31`, `T24:00`) as no date, never the day V8 rolls it into; and text of another shape (`January 1, 2023`, which only data stored before or an API client holds) as JavaScript always read it. Where text first enters from a person or a model (ingestion and its review, the CLI and MCP event and arc tools, `generate timeline`'s dates), `readTimestamp` takes ISO 8601 only and stores `toISOString`'s spelling plus the precision the text stated. An import stores ISO 8601 in that spelling too, and keeps any other text a document holds as it was. |
| `locale.ts` | Locale-aware formatting for the app (`formatHistoricalDate` and family), with the world's year and month names spliced into each locale's own layout. The locale names the months and writes the digits, but the calendar is always the Gregorian one the dates are stored on, and a year before 1 CE shows its era. |
| `bounds.ts` | Typed filter bounds (`1843`, `1843-11`, `44-03-15 BCE`) and date-field values, read as UTC. A date that does not exist (`2019-02-31`, `T24:00`) is refused. |
| `axis.ts` | Moves a time axis's year ticks onto the world's round years, using a smaller step when the given one leaves fewer than two in view (but never more ticks than d3 chose room for, and one). |
| `gregorian.ts` | Leap years, month lengths and day counts by arithmetic, so a typed date can be checked, and an instant built, without a `Date`. |

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

- every calendar the API accepts is stored unchanged, and reads the same in
  the app as in the API;
- the form accepts a draft exactly when the API would, field by field;
- every way of writing twelve month names reads back as the same twelve;
- a world year is never 0 or negative, and two years never share a label;
- what a model is told about the calendar converts years exactly as the app
  displays them;
- in every locale, a date holds the world's year and month as clean phrases,
  never shows the stored year, and two days never format the same;
- a typed bound or an ISO timestamp names exactly the instant an arithmetic
  oracle (Hinnant's `days_from_civil`, no `Date`) says it does, or is refused
  for the right reason;
- every precision of a date names the same year;
- axis ticks fall on round world years inside the domain, and none is missing.

Generators live in `src/test/arbitraries.ts`. They lean towards edge cases:

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
