import { memo } from 'react'
import { LINK_DASH, type LinkType } from './timelineLinks'

const LINK_TYPES: Array<{ type: LinkType; label: string }> = [
  { type: 'direct', label: 'direct' },
  { type: 'indirect', label: 'indirect' },
  { type: 'contributory', label: 'contributory' },
]

function LinkSwatch({ type }: { type: LinkType }) {
  return (
    <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true" className="shrink-0">
      <line
        x1="1"
        y1="4"
        x2="21"
        y2="4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={LINK_DASH[type]}
      />
    </svg>
  )
}

function ConfidenceSwatch({ tier }: { tier: 'firm' | 'probable' | 'speculative' }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0 text-baseline">
      {tier === 'firm' ? (
        <circle cx="6" cy="6" r="5" fill="currentColor" />
      ) : (
        <>
          <circle
            cx="6"
            cy="6"
            r="4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeDasharray={tier === 'speculative' ? '2.2 1.8' : undefined}
          />
          {tier === 'probable' && <circle cx="6" cy="6" r="1.75" fill="currentColor" />}
        </>
      )}
    </svg>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export interface TimelineLegendProps {
  /** What the canvas holds, after the filters. */
  counts: { events: number; arcs: number; links: number }
  /** Whether the canvas draws causal links (the link key is shown only then). */
  hasLinks: boolean
  /** Whether a selection's ripple is being traced. */
  isTracing: boolean
  /** The platform's undo shortcut, as shown to the user. */
  undoKey: string
}

/**
 * The key to the timeline canvas: what a link's stroke and a mark's shape
 * mean, then the gestures. One quiet line under the canvas, so the canvas is
 * the first thing in the card and the key is where the eye goes next.
 */
export const TimelineLegend = memo(function TimelineLegend({ counts, hasLinks, isTracing, undoKey }: TimelineLegendProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-ink-muted" data-testid="timeline-legend">
      {hasLinks && (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Causal links">
          {LINK_TYPES.map(({ type, label }) => (
            <li key={type} className="inline-flex items-center gap-1.5">
              <LinkSwatch type={type} />
              {label}
            </li>
          ))}
          <li>thicker = stronger</li>
        </ul>
      )}
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Event confidence">
        <li className="inline-flex items-center gap-1.5">
          <ConfidenceSwatch tier="firm" />
          firm
        </li>
        <li className="inline-flex items-center gap-1.5">
          <ConfidenceSwatch tier="probable" />
          probable
        </li>
        <li className="inline-flex items-center gap-1.5">
          <ConfidenceSwatch tier="speculative" />
          speculative
        </li>
      </ul>
      {hasLinks && (
        <p className="text-ink-secondary">
          {isTracing
            ? 'Tracing its causes and three steps of consequences · Esc clears'
            : 'Select an event to trace what it caused.'}
        </p>
      )}
      <p className="font-mono-code sm:ml-auto">
        {plural(counts.events, 'event', 'events')} · {plural(counts.arcs, 'arc', 'arcs')}
        {counts.links > 0 && ` · ${plural(counts.links, 'link', 'links')}`}
      </p>
      <p className="hidden w-full [@media(pointer:fine)]:block">
        Double-click to add an event · Drag to retime (Esc cancels, {undoKey} undoes) · Right-click for actions
      </p>
    </div>
  )
})
