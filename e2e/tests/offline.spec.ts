import { test, expect } from '@playwright/test'
import { installApiStub } from './support/api'

/**
 * Flow 4: the offline indicator appears when the browser goes offline.
 *
 * OfflineIndicator is driven by the browser's `online`/`offline` events, which
 * only a real browser emits. `context.setOffline` is a real connectivity change,
 * not a mocked store write.
 */
test.describe('offline indicator', () => {
  test('appears when the browser goes offline and disappears on reconnect', async ({
    page,
    context,
  }) => {
    await installApiStub(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Timeline View' })).toBeVisible()

    // Online with no queued work: the indicator renders nothing.
    await expect(page.getByTestId('offline-indicator')).toHaveCount(0)

    await context.setOffline(true)
    const indicator = page.getByTestId('offline-indicator')
    await expect(indicator).toBeVisible()
    await expect(indicator).toHaveAttribute('data-online', 'false')
    await expect(indicator).toContainText('Offline')

    await context.setOffline(false)
    await expect(indicator).toHaveCount(0)
  })
})
