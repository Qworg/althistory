/**
 * Every request says which kind of client it is and which tab, so the app's
 * live change feed can tell this tab's own edits from another writer's.
 */

import { describe, it, expect, vi } from 'vitest'
import { apiClient } from './api'
import { CLIENT_ID, CLIENT_ID_HEADER, CLIENT_KIND_HEADER } from './clientIdentity'

vi.mock('@/config/api', () => ({
  API_BASE_URL: '/api',
  API_TIMEOUT: 1000,
}))

describe('the API client identifies itself', () => {
  it('sends the kind of client and the tab on every request', async () => {
    const instance = (apiClient as unknown as {
      client: { defaults: { adapter: unknown }; interceptors: { request: { handlers: Array<{ fulfilled: (c: unknown) => unknown } | null> } } }
    }).client
    const handler = instance.interceptors.request.handlers.find((h) => h !== null)
    const config = (await handler?.fulfilled({ headers: {} })) as { headers: Record<string, string> }
    expect(config.headers[CLIENT_KIND_HEADER]).toBe('web')
    expect(config.headers[CLIENT_ID_HEADER]).toBe(CLIENT_ID)
    expect(CLIENT_ID.length).toBeGreaterThan(8)
  })

  it('asks for a feed token with the mode in the body, and a write token with none', async () => {
    const post = vi.fn().mockResolvedValue({ data: { token: 't' } })
    ;(apiClient as unknown as { client: { post: unknown } }).client.post = post
    await apiClient.stream.getToken('g1', 'feed')
    await apiClient.stream.getToken('g1')
    expect(post).toHaveBeenNthCalledWith(1, '/stream/token', { mode: 'feed' }, { headers: { 'X-Graph-Id': 'g1' } })
    expect(post).toHaveBeenNthCalledWith(2, '/stream/token', {}, { headers: { 'X-Graph-Id': 'g1' } })
  })
})
