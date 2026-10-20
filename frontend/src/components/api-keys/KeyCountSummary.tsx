/**
 * KeyCountSummary -- aggregate usage statistics of the API key dashboard.
 *
 * Rendered in the dashboard footer; it disappears while the stats query has
 * not resolved yet.
 */

import React from 'react'
import type { ApiKeyStats } from '@/types'

export interface KeyCountSummaryProps {
  /** The usage stats, undefined until they have loaded. */
  readonly stats: ApiKeyStats | undefined
}

export const KeyCountSummary: React.FC<KeyCountSummaryProps> = ({ stats }) => {
  if (!stats) return null

  return (
    <div className="text-sm text-gray-600">
      {stats.active} active / {stats.total} total keys
    </div>
  )
}

export default KeyCountSummary
