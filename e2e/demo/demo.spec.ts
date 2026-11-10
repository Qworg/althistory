import { test, expect, type Page } from '@playwright/test'

/**
 * The GitHub Pages demo: the real frontend, with its API answered in the
 * browser from a recording of the real backend (frontend/src/demo).
 */

const COUNTS = '19 events · 4 arcs · 24 links'

/** Fails the test on any request that leaves the page's own origin. */
function forbidNetwork(page: Page, baseURL: string): string[] {
  const outside: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (!url.startsWith(baseURL) && !url.startsWith('data:')) outside.push(url)
  })
  return outside
}

test('boots with the seeded history and nothing leaves the page', async ({ page, baseURL }) => {
  const outside = forbidNetwork(page, baseURL!)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('./')
  await expect(page.getByRole('region', { name: 'About this demo' })).toBeVisible()
  await expect(page.getByText(COUNTS)).toBeVisible()
  await expect(page.locator('g[data-timeline-mark="event"]')).toHaveCount(19)

  for (const view of ['causal-graph', 'actor-perspective', 'timeline']) {
    await page.goto(`./#/${view}`)
    await expect(page.getByRole('main')).toBeVisible()
  }
  await expect(page.getByText(COUNTS)).toBeVisible()
  expect(outside).toEqual([])
  expect(errors).toEqual([])
})

test('an edit lasts for the tab, and Start over undoes it', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText(COUNTS)).toBeVisible()

  await page.getByRole('button', { name: 'Create Event' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Description/).fill('The engines reach Calcutta')
  await dialog.getByLabel(/Actor/).fill('East India Company')
  await dialog.getByLabel(/Target/).fill('Calcutta')
  await dialog.getByLabel(/^Date/).fill('1857-03-01 09:00')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)

  await expect(page.getByText('20 events · 4 arcs · 24 links')).toBeVisible()
  await expect(page.locator('g[data-timeline-mark="event"][aria-label*="The engines reach Calcutta"]')).toBeVisible()

  await page.reload()
  await expect(page.getByText('20 events · 4 arcs · 24 links')).toBeVisible()

  await page.getByRole('button', { name: 'Start over' }).click()
  await expect(page.getByText(COUNTS)).toBeVisible()
})

test('switches to the branch', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText(COUNTS)).toBeVisible()
  await page.getByRole('button', { name: /The Engine Age/ }).first().click()
  await page.getByText('Clerks Prevail').first().click()
  await expect(page.getByText('21 events · 4 arcs · 25 links')).toBeVisible()
  await expect(page.getByText(/Branch of\s*The Engine Age/)).toBeVisible()
})

test('a feature that needs the server says so', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText(COUNTS)).toBeVisible()
  await page.getByRole('button', { name: 'Bring in history', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Extract from text or Wikipedia/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'Text' }).click()
  await dialog.getByRole('textbox').first().fill('On 14 February 1870, the Royal Society honoured Ada Lovelace with the Copley Medal.')
  await dialog.getByRole('button', { name: /Extract/ }).click()
  await expect(dialog.getByText(/needs the althistory server/)).toBeVisible()
})
