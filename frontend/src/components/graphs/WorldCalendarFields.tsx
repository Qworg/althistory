import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  type CalendarDraftV2,
  type LeapRuleDraft,
  type NotationDraft,
  type PartDraft,
  type WorldDraft,
  LIMITS,
  calendarIn,
  calendarSetIssues,
  dateAt,
  defaultNotation,
  defaultTimeUnit,
  draftAsSet,
  draftErrorAt,
  formatWorldFields,
  newCalendarDraft,
  normalizeCalendarSet,
  readWorldDraft,
} from '@althistory/calendar'
import type { CalendarDraftState } from './useCalendarDraft'

interface WorldCalendarFieldsProps {
  /** From `useCalendarDraft`. */
  state: CalendarDraftState
  /** Prefixes the field ids, so two forms on one page do not share them. */
  idPrefix: string
  /**
   * A position on the timeline to show in the preview: the graph's first
   * event when it has one, so the preview speaks about this history.
   */
  samplePosition?: number
  disabled?: boolean
}

const INPUT_CLASS =
  'w-full min-w-0 px-2 py-1.5 border rounded-md bg-card text-ink text-sm placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-selected disabled:opacity-50'
const SELECT_CLASS =
  'min-w-0 max-w-full px-2 py-1.5 border border-line rounded-md bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-selected disabled:opacity-50'
const SMALL_BUTTON = 'rounded border border-line px-2 py-1 text-xs text-ink hover:bg-subtle disabled:opacity-40'
const ICON_BUTTON = 'rounded px-1.5 py-1 text-xs text-ink-secondary hover:bg-subtle hover:text-ink disabled:opacity-30'

const NOTATION_FIELDS: Array<{ key: keyof NotationDraft; label: string }> = [
  { key: 'date', label: 'A day' },
  { key: 'month', label: 'A month' },
  { key: 'year', label: 'A year' },
  { key: 'festival', label: 'A one-day festival' },
  { key: 'time', label: 'A time of day' },
]

const TIME_FIELDS = [
  { key: 'hoursPerDay', label: 'Hours in a day' },
  { key: 'minutesPerHour', label: 'Minutes in an hour' },
  { key: 'secondsPerMinute', label: 'Seconds in a minute' },
] as const

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

/** A labelled text field with the problem filed under its key, shown once it has a value or the form was submitted. */
function Field({
  id,
  label,
  value,
  onChange,
  error,
  showError,
  placeholder,
  hint,
  mono = false,
  inputMode,
  labelHidden = false,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  showError: boolean
  placeholder?: string
  hint?: ReactNode
  mono?: boolean
  inputMode?: 'numeric' | 'decimal' | 'text'
  labelHidden?: boolean
}) {
  const shown = error && (showError || value.trim() !== '') ? error : undefined
  const describedBy = [shown ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={labelHidden ? 'sr-only' : 'block text-xs font-medium text-ink-secondary mb-1'}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={shown ? true : undefined}
        aria-describedby={describedBy}
        className={`${INPUT_CLASS} ${mono ? 'font-mono-code' : ''} ${shown ? 'border-red-500 dark:border-red-400' : 'border-line'}`}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {shown && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-700 dark:text-red-300">
          {shown}
        </p>
      )}
    </div>
  )
}

/** A problem with a whole list (months, leap rules, eras), shown under it. */
function ListError({ id, error }: { id: string; error?: string }) {
  if (!error) return null
  return (
    <p id={id} className="mt-1 text-xs text-red-700 dark:text-red-300" role="status">
      {error}
    </p>
  )
}

/**
 * What a calendar looks like: its year 1 and a date in the history (or a
 * hundred days on), once the whole set checks out.
 */
function Preview({ draft, index, samplePosition }: { draft: WorldDraft; index: number; samplePosition?: number }) {
  const read = readWorldDraft(draft)
  if (!read.ok) return <p className="text-xs text-ink-muted">The preview shows once every field above checks out.</p>
  const calendar = calendarIn(read.set, read.set.calendars[index]!.id)
  const first = calendar.definition.epoch * calendar.dayMs
  const sample = samplePosition ?? first + 100 * calendar.dayMs
  const line = (position: number) => formatWorldFields(calendar, dateAt(calendar, position), 'day', true)
  return (
    <div className="text-xs text-ink-secondary space-y-0.5">
      <p>
        Year 1 begins on <span className="font-medium text-ink">{line(first)}</span>.
      </p>
      <p>
        {samplePosition === undefined ? 'A hundred days later is' : 'The history begins on'}{' '}
        <span className="font-medium text-ink">{line(sample)}</span>, in the month{' '}
        <span className="font-medium text-ink">{formatWorldFields(calendar, dateAt(calendar, sample), 'month')}</span>.
      </p>
    </div>
  )
}

function CalendarEditor({
  draft,
  index,
  idPrefix,
  state,
  samplePosition,
  showErrors,
}: {
  draft: WorldDraft
  index: number
  idPrefix: string
  state: CalendarDraftState
  samplePosition?: number
  showErrors: boolean
}) {
  const calendar = draft.calendars[index]!
  const errors = state.errors
  const at = `calendars.${index}`
  const id = (name: string) => `${idPrefix}-cal${index}-${name}`
  const errorAt = (key: string) => draftErrorAt(errors, `${at}.${key}`)

  const change = (patch: Partial<CalendarDraftV2>) =>
    state.update((current) => ({
      ...current,
      calendars: current.calendars.map((candidate, position) => (position === index ? { ...candidate, ...patch } : candidate)),
    }))
  const changePart = (partIndex: number, patch: Partial<PartDraft>) =>
    change({ parts: calendar.parts.map((part, position) => (position === partIndex ? { ...part, ...patch } : part)) })
  const changeRule = (ruleIndex: number, patch: Partial<LeapRuleDraft>) =>
    change({ leapRules: calendar.leapRules.map((rule, position) => (position === ruleIndex ? { ...rule, ...patch } : rule)) })

  /** Moving or removing a part renumbers the leap rules that point at the parts after it. */
  const reorderParts = (order: number[]) => {
    const parts = order.map((from) => calendar.parts[from]!)
    const leapRules = calendar.leapRules
      .map((rule) => ({ ...rule, part: String(order.indexOf(Number(rule.part))) }))
      .filter((rule) => rule.part !== '-1')
    change({ parts, leapRules })
  }
  const partOrder = calendar.parts.map((_, position) => position)

  const weekDayNames = calendar.weekDays
    .split(calendar.weekDays.includes('\n') ? '\n' : ',')
    .map((name) => name.trim())
    .filter(Boolean)

  return (
    <div className="space-y-4">
      <Field
        id={id('name')}
        label="Calendar name"
        value={calendar.name}
        onChange={(name) => change({ name })}
        error={errorAt('name')}
        showError={showErrors}
        placeholder="the Reckoning of the Rising"
      />

      <section aria-labelledby={id('parts-heading')}>
        <h4 id={id('parts-heading')} className="text-xs font-semibold text-ink">
          Months and festival days, in order
        </h4>
        <p className="text-xs text-ink-muted">
          Festival days belong to no month (“Midwinter”, three days between two months). A one-day festival is
          written by its name alone.
        </p>
        <ul className="mt-2 space-y-1.5">
          {calendar.parts.map((part, partIndex) => (
            <li key={partIndex} className="flex flex-wrap items-start gap-1 sm:flex-nowrap">
              {/* On a phone the name has the line to itself; its days and controls go under it. */}
              <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                <Field
                  id={id(`part${partIndex}-name`)}
                  label={`${part.festival ? 'Festival' : 'Month'} ${partIndex + 1} name`}
                  labelHidden
                  value={part.name}
                  onChange={(name) => changePart(partIndex, { name })}
                  error={errorAt(`parts.${partIndex}.name`)}
                  showError={showErrors}
                  placeholder={part.festival ? 'Midwinter' : 'Thaw'}
                />
              </div>
              <div className="w-14 shrink-0">
                <Field
                  id={id(`part${partIndex}-days`)}
                  label={`${part.name || `Part ${partIndex + 1}`}: days`}
                  labelHidden
                  value={part.days}
                  onChange={(days) => changePart(partIndex, { days })}
                  error={errorAt(`parts.${partIndex}.days`)}
                  showError={showErrors}
                  placeholder="days"
                  inputMode="numeric"
                  mono
                />
              </div>
              <label className="flex shrink-0 items-center gap-1 py-1.5 text-xs text-ink-secondary">
                <input
                  type="checkbox"
                  checked={part.festival}
                  onChange={(event) => changePart(partIndex, { festival: event.target.checked })}
                />
                Festival
              </label>
              <span className="flex shrink-0">
                <button
                  type="button"
                  className={ICON_BUTTON}
                  disabled={partIndex === 0}
                  aria-label={`Move ${part.name || `part ${partIndex + 1}`} earlier`}
                  onClick={() => reorderParts(move(partOrder, partIndex, partIndex - 1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={ICON_BUTTON}
                  disabled={partIndex === calendar.parts.length - 1}
                  aria-label={`Move ${part.name || `part ${partIndex + 1}`} later`}
                  onClick={() => reorderParts(move(partOrder, partIndex, partIndex + 1))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={ICON_BUTTON}
                  disabled={calendar.parts.length === 1}
                  aria-label={`Remove ${part.name || `part ${partIndex + 1}`}`}
                  onClick={() => reorderParts(partOrder.filter((position) => position !== partIndex))}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
        <ListError id={id('parts-error')} error={errors[`${at}.parts`]} />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={SMALL_BUTTON}
            disabled={calendar.parts.length >= LIMITS.parts}
            onClick={() => change({ parts: [...calendar.parts, { name: '', days: '30', festival: false }] })}
          >
            Add a month
          </button>
          <button
            type="button"
            className={SMALL_BUTTON}
            disabled={calendar.parts.length >= LIMITS.parts}
            onClick={() => change({ parts: [...calendar.parts, { name: '', days: '1', festival: true }] })}
          >
            Add festival days
          </button>
        </div>
      </section>

      <section aria-labelledby={id('leap-heading')}>
        <h4 id={id('leap-heading')} className="text-xs font-semibold text-ink">
          Leap years
        </h4>
        <p className="text-xs text-ink-muted">
          Each rule adds days to (or, with a negative number, takes them from) a month every so many years, counting
          from a year. The Gregorian calendar has three: every 4 years +1, every 100 −1, every 400 +1.
        </p>
        <ul className="mt-2 space-y-1.5">
          {calendar.leapRules.map((rule, ruleIndex) => (
            <li key={ruleIndex} className="flex flex-wrap items-center gap-1.5 text-xs text-ink-secondary">
              <span>Every</span>
              <div className="w-16">
                <Field
                  id={id(`rule${ruleIndex}-every`)}
                  label={`Rule ${ruleIndex + 1}: every how many years`}
                  labelHidden
                  value={rule.every}
                  onChange={(every) => changeRule(ruleIndex, { every })}
                  error={errorAt(`leapRules.${ruleIndex}.every`)}
                  showError={showErrors}
                  inputMode="numeric"
                  mono
                />
              </div>
              <span>years, counting from year</span>
              <div className="w-16">
                <Field
                  id={id(`rule${ruleIndex}-offset`)}
                  label={`Rule ${ruleIndex + 1}: counting from year`}
                  labelHidden
                  value={rule.offset}
                  onChange={(offset) => changeRule(ruleIndex, { offset })}
                  error={errorAt(`leapRules.${ruleIndex}.offset`)}
                  showError={showErrors}
                  placeholder="0"
                  inputMode="numeric"
                  mono
                />
              </div>
              <span>:</span>
              <label className="sr-only" htmlFor={id(`rule${ruleIndex}-part`)}>
                Rule {ruleIndex + 1}: which month
              </label>
              <select
                id={id(`rule${ruleIndex}-part`)}
                value={rule.part}
                onChange={(event) => changeRule(ruleIndex, { part: event.target.value })}
                className={SELECT_CLASS}
              >
                {calendar.parts.map((part, partIndex) => (
                  <option key={partIndex} value={String(partIndex)}>
                    {part.name || `Part ${partIndex + 1}`}
                  </option>
                ))}
              </select>
              <span>gets</span>
              <div className="w-16">
                <Field
                  id={id(`rule${ruleIndex}-days`)}
                  label={`Rule ${ruleIndex + 1}: days added`}
                  labelHidden
                  value={rule.days}
                  onChange={(days) => changeRule(ruleIndex, { days })}
                  error={errorAt(`leapRules.${ruleIndex}.days`)}
                  showError={showErrors}
                  inputMode="numeric"
                  mono
                />
              </div>
              <span>more days</span>
              <button
                type="button"
                className={ICON_BUTTON}
                aria-label={`Remove leap rule ${ruleIndex + 1}`}
                onClick={() => change({ leapRules: calendar.leapRules.filter((_, position) => position !== ruleIndex) })}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <ListError id={id('leap-error')} error={errors[`${at}.leapRules`]} />
        <button
          type="button"
          className={`${SMALL_BUTTON} mt-2`}
          disabled={calendar.leapRules.length >= LIMITS.leapRules}
          onClick={() => change({ leapRules: [...calendar.leapRules, { every: '4', offset: '', part: '0', days: '1' }] })}
        >
          Add a leap rule
        </button>
      </section>

      <section aria-labelledby={id('years-heading')} className="space-y-2">
        <h4 id={id('years-heading')} className="text-xs font-semibold text-ink">
          Years and eras
        </h4>
        <Field
          id={id('epoch')}
          label="Year 1 begins on"
          value={calendar.epoch}
          onChange={(epoch) => change({ epoch })}
          error={errorAt('epoch')}
          showError={showErrors}
          inputMode="text"
          mono
          hint="A day of the timeline (day 0 begins at 1970-01-01, UTC), or an ISO date. It places this calendar against the world’s others."
        />
        <ul className="space-y-1.5">
          {calendar.eras.map((era, eraIndex) => (
            <li key={eraIndex} className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1">
                <Field
                  id={id(`era${eraIndex}-label`)}
                  label={`Era ${eraIndex + 1} label`}
                  value={era.label}
                  onChange={(label) =>
                    change({ eras: calendar.eras.map((candidate, position) => (position === eraIndex ? { ...candidate, label } : candidate)) })
                  }
                  error={errorAt(`eras.${eraIndex}.label`)}
                  showError={showErrors}
                  placeholder="AR"
                />
              </div>
              <div className="w-24 shrink-0">
                <Field
                  id={id(`era${eraIndex}-from`)}
                  label="Its year 1 is year"
                  value={era.from}
                  onChange={(from) =>
                    change({ eras: calendar.eras.map((candidate, position) => (position === eraIndex ? { ...candidate, from } : candidate)) })
                  }
                  error={errorAt(`eras.${eraIndex}.from`)}
                  showError={showErrors}
                  inputMode="numeric"
                  mono
                />
              </div>
              <button
                type="button"
                className={`${ICON_BUTTON} self-end mb-1`}
                aria-label={`Remove era ${era.label || eraIndex + 1}`}
                onClick={() => change({ eras: calendar.eras.filter((_, position) => position !== eraIndex) })}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <ListError id={id('eras-error')} error={errors[`${at}.eras`]} />
        <button
          type="button"
          className={SMALL_BUTTON}
          disabled={calendar.eras.length >= LIMITS.eras}
          onClick={() => change({ eras: [...calendar.eras, { label: '', from: calendar.eras.length === 0 ? '1' : '' }] })}
        >
          Add an era
        </button>
        <Field
          id={id('before-era')}
          label="Years before the first era are written"
          value={calendar.beforeEra}
          onChange={(beforeEra) => change({ beforeEra })}
          error={errorAt('beforeEra')}
          showError={showErrors}
          placeholder={calendar.eras[0]?.label ? `before ${calendar.eras[0].label}` : 'before Year 1'}
          hint="The label after a year counted back, such as BAR in “40 BAR”."
        />
      </section>

      <section aria-labelledby={id('week-heading')} className="space-y-2">
        <h4 id={id('week-heading')} className="text-xs font-semibold text-ink">
          Week <span className="font-normal text-ink-muted">(optional)</span>
        </h4>
        <div>
          <label htmlFor={id('week')} className="block text-xs font-medium text-ink-secondary mb-1">
            Names of the week’s days, one per line
          </label>
          <textarea
            id={id('week')}
            rows={3}
            value={calendar.weekDays}
            onChange={(event) => change({ weekDays: event.target.value })}
            aria-invalid={errorAt('weekDays') ? true : undefined}
            aria-describedby={errorAt('weekDays') ? `${id('week')}-error` : undefined}
            className={`${INPUT_CLASS} ${errorAt('weekDays') ? 'border-red-500 dark:border-red-400' : 'border-line'}`}
          />
          <ListError id={`${id('week')}-error`} error={errorAt('weekDays')} />
        </div>
        {weekDayNames.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
              Year 1 begins on a
              <select
                value={calendar.epochWeekday || '0'}
                onChange={(event) => change({ epochWeekday: event.target.value })}
                className={SELECT_CLASS}
              >
                {weekDayNames.map((name, position) => (
                  <option key={position} value={String(position)}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <input
                type="checkbox"
                checked={calendar.skipsIntercalary}
                onChange={(event) => change({ skipsIntercalary: event.target.checked })}
              />
              Festival days are outside the week
            </label>
          </div>
        )}
      </section>

      <section aria-labelledby={id('time-heading')} className="space-y-2">
        <h4 id={id('time-heading')} className="text-xs font-semibold text-ink">
          Time of day
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {TIME_FIELDS.map(({ key, label }) => (
            <Field
              key={key}
              id={id(key)}
              label={label}
              value={calendar[key]}
              onChange={(value) => change({ [key]: value })}
              error={errorAt(key) ?? errorAt('time')}
              showError={showErrors}
              placeholder={String(defaultTimeUnit(key))}
              inputMode="numeric"
              mono
            />
          ))}
        </div>
      </section>

      <section aria-labelledby={id('notation-heading')} className="space-y-2">
        <h4 id={id('notation-heading')} className="text-xs font-semibold text-ink">
          How dates are written
        </h4>
        <p className="text-xs text-ink-muted">
          With <span className="font-mono-code">{'{day}'}</span>, <span className="font-mono-code">{'{month}'}</span>{' '}
          and <span className="font-mono-code">{'{year}'}</span>; a time with{' '}
          <span className="font-mono-code">{'{hour}'}</span>, <span className="font-mono-code">{'{minute}'}</span> and{' '}
          <span className="font-mono-code">{'{second}'}</span>. Leave one empty for the usual form.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {NOTATION_FIELDS.map(({ key, label }) => (
            <Field
              key={key}
              id={id(`notation-${key}`)}
              label={label}
              value={calendar.notation[key]}
              onChange={(value) => change({ notation: { ...calendar.notation, [key]: value } })}
              error={errorAt(`notation.${key}`) ?? (key === 'date' ? errors[`${at}.notation`] : undefined)}
              showError={showErrors}
              placeholder={defaultNotation(key)}
              mono
            />
          ))}
        </div>
      </section>

      <div className="rounded-md bg-subtle px-3 py-2" aria-live="polite">
        <Preview draft={draft} index={index} samplePosition={samplePosition} />
      </div>
    </div>
  )
}

/** The set as JSON, to copy into a file for the CLI, or to paste one in. */
function JsonEditor({ state, idPrefix }: { state: CalendarDraftState; idPrefix: string }) {
  const [text, setText] = useState(() => JSON.stringify(draftAsSet(state.draft), null, 2))
  const [problem, setProblem] = useState<string | null>(null)
  const textId = `${idPrefix}-calendar-json`
  const apply = () => {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      setProblem('That is not JSON.')
      return
    }
    const issues = calendarSetIssues(value)
    if (issues.length > 0) {
      setProblem(issues.map((issue) => issue.message).slice(0, 3).join('; '))
      return
    }
    setProblem(null)
    state.replace(normalizeCalendarSet(value))
  }
  return (
    <div className="space-y-2">
      <label htmlFor={textId} className="block text-xs font-medium text-ink-secondary">
        The calendars as JSON (the shape the API and <span className="font-mono-code">--calendar-file</span> take)
      </label>
      <textarea
        id={textId}
        rows={10}
        value={text}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        aria-describedby={problem ? `${textId}-error` : undefined}
        className={`${INPUT_CLASS} font-mono-code text-xs ${problem ? 'border-red-500 dark:border-red-400' : 'border-line'}`}
      />
      <ListError id={`${textId}-error`} error={problem ?? undefined} />
      <button type="button" className={SMALL_BUTTON} onClick={apply}>
        Use this JSON
      </button>
    </div>
  )
}

/**
 * The optional "World calendars" section of a graph form: for an invented
 * world, calendars of any shape (docs/specs/world-calendars.md) -- months and
 * festival days of any length, leap rules, eras, a week, a day of any length
 * divided its own way, and how dates are written -- several of them if the
 * world keeps several, on the graph's one timeline.
 */
export function WorldCalendarFields({ state, idPrefix, samplePosition, disabled = false }: WorldCalendarFieldsProps) {
  const { enabled, setEnabled, draft, errors, submitted, hadCalendar } = state
  const firstFieldRef = useRef<HTMLDivElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const [asJson, setAsJson] = useState(false)
  // Set by the button that toggles the section, which is unmounted by its own
  // click: focus goes to what replaces it instead of dropping to <body>.
  const moveFocus = useRef(false)

  useEffect(() => {
    if (moveFocus.current) {
      if (enabled) firstFieldRef.current?.querySelector<HTMLInputElement>('input')?.focus()
      else addRef.current?.focus()
    }
    moveFocus.current = false
  }, [enabled])

  const several = draft.calendars.length > 1

  return (
    <fieldset className="rounded-lg border border-line p-3 min-w-0" disabled={disabled}>
      <legend className="px-1 text-sm font-medium text-ink-secondary">
        World calendars <span className="font-normal text-ink-muted">(optional)</span>
      </legend>

      {!enabled ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-muted">
            For an invented world: its own calendars, of any shape — months and festival days of any length, leap
            years, eras, a week, a day of any length divided its own way — and dates written its own way, such as
            “Thaw 4, 312 AR”. A world can keep several calendars; every date is one moment on the graph’s timeline.
          </p>
          {hadCalendar && (
            <p className="text-xs text-ink-secondary" role="status">
              Saving removes the calendars, and dates show as Gregorian dates again.
            </p>
          )}
          <button
            ref={addRef}
            type="button"
            onClick={() => {
              moveFocus.current = true
              setEnabled(true)
            }}
            className="rounded border border-line px-3 py-1.5 text-sm text-ink hover:bg-subtle"
          >
            {hadCalendar ? 'Keep the world calendars' : 'Add a world calendar'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div ref={firstFieldRef} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              id={`${idPrefix}-day-length`}
              label="Length of the world’s day"
              value={draft.dayHours}
              onChange={(dayHours) => state.update((current) => ({ ...current, dayHours }))}
              error={errors.dayHours}
              showError={submitted}
              inputMode="text"
              mono
              hint="In Earth hours (24), or hours, minutes and seconds (26:40). Every calendar of the world shares it."
            />
            {several && (
              <div>
                <label htmlFor={`${idPrefix}-primary`} className="block text-xs font-medium text-ink-secondary mb-1">
                  Dates are shown in
                </label>
                <select
                  id={`${idPrefix}-primary`}
                  value={draft.primary}
                  onChange={(event) => state.update((current) => ({ ...current, primary: event.target.value }))}
                  className={`${INPUT_CLASS} border-line`}
                >
                  {draft.calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name || calendar.id}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink-muted">Unless a viewer picks another.</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className={SMALL_BUTTON} aria-pressed={asJson} onClick={() => setAsJson((value) => !value)}>
              {asJson ? 'Edit with the form' : 'Edit as JSON'}
            </button>
          </div>

          {asJson ? (
            <JsonEditor state={state} idPrefix={idPrefix} />
          ) : (
            draft.calendars.map((calendar, index) => (
              <details key={calendar.id} open={!several || index === 0} className="rounded-md border border-line p-2">
                <summary className="cursor-pointer text-sm font-medium text-ink">
                  {calendar.name || `Calendar ${index + 1}`}
                  {draft.primary === calendar.id && several ? <span className="ml-1 text-xs text-ink-muted">(shown)</span> : null}
                  {draftErrorAt(errors, `calendars.${index}`) && (
                    <span className="ml-1 text-xs text-red-700 dark:text-red-300">— needs attention</span>
                  )}
                </summary>
                <div className="mt-3">
                  <CalendarEditor
                    draft={draft}
                    index={index}
                    idPrefix={idPrefix}
                    state={state}
                    samplePosition={samplePosition}
                    showErrors={submitted}
                  />
                  {several && (
                    <button
                      type="button"
                      className={`${SMALL_BUTTON} mt-3`}
                      onClick={() =>
                        state.update((current) => {
                          const calendars = current.calendars.filter((_, position) => position !== index)
                          const primary = calendars.some((candidate) => candidate.id === current.primary) ? current.primary : calendars[0]!.id
                          return { ...current, calendars, primary }
                        })
                      }
                    >
                      Remove {calendar.name || 'this calendar'}
                    </button>
                  )}
                </div>
              </details>
            ))
          )}
          <ListError id={`${idPrefix}-calendars-error`} error={errors.calendars ?? errors.primary} />

          <div className="flex flex-wrap gap-2">
            {!asJson && (
              <button
                type="button"
                className={SMALL_BUTTON}
                disabled={draft.calendars.length >= LIMITS.calendars}
                onClick={() =>
                  state.update((current) => ({
                    ...current,
                    calendars: [...current.calendars, newCalendarDraft(current, `Calendar ${current.calendars.length + 1}`)],
                  }))
                }
              >
                Add another calendar
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                moveFocus.current = true
                setEnabled(false)
              }}
              className="rounded px-3 py-1.5 text-sm text-ink-secondary hover:bg-subtle hover:text-ink"
            >
              Remove the calendars
            </button>
          </div>
        </div>
      )}
    </fieldset>
  )
}
