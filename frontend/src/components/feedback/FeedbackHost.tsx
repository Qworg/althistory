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
      Capturing the screen for your report… (Esc cancels)
    </div>
  )
}

/**
 * Everything feedback needs at the layout level (issue #49): the dialog, the
 * capturing notice, the Shift+I shortcut, and the open graph's name for the
 * report. Mount once, in MainLayout.
 */
/**
 * While the screen is drawn, keys do nothing but Escape, which cancels: the page
 * underneath is still live, and a shortcut (`?` opening Help) would put a
 * second dialog under the one about to open.
 */
function useCaptureKeys() {
  const capturing = useFeedbackStore((state) => state.phase === 'capturing')
  const closeFeedback = useFeedbackStore((state) => state.closeFeedback)

  useEffect(() => {
    if (!capturing) return
    const swallow = (event: KeyboardEvent) => {
      event.stopPropagation()
      event.preventDefault()
      if (event.key === 'Escape') closeFeedback()
    }
    // Capture phase on window: before any other listener sees the key.
    window.addEventListener('keydown', swallow, true)
    return () => window.removeEventListener('keydown', swallow, true)
  }, [capturing, closeFeedback])
}

export function FeedbackHost() {
  useFeedbackShortcut()
  useCaptureKeys()
  const openCount = useFeedbackStore((state) => state.openCount)
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
      <FeedbackDialog key={openCount} />
    </>
  )
}
