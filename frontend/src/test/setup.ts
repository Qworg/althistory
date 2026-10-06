import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
// Registers the jest-dom matchers on Vitest's `expect` and augments the
// `Assertion` / `AsymmetricMatchersContaining` interfaces with their types
// (this replaces the hand-written `src/test/vitest.d.ts` module augmentation).
import '@testing-library/jest-dom/vitest'
// Registers `toHaveNoViolations` on Vitest's `expect` (and augments the
// `Assertion` interface) so accessibility checks assert on rendered output.
import 'vitest-axe/extend-expect'

// Mock ResizeObserver (not available in jsdom).
// jsdom has no `ResizeObserver`, so the global is replaced by this stand-in,
// which implements the same interface (each method stays a spy).
class ResizeObserverMock implements ResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

globalThis.ResizeObserver = ResizeObserverMock

// runs a cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup()
})