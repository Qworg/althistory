/**
 * The client and the server have to agree on where the pressures live.
 *
 * The client used to ask for `/inferred-pressures`, which the backend does not
 * serve, so the query 404'd and nothing downstream ever saw a pressure. The
 * request is pinned here so the two cannot drift apart again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiClient } from './api'

const getMock = vi.fn()

vi.mock('@/config/api', () => ({
  API_BASE_URL: '/api',
  API_TIMEOUT: 1000,
}))

describe('the API client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMock.mockResolvedValue({ data: { success: true, data: [] } })
    // The client keeps its axios instance private, so the transport is
    // replaced on the instance it created.
    const instance = (apiClient as unknown as { client: { get: unknown } }).client
    ;(instance as { get: unknown }).get = getMock
  })

  it('asks the backend for the pressures at the route it serves', async () => {
    await apiClient.inference.getPressures()

    expect(getMock).toHaveBeenCalledWith(
      '/inference/pressures',
      expect.objectContaining({ params: undefined })
    )
  })

  it('passes the filters the backend accepts', async () => {
    await apiClient.inference.getPressures({ type: 'political', minConfidence: 0.4 })

    expect(getMock).toHaveBeenCalledWith(
      '/inference/pressures',
      expect.objectContaining({
        params: { type: 'political', minConfidence: 0.4 },
      })
    )
  })
})
