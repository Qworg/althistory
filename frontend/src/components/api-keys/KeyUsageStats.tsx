/**
 * KeyUsageStats -- the current usage of one API key against its rate limits.
 *
 * The design names this component and gives it three properties: the key it
 * describes, the rate limits configured on that key, and the usage counted so
 * far. The data comes from `GET /api/keys/:id/usage`, which reports both, so
 * the component is given what it needs and does no fetching of its own.
 *
 * Each of the three request windows is shown as a count against its limit; the
 * bar turns amber at 80% of the limit and red once the window is spent.
 */

import React from 'react'
import type { ApiKeyRateLimit, ApiKeyUsageWindow } from '@/types'
import { usageRatio } from './usage'

export interface KeyUsageStatsProps {
  /** The key the usage belongs to. */
  readonly keyId: string
  /** The rate limits configured on the key. */
  readonly rateLimit: ApiKeyRateLimit
  /** The usage counted so far, one window per rate limit period. */
  readonly currentUsage: {
    readonly minute: ApiKeyUsageWindow
    readonly hour: ApiKeyUsageWindow
    readonly day: ApiKeyUsageWindow
  }
}

interface WindowRow {
  readonly label: string
  readonly limit: number
  readonly window: ApiKeyUsageWindow
}

const UsageRow: React.FC<WindowRow> = ({ label, limit, window }) => {
  const ratio = usageRatio(window.count, limit)
  const overBudget = limit > 0 && window.count >= limit
  const nearlySpent = !overBudget && ratio >= 0.8

  const barColor = overBudget
    ? 'bg-red-500'
    : nearlySpent
      ? 'bg-amber-500'
      : 'bg-blue-500'

  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-xs text-gray-500">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full ${barColor}`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
          role="progressbar"
          aria-label={`${label} requests`}
          aria-valuenow={window.count}
          aria-valuemin={0}
          aria-valuemax={limit}
        />
      </div>
      <span className="w-24 shrink-0 text-right text-xs text-gray-600 tabular-nums">
        {window.count} / {limit}
      </span>
    </div>
  )
}

export const KeyUsageStats: React.FC<KeyUsageStatsProps> = ({
  keyId,
  rateLimit,
  currentUsage,
}) => {
  return (
    <div className="space-y-2" data-testid={`key-usage-${keyId}`}>
      <UsageRow label="Minute" limit={rateLimit.requestsPerMinute} window={currentUsage.minute} />
      <UsageRow label="Hour" limit={rateLimit.requestsPerHour} window={currentUsage.hour} />
      <UsageRow label="Day" limit={rateLimit.requestsPerDay} window={currentUsage.day} />
    </div>
  )
}

export default KeyUsageStats
