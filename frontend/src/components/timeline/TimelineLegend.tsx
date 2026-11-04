import { memo, useId, useState } from 'react'
import { LINK_DASH, type LinkType } from './timelineLinks'
import { DEFAULT_PRESSURE_COLORS } from '@/types/pressure'
import { PressureTypeMark } from './PressureIndicators'

export type LegendPressureType = keyof typeof DEFAULT_PRESSURE_COLORS

/** Link colours by type at rest, as in the causal graph (see index.css --link-*). */
const LINK_COLOR: Record<LinkType, string> = {
  direct: 'var(--link-direct)',
  indirect: 'var(--link-indirect)',
  contributory: 'var(--link-contributory)',
}

// Worded as in the causal graph's legend, so a link reads the same in both.
const LINK_TYPES: Array<{ type: LinkType; label: string }> = [
  { type: 'direct', label: 'direct (solid)' },
  { type: 'indirect', label: 'indirect (dashed)' },
  { type: 'contributory', label: 'contributory (dotted)' },
]

function LinkSwatch({ type }: { type: LinkType }) {
  return (
    <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true" className="shrink-0">
      <line
        x1="1"
        y1="4"
        x2="21"
        y2="4"
        stroke={LINK_COLOR[type]}
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
  /** Set when the graph holds more events than the view fetched: the cap. */
  truncatedAt?: number
  /** The pressure types drawn as lines on the arc bars. */
  pressureTypes?: LegendPressureType[]
  /** The link types the canvas draws (the key lists only these); all by default. */
  linkTypes?: readonly LinkType[]
  /** The confidence tiers among the marks (the key lists only these); all by default. */
  tiers?: readonly ('firm' | 'probable' | 'speculative')[]
}

/** A short sample of a trace colour, for the tracing line. */
function TraceSwatch({ color }: { color: string }) {
  return (
    <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden="true" className="shrink-0">
      <line x1="1" y1="4" x2="17" y2="4" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The key to the timeline canvas, folded behind "Key" beside the counts.
 *
 * It used to be four lines of 12px text under every timeline: thirteen
 * encodings and the mouse gestures, whatever the canvas held and whatever
 * the input. Now one line stays (the trace status and the counts, with the
 * trace colours while a trace is on, since that is when the links change
 * colour), and the key lists only the encodings the canvas draws. Mouse
 * gestures are listed only for a fine pointer; Help (?) has everything.
 */
export const TimelineLegend = memo(function TimelineLegend({
  counts,
  hasLinks,
  isTracing,
  undoKey,
  truncatedAt,
  pressureTypes = [],
  linkTypes = LINK_TYPES.map((l) => l.type),
  tiers = ['firm', 'probable', 'speculative'],
}: TimelineLegendProps) {
  const [open, setOpen] = useState(false)
  const keyId = useId()
  const shownLinks = LINK_TYPES.filter(({ type }) => linkTypes.includes(type))
  return (
    <div className="mb-4 text-xs text-ink-muted" data-testid="timeline-legend">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={keyId}
          className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 font-medium text-ink-secondary hover:bg-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
        >
          Key
          <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {hasLinks && (
          <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-secondary">
            {isTracing ? (
              <>
                <span>Tracing:</span>
                <span className="inline-flex items-center gap-1"><TraceSwatch color="var(--text-primary)" />causes</span>
                <span className="inline-flex items-center gap-1"><TraceSwatch color="var(--accent-selected)" />what it set in motion</span>
                <span>· Esc clears</span>
              </>
            ) : (
              'Select an event to trace what it caused.'
            )}
          </p>
        )}
        <p className="font-mono-code sm:ml-auto">
          {plural(counts.events, 'event', 'events')} · {plural(counts.arcs, 'arc', 'arcs')}
          {counts.links > 0 && ` · ${plural(counts.links, 'link', 'links')}`}
        </p>
      </div>
      <div id={keyId} hidden={!open} className="mt-2 space-y-1.5 rounded-md border border-line bg-subtle px-3 py-2">
        {hasLinks && shownLinks.length > 0 && (
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Causal links">
            {shownLinks.map(({ type, label }) => (
              <li key={type} className="inline-flex items-center gap-1.5">
                <LinkSwatch type={type} />
                {label}
              </li>
            ))}
            <li>thicker = stronger</li>
          </ul>
        )}
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Event confidence">
          {tiers.map((tier) => (
            <li key={tier} className="inline-flex items-center gap-1.5">
              <ConfidenceSwatch tier={tier} />
              {tier}
            </li>
          ))}
          {hasLinks && <li>larger = sets more in motion</li>}
        </ul>
        {pressureTypes.length > 0 && (
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Pressures on arcs">
            {pressureTypes.map((type) => (
              <li key={type} className="inline-flex items-center gap-1.5">
                {/* The bar as drawn on an arc, with its type's shape: the
                    shape, not only the colour, tells the types apart. */}
                <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true" className="shrink-0">
                  <rect x="1" y="3" width="22" height="4" rx="2" fill={DEFAULT_PRESSURE_COLORS[type]} opacity={0.75} />
                  <PressureTypeMark type={type} cx={6} cy={5} color={DEFAULT_PRESSURE_COLORS[type]} />
                </svg>
                {type} pressure
              </li>
            ))}
          </ul>
        )}
        <p className="hidden [@media(pointer:fine)]:block">
          Double-click to add an event · Drag to retime (Esc cancels, {undoKey} undoes) · Right-click for actions
        </p>
      </div>
      {truncatedAt !== undefined && (
        <p role="status" className="mt-1.5 w-full text-ink-secondary">
          Showing {truncatedAt.toLocaleString()} events. The graph holds more than the timeline
          draws at once; the CLI and export include all of them.
        </p>
      )}
    </div>
  )
})
