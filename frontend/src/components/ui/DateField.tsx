import { useId, useState, type InputHTMLAttributes } from 'react'
import type { DateBoundEdge } from '@althistory/calendar'
import { useWorldCalendar } from '@/stores/worldCalendarStore'
import { type DateFieldKind, readDateFieldValue } from '@/utils/dateField'

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

  if (!calendar) {
    return (
      <input
        {...rest}
        type={kind === 'date' ? 'date' : 'datetime-local'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={className}
      />
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
