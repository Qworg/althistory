import { test, expect } from '@playwright/test'
import { installApiStub } from './support/api'

/**
 * Flow 2: create an event through the real UI and see it appear.
 *
 * This is a genuine write path: the form POSTs to `/api/events`, the stub
 * stores the created event, React Query invalidates the event list, the app
 * refetches it, and the new mark must show up in the timeline. A mocked API
 * client cannot prove any of those links.
 */
test.describe('create event', () => {
  test('creates an event through the UI and renders it on the timeline', async ({ page }) => {
    const state = await installApiStub(page)

    await page.goto('/')
    await expect(page.getByText('3 events, 1 arcs')).toBeVisible()

    await page.getByRole('button', { name: 'Create Event' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Create Event' })).toBeVisible()

    await dialog.getByLabel(/Description/).fill('Harrying of the North')
    await dialog.getByLabel(/Actor/).fill('William of Normandy')
    await dialog.getByLabel(/Target/).fill('Northern England')
    await dialog.getByLabel(/Timestamp/).fill('1069-01-15T09:00')

    await dialog.getByRole('button', { name: 'Save' }).click()

    // The modal closes only after the mutation resolves.
    await expect(dialog).toHaveCount(0)

    // The server received exactly the typed payload.
    expect(state.createdEvents).toHaveLength(1)
    expect(state.createdEvents[0]).toMatchObject({
      description: 'Harrying of the North',
      actor: 'William of Normandy',
      target: 'Northern England',
    })
    expect(state.createdEvents[0]?.timestamp).toContain('1069-01-15')

    // The write is observable through the UI: the refetched list now has four
    // events and the new one is rendered.
    await expect(page.getByText('4 events, 1 arcs')).toBeVisible()
    await expect(
      page.locator('g[data-timeline-mark="event"][aria-label*="Harrying of the North"]'),
    ).toBeVisible()
    expect(state.unhandled).toEqual([])
  })
})
