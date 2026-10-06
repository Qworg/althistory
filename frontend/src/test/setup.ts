import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
// Registers the jest-dom matchers on Vitest's `expect` and augments the
// `Assertion` / `AsymmetricMatchersContaining` interfaces with their types
// (this replaces the hand-written `src/test/vitest.d.ts` module augmentation).
import '@testing-library/jest-dom/vitest'
// Registers `toHaveNoViolations` on Vitest's `expect` (and augments the
// `Assertion` interface) so accessibility checks assert on rendered output.
//
// Scope of these checks -- what a passing `toHaveNoViolations()` does and does
// not prove under axe + jsdom:
//   Covers: element roles, accessible names, label/control associations, ARIA
//   attribute validity, and required-children / required-parent relationships
//   within the DOM node handed to `axe()`.
//   Does NOT cover:
//   - Colour contrast or any rule that needs computed layout. jsdom performs no
//     layout and does not apply Tailwind, so axe cannot evaluate those rules.
//   - Responsive visibility. Tailwind classes like `hidden sm:inline` are inert
//     in jsdom, so a label hidden at narrow viewports is treated as visible.
//     A ViewToolbar button's `aria-label` is therefore redundant here and only
//     matters at real narrow viewports; these assertions do not prove the
//     accessible name still holds once the visible text is hidden.
//   - Portaled content. `axe(container)` sees only the subtree under
//     `container`; a React portal (none of the components under test use one
//     today) would fall outside the check.
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