import { ArrowLeftIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import type { Event } from '@/types'
import { formatEventDate } from '@/utils/historicalTime'
import type { CausalNeighbour } from './eventInspectorUtils'

export interface EventCausesEffectsProps {
  causes: CausalNeighbour[]
  effects: CausalNeighbour[]
  /** Selects an event on the timeline (the view's own select handler). */
  onSelectEvent: (event: Event) => void
  isLoading?: boolean
  /** `stacked` for a narrow panel: causes over effects, never side by side. */
  layout?: 'columns' | 'stacked'
}

function NeighbourList({
  label,
  items,
  empty,
  direction,
  onSelectEvent,
}: {
  label: string
  items: CausalNeighbour[]
  empty: string
  direction: 'cause' | 'effect'
  onSelectEvent: (event: Event) => void
}) {
  const Icon = direction === 'cause' ? ArrowLeftIcon : ArrowRightIcon
  return (
    <div>
      <h4 className="flex items-center gap-1.5 text-base font-semibold text-ink">
        {direction === 'cause' && <Icon className="h-4 w-4 text-ink-muted" aria-hidden="true" />}
        {label}
        {direction === 'effect' && <Icon className="h-4 w-4 text-ink-muted" aria-hidden="true" />}
        <span className="font-mono-code text-xs font-normal text-ink-muted">{items.length}</span>
      </h4>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">{empty}</p>
      ) : (
        // A container query: in a narrow panel (the causal graph's inspector)
        // the type, weight and date go under the description instead of
        // squeezing it into a sliver beside them.
        <ul className="@container mt-1 divide-y divide-line" aria-label={label}>
          {items.map(({ relationship, event }) => (
            <li key={relationship.id}>
              <button
                type="button"
                onClick={() => onSelectEvent(event)}
                className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-sm py-1.5 text-left text-sm hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-selected"
              >
                <span className="min-w-0 flex-1 basis-full text-ink @md:basis-0">{event.description}</span>
                <span className="shrink-0 text-xs text-ink-muted">
                  {relationship.relationship_type}{' '}
                  <span className="font-mono-code" title="Causal weight, 0–1">
                    {relationship.weight.toFixed(2)}
                  </span>
                </span>
                <span className="font-mono-code shrink-0 text-xs text-ink-muted">
                  {formatEventDate(event)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * What led to the selected event and what it led to, from the graph's causal
 * links. Each entry selects that event, so a chain can be walked from the
 * inspector without leaving the timeline.
 */
export function EventCausesEffects({ causes, effects, onSelectEvent, isLoading = false, layout = 'columns' }: EventCausesEffectsProps) {
  if (isLoading) {
    return <p className="text-sm text-ink-muted" role="status">Loading causal links…</p>
  }
  return (
    <div className={`grid grid-cols-1 gap-x-8 gap-y-4 ${layout === 'columns' ? '@md:grid-cols-2' : ''}`}>
      <NeighbourList
        label="Causes"
        items={causes}
        empty="No recorded causes."
        direction="cause"
        onSelectEvent={onSelectEvent}
      />
      <NeighbourList
        label="Effects"
        items={effects}
        empty="No recorded effects."
        direction="effect"
        onSelectEvent={onSelectEvent}
      />
    </div>
  )
}
