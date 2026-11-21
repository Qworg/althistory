import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearDiagnostics,
  installDiagnostics,
  pathOnly,
  recentDiagnostics,
  recordApiFailure,
  recordBoundaryError,
  scrubSecrets,
} from './diagnostics'

describe('diagnostics', () => {
  beforeEach(() => clearDiagnostics())

  it('keeps a failed call’s method, path, status, code and request id, and nothing of its query', () => {
    recordApiFailure({
      method: 'post',
      url: '/events?search=secret%20plans&api_key=ak_abcdefghijklmnopqrstuvwxyz',
      baseURL: '/api',
      status: 500,
      code: 'DATABASE_ERROR',
      requestId: 'req_1',
      message: 'Request failed with status code 500',
    })
    const [entry] = recentDiagnostics()
    expect(entry?.request).toEqual({ method: 'POST', path: '/events', status: 500, code: 'DATABASE_ERROR', requestId: 'req_1' })
    expect(JSON.stringify(entry)).not.toMatch(/secret|ak_/)
  })

  it('reads an absolute URL down to its path', () => {
    expect(pathOnly('https://host.example/api/graphs/g1?x=1#y')).toBe('/api/graphs/g1')
    expect(pathOnly(undefined)).toBe('')
  })

  it('keeps only the last fifteen entries', () => {
    for (let i = 0; i < 20; i++) recordBoundaryError(new Error(`boom ${i}`))
    const entries = recentDiagnostics()
    expect(entries).toHaveLength(15)
    expect(entries[0]?.message).toBe('Error: boom 5')
  })

  it('caps a message and the stack', () => {
    const error = new Error('x'.repeat(1000))
    recordBoundaryError(error)
    const [entry] = recentDiagnostics()
    expect(entry!.message.length).toBeLessThanOrEqual(300)
    expect(entry!.stack!.split('\n').length).toBeLessThanOrEqual(6)
  })

  it('scrubs secrets from messages', () => {
    expect(scrubSecrets('Authorization: Bearer abc.def-ghi')).toBe('Authorization: Bearer [redacted]')
    expect(scrubSecrets('api_key=hunter2&x=1')).toBe('api_key=[redacted]&x=1')
    expect(scrubSecrets('"token": "t0k3n"')).toBe('"token": "[redacted]"')
    expect(scrubSecrets('used ak_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')).toBe('used [redacted key]')
  })

  it('records uncaught errors and rejections once installed, but not a failed image load', () => {
    installDiagnostics()
    installDiagnostics() // idempotent
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('x is undefined'), message: 'x is undefined' }))
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(rejection, 'reason', { value: 'nope' })
    window.dispatchEvent(rejection)
    window.dispatchEvent(new ErrorEvent('error'))
    expect(recentDiagnostics().map((d) => [d.kind, d.message])).toEqual([
      ['error', 'TypeError: x is undefined'],
      ['rejection', 'nope'],
    ])
  })

  it('returns copies, so a caller trimming them changes nothing', () => {
    recordApiFailure({ method: 'get', url: '/a', status: 404 })
    recentDiagnostics()[0]!.request!.path = '/changed'
    expect(recentDiagnostics()[0]!.request!.path).toBe('/a')
  })
})

describe('scrubSecrets, after the first review', () => {
  it('redacts Basic credentials, JSON Web Tokens and a key glued to a word', () => {
    expect(scrubSecrets('Authorization: Basic dXNlcjpwYXNz')).toBe('Authorization: Basic [redacted]')
    expect(scrubSecrets('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc_DEF-123')).toBe('jwt [redacted token]')
    expect(scrubSecrets('xak_ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe('x[redacted key]')
  })
})
