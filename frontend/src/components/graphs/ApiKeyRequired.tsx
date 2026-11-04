import { memo, useCallback, useId, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { storeApiKey, type ApiAccessProblem } from '@/services/api'

/**
 * Stands in for the view when the server refuses this browser.
 *
 * Without this, a 401 on the graph list read as "No active graphs found" while
 * unscoped entity reads still drew a history underneath: the UI said there was
 * nothing while showing something. The real problem is the key, so the view
 * names it and takes one.
 */
const COPY: Record<ApiAccessProblem, { heading: string; body: string }> = {
  missing: {
    heading: 'This workspace needs an API key',
    body: 'The server requires a key and this browser has not sent one. Paste a key to open your graphs.',
  },
  rejected: {
    heading: 'The server did not accept this browser’s key',
    body: 'It may have been revoked, expired or mistyped. Paste a current key to continue.',
  },
  forbidden: {
    heading: 'This key can’t read graphs',
    body: 'The server accepted the key but it lacks read:graphs. Paste a key that has it, along with read:events, read:arcs and read:relationships to see the history.',
  },
}

export const ApiKeyRequired = memo(function ApiKeyRequired({ problem }: { problem: ApiAccessProblem }) {
  const queryClient = useQueryClient()
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  const errorId = useId()
  const hintId = useId()

  const handleSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      const trimmed = key.trim()
      if (!trimmed) {
        setError('Paste the key first. It starts with ak_.')
        return
      }
      setError(null)
      storeApiKey(trimmed)
      setKey('')
      // Every cached read was made without the key; start over with it.
      void queryClient.resetQueries()
    },
    [key, queryClient]
  )

  const { heading, body } = COPY[problem]

  return (
    <section
      aria-labelledby="api-key-heading"
      className="mx-auto max-w-xl rounded-lg border border-line bg-card p-6 shadow-sm"
    >
      <h2 id="api-key-heading" className="font-display text-2xl font-semibold text-ink text-balance">
        {heading}
      </h2>
      <p className="mt-1 text-sm text-ink-secondary">{body}</p>

      <form onSubmit={handleSubmit} className="mt-5" noValidate>
        <label htmlFor={inputId} className="block text-sm font-medium text-ink">
          API key
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="ak_…"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${errorId} ${hintId}` : hintId}
            className="min-w-0 flex-1 rounded-md border border-line bg-card px-3 py-1.5 font-mono-code text-sm text-ink placeholder:text-ink-placeholder focus:border-selected focus:outline-none focus:ring-2 focus:ring-selected/30"
          />
          <button
            type="submit"
            className="shrink-0 rounded-md bg-baseline px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-baseline/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selected"
          >
            Use this key
          </button>
        </div>
        {error && (
          <p id={errorId} role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <p id={hintId} className="mt-3 text-xs text-ink-muted">
          The key stays in this browser. Someone with an admin key creates keys with{' '}
          <code className="font-mono-code text-ink-secondary">POST /api/keys</code>.
        </p>
      </form>
    </section>
  )
})
