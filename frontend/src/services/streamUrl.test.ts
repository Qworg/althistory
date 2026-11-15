import { describe, it, expect } from 'vitest'
import { getWebSocketStreamUrl } from './streamUrl'

describe('getWebSocketStreamUrl', () => {
  it('points at the stream endpoint over ws, with the token escaped', () => {
    const url = getWebSocketStreamUrl('a+b/c')
    expect(url).toMatch(/^wss?:\/\//)
    expect(url).toContain('/api/ws/stream?token=a%2Bb%2Fc')
  })
})
