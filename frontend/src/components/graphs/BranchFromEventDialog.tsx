import { useId, useState } from 'react'
import { ModalBase } from '@/components/modals/ModalBase'
import { useActiveGraph, useBranchGraph, useSwitchGraph } from '@/hooks/useGraphs'
import { formatEventDate } from '@/utils/historicalTime'
import type { Event, Graph } from '@/types'

/** The API accepts 255 characters; a name this long is still readable in the graph selector. */
const MAX_NAME_LENGTH = 100
/** The API's limit on a graph name. */
const API_NAME_LIMIT = 255

/** Cut `text` to `max` characters on a word boundary where one is close, ending in an ellipsis. */
function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, Math.max(0, max - 1))
  const lastSpace = cut.lastIndexOf(' ')
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${base.replace(/[\s,.;:–—-]+$/, '')}…`
}

/** "Engine Age — what if: Babbage completes the Analytical Engine". */
function defaultBranchName(graphName: string, event: Event): string {
  const prefix = `${graphName} — what if: `
  return prefix + truncate(event.description, Math.max(20, MAX_NAME_LENGTH - prefix.length))
}

/**
 * Records the point of divergence in the branch's description, in words: the
 * event and its date. The description is shown to people (the graph selector,
 * the graph manager), so it carries no internal event id.
 */
function defaultBranchDescription(event: Event): string {
  return (
    `Counterfactual branch diverging at “${event.description.trim()}” ` +
    `(${formatEventDate(event)}).`
  )
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : ''
  if (!message) return 'The server did not say why.'
  return /[.!?]$/.test(message) ? message : `${message}.`
}

export interface BranchFromEventDialogProps {
  /** The point of divergence. The dialog renders nothing without one. */
  event: Event | null
  isOpen: boolean
  onClose: () => void
}

/**
 * Forks the active graph into a counterfactual branch that diverges at
 * `event`. The branch starts as a full copy of the active graph and records
 * it as its parent (POST /graphs/:id/branch), so it can later be compared
 * with and merged back into it; the active graph is not changed.
 */
export function BranchFromEventDialog({ event, isOpen, onClose }: BranchFromEventDialogProps) {
  // Mounted only while open, and keyed by the event: each opening, or a new
  // point of divergence, starts from a fresh prefilled form, and a closed
  // dialog runs no queries.
  if (!isOpen || !event) return null
  return <BranchFromEventForm key={event.id} event={event} onClose={onClose} />
}

function BranchFromEventForm({ event, onClose }: { event: Event; onClose: () => void }) {
  const { data: activeGraph } = useActiveGraph()
  const branchGraph = useBranchGraph()
  const switchGraph = useSwitchGraph()

  const nameId = useId()
  const descriptionId = useId()
  const nameHintId = useId()

  const graphName = activeGraph?.name ?? 'the active graph'
  // `null` until the user edits a field: the suggestion follows the graph's
  // name if it arrives after the dialog opens, and never overwrites typing.
  const [editedName, setName] = useState<string | null>(null)
  const [editedDescription, setDescription] = useState<string | null>(null)
  const [created, setCreated] = useState<Graph | null>(null)
  const [error, setError] = useState<string | null>(null)

  const name = editedName ?? defaultBranchName(graphName, event)
  const description = editedDescription ?? defaultBranchDescription(event)
  const trimmedName = name.trim()
  const isPending = branchGraph.isPending
  const canSubmit = trimmedName.length > 0 && !isPending && !!activeGraph

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!activeGraph || !trimmedName) return
    setError(null)
    try {
      const branch = await branchGraph.mutateAsync({
        id: activeGraph.id,
        data: {
          branchName: trimmedName,
          description: description.trim() || undefined,
        },
      })
      setCreated(branch)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const handleSwitch = () => {
    if (created) switchGraph.mutate(created.id)
    onClose()
  }

  const buttonBase =
    'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-selected focus-visible:ring-offset-2'
  const primaryButton = `${buttonBase} bg-baseline text-on-accent hover:bg-baseline/80 disabled:cursor-not-allowed disabled:opacity-50`
  const secondaryButton = `${buttonBase} border border-line bg-card text-ink-secondary hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-50`

  const footer = created ? (
    <div className="flex flex-wrap justify-end gap-3">
      <button type="button" onClick={onClose} className={secondaryButton}>
        Stay on {graphName}
      </button>
      <button type="button" onClick={handleSwitch} className={primaryButton}>
        Switch to branch
      </button>
    </div>
  ) : (
    <div className="flex flex-wrap justify-end gap-3">
      <button type="button" onClick={onClose} disabled={isPending} className={secondaryButton}>
        Cancel
      </button>
      <button
        type="submit"
        form={`${nameId}-form`}
        disabled={!canSubmit}
        className={primaryButton}
      >
        {isPending ? 'Creating branch…' : 'Create branch'}
      </button>
    </div>
  )

  return (
    <ModalBase
      isOpen
      onClose={onClose}
      title="Branch from this event"
      size="lg"
      footer={footer}
      closeOnBackdrop={!isPending}
      closeOnEscape={!isPending}
    >
      {/* The point of divergence */}
      <section aria-label="Point of divergence" className="mb-4 rounded-md border border-line bg-subtle p-3">
        <div className="flex items-start gap-2">
          <svg
            className="mt-0.5 h-4 w-4 shrink-0 text-divergence"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <circle cx="6" cy="6" r="2" />
            <circle cx="6" cy="18" r="2" />
            <circle cx="18" cy="9" r="2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 8v8M6 12c0-2 1.5-3 4-3h6" />
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink break-words">{event.description}</p>
            <p className="mt-1 text-xs text-ink-muted">
              <span className="font-mono-code">{formatEventDate(event)}</span>
              {event.actor?.trim() && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="break-words">{event.actor}</span>
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      {created ? (
        <div role="status" className="space-y-2 text-sm text-ink-secondary">
          <p className="text-ink">
            Branch <span className="font-medium">{created.name}</span> created.
          </p>
          <p>
            {graphName} is unchanged. Switch to the branch to change history from this
            event onward.
          </p>
        </div>
      ) : (
        <form id={`${nameId}-form`} onSubmit={handleSubmit} className="space-y-4" noValidate>
          <p className="text-sm text-ink-secondary">
            The branch starts as a full copy of <span className="font-medium text-ink">{graphName}</span>,
            which stays exactly as it is. After you switch to the branch, change history from
            this event onward; you can compare the branch with {graphName} or merge it back later.
          </p>

          <div>
            <label htmlFor={nameId} className="mb-1 block text-sm font-medium text-ink">
              Branch name
            </label>
            <input
              id={nameId}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={API_NAME_LIMIT}
              required
              aria-invalid={trimmedName.length === 0 || undefined}
              aria-describedby={trimmedName.length === 0 ? nameHintId : undefined}
              disabled={isPending}
              className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-selected"
            />
            {trimmedName.length === 0 && (
              <p id={nameHintId} className="mt-1 text-xs text-red-700 dark:text-red-300">
                Give the branch a name.
              </p>
            )}
          </div>

          <div>
            <label htmlFor={descriptionId} className="mb-1 block text-sm font-medium text-ink">
              Description <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <textarea
              id={descriptionId}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={isPending}
              className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-selected"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-200"
            >
              Couldn't create the branch: {error} Nothing was changed; try again.
            </div>
          )}
        </form>
      )}
    </ModalBase>
  )
}

export default BranchFromEventDialog
