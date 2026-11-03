import { useEffect, useId, useState } from 'react'
import { parseHistoricalDate, type DateBoundEdge } from './filterUtils'

/** The instant a bound stands for, or null when it is empty or unreadable. */
function instantOf(text: string, edge: DateBoundEdge): number | null {
  if (text.trim() === '') return null
  const parsed = parseHistoricalDate(text, edge)
  return parsed.ok ? parsed.date.getTime() : null
}

interface HistoricalDateInputProps {
  id: string
  label: string
  /** The committed bound, in its canonical spelling ('' for open). */
  value: string
  edge: DateBoundEdge
  /** Called with a canonical bound, or '' when the field is cleared. */
  onCommit: (value: string) => void
  /** The id of the shared format hint. */
  hintId: string
  placeholder?: string
}

/**
 * A typed date bound for historical time: `1843`, `1843-11`, `1843-11-20`,
 * `44 BCE`. The text is a draft until it reads as a date; only then (or when
 * it is cleared) does it reach the filters, so a half-typed year never empties
 * the field or filters on nonsense. Leaving the field rewrites a valid entry
 * in its canonical form (`-44` -> `44 BCE`), so what it was read as is shown.
 */
export function HistoricalDateInput({
  id,
  label,
  value,
  edge,
  onCommit,
  hintId,
  placeholder,
}: HistoricalDateInputProps) {
  const errorId = useId()
  const [draft, setDraft] = useState(value)
  const [touched, setTouched] = useState(false)

  // A new committed value from outside (Clear all, a link, a chip removed)
  // replaces the draft unless the draft already stands for the same instant.
  // (By instant, not by spelling: the store hands `1843-01` back as `1843`,
  // and rewriting the field mid-word would break the typing.)
  useEffect(() => {
    setDraft((current) => {
      if (current.trim() === '' && value === '') return current
      const draftInstant = instantOf(current, edge)
      return draftInstant !== null && draftInstant === instantOf(value, edge) ? current : value
    })
  }, [value, edge])

  const parsed = draft.trim() === '' ? null : parseHistoricalDate(draft, edge)
  const error = parsed && !parsed.ok && touched ? parsed.error : null

  // The message waits for the field to be left (or Enter): mid-word, `1843-`
  // is not a mistake yet.
  const handleChange = (text: string) => {
    setDraft(text)
    setTouched(false)
    if (text.trim() === '') {
      if (value !== '') onCommit('')
      return
    }
    const next = parseHistoricalDate(text, edge)
    if (next.ok && next.date.getTime() !== instantOf(value, edge)) onCommit(next.text)
  }

  const handleBlur = () => {
    setTouched(true)
    if (parsed?.ok) setDraft(parsed.text)
  }

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-medium text-ink-muted mb-1">
        {label}
      </label>
      <input
        type="text"
        id={id}
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleBlur()
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${errorId} ${hintId}` : hintId}
        className={`w-full px-3 py-2 border rounded-md bg-card text-ink font-mono-code text-sm shadow-sm placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-selected ${
          error ? 'border-red-500 dark:border-red-400' : 'border-line focus:border-selected'
        }`}
      />
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}
