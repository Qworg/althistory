import { openToolbarTool } from './toolbarTools'

interface EmptyGraphStateProps {
  /**
   * `empty`: the graph holds no events. `filtered`: it does, but the filters
   * hide them all. The two need different next steps, so they never share copy.
   */
  kind: 'empty' | 'filtered'
  /** Clears the filters (the `filtered` state's one action). */
  onClearFilters?: () => void
  /** What the view would show, for the filtered message: "events", "actors". */
  noun?: string
}

/**
 * What a view shows before there is anything to show.
 *
 * A new graph used to open on an empty axis dated to the current month, with
 * nothing to say how history gets in. This names the ways in, most useful
 * first: extracting from a source (with a review before anything is added),
 * then adding an event by hand, then importing an export.
 */
export function EmptyGraphState({ kind, onClearFilters, noun = 'events' }: EmptyGraphStateProps) {
  if (kind === 'filtered') {
    return (
      <div className="mx-auto max-w-prose py-12 text-center" data-testid="empty-graph-filtered">
        <h3 className="font-display text-xl font-semibold text-ink">No {noun} match the filters</h3>
        <p className="mt-2 text-sm text-ink-secondary text-pretty">
          The graph has history, but the current search, dates or actors leave nothing to show.
        </p>
        {onClearFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className="mt-5 rounded-md border border-line bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-subtle"
          >
            Clear filters
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-prose py-12 text-center" data-testid="empty-graph">
      <h3 className="font-display text-2xl font-semibold text-ink text-balance">This graph has no history yet</h3>
      <p className="mt-2 text-sm text-ink-secondary text-pretty">
        Bring events in from a source, paste prose or a Wikipedia article and review what is
        found before anything is added, or place the first event by hand.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => openToolbarTool('ingest')}
          className="rounded-md bg-baseline px-4 py-2 text-sm font-medium text-on-accent hover:bg-baseline/90"
        >
          Extract from text or Wikipedia
        </button>
        <button
          type="button"
          onClick={() => openToolbarTool('create-event')}
          className="rounded-md border border-line bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-subtle"
        >
          Create the first event
        </button>
      </div>
      <p className="mt-4 text-sm text-ink-muted">
        Have an althistory export?{' '}
        <button
          type="button"
          onClick={() => openToolbarTool('import')}
          className="font-medium text-baseline underline underline-offset-2 hover:no-underline"
        >
          Import it
        </button>
      </p>
    </div>
  )
}
