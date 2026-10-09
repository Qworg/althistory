import { test, expect } from '@playwright/test'
import { installApiStub } from './support/api'

/**
 * Flow 1: the app loads, the timeline renders, and the expected events appear.
 *
 * This is the floor the rest of the suite stands on. It runs the real
 * production bundle against stubbed HTTP and asserts on rendered SVG marks,
 * not on the API client (which is what the unit suite mocks).
 */
test.describe('timeline smoke', () => {
  test('renders the stubbed events and arcs in the timeline', async ({ page }) => {
    const state = await installApiStub(page)

    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Timeline View' })).toBeVisible()
    await expect(page.getByText('3 events, 1 arcs')).toBeVisible()

    // The marks are real DOM nodes the D3/React timeline rendered.
    await expect(page.locator('g[data-timeline-mark="event"]')).toHaveCount(3)

    await expect(
      page.locator('g[data-timeline-mark="event"][aria-label*="Battle of Hastings"]'),
    ).toBeVisible()
    await expect(
      page.locator('g[data-timeline-mark="event"][aria-label*="Battle of Stamford Bridge"]'),
    ).toBeVisible()
    await expect(
      page.locator('g[data-timeline-mark="event"][aria-label*="Coronation of William I"]'),
    ).toBeVisible()

    await expect(page.locator('svg[role="img"]')).toHaveAttribute(
      'aria-label',
      'Timeline with 3 events and 1 arcs',
    )

    // Hermeticity check: the covered flow must not have hit an unstubbed route.
    expect(state.unhandled).toEqual([])
  })
})
