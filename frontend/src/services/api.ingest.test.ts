/**
 * Text bound for a graph names it in the `X-Graph-Id` header, which is what the
 * server scopes the request by (and reads the world calendar from). It is not
 * sent in the body, which the route does not read.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiClient } from './api'

const postMock = vi.fn()

vi.mock('@/config/api', () => ({
  API_BASE_URL: '/api',
  API_TIMEOUT: 1000,
}))

describe('text extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    postMock.mockResolvedValue({ data: { jobId: 'job-1' } })
    const instance = (apiClient as unknown as { client: { post: unknown } }).client
    ;(instance as { post: unknown }).post = postMock
  })

  it('sends the target graph as X-Graph-Id, not in the body', async () => {
    await apiClient.ingest.text({ text: 'In Thaw of 141 AR…', useLLM: true, targetGraphId: 'graph_vael' })

    const [url, body, config] = postMock.mock.calls[0]!
    expect(url).toBe('/ingest/text')
    expect(body).toEqual({ text: 'In Thaw of 141 AR…', useLLM: true })
    expect(config.headers).toEqual({ 'X-Graph-Id': 'graph_vael' })
  })

  it('sends no header without a target graph', async () => {
    await apiClient.ingest.text({ text: 'x' })

    const [, body, config] = postMock.mock.calls[0]!
    expect(body).toEqual({ text: 'x' })
    expect(config.headers).toBeUndefined()
  })
})

describe('Wikipedia and Wikidata extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    postMock.mockResolvedValue({ data: { jobId: 'job-1' } })
    const instance = (apiClient as unknown as { client: { post: unknown } }).client
    ;(instance as { post: unknown }).post = postMock
  })

  it('names the target graph in X-Graph-Id, as text extraction does, and not in the body', async () => {
    await apiClient.ingest.url({ url: 'https://en.wikipedia.org/wiki/Hastings', strategy: 'wikipedia', targetGraphId: 'graph_vael' })
    await apiClient.ingest.wikidata({ queryType: 'person-timeline', parameters: { person: 'Q42' }, targetGraphId: 'graph_vael' })

    const [urlPath, urlBody, urlConfig] = postMock.mock.calls[0]!
    expect(urlPath).toBe('/ingest/url')
    expect(urlBody).toEqual({ url: 'https://en.wikipedia.org/wiki/Hastings', strategy: 'wikipedia' })
    expect(urlConfig.headers).toEqual({ 'X-Graph-Id': 'graph_vael' })
    const [wikidataPath, wikidataBody, wikidataConfig] = postMock.mock.calls[1]!
    expect(wikidataPath).toBe('/ingest/wikidata')
    expect(wikidataBody).toEqual({ queryType: 'person-timeline', parameters: { person: 'Q42' } })
    expect(wikidataConfig.headers).toEqual({ 'X-Graph-Id': 'graph_vael' })
  })

  it('sends no header without a target graph', async () => {
    await apiClient.ingest.url({ url: 'https://en.wikipedia.org/wiki/Hastings' })
    await apiClient.ingest.wikidata({ queryType: 'custom' })
    expect(postMock.mock.calls[0]![2].headers).toBeUndefined()
    expect(postMock.mock.calls[1]![2].headers).toBeUndefined()
  })
})
