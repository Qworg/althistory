import { afterEach, describe, expect, it, vi } from 'vitest'
import { isOnline, subscribeConnectivity } from './connectivity'

function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  })
}

describe('connectivity', () => {
  afterEach(() => {
    setNavigatorOnline(true)
  })

  it('reports navigator.onLine', () => {
    setNavigatorOnline(false)
    expect(isOnline()).toBe(false)

    setNavigatorOnline(true)
    expect(isOnline()).toBe(true)
  })

  it('notifies subscribers on offline/online events and unsubscribes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeConnectivity(listener)

    window.dispatchEvent(new Event('offline'))
    window.dispatchEvent(new Event('online'))

    expect(listener.mock.calls).toEqual([[false], [true]])

    unsubscribe()
    window.dispatchEvent(new Event('offline'))
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
