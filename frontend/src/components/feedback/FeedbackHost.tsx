import { useEffect } from 'react'
import { useActiveGraph } from '@/hooks/useGraphs'
import { useFeedbackStore } from './feedbackStore'
import { FeedbackDialog } from './FeedbackDialog'
import { useFeedbackShortcut } from './useFeedbackShortcut'

/** Says the screen is being captured. Left out of the picture itself (`data-feedback-ignore`). */
function CapturingNotice() {
  const phase = useFeedbackStore((state) => state.phase)
  if (phase !== 'capturing') return null
  return (
    <div
      data-feedback-ignore
      role="status"
      className="pointer-events-none fixed left-1/2 top-3 z-[70] -translate-x-1/2 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink-secondary shadow-md"
    >
      Capturing the screen for your report…
    </div>
  )
}

/**
 * Everything feedback needs at the layout level (issue #49): the dialog, the
 * capturing notice, the Shift+I shortcut, and the open graph's name for the
 * report. Mount once, in MainLayout.
 */
export function FeedbackHost() {
  useFeedbackShortcut()
  const { data: graph } = useActiveGraph()
  const setExtras = useFeedbackStore((state) => state.setExtras)

  useEffect(() => {
    setExtras({
      ...(graph?.name ? { graphName: graph.name } : {}),
      ...(graph?.parentGraphId ? { branchOf: graph.parentGraphId } : {}),
    })
  }, [graph?.name, graph?.parentGraphId, setExtras])

  return (
    <>
      <CapturingNotice />
      <FeedbackDialog />
    </>
  )
}
