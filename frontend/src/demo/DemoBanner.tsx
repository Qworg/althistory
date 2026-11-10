import { DEMO_STATE_KEY, REPO_URL } from './flag'

/**
 * The strip above the app in the GitHub Pages demo: what this is, how long an
 * edit lasts, and how to start over or get the real thing. In normal flow
 * above the sticky header, so it scrolls away and never covers the app.
 */
export function DemoBanner() {
  const startOver = () => {
    try {
      sessionStorage.removeItem(DEMO_STATE_KEY)
      localStorage.removeItem('active_graph_id')
    } catch {
      // Nothing stored, so there is nothing to clear.
    }
    window.location.reload()
  }

  return (
    <div
      role="region"
      aria-label="About this demo"
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line bg-subtle px-4 py-2 text-sm text-ink-secondary sm:px-6"
    >
      <p className="m-0 min-w-0 basis-full sm:basis-0 sm:flex-1">
        <span className="font-semibold text-ink">Demo.</span> This copy of althistory runs in your browser, and your
        edits last until you close the tab.
        <span className="hidden md:inline"> Bringing in history, exporting and branching need the server.</span>
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={startOver}
          className="rounded-md border border-line bg-card px-3 py-1 font-medium text-ink hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
        >
          Start over
        </button>
        <a
          href={REPO_URL}
          className="inline-flex items-center font-medium text-baseline underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
        >
          Run it yourself
        </a>
      </div>
    </div>
  )
}
