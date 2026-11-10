import { describe, it, expect } from 'vitest'
import { APIError } from '@/services/api'
import { describeIngestError } from './ingestErrors'

describe('describeIngestError', () => {
  it('turns a server failure fetching Wikipedia into a next step, keeping the server text as detail', () => {
    const view = describeIngestError(new APIError('Internal server error', 500), 'wikipedia')
    expect(view.message).toMatch(/couldn't fetch from Wikipedia/)
    expect(view.message).toMatch(/Text tab/)
    expect(view.message).not.toMatch(/Internal server error/)
    expect(view.detail).toBe('500: Internal server error')
    expect(view.offerText).toBe(true)
  })

  it('says a missing article is missing', () => {
    expect(describeIngestError(new APIError('Not found', 404), 'wikipedia').message).toMatch(/nothing at that address/)
  })

  it('says Wikipedia is rate-limiting, rather than that the fetch broke', () => {
    const view = describeIngestError(new APIError('Wikipedia is limiting how fast…', 503), 'wikipedia')
    expect(view.message).toMatch(/Wikipedia is limiting/)
    expect(view.message).toMatch(/lower the page count/)
    expect(view.offerText).toBe(false)
  })

  it('keeps a validation message, which names the field', () => {
    const view = describeIngestError(new APIError('text must not be empty', 400), 'text')
    expect(view.message).toBe('text must not be empty')
    expect(view.offerText).toBe(false)
  })

  it('separates an unreachable server from a failing one', () => {
    expect(describeIngestError(new APIError('Network error', 0, 'NETWORK_ERROR'), 'text').message).toMatch(/Couldn't reach/)
  })

  it('reassures that a failed import added nothing', () => {
    expect(describeIngestError(new Error('boom'), 'import').message).toMatch(/nothing was added/)
  })
})
