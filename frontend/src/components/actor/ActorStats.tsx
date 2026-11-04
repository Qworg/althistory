import { useId } from 'react'
import { formatHistoricalDate } from '@/utils/historicalTime'

export interface ActorStatsData {
  eventCount: number
  timeSpan: { start: Date; end: Date } | null
  relationshipMetrics: {
    asActor: number
    asTarget: number
    uniqueTargets: number
    uniqueActors: number
  }
}

export interface ActorStatsProps {
  actor: string
  stats: ActorStatsData
  className?: string
}

const DAY_MS = 1000 * 60 * 60 * 24

function formatDuration(start: Date, end: Date): string {
  const diffDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS)
  const diffYears = Math.floor(diffDays / 365)
  const remainingDays = diffDays % 365
  const diffMonths = Math.floor(remainingDays / 30)
  const remainingDaysAfterMonths = remainingDays % 30

  if (diffYears > 0) {
    if (diffMonths > 0) {
      return `${diffYears}y ${diffMonths}m`
    }
    return `${diffYears} year${diffYears !== 1 ? 's' : ''}`
  } else if (diffMonths > 0) {
    if (remainingDaysAfterMonths > 0) {
      return `${diffMonths}m ${remainingDaysAfterMonths}d`
    }
    return `${diffMonths} month${diffMonths !== 1 ? 's' : ''}`
  } else if (diffDays > 0) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''}`
  }
  return 'Same day'
}

function formatDateRange(start: Date, end: Date): string {
  // Historical dates: formatted in UTC so the viewer's time zone cannot
  // move them to a neighbouring day.
  const startStr = formatHistoricalDate(start, 'en-US')
  const endStr = formatHistoricalDate(end, 'en-US')
  return startStr === endStr ? startStr : `${startStr} - ${endStr}`
}

function formatRate(rate: number): string {
  if (rate >= 10) return rate.toFixed(0)
  if (rate >= 0.1) return rate.toFixed(1)
  return rate.toFixed(2)
}

/**
 * How often the actor appears, in the unit that gives a readable number: per
 * year over a multi-year span, otherwise per day, week or month. A sparse
 * actor used to read "0.001 Events/Day" (with a per-year figure beside it).
 */
function activityRate(stats: ActorStatsData): { value: string; unit: string } | null {
  if (!stats.timeSpan || stats.eventCount === 0) return null

  const diffDays = Math.max(1, Math.floor((stats.timeSpan.end.getTime() - stats.timeSpan.start.getTime()) / DAY_MS))
  const daily = stats.eventCount / diffDays

  if (diffDays > 366) return { value: formatRate(stats.eventCount / (diffDays / 365.25)), unit: 'per year' }
  if (daily >= 1) return { value: formatRate(daily), unit: 'per day' }
  if (daily * 7 >= 1) return { value: formatRate(daily * 7), unit: 'per week' }
  return { value: formatRate(daily * 30.44), unit: 'per month' }
}

function average(count: number, over: number): string {
  return over > 0 ? (count / over).toFixed(1) : '0'
}

/** Role colours, matching the actor timeline's marks and legend. */
/** Role marks, matching the actor timeline: a filled dot acts, a ring is acted on. */
const ROLE_DOT = {
  actor: 'bg-role-actor',
  target: 'border-2 border-role-target',
} as const
/** The distribution bar's fills (a bar segment cannot be a ring). */
const ROLE_FILL = { actor: 'bg-role-actor', target: 'bg-role-target' } as const

/** "2 of 3" for a handful of events (a percentage of three is false precision), else a whole percent. */
function share(count: number, total: number): string {
  if (total < 20) return `${count} of ${total}`
  return `${Math.round((count / total) * 100)}%`
}

/**
 * The actor's statistics: one flat section inside the view's card -- headline
 * figures in a rule-separated row, then the two roles side by side, then the
 * split between them. It used to be seven bordered tiles with coloured icon
 * chips inside a tinted panel inside the card.
 */
export function ActorStats({ actor, stats, className = '' }: ActorStatsProps) {
  const headingId = useId()
  const rate = activityRate(stats)
  const { asActor, asTarget, uniqueTargets, uniqueActors } = stats.relationshipMetrics
  const actorShare = stats.eventCount > 0 ? (asActor / stats.eventCount) * 100 : 0
  const targetShare = stats.eventCount > 0 ? (asTarget / stats.eventCount) * 100 : 0

  return (
    <section aria-labelledby={headingId} className={`actor-stats ${className}`}>
      <h3 id={headingId} className="font-display text-2xl font-semibold text-ink text-balance">
        Statistics for {actor}
      </h3>

      {/* Headline figures */}
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-4 md:grid-cols-4">
        <div data-stat="total">
          <dt className="text-xs font-medium text-ink-muted">Total Events</dt>
          <dd className="mt-1 font-mono-code text-base font-semibold text-ink">{stats.eventCount}</dd>
        </div>

        <div data-stat="span">
          <dt className="text-xs font-medium text-ink-muted">Time Span</dt>
          <dd className="mt-1 text-base font-semibold text-ink">
            {stats.timeSpan ? formatDuration(stats.timeSpan.start, stats.timeSpan.end) : 'N/A'}
          </dd>
          {stats.timeSpan && (
            <dd className="font-mono-code text-xs text-ink-muted">
              {formatDateRange(stats.timeSpan.start, stats.timeSpan.end)}
            </dd>
          )}
        </div>

        <div data-stat="rate">
          <dt className="text-xs font-medium text-ink-muted">Activity</dt>
          <dd className="mt-1 text-base font-semibold text-ink">
            {rate ? (
              <>
                <span className="font-mono-code">{rate.value}</span>{' '}
                <span className="text-sm font-normal text-ink-secondary">events {rate.unit}</span>
              </>
            ) : (
              <span className="text-sm font-normal text-ink-secondary">No events</span>
            )}
          </dd>
        </div>

        <div data-stat="roles">
          <dt className="text-xs font-medium text-ink-muted">Actor / Target</dt>
          <dd className="mt-1 font-mono-code text-base font-semibold text-ink">
            {asActor} / {asTarget}
          </dd>
        </div>
      </dl>

      {/* The two roles */}
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 py-4 md:grid-cols-2">
        <div data-role="actor">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-ink-secondary">
            <span className={`h-2.5 w-2.5 rounded-full ${ROLE_DOT.actor}`} aria-hidden="true" />
            As Actor
          </h4>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-secondary">Events</dt>
              <dd className="font-mono-code text-ink">{asActor}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-secondary">Unique targets</dt>
              <dd className="font-mono-code text-ink">{uniqueTargets}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-secondary">Average per target</dt>
              <dd className="font-mono-code text-ink">{average(asActor, uniqueTargets)}</dd>
            </div>
          </dl>
        </div>

        <div data-role="target">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-ink-secondary">
            <span className={`h-2.5 w-2.5 rounded-full ${ROLE_DOT.target}`} aria-hidden="true" />
            As Target
          </h4>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-secondary">Events</dt>
              <dd className="font-mono-code text-ink">{asTarget}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-secondary">Unique actors</dt>
              <dd className="font-mono-code text-ink">{uniqueActors}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-secondary">Average per actor</dt>
              <dd className="font-mono-code text-ink">{average(asTarget, uniqueActors)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* The split between the roles, in the timeline's role colours */}
      {asActor > 0 && asTarget > 0 && (
        <div className="border-t border-line pt-4" data-stat="distribution">
          <h4 className="text-sm font-semibold text-ink-secondary">Activity distribution</h4>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
            <div
              className={`${ROLE_FILL.actor} transition-all duration-300`}
              style={{ width: `${actorShare}%` }}
            />
            <div
              className={`${ROLE_FILL.target} transition-all duration-300`}
              style={{ width: `${targetShare}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-ink-secondary">
            <span className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${ROLE_DOT.actor}`} aria-hidden="true" />
              Actor ({share(asActor, stats.eventCount)})
            </span>
            <span className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${ROLE_DOT.target}`} aria-hidden="true" />
              Target ({share(asTarget, stats.eventCount)})
            </span>
          </div>
        </div>
      )}
    </section>
  )
}
