import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useGlobalStore } from '@/stores/globalStore'
import { noticeRateLimited, retryAfterSeconds, describeRefusedRequest } from './rateLimitNotice'

const refused = (headers: Record<string, string> = {}, data: unknown = {}) => ({ status: 429, headers, data })

describe('noticeRateLimited', () => {
  beforeEach(() => {
    useGlobalStore.setState({ errors: [] })
  })

  it('reads the wait from the error body', () => {
    expect(retryAfterSeconds(refused({}, { error: { retryAfter: 12 } }))).toBe(12)
  })

  it('falls back to the Retry-After header, in seconds or as a date', () => {
    expect(retryAfterSeconds(refused({ 'retry-after': '7' }))).toBe(7)
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(retryAfterSeconds(refused({ 'Retry-After': 'Thu, 01 Jan 2026 00:00:30 GMT' }), now)).toBe(30)
    expect(retryAfterSeconds(refused())).toBeNull()
  })

  it.each([
    ['post', '/graphs/g2/activate', 'Switching graphs'],
    ['post', '/events', 'Saving the event'],
    ['put', '/arcs/a1', 'Saving the arc'],
    ['post', '/causal/link', 'Saving the link'],
    ['post', '/batch', 'The batch update'],
    ['post', '/import', 'The import'],
    ['post', '/ingest/text', 'The ingestion'],
    ['post', '/generate/timeline', 'The generation request'],
    ['post', '/stream/token', 'Starting live sync'],
  ])('says what a refused %s %s was', async (method, url, what) => {
    expect(describeRefusedRequest({ method, url })).toBe(what)
    const message = noticeRateLimited(refused({}, { error: { retryAfter: 3 } }), { method, url })
    expect(message).toContain(`${what} was refused`)
    expect(message).toContain('Try again in 3 seconds')
    expect(useGlobalStore.getState().errors.map((e) => e.message)).toContain(message)
  })

  it('shows one notice for a burst of identical refusals', () => {
    for (let i = 0; i < 5; i++) {
      noticeRateLimited(refused({ 'retry-after': '9' }), { method: 'get', url: '/events' })
    }
    expect(useGlobalStore.getState().errors).toHaveLength(1)
  })

  it('ignores other statuses', () => {
    expect(noticeRateLimited({ status: 500 }, { method: 'get', url: '/events' })).toBeNull()
    expect(useGlobalStore.getState().errors).toHaveLength(0)
  })

  it('updates one notice with the new wait instead of stacking a notice per second', () => {
    for (const wait of [30, 29, 28, 27]) {
      noticeRateLimited(refused({}, { error: { retryAfter: wait } }), { method: 'post', url: '/graphs/g2/activate' })
    }
    const notices = useGlobalStore.getState().errors
    expect(notices).toHaveLength(1)
    expect(notices[0]?.message).toContain('Try again in 27 seconds')
  })

  it('does not notify for a job-status poll, and words it as a check if it is ever shown', () => {
    expect(noticeRateLimited(refused({}, { error: { retryAfter: 3 } }), { method: 'get', url: '/import/jobs/job_1' })).toBeNull()
    expect(useGlobalStore.getState().errors).toHaveLength(0)
    expect(describeRefusedRequest({ method: 'get', url: '/import/jobs/job_1' })).toBe('Checking on the job')
  })

  it("drops a caller's own report of a refusal the client already showed", () => {
    const shown = noticeRateLimited(refused({}, { error: { retryAfter: 12 } }), { method: 'post', url: '/events' })
    // What a caller writes: its own prefix plus the thrown APIError's message.
    useGlobalStore.getState().addError({ type: 'network', message: `Failed to create event: ${shown}` })
    expect(useGlobalStore.getState().errors).toHaveLength(1)
    useGlobalStore.getState().addError({ type: 'network', message: 'Failed to create event: disk full' })
    expect(useGlobalStore.getState().errors).toHaveLength(2)
  })

  describe('expiry', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('clears the notice once the wait has passed', () => {
      noticeRateLimited(refused({}, { error: { retryAfter: 10 } }), { method: 'post', url: '/events' })
      expect(useGlobalStore.getState().errors).toHaveLength(1)
      vi.advanceTimersByTime(9000)
      expect(useGlobalStore.getState().errors).toHaveLength(1)
      vi.advanceTimersByTime(5000)
      expect(useGlobalStore.getState().errors).toHaveLength(0)
    })
  })
})
