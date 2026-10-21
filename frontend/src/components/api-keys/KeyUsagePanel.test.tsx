/**
 * Tests for KeyUsagePanel -- the usage of one key, fetched when it is opened.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { KeyUsagePanel } from './KeyUsagePanel'
import { apiClient, APIError } from '@/services/api'
import type { ApiKeyUsage } from '@/types'

vi.mock('@/services/api', () => ({
  apiClient: {
    keys: {
      getUsage: vi.fn(),
    },
  },
  APIError: class APIError extends Error {
    constructor(
      message: string,
      public status: number,
      public code?: string
    ) {
      super(message)
      this.name = 'APIError'
    }
  },
}))

const USAGE: ApiKeyUsage = {
  keyId: 'key-1',
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
    requestsPerDay: 10000,
    batchSizeLimit: 1000,
    concurrentStreams: 5,
  },
  currentUsage: {
    minute: { count: 12, resetAt: 1700000000000 },
    hour: { count: 340, resetAt: 1700000000000 },
    day: { count: 5600, resetAt: 1700000000000 },
  },
}

function renderPanel(keyId = 'key-1') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={client}>
      <KeyUsagePanel keyId={keyId} />
    </QueryClientProvider>
  )
}

describe('KeyUsagePanel', () => {
  beforeEach(() => {
    vi.mocked(apiClient.keys.getUsage).mockReset()
  })

  it('should ask the server for the usage of the key', async () => {
    vi.mocked(apiClient.keys.getUsage).mockResolvedValue(USAGE)

    renderPanel('key-7')

    await waitFor(() => {
      expect(apiClient.keys.getUsage).toHaveBeenCalledWith('key-7')
    })
  })

  it('should show the usage once it has loaded', async () => {
    vi.mocked(apiClient.keys.getUsage).mockResolvedValue(USAGE)

    renderPanel()

    expect(await screen.findByText('12 / 60')).toBeInTheDocument()
    expect(screen.getByText('340 / 1000')).toBeInTheDocument()
  })

  it('should report a failure instead of showing nothing', async () => {
    vi.mocked(apiClient.keys.getUsage).mockRejectedValue(new Error('boom'))

    renderPanel()

    expect(
      await screen.findByText('Could not load the usage of this key.')
    ).toBeInTheDocument()
  })

  it('should show nothing when the key is gone', async () => {
    vi.mocked(apiClient.keys.getUsage).mockRejectedValue(
      new APIError('API key not found: key-1', 404, 'KEY_NOT_FOUND')
    )

    renderPanel()

    // Wait for the request to have finished, not just to have been made:
    // until then the panel is still loading, and "nothing is shown" would be
    // true for the wrong reason.
    await waitFor(() => {
      expect(screen.queryByText('Loading usage...')).not.toBeInTheDocument()
    })

    expect(
      screen.queryByText('Could not load the usage of this key.')
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('key-usage-key-1')).not.toBeInTheDocument()
  })

  it('should report a 404 that is not a missing key', async () => {
    vi.mocked(apiClient.keys.getUsage).mockRejectedValue(
      new APIError('Not Found', 404)
    )

    renderPanel()

    expect(
      await screen.findByText('Could not load the usage of this key.')
    ).toBeInTheDocument()
  })

  it('should not ask the server without a key', async () => {
    renderPanel('')

    // The query is disabled without an id, so nothing is asked for. The check
    // is a plain assertion after a tick: `waitFor` passes on its first
    // successful check, which says nothing about a later call.
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(apiClient.keys.getUsage).not.toHaveBeenCalled()
  })
})
