import { memo, useId, useMemo, useState } from 'react'
import { datePhrase } from './reviewDefaults'

export interface SkippedSentencesProps {
  /** How many sentences the extraction skipped (the list may be capped). */
  count: number
  sentences: readonly string[]
  /** Whether the reviewer has edited rows that extracting again would replace. */
  hasEdits: boolean
  /** Whether the passage can be extracted again (a text extraction). */
  canReextract: boolean
  isExtracting: boolean
  /** Extract again, from the original text rewritten by `rewrite`. */
  onReextract: (rewrite: (original: string) => string) => void
}

/**
 * The sentences an extraction left out because it found no date in them.
 * They used to be a count ("2 sentences had no date") with no way to see
 * which; here they are listed, and each can be given a date so the passage
 * is extracted again with them in.
 */
export const SkippedSentences = memo(function SkippedSentences({
  count,
  sentences,
  hasEdits,
  canReextract,
  isExtracting,
  onReextract,
}: SkippedSentencesProps) {
  const [dates, setDates] = useState<Record<number, string>>({})
  const baseId = useId()
  const phrases = useMemo(
    () => sentences.map((_, index) => (dates[index] ? datePhrase(dates[index]!) : null)),
    [sentences, dates]
  )
  const dated = phrases.filter(Boolean).length

  const reextract = () => {
    onReextract((original) => {
      let text = original
      sentences.forEach((sentence, index) => {
        const phrase = phrases[index]
        if (phrase && text.includes(sentence)) text = text.replace(sentence, `${phrase}${sentence}`)
      })
      return text
    })
  }

  return (
    <section aria-labelledby={`${baseId}-heading`} className="mb-4 rounded-md border border-line bg-subtle p-3 text-sm">
      <h3 id={`${baseId}-heading`} className="font-medium text-ink">
        {count === 1 ? '1 sentence was left out: it has no date the reader recognises' : `${count} sentences were left out: they have no date the reader recognises`}
      </h3>
      {sentences.length > 0 && (
        <ul className="mt-2 space-y-2">
          {sentences.map((sentence, index) => {
            const inputId = `${baseId}-date-${index}`
            const value = dates[index] ?? ''
            const invalid = value.trim() !== '' && phrases[index] === null
            return (
              <li key={`${index}-${sentence.slice(0, 24)}`} className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <p className="min-w-0 flex-1 basis-64 text-ink-secondary [text-wrap:pretty]">{sentence}</p>
                {canReextract && (
                  <div className="flex flex-col">
                    <label htmlFor={inputId} className="sr-only">
                      Date for: {sentence}
                    </label>
                    <input
                      id={inputId}
                      value={value}
                      onChange={(e) => setDates((prev) => ({ ...prev, [index]: e.target.value }))}
                      placeholder="1862 or 1862-05"
                      inputMode="numeric"
                      aria-invalid={invalid || undefined}
                      className="w-36 rounded-md border border-line bg-card px-2 py-1 font-mono-code text-xs text-ink placeholder:text-ink-placeholder focus:border-selected focus:outline-none focus:ring-2 focus:ring-selected/30"
                    />
                    {invalid && <span className="mt-0.5 text-xs text-danger">Use YYYY, YYYY-MM or YYYY-MM-DD</span>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {count > sentences.length && (
        <p className="mt-2 text-xs text-ink-muted">The first {sentences.length} are shown.</p>
      )}
      {canReextract ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={reextract}
            disabled={dated === 0 || isExtracting}
            className="rounded-md border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink hover:bg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-selected disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExtracting ? 'Extracting…' : dated > 0 ? `Extract again with ${dated} ${dated === 1 ? 'date' : 'dates'}` : 'Extract again with these dates'}
          </button>
          <span className="text-xs text-ink-muted">
            {hasEdits ? 'Your edits to the rows below will be replaced.' : 'The rows below are extracted again, with these sentences in.'}
          </span>
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-muted">Add a date to a sentence (“In 1862, …”) in the source to bring it in.</p>
      )}
    </section>
  )
})
