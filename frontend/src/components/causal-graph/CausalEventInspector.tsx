import { memo, useMemo } from 'react'
import type { CausalRelationship, Event } from '@/types'
import { formatEventDate } from '@/utils/historicalTime'
import { EventCausesEffects } from '@/components/timeline/EventCausesEffects'
import { causesAndEffects, eventConfidence } from '@/components/timeline/eventInspectorUtils'
import { computeRipple, RIPPLE_DEPTH } from '@/components/timeline/timelineLinks'

export interface CausalEventInspectorProps {
  event: Event | null
  events: readonly Event[]
  relationships: readonly CausalRelationship[]
  onSelectEvent: (event: Event) => void
  onEdit: (event: Event) => void
  /** Clear the selection (closes the inspector beside the graph). */
  onClose?: () => void
  isLoading?: boolean
}

/**
 * The selected event beside the causal graph: what it is, what caused it and
 * what it caused, in the same words and order as the timeline's inspector, so
 * the two views describe one history the same way. Picking a cause or effect
 * selects it on the graph.
 */
export const CausalEventInspector = memo(function CausalEventInspector({
  event,
  events,
  relationships,
  onSelectEvent,
  onEdit,
  onClose,
  isLoading = false,
}: CausalEventInspectorProps) {
  const neighbours = useMemo(
    () => (event ? causesAndEffects(event.id, relationships, events) : { causes: [], effects: [] }),
    [event, relationships, events]
  )
  const reach = useMemo(() => {
    if (!event) return 0
    const links = relationships.map((r) => ({
      id: r.id,
      causeId: r.cause_event_id,
      effectId: r.effect_event_id,
      type: r.relationship_type,
      weight: r.weight,
    }))
    return computeRipple(event.id, links).effects.size
  }, [event, relationships])

  if (!event) {
    return (
      <aside aria-label="Selected event" className="text-sm text-ink-secondary" data-testid="causal-inspector">
        <h3 className="font-display text-xl font-semibold text-ink">Selected event</h3>
        <p className="mt-2">
          Select an event on the graph to see what caused it and what it set in motion. Its ripple stays lit; the
          rest of the graph fades back.
        </p>
      </aside>
    )
  }

  const confidence = eventConfidence(event)
  return (
    <aside aria-label="Selected event" className="space-y-4 text-sm text-ink" data-testid="causal-inspector">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-xl font-semibold text-ink">Selected event</h3>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onEdit(event)}
            className="rounded-md border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink-secondary hover:bg-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
          >
            Edit
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the inspector (Esc)"
              title="Close (Esc)"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <dl className="space-y-3">
        <div>
          <dt className="text-xs font-medium text-ink-muted">Description</dt>
          <dd>{event.description}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-ink-muted">Actor → target</dt>
          <dd>
            {event.actor} → {event.target}
          </dd>
        </div>
        <div className="flex gap-6">
          <div>
            <dt className="text-xs font-medium text-ink-muted">Date</dt>
            <dd className="font-mono-code">{formatEventDate(event)}</dd>
          </div>
          {confidence !== null && (
            <div>
              <dt className="text-xs font-medium text-ink-muted">Confidence</dt>
              <dd className="font-mono-code">{confidence.toFixed(2)}</dd>
            </div>
          )}
        </div>
      </dl>
      {/* The panel is narrow, so the lists stack. */}
      <EventCausesEffects
        causes={neighbours.causes}
        effects={neighbours.effects}
        onSelectEvent={onSelectEvent}
        isLoading={isLoading}
        layout="stacked"
      />
      {reach > neighbours.effects.length && (
        <p className="text-ink-secondary" data-testid="causal-ripple-reach">
          In all, it sets <span className="font-medium text-ink">{reach} events</span> in motion within{' '}
          {RIPPLE_DEPTH} steps, lit on the graph.
        </p>
      )}
    </aside>
  )
})
