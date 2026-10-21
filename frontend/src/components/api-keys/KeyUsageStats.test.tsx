/**
 * Tests for KeyUsageStats -- the per-key usage against the rate limits.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KeyUsageStats } from './KeyUsageStats'
import { usageRatio } from './usage'
import type { ApiKeyRateLimit, ApiKeyUsageWindow } from '@/types'

const RATE_LIMIT: ApiKeyRateLimit = {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  requestsPerDay: 10000,
  batchSizeLimit: 1000,
  concurrentStreams: 5,
}

function windowOf(count: number): ApiKeyUsageWindow {
  return { count, resetAt: 1700000000000 }
}

describe('KeyUsageStats', () => {
  it('should show the count against the limit for each window', () => {
    render(
      <KeyUsageStats
        keyId="key-1"
        rateLimit={RATE_LIMIT}
        currentUsage={{
          minute: windowOf(12),
          hour: windowOf(340),
          day: windowOf(5600),
        }}
      />
    )

    expect(screen.getByText('12 / 60')).toBeInTheDocument()
    expect(screen.getByText('340 / 1000')).toBeInTheDocument()
    expect(screen.getByText('5600 / 10000')).toBeInTheDocument()
  })

  it('should label the panel with the key it describes', () => {
    render(
      <KeyUsageStats
        keyId="key-42"
        rateLimit={RATE_LIMIT}
        currentUsage={{
          minute: windowOf(0),
          hour: windowOf(0),
          day: windowOf(0),
        }}
      />
    )

    expect(screen.getByTestId('key-usage-key-42')).toBeInTheDocument()
  })

  it('should show an empty bar for a key that was never used', () => {
    render(
      <KeyUsageStats
        keyId="key-1"
        rateLimit={RATE_LIMIT}
        currentUsage={{
          minute: windowOf(0),
          hour: windowOf(0),
          day: windowOf(0),
        }}
      />
    )

    const bars = screen.getAllByRole('progressbar')
    expect(bars).toHaveLength(3)
    for (const bar of bars) {
      expect(bar).toHaveStyle({ width: '0%' })
    }
  })

  it('should fill the bar in proportion to the usage', () => {
    render(
      <KeyUsageStats
        keyId="key-1"
        rateLimit={RATE_LIMIT}
        currentUsage={{
          minute: windowOf(30),
          hour: windowOf(500),
          day: windowOf(2500),
        }}
      />
    )

    const bars = screen.getAllByRole('progressbar')
    expect(bars[0]).toHaveStyle({ width: '50%' })
    expect(bars[1]).toHaveStyle({ width: '50%' })
    expect(bars[2]).toHaveStyle({ width: '25%' })
  })

  it('should report the usage to the accessibility tree', () => {
    render(
      <KeyUsageStats
        keyId="key-1"
        rateLimit={RATE_LIMIT}
        currentUsage={{
          minute: windowOf(12),
          hour: windowOf(340),
          day: windowOf(5600),
        }}
      />
    )

    const bar = screen.getByRole('progressbar', { name: 'Minute requests' })
    expect(bar).toHaveAttribute('aria-valuenow', '12')
    expect(bar).toHaveAttribute('aria-valuemax', '60')
  })
})

describe('usageRatio', () => {
  it('should be the share of the limit that was used', () => {
    expect(usageRatio(30, 60)).toBe(0.5)
  })

  it('should never exceed one', () => {
    expect(usageRatio(120, 60)).toBe(1)
  })

  it('should never be negative', () => {
    expect(usageRatio(-5, 60)).toBe(0)
  })

  it('should be zero when the limit is zero', () => {
    expect(usageRatio(10, 0)).toBe(0)
  })
})
