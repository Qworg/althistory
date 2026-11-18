import { useState } from 'react'
import { useGlobalStore } from '@/stores/globalStore'
import { useActiveGraph, useActiveGraphId } from '@/hooks/useGraphs'
import { discardUnscopedMutations, sendUnscopedToGraph } from './offlineSync'

/**
 * Writes saved before graphs were recorded do not say where they belong. They
 * wait here for a choice instead of being sent to a guess or thrown away. It
 * renders inside the notification stack (a polite live region, so its arrival
 * is announced, and it stacks with the notices instead of overlapping them).
 */
export function UnscopedPrompt() {
  const count = useGlobalStore((state) => state.unscopedMutationCount)
  // The graph hooks need a query client; nothing here mounts them until asked.
  return count === 0 ? null : <PromptBody count={count} />
}

function PromptBody({ count }: { count: number }) {
  const activeGraphId = useActiveGraphId()
  const { data: graph } = useActiveGraph()
  const [confirming, setConfirming] = useState(false)

  const name = graph?.name ?? 'the open graph'
  const noun = count === 1 ? 'change' : 'changes'
  const button =
    'rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-selected focus-visible:ring-offset-2'

  return (
    <div
      role="group"
      aria-label="Changes saved before this update"
      data-testid="unscoped-prompt"
      className="pointer-events-auto rounded-lg border border-line bg-card px-4 py-3 text-sm text-ink shadow-lg"
    >
      <p>
        {count} {noun} saved before this update {count === 1 ? "doesn't record its graph" : "don't record their graph"}.
        {!activeGraphId && ' Open a graph to send them.'}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {confirming ? (
          <>
            <button
              type="button"
              onClick={() => {
                setConfirming(false)
                discardUnscopedMutations()
              }}
              className={`${button} border border-line bg-subtle text-ink hover:bg-line`}
            >
              Discard {count} {noun}?
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={`${button} border border-line text-ink hover:bg-subtle`}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={!activeGraphId}
              onClick={() => activeGraphId && sendUnscopedToGraph(activeGraphId)}
              className={`${button} bg-ink text-canvas hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              Send to {name}
            </button>
            <button type="button" onClick={() => setConfirming(true)} className={`${button} border border-line text-ink hover:bg-subtle`}>
              Discard
            </button>
          </>
        )}
      </div>
    </div>
  )
}
