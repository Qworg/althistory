/**
 * Generators for the property tests: calendars good and bad, month names,
 * instants across the whole range a Date holds, and the locales the app may
 * be read in.
 */

import fc from 'fast-check'
import { MAX_EPOCH_YEAR, MIN_EPOCH_YEAR, type GraphCalendar } from '../calendar'
import { MAX_AXIS_MS, MIN_AXIS_MS, axisTimeOfCivil } from '../time'

/** The instants a Date can hold: ±8.64e15 ms, about 271,821 BCE to 275,760 CE. */
export const MAX_TIME = 8.64e15

/** Characters a label or a name may hold, including ones that are easy to get wrong. */
const LABEL_CHARS = [
  ...'ARBCDEZaez0189',
  ' ', // inside a label, never around it (labels are trimmed)
  "'",
  ',', // allowed in a label and a name, not in a month name
  '-',
  '.',
  '·',
  'é',
  'ß',
  'İ',
  'ı',
  '年',
  'ع',
  'Ω',
  '\u00a0', // NBSP: trimmed at the ends, kept inside
  '\u200b', // zero-width space: not whitespace to trim()
  '😀', // two UTF-16 units: counts twice towards a length limit
]
const MONTH_CHARS = LABEL_CHARS.filter((char) => char !== ',')

/** Characters no label holds: what `calendarIssues` must refuse. */
export const FORBIDDEN_LABEL_CHARS = [
  '|', '\n', '\r', '\t', '\u0000', '\u007f', '\u0085', '\u2028', '\u2029',
]

/** Characters drawn as nothing: a name may hold them inside it, but not be made of them. */
export const INVISIBLE_CHARS = [
  '\u200B', '\u200C', '\u200D', '\u00AD', '\u2060', '\uFEFF',
  // Not format characters, but drawn as nothing all the same.
  '\u3164', '\uFFA0', '\u115F', '\u2800', '\uFE0F', '\u034F',
]

/** Text-direction controls that open (embeddings, overrides, isolates) and the one that closes each. */
export const BIDI_PAIRS: Array<[string, string]> = [
  ['\u202A', '\u202C'], ['\u202B', '\u202C'], ['\u202D', '\u202C'], ['\u202E', '\u202C'],
  ['\u2066', '\u2069'], ['\u2067', '\u2069'], ['\u2068', '\u2069'],
]
export const FORBIDDEN_MONTH_CHARS = [...FORBIDDEN_LABEL_CHARS, ',', '[', ']', '"']

function text(chars: string[], maxLength: number): fc.Arbitrary<string> {
  return fc
    .string({ unit: fc.constantFrom(...chars), minLength: 1, maxLength })
    .map((value) => value.trim())
    // Something visible in it: text of invisible characters alone is refused.
    .filter((value) => value.length > 0 && value.length <= maxLength && /[^\s\p{Cf}]/u.test(value))
}

/**
 * Any epoch year the calendar accepts: mostly the familiar 1..9999, but also
 * 0 and the years before it, the years past 9999, and the edges of the axis.
 */
export const epochYear = fc.oneof(
  { weight: 5, arbitrary: fc.integer({ min: 1, max: 9999 }) },
  { weight: 2, arbitrary: fc.integer({ min: -9999, max: 0 }) },
  { weight: 2, arbitrary: fc.integer({ min: 10000, max: 5_000_000 }) },
  { weight: 1, arbitrary: fc.integer({ min: MIN_EPOCH_YEAR, max: MAX_EPOCH_YEAR }) },
  { weight: 1, arbitrary: fc.constantFrom(MIN_EPOCH_YEAR, MAX_EPOCH_YEAR, 0, -1, 1) }
)
export const eraLabel = text(LABEL_CHARS, 16)
export const calendarName = text(LABEL_CHARS, 80)
export const monthName = text(MONTH_CHARS, 24)

/** Twelve good, distinct month names: not the same in another case, or once invisible characters are taken out. */
export const monthNames = fc.uniqueArray(monthName, {
  minLength: 12,
  maxLength: 12,
  selector: (name) => name.replace(/\p{Cf}/gu, '').normalize('NFC').toLowerCase(),
})

/** Month names made of letters alone, for checks that look for digits in formatted output. */
export const letterMonthNames = fc.uniqueArray(
  fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzþðæø'), minLength: 3, maxLength: 9 }).map((name) => `Q${name}`),
  { minLength: 12, maxLength: 12, selector: (name) => name.toLowerCase() }
)

/** A calendar the API accepts, already in the shape it stores (trimmed, no empty fields). */
export const calendar: fc.Arbitrary<GraphCalendar> = fc.record(
  { epochYear, eraLabel, name: calendarName, monthNames },
  { requiredKeys: ['epochYear'] }
)

/** A good calendar as a client may send it: padded, with empty text where a field is not wanted. */
export const paddedCalendar: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(calendar, fc.constantFrom('', ' ', '\t', '\n', '\u00a0'), fc.boolean())
  .map(([good, pad, emptyName]) => ({
    ...good,
    ...(good.eraLabel !== undefined ? { eraLabel: `${pad}${good.eraLabel}${pad}` } : {}),
    ...(emptyName ? { name: pad } : good.name !== undefined ? { name: `${pad}${good.name}` } : {}),
    ...(good.monthNames !== undefined ? { monthNames: good.monthNames.map((m) => `${pad}${m}${pad}`) } : {}),
  }))

/** A calendar as it may arrive: padded, with empty text, or a field of the wrong kind. */
export const untrustedCalendar: fc.Arbitrary<unknown> = fc.oneof(
  fc.anything(),
  fc.record(
    {
      epochYear: fc.oneof(
        epochYear,
        fc.integer(),
        fc.double(),
        fc.constantFrom(0, -0, 10000, NaN, Infinity, '1000', null)
      ),
      eraLabel: fc.oneof(
        eraLabel.map((label) => ` ${label}\t`),
        fc.string({ maxLength: 20 }),
        fc.constantFrom('', '   ', 'A|R', 'A\nR', 'x'.repeat(17), 7, null)
      ),
      name: fc.oneof(calendarName, fc.string({ maxLength: 90 }), fc.constantFrom('', 'Vael\u2028now', 'n'.repeat(81), {})),
      monthNames: fc.oneof(
        monthNames,
        monthNames.map((names) => names.map((name) => `  ${name} `)),
        fc.array(fc.string({ maxLength: 26 }), { maxLength: 14 }),
        fc.array(fc.constantFrom(...FORBIDDEN_MONTH_CHARS), { minLength: 12, maxLength: 12 }),
        fc.constantFrom('Thaw', null, [], Array(12).fill(''), Array(12).fill('Thaw'))
      ),
      offset: fc.anything(),
    },
    { requiredKeys: [] }
  )
)

/** Any valid instant, weighted towards the edges: year 0 and 1, the two-digit years, the ends of the range. */
export const instant: fc.Arbitrary<Date> = fc.oneof(
  fc.date({ min: new Date(-MAX_TIME), max: new Date(MAX_TIME), noInvalidDate: true }),
  fc.date({ min: new Date('-000100-01-01T00:00:00Z'), max: new Date('0200-01-01T00:00:00Z'), noInvalidDate: true }),
  fc.date({ min: new Date('1000-01-01T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z'), noInvalidDate: true }),
  fc.constantFrom(
    new Date(-MAX_TIME),
    new Date(MAX_TIME),
    new Date('0000-01-01T00:00:00Z'),
    new Date('-000001-12-31T23:59:59.999Z'),
    new Date('1900-02-28T00:00:00Z'),
    new Date('2000-02-29T00:00:00Z'),
    new Date('1311-12-31T23:59:59.999Z')
  )
)

/** An instant whose year has four digits, as a date field holds it. */
export const fieldInstant = fc.date({
  min: new Date('0001-01-01T00:00:00Z'),
  max: new Date('9999-12-31T23:59:59.999Z'),
  noInvalidDate: true,
})

/**
 * Locales the app may be read in, chosen for what they do to a date: the
 * order of the fields, a year written first or between, marks around a
 * numeric month (ja's 月, bg's dots, lt's dashes), an ordinal day (de, cs,
 * fi), other digits (ar-EG, fa, mr, bn, my), another default calendar (th-TH
 * Buddhist, fa Persian, ar-SA Islamic, ja-JP-u-ca-japanese), right-to-left
 * scripts, and a comma that is not ASCII (ar's ،).
 */
const LOCALE_CANDIDATES = [
  'en-US', 'en-GB', 'en-IN', 'en-CA', 'en-ZA', 'fr', 'fr-CA', 'de', 'de-CH', 'es', 'es-MX', 'it', 'pt-BR', 'pt-PT',
  'nl', 'sv', 'da', 'nb', 'fi', 'is', 'pl', 'cs', 'sk', 'sl', 'hr', 'sr', 'sr-Latn', 'bs', 'bg', 'mk', 'ru', 'uk',
  'be', 'lt', 'lv', 'et', 'hu', 'ro', 'el', 'tr', 'az', 'kk', 'ky', 'uz', 'ka', 'hy', 'he', 'ar', 'ar-EG', 'ar-SA',
  'ar-MA', 'fa', 'fa-IR', 'ps', 'ur', 'hi', 'bn', 'mr', 'ta', 'te', 'kn', 'ml', 'gu', 'pa', 'si', 'ne', 'th', 'th-TH',
  'lo', 'km', 'my', 'vi', 'id', 'ms', 'fil', 'zh', 'zh-TW', 'zh-HK', 'ja', 'ja-JP-u-ca-japanese', 'ko', 'mn', 'sw',
  'am', 'zu', 'af', 'ca', 'eu', 'gl', 'cy', 'ga', 'sq', 'en-u-nu-arab', 'en-u-ca-islamic', 'he-u-ca-hebrew',
]
export const LOCALES: string[] = Intl.DateTimeFormat.supportedLocalesOf(LOCALE_CANDIDATES)
export const locale = fc.constantFrom<string | undefined>(undefined, ...LOCALES)

/** How much longer than usual the properties run (FC_SCALE; see setup.ts). */
export const SCALE = Number(process.env.FC_SCALE) || 1

/** A property's own run count, scaled by FC_SCALE. */
export const runs = (numRuns: number) => ({ numRuns: Math.round(numRuns * SCALE) })

/** A year, in milliseconds: the unit deep time is measured in here. */
const YEAR_MS = 31_556_952_000n

/**
 * Any axis time (time.ts), weighted towards where it matters: the edges of
 * a Date's range, the years 0-99, ±300,000 years, and the bound itself.
 */
export const axisTime: fc.Arbitrary<bigint> = fc.oneof(
  fc.bigInt({ min: MIN_AXIS_MS, max: MAX_AXIS_MS }),
  fc.bigInt({ min: -8_700_000_000_000_000n, max: 8_700_000_000_000_000n }),
  fc.bigInt({ min: -600_000n * YEAR_MS, max: 600_000n * YEAR_MS }),
  // The years 0-99, which a two-digit year reading would take for the 1900s.
  fc.tuple(fc.integer({ min: -5, max: 120 }), fc.integer({ min: 0, max: 31_000_000_000 })).map(([year, ms]) => axisTimeOfCivil(year, 1, 1) + BigInt(ms)),
  fc.bigInt({ min: -3_000_000n * YEAR_MS, max: 3_000_000n * YEAR_MS }),
  fc.constantFrom(
    MIN_AXIS_MS,
    MAX_AXIS_MS,
    0n,
    -1n,
    1n,
    8_640_000_000_000_000n,
    8_640_000_000_000_001n,
    -8_640_000_000_000_000n,
    -8_640_000_000_000_001n,
    9_007_199_254_740_993n,
    -9_007_199_254_740_993n,
    300_000n * YEAR_MS,
    -300_000n * YEAR_MS
  )
)

/** Axis times beyond what a Date holds. */
export const deepAxisTime: fc.Arbitrary<bigint> = axisTime.filter((time) => time > 8_640_000_000_000_000n || time < -8_640_000_000_000_000n)
