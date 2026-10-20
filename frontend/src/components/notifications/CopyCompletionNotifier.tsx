import { useCallback, useMemo, useState } from 'react'
import { CopyCompletionNotification } from '@/components/notifications/CopyCompletionNotification'
import { useCopyStore } from '@/stores/copyStore'
import { CANCELLED_MESSAGE } from '@/hooks/useGraphCopy'
import { useSwitchGraph } from '@/hooks/useGraphs'
import { CopyOperation } from '@/types'

/**
 * Shows the outcome of the most recent copy that finished.
 *
 * The notification used to have no home: it needs a `CopyOperation`, and the
 * operations lived in `useGraphCopy`'s own state, so a second instance of the
 * hook -- which is what a component outside the copy modal would be -- saw an
 * empty list. The operations are shared state now, so this can live in the
 * layout, outlive the modal that started the copy, and offer "Switch to Graph"
 * where the user actually is.
 */
export const CopyCompletionNotifier: React.FC = () => {
  const completedOperations = useCopyStore((state) => state.completedOperations)

  // Which copies have already been announced, by id. Counting them would not
  // work: the history can be cleared, and a notice that is dismissed does not
  // remove the copy from it, so the count goes down as well as up.
  const [announced, setAnnounced] = useState<Set<string>>(
    () => new Set(completedOperations.map((operation) => operation.id))
  )

  // The first copy that has not been announced yet. A copy the user
  // cancelled is not announced: they know, and a red "Copy Failed" notice for
  // something they just did on purpose is noise.
  const pending = useMemo(
    () =>
      completedOperations.find(
        (operation) =>
          !announced.has(operation.id) &&
          operation.error_message !== CANCELLED_MESSAGE
      ),
    [completedOperations, announced]
  )

  // The notice that is on screen. It is held separately from the store so
  // that dismissing it does not clear the history: the history panel shows the
  // same operations, and a copy the user never looked at must not disappear
  // from it because a notice timed out.
  const [shown, setShown] = useState<CopyOperation | null>(null)

  if (pending !== undefined && pending !== shown) {
    setShown(pending)
    setAnnounced((previous) => new Set(previous).add(pending.id))
  }

  // The dismissal is specific to the notice it belongs to. The notification
  // hides itself and calls `onDismiss` 300 ms later, so a copy that finishes
  // in between would be dismissed by the older notice's timer if the handler
  // cleared whatever was on screen. The handler is created per notice (the
  // component is keyed by the copy's id) and therefore captures the id it
  // belongs to.
  const handleDismiss = useCallback(
    (dismissedId: string) => {
      setShown((current) => (current?.id === dismissedId ? null : current))
    },
    []
  )

  // A copy's id is the id of the graph the copy created (see POST /graphs/copy),
  // so the notice switches straight to it -- the graph list the user is looking
  // at may not have been refreshed yet, and the copy is not in it.
  const switchGraph = useSwitchGraph()
  const handleSwitchToGraph = useCallback(
    () => {
      if (shown) {
        switchGraph.mutate(shown.id)
      }
    },
    [shown, switchGraph]
  )

  if (!shown) return null

  return (
    // The key makes a new notice a new component: without it the second
    // notice would inherit the first one's countdown and its faded-out state.
    <CopyCompletionNotification
      key={shown.id}
      operation={shown}
      onSwitchToGraph={handleSwitchToGraph}
      onDismiss={() => handleDismiss(shown.id)}
    />
  )
}
