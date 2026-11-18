import { test, expect } from '@playwright/test'
import { installApiStub, defaultGraphs } from './support/api'

/**
 * #43: the notification stack (and the other toasts) drop beneath the graph
 * picker, and any modal dialog, while one is open; they are lowered, not
 * hidden, so notices are still announced. See the layering rule in
 * frontend/src/index.css.
 */

function twoGraphs() {
  const [main] = defaultGraphs()
  return [main!, { ...main!, id: 'graph-alt', name: 'Alternative Branch' }]
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test.describe(`notification stack under the graph picker at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport })

    test('the picker stays clickable with a notice showing', async ({ page, context }) => {
      await installApiStub(page, { graphs: twoGraphs() })
      await page.goto('/')
      await expect(page.locator('svg[data-timeline-canvas]')).toBeVisible()

      // Open the picker, then a real notice arrives: going offline.
      await page.getByRole('button', { name: /Main Timeline/ }).first().click()
      const row = page.getByText('Alternative Branch').last()
      await expect(row).toBeVisible()
      await context.setOffline(true)
      await expect(page.locator('[aria-label="Notifications"]').getByText(/You are offline/)).toBeAttached()
      // Make the stack as tall as it can be, so it would cover the picker
      // wherever that is. Its z-index is still the token's.
      await page.addStyleTag({
        content: '[aria-label="Notifications"]{top:0!important;max-height:none!important;pointer-events:auto!important}',
      })

      // Nothing from the notification stack is on top of the row.
      const covered = await row.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return hit !== null && hit.closest('[aria-label="Notifications"]') !== null
      })
      expect(covered).toBe(false)

      // Nor is the picker's footer under the offline pill or any other notice.
      const footerCovered = await page.getByRole('button', { name: /New Graph/ }).evaluate((el) => {
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return hit !== null && hit.closest('[aria-label="Notifications"], [data-testid="offline-indicator"]') !== null
      })
      expect(footerCovered).toBe(false)
      await row.click({ timeout: 3000 })

      // Lowered, not hidden: the live region is still there to announce.
      await expect(page.locator('[aria-label="Notifications"][aria-live="polite"]')).toHaveCount(1)
    })

    test('a notice that arrives while the picker is open is still announced', async ({ page, context }) => {
      await installApiStub(page, { graphs: twoGraphs() })
      await page.goto('/')
      await page.getByRole('button', { name: /Main Timeline/ }).first().click()
      await expect(page.getByText('Alternative Branch').last()).toBeVisible()
      await context.setOffline(true)
      await expect(page.locator('[aria-label="Notifications"][aria-live="polite"]').getByText(/You are offline/)).toBeAttached()
    })
  })
}
