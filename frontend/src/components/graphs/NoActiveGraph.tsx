import { memo, useCallback, useState, type FormEvent } from 'react'
import { useGraphManagement } from '@/hooks/useGraphs'

/**
 * Stands in for the view when no graph is active.
 *
 * Every view reads its events, arcs and links from the server's active graph.
 * Without one there is nothing to show and nowhere for an edit to go, so the
 * view is replaced by the choice that unblocks it: open a graph, or start one.
 */
export const NoActiveGraph = memo(function NoActiveGraph() {
  const { graphs, switchGraph, createGraph, isLoadingGraphs, isCreating, isSwitching } = useGraphManagement()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleCreate = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      const trimmed = name.trim()
      if (!trimmed) {
        setError('Name the graph, e.g. "The Engine Age".')
        return
      }
      setError(null)
      try {
        const graph = await createGraph({ name: trimmed })
        switchGraph(graph.id)
      } catch (err) {
        setError(`The graph could not be created: ${err instanceof Error ? err.message : 'unknown error'}.`)
      }
    },
    [name, createGraph, switchGraph]
  )

  const openable = graphs.filter((graph) => graph.status !== 'deleted')

  return (
    <section
      aria-labelledby="no-graph-heading"
      className="mx-auto max-w-xl rounded-lg border border-line bg-card p-6 shadow-sm"
    >
      <h2 id="no-graph-heading" className="font-display text-2xl font-semibold text-ink">
        No graph is open
      </h2>
      <p className="mt-1 text-sm text-ink-secondary">
        Events, arcs and causal links belong to a graph. Open one to see its history, or start a new one.
      </p>

      {isLoadingGraphs ? (
        <p className="mt-5 text-sm text-ink-muted">Loading graphs…</p>
      ) : openable.length > 0 ? (
        <ul className="mt-5 divide-y divide-line rounded-md border border-line" aria-label="Graphs">
          {openable.map((graph) => (
            <li key={graph.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{graph.name}</div>
                <div className="font-mono-code text-xs text-ink-muted">
                  {graph.metadata.eventCount} events · {graph.metadata.arcCount} arcs
                  {graph.parentGraphId ? ' · branch' : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => switchGraph(graph.id)}
                disabled={isSwitching}
                className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selected disabled:cursor-not-allowed disabled:opacity-60"
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={handleCreate} className="mt-5" noValidate>
        <label htmlFor="no-graph-name" className="block text-sm font-medium text-ink">
          New graph
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="no-graph-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'no-graph-error' : undefined}
            className="min-w-0 flex-1 rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink focus:border-selected focus:outline-none focus:ring-2 focus:ring-selected/30"
          />
          <button
            type="submit"
            disabled={isCreating}
            className="shrink-0 rounded-md bg-baseline px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-baseline/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selected disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreating ? 'Creating…' : 'Create graph'}
          </button>
        </div>
        {error && (
          <p id="no-graph-error" role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </form>
    </section>
  )
})
