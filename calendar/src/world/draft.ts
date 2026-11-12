/**
 * The app's world-calendar editor: a calendar set as a form holds it (every
 * number as the text typed), what is wrong with it, and what it sends
 * (docs/specs/world-calendars.md, Req 2-12).
 *
 * A draft is read into the shape a request carries and checked by the same
 * rules (`calendarSetIssues`), each problem filed under the field it is about.
 * So the editor accepts exactly what the API accepts, and what it sends is
 * what the API stores (`normalizeCalendarSet`).
 */

import { parseIsoInstant } from '../instant'
import {
  type CalendarDefinition,
  type CalendarNotation,
  DEFAULT_NOTATION,
  DEFAULT_TIME,
  LIMITS,
  type WorldCalendarSet,
  calendarSetIssues,
  normalizeCalendarSet,
} from './definition'
import { gregorianDefinition } from './legacy'

export interface PartDraft {
  name: string
  days: string
  /** Festival days, belonging to no month. */
  festival: boolean
}

export interface LeapRuleDraft {
  every: string
  offset: string
  /** The part's index, as text. */
  part: string
  days: string
}

export interface EraDraft {
  label: string
  from: string
}

export type NotationDraft = Record<keyof Required<CalendarNotation>, string>

export interface CalendarDraftV2 {
  id: string
  name: string
  parts: PartDraft[]
  leapRules: LeapRuleDraft[]
  /** The axis day year 1 begins on, or an ISO date (that day on the axis). */
  epoch: string
  eras: EraDraft[]
  beforeEra: string
  /** The weekday names, one per line or separated by commas; empty for no week. */
  weekDays: string
  /** The weekday of the epoch's first day, as an index ('' for the first). */
  epochWeekday: string
  skipsIntercalary: boolean
  /** '' for the default (24, 60, 60). */
  hoursPerDay: string
  minutesPerHour: string
  secondsPerMinute: string
  /** '' for the default template. */
  notation: NotationDraft
}

export interface WorldDraft {
  /** The world's day, in Earth hours ("24", "30", "0.5") or hours, minutes and seconds ("26:40", "0:16:40"). */
  dayHours: string
  primary: string
  calendars: CalendarDraftV2[]
}

/** Problems keyed by where they are: "dayHours", "calendars.0.parts.2.days", "calendars.1.weekDays". */
export type WorldDraftErrors = Record<string, string>

const EMPTY_NOTATION: NotationDraft = { date: '', month: '', year: '', festival: '', time: '' }

const text = (value: number | undefined) => (value === undefined ? '' : String(value))

/** A calendar as the editor holds it. */
export function draftFromDefinition(definition: CalendarDefinition): CalendarDraftV2 {
  return {
    id: definition.id,
    name: definition.name,
    parts: definition.parts.map((part) => ({ name: part.name, days: String(part.days), festival: Boolean(part.intercalary) })),
    leapRules: (definition.leapRules ?? []).map((rule) => ({
      every: String(rule.every),
      offset: text(rule.offset),
      part: String(rule.part),
      days: String(rule.days),
    })),
    epoch: String(definition.epoch),
    eras: (definition.eras ?? []).map((era) => ({ label: era.label, from: String(era.from) })),
    beforeEra: definition.beforeEra ?? '',
    weekDays: definition.week ? definition.week.days.join('\n') : '',
    epochWeekday: text(definition.week?.epochWeekday),
    skipsIntercalary: Boolean(definition.week?.skipsIntercalary),
    hoursPerDay: text(definition.time?.hoursPerDay),
    minutesPerHour: text(definition.time?.minutesPerHour),
    secondsPerMinute: text(definition.time?.secondsPerMinute),
    notation: { ...EMPTY_NOTATION, ...definition.notation },
  }
}

/** A set as the editor holds it. */
export function draftFromSet(set: WorldCalendarSet): WorldDraft {
  return {
    dayHours: hoursText(set.dayLength),
    primary: set.primary,
    calendars: set.calendars.map(draftFromDefinition),
  }
}

/** Seconds as hours ("30"), or as hours, minutes and seconds ("0:16:40"): what {@link dayLengthOf} reads back as them. */
function hoursText(seconds: number): string {
  if (seconds % 3600 === 0) return String(seconds / 3600)
  const two = (value: number) => String(value).padStart(2, '0')
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return rest === 0 ? `${hours}:${two(minutes)}` : `${hours}:${two(minutes)}:${two(rest)}`
}

/**
 * A new calendar for a world: the Gregorian shape, to change from there,
 * dividing the day as the world's first calendar does (so its seconds fit a
 * day of any length).
 */
export function newCalendarDraft(world: WorldDraft | null, name = 'Calendar'): CalendarDraftV2 {
  const existingIds = world ? world.calendars.map((calendar) => calendar.id) : []
  let index = existingIds.length + 1
  let id = index === 1 ? 'calendar' : `calendar-${index}`
  while (existingIds.includes(id)) id = `calendar-${++index}`
  const draft = draftFromDefinition(gregorianDefinition({ id, name }))
  const first = world?.calendars[0]
  return first
    ? { ...draft, hoursPerDay: first.hoursPerDay, minutesPerHour: first.minutesPerHour, secondsPerMinute: first.secondsPerMinute }
    : draft
}

/** A new world: one calendar, Earth's day. */
export function newWorldDraft(): WorldDraft {
  const calendar = newCalendarDraft(null)
  return { dayHours: '24', primary: calendar.id, calendars: [calendar] }
}

// ── Reading ──────────────────────────────────────────────────────────────

/** A whole number as typed; the text itself when it is not one (so the rules name it); undefined when empty. */
function wholeNumber(value: string): number | string | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return /^[+-]?\d{1,15}$/.test(trimmed) ? Number(trimmed) : trimmed
}

function dayLengthOf(hours: string): number | string {
  const trimmed = hours.trim()
  const clock = /^(\d{1,7}):([0-5]\d)(?::([0-5]\d))?$/.exec(trimmed)
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3] ?? 0)
  if (!/^\d{1,7}(?:\.\d{1,12})?$/.test(trimmed)) return trimmed
  const seconds = Number(trimmed) * 3600
  const whole = Math.round(seconds)
  // A day is a whole number of seconds: "0.5" hours is, "0.0001" is not.
  return Math.abs(seconds - whole) < 1e-6 ? whole : trimmed
}

/** The epoch as typed: a whole axis day, or an ISO date (the day it falls on). */
function epochOf(value: string, dayLength: number | string): number | string {
  const whole = wholeNumber(value)
  if (typeof whole === 'number' || whole === undefined) return whole ?? value
  const date = parseIsoInstant(whole)
  if (!date || typeof dayLength !== 'number') return whole
  return Math.floor(date.date.getTime() / (dayLength * 1000))
}

const splitNames = (value: string) =>
  (value.includes('\n') ? value.split('\n') : value.split(','))
    .map((name) => name.trim())
    .filter((name) => name !== '')

function definitionOf(draft: CalendarDraftV2, dayLength: number | string): Record<string, unknown> {
  const definition: Record<string, unknown> = {
    id: draft.id,
    name: draft.name,
    parts: draft.parts.map((part) => ({
      name: part.name,
      days: wholeNumber(part.days) ?? part.days,
      ...(part.festival ? { intercalary: true } : {}),
    })),
    epoch: epochOf(draft.epoch, dayLength),
  }
  if (draft.leapRules.length > 0) {
    definition.leapRules = draft.leapRules.map((rule) => {
      const offset = wholeNumber(rule.offset)
      return {
        every: wholeNumber(rule.every) ?? rule.every,
        ...(offset !== undefined ? { offset } : {}),
        part: wholeNumber(rule.part) ?? rule.part,
        days: wholeNumber(rule.days) ?? rule.days,
      }
    })
  }
  if (draft.eras.length > 0) definition.eras = draft.eras.map((era) => ({ label: era.label, from: wholeNumber(era.from) ?? era.from }))
  if (draft.beforeEra.trim() !== '') definition.beforeEra = draft.beforeEra
  const weekDays = splitNames(draft.weekDays)
  if (weekDays.length > 0) {
    const epochWeekday = wholeNumber(draft.epochWeekday)
    definition.week = {
      days: weekDays,
      ...(epochWeekday !== undefined ? { epochWeekday } : {}),
      ...(draft.skipsIntercalary ? { skipsIntercalary: true } : {}),
    }
  }
  const time: Record<string, unknown> = {}
  for (const unit of ['hoursPerDay', 'minutesPerHour', 'secondsPerMinute'] as const) {
    const value = wholeNumber(draft[unit])
    if (value !== undefined) time[unit] = value
  }
  if (Object.keys(time).length > 0) definition.time = time
  const notation: Record<string, string> = {}
  for (const [key, template] of Object.entries(draft.notation)) if (template.trim() !== '') notation[key] = template
  if (Object.keys(notation).length > 0) definition.notation = notation
  return definition
}

/** The draft as a request carries it (not yet checked). */
export function draftAsSet(draft: WorldDraft): Record<string, unknown> {
  const dayLength = dayLengthOf(draft.dayHours)
  return {
    version: 2,
    dayLength,
    calendars: draft.calendars.map((calendar) => definitionOf(calendar, dayLength)),
    primary: draft.primary,
  }
}

/** Where an issue is, as an error key: "calendar.calendars[0].week.days" → "calendars.0.weekDays". */
function errorKey(path: string): string {
  const key = path
    .replace(/^calendar\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/^\./, '')
  if (key === 'dayLength' || key === '') return key === '' ? 'calendars' : 'dayHours'
  return key
    .replace(/\.intercalary$/, '.festival')
    .replace(/\.week\.epochWeekday$/, '.epochWeekday')
    .replace(/\.week\.skipsIntercalary$/, '.skipsIntercalary')
    .replace(/\.week(\.days(\.\d+)?)?$/, '.weekDays')
    .replace(/\.time\.(hoursPerDay|minutesPerHour|secondsPerMinute)$/, '.$1')
}

/** An issue's message for the field it is shown beside: its path left out, as a sentence. */
function fieldMessage(path: string, message: string): string {
  // The day is typed in hours, and checked in seconds.
  if (path === 'calendar.dayLength') {
    return `A day must last a whole number of seconds, from 1 second to ${hoursText(LIMITS.dayLength)} hours.`
  }
  let rest = message.startsWith(path) ? message.slice(path.length).trim() : message
  rest = rest.charAt(0).toUpperCase() + rest.slice(1)
  return /[.!?]$/.test(rest) ? rest : `${rest}.`
}

/** What the editor says is wrong, by field; empty when the API would take the set. */
export function worldDraftErrors(draft: WorldDraft): WorldDraftErrors {
  const errors: WorldDraftErrors = {}
  for (const issue of calendarSetIssues(draftAsSet(draft))) {
    const key = errorKey(issue.path)
    if (!(key in errors)) errors[key] = fieldMessage(issue.path, issue.message)
  }
  return errors
}

/** The set a draft names, as the API stores it; or the problems, by field. */
export function readWorldDraft(draft: WorldDraft): { ok: true; set: WorldCalendarSet } | { ok: false; errors: WorldDraftErrors } {
  const errors = worldDraftErrors(draft)
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, set: normalizeCalendarSet(draftAsSet(draft)) }
}

/** The first problem at a field or anywhere inside it ("calendars.0.parts" covers each part's). */
export function draftErrorAt(errors: WorldDraftErrors, key: string): string | undefined {
  if (errors[key]) return errors[key]
  const inside = Object.keys(errors).find((candidate) => candidate.startsWith(`${key}.`))
  return inside ? errors[inside] : undefined
}

/** The template a notation field falls back to when left empty. */
export function defaultNotation(key: keyof NotationDraft): string {
  return DEFAULT_NOTATION[key]
}

/** The unit counts a time field falls back to when left empty. */
export function defaultTimeUnit(key: 'hoursPerDay' | 'minutesPerHour' | 'secondsPerMinute'): number {
  return DEFAULT_TIME[key]
}
