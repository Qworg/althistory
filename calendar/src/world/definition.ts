/**
 * A world's calendars, as data: what they are, the limits on them, and the
 * one set of rules that says whether a set is usable (docs/specs/
 * world-calendars.md, Req 2-12).
 */

import { FORBIDDEN_IN_LABEL, FORBIDDEN_IN_MONTH_NAME, bidiClosed, hasVisible, sameNameKey } from '../text'

/** A month, or a run of festival days that belongs to no month (Req 4). */
export interface CalendarPart {
  name: string
  days: number
  intercalary?: boolean
}

/** Days added to (or taken from) a part in the years `every` apart, counted from `offset` (Req 5). */
export interface LeapRule {
  every: number
  offset?: number
  /** The part's index in `parts`. */
  part: number
  days: number
}

/** Years counted from `from` (the line year that is this era's year 1) (Req 7). */
export interface CalendarEra {
  label: string
  from: number
}

/** A cycle of named days (Req 9). */
export interface CalendarWeek {
  days: string[]
  /** The weekday (index into `days`) of the epoch's first day. */
  epochWeekday?: number
  /** Festival days are left out of the week, which resumes after them. */
  skipsIntercalary?: boolean
}

/** The calendar's division of the world's day (Req 8). */
export interface CalendarTime {
  hoursPerDay: number
  minutesPerHour: number
  secondsPerMinute: number
}

/**
 * How a date is written (Req 10). Placeholders: {day} {month} {year}, and
 * {hour} {minute} {second} in `time`. `festival` writes a festival of a single
 * day ("Midyear's Day, 312 AR").
 */
export interface CalendarNotation {
  date?: string
  month?: string
  year?: string
  festival?: string
  time?: string
}

export interface CalendarDefinition {
  /** Unique in its set: lowercase letters, digits and hyphens. */
  id: string
  /** What the calendar is called ("the Reckoning of the Rising"). */
  name: string
  parts: CalendarPart[]
  leapRules?: LeapRule[]
  /** The axis day on which year 1 begins (Req 6). */
  epoch: number
  eras?: CalendarEra[]
  /** How years before the first era are written: "40 BAR". Default "40 before {first era}". */
  beforeEra?: string
  week?: CalendarWeek
  time?: Partial<CalendarTime>
  notation?: CalendarNotation
}

/** A world's calendars (Req 11). */
export interface WorldCalendarSet {
  version: 2
  /** Seconds of the axis in the world's day. */
  dayLength: number
  calendars: CalendarDefinition[]
  /** The id of the calendar shown unless another is picked. */
  primary: string
}

export const LIMITS = {
  calendars: 8,
  parts: 100,
  partDays: 1000,
  leapRules: 20,
  cycleYears: 100_000,
  eras: 20,
  weekDays: 100,
  timeUnit: 1000,
  secondsPerDayUnits: 1_000_000,
  dayLength: 1_000_000,
  nameLength: 24,
  labelLength: 16,
  calendarNameLength: 80,
  templateLength: 80,
} as const

export const DEFAULT_TIME: CalendarTime = { hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 }
export const DEFAULT_NOTATION: Required<CalendarNotation> = {
  date: '{month} {day}, {year}',
  month: '{month} {year}',
  year: '{year}',
  festival: '{month}, {year}',
  time: '{hour}:{minute}',
}

/** A Date holds ±8.64e15 ms. */
export const MAX_TIME = 8.64e15

const PLACEHOLDERS = {
  date: ['day', 'month', 'year'],
  month: ['month', 'year'],
  year: ['year'],
  festival: ['month', 'year'],
  time: ['hour', 'minute'],
} as const
const OPTIONAL_PLACEHOLDERS: Record<keyof typeof PLACEHOLDERS, string[]> = {
  date: [],
  month: [],
  year: [],
  festival: [],
  time: ['second'],
}

/** One way a calendar set can be unusable; `path` says where ("calendars[0].parts[2].days"). */
export interface WorldCalendarIssue {
  path: string
  message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return Math.abs(a)
}

/** The years after which a calendar's leap rules repeat: the least common multiple of their `every`. */
export function cycleYears(rules: readonly LeapRule[] | undefined): number {
  let cycle = 1
  for (const rule of rules ?? []) {
    cycle = (cycle / gcd(cycle, rule.every)) * rule.every
    if (cycle > LIMITS.cycleYears) return Infinity
  }
  return cycle
}

/** A part's length in a year, by the leap rules (`year` is the line year). */
export function partLengthsIn(year: number, parts: readonly CalendarPart[], rules: readonly LeapRule[] | undefined): number[] {
  const lengths = parts.map((part) => part.days)
  for (const rule of rules ?? []) {
    const offset = rule.offset ?? 0
    if ((((year - offset) % rule.every) + rule.every) % rule.every === 0) lengths[rule.part] = lengths[rule.part]! + rule.days
  }
  return lengths
}

/** Problems with a name a reader reads in a date: a part's, an era's, a weekday's. */
function nameProblems(path: string, value: unknown, maxLength: number, forbidden: RegExp, what: string): WorldCalendarIssue[] {
  if (typeof value !== 'string') return [{ path, message: `${path} must be text` }]
  const text = value.trim()
  if (!hasVisible(text)) return [{ path, message: `${path} cannot be empty or invisible` }]
  if (text.length > maxLength) return [{ path, message: `${path} must be at most ${maxLength} characters` }]
  if (forbidden.test(text) || /[{}]/.test(text)) {
    return [{ path, message: `${path} cannot contain ${what}, braces, or a line break or other control character` }]
  }
  if (!bidiClosed(text)) return [{ path, message: `${path} has a text-direction control left open` }]
  return []
}

function distinctNames(path: string, names: string[]): WorldCalendarIssue[] {
  const seen = new Map<string, number>()
  for (const [index, name] of names.entries()) {
    const key = sameNameKey(name.trim())
    if (seen.has(key)) return [{ path: `${path}[${index}]`, message: `${path} names "${name.trim()}" twice` }]
    seen.set(key, index)
  }
  return []
}

function templateProblems(path: string, value: unknown, kind: keyof typeof PLACEHOLDERS): WorldCalendarIssue[] {
  if (value === undefined) return []
  if (typeof value !== 'string' || value.length === 0 || value.length > LIMITS.templateLength) {
    return [{ path, message: `${path} must be text of 1 to ${LIMITS.templateLength} characters` }]
  }
  if (FORBIDDEN_IN_LABEL.test(value)) return [{ path, message: `${path} cannot contain a "|" or a control character` }]
  const found = [...value.matchAll(/\{([a-z]+)\}/g)].map((match) => match[1]!)
  const allowed = [...PLACEHOLDERS[kind], ...OPTIONAL_PLACEHOLDERS[kind]]
  for (const name of found) {
    if (!allowed.includes(name)) return [{ path, message: `${path} has an unknown placeholder {${name}}` }]
  }
  for (const name of PLACEHOLDERS[kind]) {
    if (found.filter((f) => f === name).length !== 1) return [{ path, message: `${path} must hold {${name}} exactly once` }]
  }
  if (found.length !== new Set(found).size) return [{ path, message: `${path} holds a placeholder twice` }]
  // Two placeholders side by side cannot be told apart when read back.
  if (/\}\s*\{/.test(value)) return [{ path, message: `${path} must separate its placeholders with text` }]
  if (/[{}]/.test(value.replace(/\{[a-z]+\}/g, ''))) return [{ path, message: `${path} has a stray brace` }]
  return []
}

/** Every issue with one calendar, its paths under `path`. */
export function calendarDefinitionIssues(value: unknown, path: string, dayLength: number): WorldCalendarIssue[] {
  if (!isRecord(value)) return [{ path, message: `${path} must be an object` }]
  const issues: WorldCalendarIssue[] = []
  const known = ['id', 'name', 'parts', 'leapRules', 'epoch', 'eras', 'beforeEra', 'week', 'time', 'notation']
  for (const key of Object.keys(value)) if (!known.includes(key)) issues.push({ path: `${path}.${key}`, message: `${path} has an unknown field "${key}"` })

  if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(value.id)) {
    issues.push({ path: `${path}.id`, message: `${path}.id must be 1 to 32 lowercase letters, digits or hyphens` })
  }
  issues.push(...nameProblems(`${path}.name`, value.name, LIMITS.calendarNameLength, FORBIDDEN_IN_LABEL, 'a "|"'))

  const parts = value.parts
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > LIMITS.parts) {
    issues.push({ path: `${path}.parts`, message: `${path}.parts must list 1 to ${LIMITS.parts} months or festival days` })
    return issues
  }
  let partsOk = true
  parts.forEach((part, index) => {
    const at = `${path}.parts[${index}]`
    if (!isRecord(part)) {
      issues.push({ path: at, message: `${at} must be an object` })
      partsOk = false
      return
    }
    const nameIssues = nameProblems(`${at}.name`, part.name, LIMITS.nameLength, FORBIDDEN_IN_MONTH_NAME, 'a comma, a "|", brackets or a double quote')
    issues.push(...nameIssues)
    if (!isInt(part.days) || part.days < 1 || part.days > LIMITS.partDays) {
      issues.push({ path: `${at}.days`, message: `${at}.days must be a whole number from 1 to ${LIMITS.partDays}` })
      partsOk = false
    }
    if (part.intercalary !== undefined && typeof part.intercalary !== 'boolean') {
      issues.push({ path: `${at}.intercalary`, message: `${at}.intercalary must be true or false` })
    }
    for (const key of Object.keys(part)) {
      if (!['name', 'days', 'intercalary'].includes(key)) issues.push({ path: `${at}.${key}`, message: `${at} has an unknown field "${key}"` })
    }
    if (nameIssues.length > 0) partsOk = false
  })
  if (partsOk) issues.push(...distinctNames(`${path}.parts`, (parts as CalendarPart[]).map((part) => part.name)))
  if (partsOk && (parts as CalendarPart[]).every((part) => part.intercalary)) {
    issues.push({ path: `${path}.parts`, message: `${path}.parts must hold at least one month that is not festival days` })
  }

  const rules = value.leapRules
  let rulesOk = true
  if (rules !== undefined) {
    if (!Array.isArray(rules) || rules.length > LIMITS.leapRules) {
      issues.push({ path: `${path}.leapRules`, message: `${path}.leapRules must list at most ${LIMITS.leapRules} rules` })
      rulesOk = false
    } else {
      rules.forEach((rule, index) => {
        const at = `${path}.leapRules[${index}]`
        if (!isRecord(rule)) {
          issues.push({ path: at, message: `${at} must be an object` })
          rulesOk = false
          return
        }
        if (!isInt(rule.every) || rule.every < 1 || rule.every > LIMITS.cycleYears) {
          issues.push({ path: `${at}.every`, message: `${at}.every must be a whole number of years from 1 to ${LIMITS.cycleYears}` })
          rulesOk = false
        }
        if (rule.offset !== undefined && (!isInt(rule.offset) || Math.abs(rule.offset) > 1e9)) {
          issues.push({ path: `${at}.offset`, message: `${at}.offset must be a whole number` })
          rulesOk = false
        }
        if (!isInt(rule.part) || rule.part < 0 || rule.part >= parts.length) {
          issues.push({ path: `${at}.part`, message: `${at}.part must be the index of one of the calendar's parts (0 to ${parts.length - 1})` })
          rulesOk = false
        }
        if (!isInt(rule.days) || rule.days === 0 || Math.abs(rule.days) > LIMITS.partDays) {
          issues.push({ path: `${at}.days`, message: `${at}.days must be a whole number of days to add or take away, not 0` })
          rulesOk = false
        }
        for (const key of Object.keys(rule)) {
          if (!['every', 'offset', 'part', 'days'].includes(key)) issues.push({ path: `${at}.${key}`, message: `${at} has an unknown field "${key}"` })
        }
      })
    }
  }
  if (partsOk && rulesOk) {
    const typedRules = rules as LeapRule[] | undefined
    const cycle = cycleYears(typedRules)
    if (!Number.isFinite(cycle)) {
      issues.push({ path: `${path}.leapRules`, message: `${path}.leapRules repeat over more than ${LIMITS.cycleYears} years` })
    } else {
      for (let year = 1; year <= cycle; year++) {
        const lengths = partLengthsIn(year, parts as CalendarPart[], typedRules)
        const short = lengths.findIndex((days) => days < 1 || days > LIMITS.partDays)
        if (short >= 0) {
          issues.push({
            path: `${path}.leapRules`,
            message: `${path}.leapRules leave ${(parts as CalendarPart[])[short]!.name} with ${lengths[short]} days in some years; a part has 1 to ${LIMITS.partDays}`,
          })
          break
        }
      }
    }
  }

  if (!isInt(value.epoch) || Math.abs(value.epoch * dayLength * 1000) > MAX_TIME) {
    issues.push({ path: `${path}.epoch`, message: `${path}.epoch must be a whole axis day within the range a date can hold` })
  }

  const eras = value.eras
  if (eras !== undefined) {
    if (!Array.isArray(eras) || eras.length < 1 || eras.length > LIMITS.eras) {
      issues.push({ path: `${path}.eras`, message: `${path}.eras must list 1 to ${LIMITS.eras} eras` })
    } else {
      let previous = -Infinity
      eras.forEach((era, index) => {
        const at = `${path}.eras[${index}]`
        if (!isRecord(era)) {
          issues.push({ path: at, message: `${at} must be an object` })
          return
        }
        // An empty label is allowed for a calendar of one era: its years read "Year 312".
        if (!(era.label === '' && eras.length === 1)) {
          issues.push(...nameProblems(`${at}.label`, era.label, LIMITS.labelLength, FORBIDDEN_IN_LABEL, 'a "|"'))
          if (typeof era.label === 'string' && /\d/.test(era.label)) {
            issues.push({ path: `${at}.label`, message: `${at}.label cannot contain a digit, which would read as part of the year` })
          }
          // "40 before AR" counts back from the first era: a label that reads the same way would be ambiguous.
          if (typeof era.label === 'string' && /^(before\b|year$)/iu.test(era.label.trim())) {
            issues.push({ path: `${at}.label`, message: `${at}.label cannot start with "before" or be "Year", which name years before an era` })
          }
        }
        if (!isInt(era.from) || era.from <= previous) {
          issues.push({ path: `${at}.from`, message: `${at}.from must be a whole year after the previous era's` })
        } else previous = era.from
      })
      if (eras.every((era) => isRecord(era) && typeof era.label === 'string' && era.label !== '')) {
        issues.push(...distinctNames(`${path}.eras`, (eras as CalendarEra[]).map((era) => era.label)))
      }
    }
  }
  if (value.beforeEra !== undefined) {
    issues.push(...nameProblems(`${path}.beforeEra`, value.beforeEra, LIMITS.labelLength, FORBIDDEN_IN_LABEL, 'a "|"'))
    if (typeof value.beforeEra === 'string' && /\d/.test(value.beforeEra)) {
      issues.push({ path: `${path}.beforeEra`, message: `${path}.beforeEra cannot contain a digit` })
    }
    const labels = Array.isArray(eras) ? eras.map((era) => (isRecord(era) && typeof era.label === 'string' ? sameNameKey(era.label.trim()) : '')) : []
    if (typeof value.beforeEra === 'string' && labels.includes(sameNameKey(value.beforeEra.trim()))) {
      issues.push({ path: `${path}.beforeEra`, message: `${path}.beforeEra must differ from every era's label` })
    }
  }

  const week = value.week
  if (week !== undefined) {
    if (!isRecord(week) || !Array.isArray(week.days) || week.days.length < 1 || week.days.length > LIMITS.weekDays) {
      issues.push({ path: `${path}.week`, message: `${path}.week must name 1 to ${LIMITS.weekDays} days` })
    } else {
      const dayIssues = week.days.flatMap((day, index) =>
        nameProblems(`${path}.week.days[${index}]`, day, LIMITS.nameLength, FORBIDDEN_IN_MONTH_NAME, 'a comma, a "|", brackets or a double quote')
      )
      issues.push(...dayIssues)
      if (dayIssues.length === 0) issues.push(...distinctNames(`${path}.week.days`, week.days as string[]))
      if (week.epochWeekday !== undefined && (!isInt(week.epochWeekday) || week.epochWeekday < 0 || week.epochWeekday >= week.days.length)) {
        issues.push({ path: `${path}.week.epochWeekday`, message: `${path}.week.epochWeekday must be the index of one of its days` })
      }
      if (week.skipsIntercalary !== undefined && typeof week.skipsIntercalary !== 'boolean') {
        issues.push({ path: `${path}.week.skipsIntercalary`, message: `${path}.week.skipsIntercalary must be true or false` })
      }
    }
  }

  const time = value.time
  if (time !== undefined) {
    if (!isRecord(time)) issues.push({ path: `${path}.time`, message: `${path}.time must be an object` })
    else {
      const units = { ...DEFAULT_TIME, ...time } as Record<string, unknown>
      for (const key of ['hoursPerDay', 'minutesPerHour', 'secondsPerMinute']) {
        if (!isInt(units[key]) || (units[key] as number) < 1 || (units[key] as number) > LIMITS.timeUnit) {
          issues.push({ path: `${path}.time.${key}`, message: `${path}.time.${key} must be a whole number from 1 to ${LIMITS.timeUnit}` })
        }
      }
      const total = (units.hoursPerDay as number) * (units.minutesPerHour as number) * (units.secondsPerMinute as number)
      if (Number.isFinite(total) && total > LIMITS.secondsPerDayUnits) {
        issues.push({ path: `${path}.time`, message: `${path}.time divides the day into more than ${LIMITS.secondsPerDayUnits} seconds` })
      }
    }
  }
  // A position is a whole millisecond: a second shorter than one could not be told from the next.
  {
    const units = { ...DEFAULT_TIME, ...(isRecord(time) ? time : {}) } as Record<string, unknown>
    const total = (units.hoursPerDay as number) * (units.minutesPerHour as number) * (units.secondsPerMinute as number)
    if (Number.isFinite(total) && total > dayLength * 1000) {
      issues.push({
        path: `${path}.time`,
        message: `${path}.time divides a day of ${dayLength} seconds into ${total} seconds; each must last at least a millisecond`,
      })
    }
  }

  const notation = value.notation
  if (notation !== undefined) {
    if (!isRecord(notation)) issues.push({ path: `${path}.notation`, message: `${path}.notation must be an object` })
    else
      for (const kind of ['date', 'month', 'year', 'festival', 'time'] as const) {
        issues.push(...templateProblems(`${path}.notation.${kind}`, notation[kind], kind))
      }
  }
  return issues
}

/** Every issue with a calendar set from outside (a request, a tool, an import). Empty when usable. */
export function calendarSetIssues(value: unknown): WorldCalendarIssue[] {
  if (!isRecord(value)) return [{ path: 'calendar', message: 'calendar must be an object' }]
  const issues: WorldCalendarIssue[] = []
  for (const key of Object.keys(value)) {
    if (!['version', 'dayLength', 'calendars', 'primary'].includes(key)) issues.push({ path: `calendar.${key}`, message: `calendar has an unknown field "${key}"` })
  }
  if (value.version !== 2) issues.push({ path: 'calendar.version', message: 'calendar.version must be 2' })
  const dayLength = value.dayLength
  if (!isInt(dayLength) || dayLength < 1 || dayLength > LIMITS.dayLength) {
    issues.push({ path: 'calendar.dayLength', message: `calendar.dayLength must be a whole number of seconds from 1 to ${LIMITS.dayLength}` })
  }
  const calendars = value.calendars
  if (!Array.isArray(calendars) || calendars.length < 1 || calendars.length > LIMITS.calendars) {
    issues.push({ path: 'calendar.calendars', message: `calendar.calendars must list 1 to ${LIMITS.calendars} calendars` })
    return issues
  }
  const length = isInt(dayLength) && dayLength >= 1 ? dayLength : 86_400
  calendars.forEach((definition, index) => issues.push(...calendarDefinitionIssues(definition, `calendar.calendars[${index}]`, length)))
  const ids = calendars.map((definition) => (isRecord(definition) ? definition.id : undefined))
  if (new Set(ids).size !== ids.length) issues.push({ path: 'calendar.calendars', message: 'calendar.calendars must have distinct ids' })
  if (typeof value.primary !== 'string' || !ids.includes(value.primary)) {
    issues.push({ path: 'calendar.primary', message: 'calendar.primary must be the id of one of its calendars' })
  }
  return issues
}

/** A checked calendar set, its names trimmed. Throws on an unusable one. */
export function normalizeCalendarSet(value: unknown): WorldCalendarSet {
  const issues = calendarSetIssues(value)
  if (issues.length > 0) throw new Error(issues.map((issue) => issue.message).join('; '))
  const set = value as WorldCalendarSet
  return {
    version: 2,
    dayLength: set.dayLength,
    primary: set.primary,
    calendars: set.calendars.map((definition) => ({
      ...definition,
      name: definition.name.trim(),
      parts: definition.parts.map((part) => ({ ...part, name: part.name.trim() })),
      ...(definition.eras ? { eras: definition.eras.map((era) => ({ ...era, label: era.label.trim() })) } : {}),
      ...(definition.beforeEra !== undefined ? { beforeEra: definition.beforeEra.trim() } : {}),
      ...(definition.week ? { week: { ...definition.week, days: definition.week.days.map((day) => day.trim()) } } : {}),
    })),
  }
}
