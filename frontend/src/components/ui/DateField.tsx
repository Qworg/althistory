import { useId, useState, type InputHTMLAttributes } from 'react'
import type { DateBoundEdge } from '@althistory/calendar'
import { useWorldCalendar } from '@/stores/worldCalendarStore'
import { type DateFieldKind, isNativeDateValue, readDateFieldValue } from '@/utils/dateField'

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'>

interface DateFieldProps extends NativeProps {
  /** The field's value, as `dateFieldValue` gives it for the open graph. */
  value: string
  onChange: (value: string) => void
  /** A date alone, or a date and a time, when the graph has no world calendar. */
  kind: DateFieldKind
  /** Which end of a month or a year an untimed world date stands for. */
  edge?: DateBoundEdge
}

/**
 * A historical date in a form. Without a world calendar it is the native
 * picker, read as UTC. In a world it is text in the calendar shown ("Thaw 4,
 * 312 AR", "Thaw 312 AR, 06:30"), with what it cannot read said once the
 * field is left.
 */
export function DateField({ value, onChange, kind, edge = 'start', className, onBlur, ...rest }: DateFieldProps) {
  const calendar = useWorldCalendar()
  const errorId = useId()
  const [touched, setTouched] = useState(false)
  const [typed, setTyped] = useState(false)

  // Without a world, the native picker holds the years 0001 to 9999. A date
  // outside them (44 BCE is not one; nor is 300000 CE) is typed, year first, and
  // read as every other typed date is; the field is text while it holds one.
  const nativeValue = value === '' || isNativeDateValue(value)
  const text = !calendar && (typed || !nativeValue)
  if (!calendar && !text) {
    return (
      <>
        <input
          {...rest}
          type={kind === 'date' ? 'date' : 'datetime-local'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          className={className}
        />
        <button
          type="button"
          className="mt-1 block text-xs text-ink-muted underline"
          onClick={() => setTyped(true)}
        >
          Type a year before 1 CE or after 9999
        </button>
      </>
    )
  }

  const read = value.trim() === '' ? null : readDateFieldValue(value, { calendar, edge })
  const error = touched && read && !read.ok ? read.error : null
  const described = [rest['aria-describedby'], error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <>
      <input
        {...rest}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          setTouched(false)
          onChange(event.target.value)
        }}
        onBlur={(event) => {
          setTouched(true)
          onBlur?.(event)
        }}
        aria-invalid={error ? true : rest['aria-invalid']}
        aria-describedby={described}
        placeholder={calendar ? undefined : '300000 BCE, 1843-11-20, 44-03-15 BCE'}
        className={className}
      />
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </>
  )
}
