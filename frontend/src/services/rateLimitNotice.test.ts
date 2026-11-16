import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useGlobalStore } from '@/stores/globalStore'
import {
  noticeRateLimited,
  retryAfterSeconds,
  describeRefusedRequest,
  reportApiError,
  retryText,
} from './rateLimitNotice'

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
    // No number in the text: the notice centre counts the wait down from retryAt.
    expect(message).not.toMatch(/\d/)
    const notice = useGlobalStore.getState().errors.find((e) => e.message === message)
    expect(notice?.retryAt).toBeGreaterThan(Date.now() + 2000)
    expect(notice?.retryAt).toBeLessThanOrEqual(Date.now() + 3000)
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

  it('moves the one notice\'s retryAt on a repeat refusal, so its countdown follows the server', () => {
    noticeRateLimited(refused({}, { error: { retryAfter: 30 } }), { method: 'post', url: '/graphs/g2/activate' })
    const first = useGlobalStore.getState().errors[0]!
    noticeRateLimited(refused({}, { error: { retryAfter: 58 } }), { method: 'post', url: '/graphs/g2/activate' })
    const notices = useGlobalStore.getState().errors
    expect(notices).toHaveLength(1)
    expect(notices[0]?.id).toBe(first.id)
    expect(notices[0]?.message).toBe(first.message)
    expect(notices[0]!.retryAt! - first.retryAt!).toBeGreaterThan(20000)
  })

  it('counts the wait down in words', () => {
    const now = 1_000_000
    expect(retryText(now + 12_000, now)).toBe('Try again in 12 seconds.')
    expect(retryText(now + 1_000, now)).toBe('Try again in 1 second.')
    expect(retryText(now - 1, now)).toBe('You can try again now.')
    expect(retryText(undefined, now)).toBe('Try again in a moment.')
  })

  it('does not notify for a job-status poll, and words it as a check if it is ever shown', () => {
    expect(noticeRateLimited(refused({}, { error: { retryAfter: 3 } }), { method: 'get', url: '/import/jobs/job_1' })).toBeNull()
    expect(useGlobalStore.getState().errors).toHaveLength(0)
    expect(describeRefusedRequest({ method: 'get', url: '/import/jobs/job_1' })).toBe('Checking on the job')
  })

  it('adds nothing when a caller only restates a refusal the notice already shows', () => {
    noticeRateLimited(refused({}, { error: { retryAfter: 12 } }), { method: 'post', url: '/events' })
    const refusal = Object.assign(new Error('The event was refused'), { status: 429, refusal: 'The event was refused' })
    reportApiError('Failed to save event', refusal)
    expect(useGlobalStore.getState().errors).toHaveLength(1)
  })

  it('adds the caller\'s own notice for a failure that is not a refusal', () => {
    reportApiError('Failed to save event', new Error('disk full'))
    expect(useGlobalStore.getState().errors.map((e) => e.message)).toEqual(['Failed to save event: disk full'])
    reportApiError(null, new Error('plain'), 'validation')
    expect(useGlobalStore.getState().errors[1]).toMatchObject({ message: 'plain', type: 'validation' })
  })

  it('never merges text into a notice: addError only adds', () => {
    noticeRateLimited(refused({}, { error: { retryAfter: 12 } }), { method: 'post', url: '/events' })
    const notice = useGlobalStore.getState().errors[0]!
    useGlobalStore.getState().addError({ type: 'network', message: `Failed: ${notice.message} Version history.` })
    useGlobalStore.getState().addError({ type: 'network', message: `Failed: ${notice.message} Another.` })
    const all = useGlobalStore.getState().errors
    expect(all).toHaveLength(3)
    expect(all[0]).toEqual(notice)
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
